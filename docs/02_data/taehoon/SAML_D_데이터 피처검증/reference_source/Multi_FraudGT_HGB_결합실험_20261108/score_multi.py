"""Original PyG sampling and Multi model with lossless GPU input lookup."""
from experiment import *
import gc, ctypes
from dataclasses import replace
from types import SimpleNamespace
from concurrent.futures import ThreadPoolExecutor
import torch
from fraudgt_lab import GRAPH_ROOT
from fraudgt_lab.config import TrainConfig, EDGE_INDICES
from fraudgt_lab.data import FeatureAdapter, GraphBatch
from fraudgt_lab.official_loader import PeriodGraph, FORWARD, REVERSE
from fraudgt_lab.models import make_model
from fraudgt_lab.training import sample_next
from salt_daily.cuda_features import CudaFeatureStore
BATCH=2048
CHUNK=64*BATCH

def trim():
    gc.collect();ctypes.CDLL('libc.so.6').malloc_trim(0)

class GpuAdapter:
    def __init__(self,cpu):
        # Explicit original Multi input root; do not rely on SALT's fallback path.
        cpu.inputs.test=np.load(GRAPH_ROOT/'cache/hi/test_edge17.npy',mmap_mode='r')
        cpu.inputs.test_origin=read_json(GRAPH_ROOT/'cache/hi/test_edges_complete.json')['origin']
        extra=SimpleNamespace(in_ports=cpu.port_arrays[0],out_ports=cpu.port_arrays[1],formats=cpu.formats)
        self.cache=CudaFeatureStore(cpu.inputs,extra,len(cpu.inputs.minute),list(EDGE_INDICES))
        self.original={};self.node=self.src=self.dst=None

    def set_graph(self,graph):
        self.original.clear();self.node=self.src=self.dst=None
        torch.cuda.empty_cache()
        # Keep full ID maps compact; convert only selected rows to int64.
        self.original={k:torch.tensor(np.asarray(v).astype('int32'),device='cuda') for k,v in graph.ids.items()}
        self.node=torch.tensor(np.asarray(graph.nodes),device='cuda')
        self.src=torch.tensor(np.asarray(graph.src),device='cuda')
        self.dst=torch.tensor(np.asarray(graph.dst),device='cuda')

    def materialize(self,graph,sampled,seed_ids):
        rows=sampled[FORWARD].input_id.numpy()
        targets=torch.tensor(np.asarray(seed_ids[rows]).astype('int64'),device='cuda')
        forward=self.original[FORWARD][sampled[FORWARD].e_id.to('cuda')].long()
        reverse=self.original[REVERSE][sampled[REVERSE].e_id.to('cuda')].long()
        all_ids=torch.cat([forward,reverse]);nodes=sampled['node'].n_id.to('cuda')
        indices=torch.cat([sampled[FORWARD].edge_index.to('cuda'),sampled[REVERSE].edge_index.to('cuda').flip(0)],dim=1)
        target_index=sampled[FORWARD].edge_label_index.to('cuda')
        assert torch.equal(nodes[target_index[0]],self.src[targets].long())
        assert torch.equal(nodes[target_index[1]],self.dst[targets].long())
        assert torch.equal(nodes[indices[0]],self.src[all_ids].long())
        assert torch.equal(nodes[indices[1]],self.dst[all_ids].long())
        ego=torch.zeros(len(nodes),dtype=torch.float32,device='cuda');ego[target_index.flatten()]=1
        node_features=torch.cat([self.node[nodes],ego[:,None]],dim=1)
        ordered,order=torch.sort(forward);offset=torch.searchsorted(ordered,targets)
        valid=offset<len(order);safe=offset.clamp(max=len(order)-1)
        valid &= ordered[safe]==targets
        positions=torch.where(valid,order[safe],-1)
        incoming=torch.arange(len(all_ids),device='cuda')<len(forward)
        edge=self.cache.edges(all_ids);target=self.cache.edges(targets)
        batch=GraphBatch(node_features,indices,edge[:,:22],target_index,target[:,:22],incoming,~incoming,positions,edge[:,22:],target[:,22:])
        return rows,batch

def preflight(model,config,cpu,gpu):
    checks=[]
    for scope in ('test','val'):
        graph=PeriodGraph(scope,'multi_fraudgt_format',config);gpu.set_graph(graph)
        if scope=='test':
            with np.load(TEST/'chunks/0000.npz') as part:
                ids=part['transaction_id'][:BATCH].copy();saved=part['logit'][:BATCH].copy()
        else:
            p=population('fusion_fit');order=np.random.default_rng(1000045).permutation(len(p))
            ids=p.ids[order[:BATCH]].copy();del order
        t=time.monotonic()
        sampled=sample_next(iter(graph.loader(ids,batch_size=BATCH)),config,scope,0,0)
        rows,reference,_=cpu.materialize(graph,sampled,ids)
        gpu_rows,batch=gpu.materialize(graph,sampled,ids)
        np.testing.assert_array_equal(rows,gpu_rows)
        for field,value in vars(reference).items():
            assert torch.equal(value,getattr(batch,field).cpu()),field
        logits,selected=model(batch);ref_logits,ref_selected=model(reference.to('cuda'))
        torch.testing.assert_close(logits,ref_logits,atol=1e-5,rtol=1e-5)
        np.testing.assert_array_equal(selected.cpu().numpy(),np.arange(len(rows)))
        item=dict(scope=scope,rows=len(ids),all_input_tensors_bitwise_equal=True,
                  cpu_gpu_logit_max_abs_error=float((logits-ref_logits).abs().max()),seconds=time.monotonic()-t)
        if scope=='test':
            np.testing.assert_allclose(logits.cpu().numpy(),saved[rows],atol=1e-5,rtol=1e-5)
            item['archived_test_max_abs_error']=float(np.max(np.abs(logits.cpu().numpy()-saved[rows])))
        checks.append(item);log('preflight_pass',**item)
        del graph,sampled,reference,batch,logits,selected,ref_logits,ref_selected;trim()
    write(OUT/'preflight.json',dict(passed=True,utc=utc(),plan_sha256=sha(OUT/'plan.json'),checks=checks))

def score(scope,model,config,graph,gpu):
    data=population(scope);folder=OUT/'gnn_scores'/scope;folder.mkdir(parents=True,exist_ok=True)
    complete=folder/'complete.json'
    if complete.exists():gnn_scores(scope);return
    order_path=folder/'order.npy'
    if not order_path.exists():np.save(order_path,np.random.default_rng(1000045).permutation(len(data)).astype('uint32'))
    order=np.load(order_path,mmap_mode='r')
    request=dict(scope=scope,rows=len(data),order_sha256=sha(order_path),plan_sha256=sha(OUT/'plan.json'),population=data.meta['files'])
    if (folder/'request.json').exists():assert read_json(folder/'request.json')==request
    else:write(folder/'request.json',request)
    chunks=folder/'chunks';chunks.mkdir(exist_ok=True)
    score_path=folder/'scores.npy'
    scores=(np.load(score_path,mmap_mode='r+') if score_path.exists() else
        np.lib.format.open_memmap(score_path,'w+',dtype='float32',shape=(len(data),)))
    completed=0
    for meta in sorted(chunks.glob('*.json')):
        d=read_json(meta);assert d['start']==completed and d['request_sha256']==sha(folder/'request.json')
        values=np.asarray(scores[order[d['start']:d['stop']]])
        assert hashlib.sha256(values.tobytes()).hexdigest()==d['score_block_sha256']
        completed=d['stop']
    already=completed;t0=time.monotonic();last_event=0.
    with ThreadPoolExecutor(max_workers=1) as pool:
        for start in range(completed,len(data),CHUNK):
            ensure_paused();stop=min(start+CHUNK,len(data));take=order[start:stop];ids=data.ids[take]
            iterator=iter(graph.loader(ids,batch_size=BATCH));count=(len(ids)+BATCH-1)//BATCH
            values=np.empty(len(ids),'float32');seen=np.zeros(len(ids),bool);t_chunk=time.monotonic()
            timings=dict(sampler_wait=0.,feature=0.,gpu=0.)
            future=pool.submit(sample_next,iterator,config,'val',0,start//BATCH)
            for local in range(count):
                t=time.monotonic();sampled=future.result();timings['sampler_wait']+=time.monotonic()-t
                if local+1<count:future=pool.submit(sample_next,iterator,config,'val',0,start//BATCH+local+1)
                t=time.monotonic();rows,batch=gpu.materialize(graph,sampled,ids);timings['feature']+=time.monotonic()-t
                t=time.monotonic();logits,selected=model(batch);z=logits.cpu().numpy();selection=selected.cpu().numpy();timings['gpu']+=time.monotonic()-t
                assert np.array_equal(selection,np.arange(len(rows))) and not seen[rows].any() and np.isfinite(z).all()
                values[rows]=z;seen[rows]=True
                done=start+int(seen.sum());elapsed=time.monotonic()-t0;speed=(done-already)/elapsed
                if time.monotonic()-last_event>=15 or local+1==count:
                    log('inference',scope=scope,completed=done,total=len(data),percent=100*done/len(data),rows_per_second=speed,
                        eta_seconds=(len(data)-done)/speed,gpu_allocated_bytes=torch.cuda.memory_allocated(),gpu_peak_bytes=torch.cuda.max_memory_allocated())
                    last_event=time.monotonic()
                del sampled,batch,logits,selected,z,selection
            assert seen.all();scores[take]=values;scores.flush()
            write(chunks/f'{start:012d}.json',dict(start=start,stop=stop,request_sha256=sha(folder/'request.json'),
                score_block_sha256=hashlib.sha256(values.tobytes()).hexdigest(),seconds=time.monotonic()-t_chunk,timings=timings))
            del iterator,ids,values,seen;trim()
    assert np.isfinite(scores).all()
    write(complete,dict(status='complete',utc=utc(),coverage=1.,scored=len(data),plan_sha256=sha(OUT/'plan.json'),
        scores_sha256=sha(score_path),request_sha256=sha(folder/'request.json'),population=data.meta['files']))
    log('scope_complete',scope=scope,rows=len(data),seconds=time.monotonic()-t0)

def run():
    check_frozen();checkpoint=torch.load(MODEL,map_location='cpu',weights_only=False)
    assert checkpoint['epoch']==280 and checkpoint['variant']=='multi_fraudgt_format'
    config=replace(TrainConfig(**checkpoint['config']),readout='all_targets')
    assert config.seed_batch==2048 and config.graph_mode=='shared' and config.loader_workers==0
    torch.set_num_threads(2);torch.manual_seed(config.seed);torch.cuda.set_per_process_memory_fraction(.90)
    model=make_model(checkpoint['variant'],config).eval().to('cuda');model.load_state_dict(checkpoint['state_dict'],strict=True)
    cpu=FeatureAdapter(use_ports=True);log('gpu_cache_loading')
    with torch.inference_mode():
        gpu=GpuAdapter(cpu);log('gpu_cache_ready',seconds=gpu.cache.initialization_seconds)
        preflight(model,config,cpu,gpu)
        graph=PeriodGraph('val','multi_fraudgt_format',config);gpu.set_graph(graph)
        for scope in ('fusion_fit','validation'):score(scope,model,config,graph,gpu)
    check_frozen();log('multi_inference_complete')

if __name__=='__main__':run()
