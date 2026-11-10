"""Paired, frozen-weight HI input interventions; no retraining or test tuning."""
from pathlib import Path
import os,sys,json,time,hashlib,gc,ctypes
from datetime import datetime,timezone
from dataclasses import replace
ROOT=Path(__file__).resolve().parent
FULL=ROOT.parent
HI=Path('/workspace/handoff/V10_FraudGT_조건수정_20261027')
ARCH=HI/'runs/shared_corrected_001/evaluations/multi_alltargets_fulltest_20261103'
for key in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS']:os.environ[key]='1'
sys.path.insert(0,str(HI))
import fraudgt_lab
from fraudgt_lab.config import TrainConfig,EDGE_INDICES
from fraudgt_lab.data import FeatureAdapter,GraphBatch
from fraudgt_lab.official_loader import PeriodGraph,FORWARD,REVERSE
from fraudgt_lab.models import make_model
from fraudgt_lab.training import sample_next
from fraudgt_lab.population import Labels
from fraudgt_lab.metrics import binary_average_precision
import numpy as np,torch,pandas as pd

CASES=['baseline','node_type_zero','node_owner_zero','country_zero','missing11','unknown31','missing11_unknown31']
N_BATCHES=128
BATCH=2048
SEED=20261106
RATE=2946034/9504852
WEIGHT_SHA='42d0d8002a87962291eb3f409cfbba1d1dec381c35162f11f2e11cb3a034c58f'

def now():return datetime.now(timezone.utc).isoformat()
def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
    return h.hexdigest()
def write(name,value):
    path=ROOT/name;temp=path.with_suffix('.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');temp.replace(path)
def log(stage,**kw):
    a=dict(utc=now(),stage=stage,**kw);print(json.dumps(a,ensure_ascii=False),flush=True);write('control_status.json',a)
def trim():gc.collect();ctypes.CDLL('libc.so.6').malloc_trim(0)

class PackedGpuInputs:
    """Lossless CUDA cache, using the same packing already validated for SALT."""
    def __init__(self,graph,reference):
        width=len(graph.src);inputs=reference.inputs
        self.numeric=torch.empty((width,12),dtype=torch.float32,device='cuda')
        self.packed=torch.empty(width,dtype=torch.uint8,device='cuda')
        self.unknown=torch.empty(width,dtype=torch.bool,device='cuda')
        self.nodes=torch.tensor(np.asarray(graph.nodes),device='cuda')
        # Initialize original test fallback before reading the complete prefix.
        order=np.load(json.loads((ARCH/'request.json').read_text())['ordered_test_ids_path'],mmap_mode='r')
        inputs.edges(order[:1])
        rng=np.random.default_rng(SEED+1)
        for start in range(0,width,500000):
            stop=min(start+500000,width);ids=np.arange(start,stop,dtype='int64')
            present=ids<len(inputs.edge);present[present]=inputs.present[ids[present]]!=0
            fallback=(inputs.minute[ids]>=74*1440)&(ids>=inputs.test_origin)&(ids-inputs.test_origin<len(inputs.test))
            valid=present|fallback;selected=ids[valid]
            raw=inputs.edges(selected);binary=raw[:,[12,13,14,15]]
            assert ((binary==0)|(binary==1)).all()
            pin,pout=[a[selected] for a in reference.port_arrays]
            ports_ok=(pin>=0)&(pout>=0)
            values=np.zeros((len(ids),12),dtype='float32');values[valid,:10]=raw[:,EDGE_INDICES[:10]]
            values[valid,10]=pin;values[valid,11]=pout
            fmt=reference.formats[selected].astype('int64');fmt=np.where((fmt>=0)&(fmt<7),fmt,7).astype('uint8')
            packed=np.zeros(len(ids),dtype='uint8')
            bits=sum(binary[:,i].astype('uint8')<<i for i in range(4))
            packed[valid]=(ports_ok.astype('uint8')<<7)|(fmt<<4)|bits
            self.numeric[start:stop].copy_(torch.from_numpy(values))
            self.packed[start:stop].copy_(torch.from_numpy(packed))
            self.unknown[start:stop].copy_(torch.from_numpy(rng.random(len(ids))<RATE))
            if stop%20000000==0 or stop==width:log('cache_loading',completed=stop,total=width)
        torch.cuda.synchronize();trim()

    def values(self,ids):
        packed=self.packed[ids].long();assert bool(((packed&128)!=0).all())
        v=self.numeric[ids];edge=torch.empty((len(ids),22),dtype=torch.float32,device='cuda')
        edge[:,:10]=v[:,:10]
        for i in range(4):edge[:,10+i]=(packed>>i)&1
        edge[:,14:]=0;edge[:,14:].scatter_(1,((packed>>4)&7)[:,None],1.)
        return edge,v[:,10:12]

    def materialize(self,graph,sampled,ids):
        rows=sampled[FORWARD].input_id.numpy();targets=np.asarray(ids[rows],dtype='int64')
        fi=np.asarray(graph.ids[FORWARD][sampled[FORWARD].e_id.numpy()],dtype='int64')
        ri=np.asarray(graph.ids[REVERSE][sampled[REVERSE].e_id.numpy()],dtype='int64')
        f=torch.tensor(fi,device='cuda');r=torch.tensor(ri,device='cuda');all_ids=torch.cat([f,r]);target_ids=torch.tensor(targets,device='cuda')
        nodes=sampled['node'].n_id.to('cuda');target=sampled[FORWARD].edge_label_index.to('cuda')
        index=torch.cat([sampled[FORWARD].edge_index.to('cuda'),sampled[REVERSE].edge_index.to('cuda').flip(0)],dim=1)
        cpu_nodes=sampled['node'].n_id.numpy();cpu_target=sampled[FORWARD].edge_label_index.numpy()
        assert np.array_equal(cpu_nodes[cpu_target[0]],graph.src[targets]) and np.array_equal(cpu_nodes[cpu_target[1]],graph.dst[targets])
        ego=torch.zeros(len(nodes),dtype=torch.float32,device='cuda');ego[target.flatten()]=1
        x=torch.cat([self.nodes[nodes],ego[:,None]],dim=1)
        sorted_ids,order=torch.sort(f);off=torch.searchsorted(sorted_ids,target_ids)
        ok=(off<len(f))&(sorted_ids[off.clamp(max=len(f)-1)]==target_ids)
        pos=torch.full((len(targets),),-1,dtype=torch.int64,device='cuda');pos[ok]=order[off[ok]]
        edge,ports=self.values(all_ids);query,qports=self.values(target_ids)
        incoming=torch.arange(len(all_ids),device='cuda')<len(f)
        batch=GraphBatch(x,index,edge,target,query,incoming,~incoming,pos,ports,qports)
        return rows,batch,self.unknown[all_ids],self.unknown[target_ids]

def changed(batch,case,edge_unknown,query_unknown):
    fields=vars(batch).copy()
    if case in ['node_type_zero','node_owner_zero','missing11','missing11_unknown31']:
        x=batch.node_features.clone()
        if case=='node_type_zero':x[:,10:16]=0
        elif case=='node_owner_zero':x[:,16:19]=0
        else:x[:,10:19]=0
        fields['node_features']=x
    if case in ['country_zero','missing11','unknown31','missing11_unknown31']:
        for name,mask in [('edge_features',edge_unknown),('target_features',query_unknown)]:
            x=getattr(batch,name).clone()
            if case in ['country_zero','missing11','missing11_unknown31']:x[:,10:12]=0
            if case in ['unknown31','missing11_unknown31']:
                x[mask,14:22]=0;x[mask,21]=1
            fields[name]=x
    return GraphBatch(**fields)

def main():
    chunks=ROOT/'control_chunks';chunks.mkdir(exist_ok=True)
    checkpoint=FULL/'selected_best.pt';assert sha(checkpoint)==WEIGHT_SHA
    request=json.loads((ARCH/'request.json').read_text());order=np.load(request['ordered_test_ids_path'],mmap_mode='r')
    selected=np.sort(np.random.default_rng(SEED).choice(len(order)//BATCH,N_BATCHES,replace=False))
    plan=dict(version=1,source='HI Test already evaluated previously; retrospective mechanism diagnosis',
        hypotheses=['Unavailable KYC/country features drive failure','Unknown format drives failure','Observable distribution/graph differences remain'],
        rows=N_BATCHES*BATCH,batches=N_BATCHES,global_batches=selected.tolist(),sampling='Uniform selection of128 complete original2048-target Test batches, independent of labels/scores',
        sample_seed=SEED,graph='Original cumulative HI Test graph and original neighbor RNG test/0/global_batch',
        checkpoint_sha256=WEIGHT_SHA,selected_epoch=280,readout='all_targets',threshold=0.5,fit=False,threshold_tuning=False,
        interventions={'baseline':'Unmodified inputs','node_type_zero':'All sampled node columns10:16 ->0',
            'node_owner_zero':'All sampled node columns16:19 ->0','country_zero':'All context/query numeric edge columns10:12 ->0',
            'missing11':'Node10:19 and edge10:12 ->0, same missing-feature policy as SAML',
            'unknown31':'Deterministic label-independent Bernoulli mask on global transaction IDs, format ->Unknown',
            'missing11_unknown31':'Combine missing11 with unknown31'},
        unknown_probability=RATE,unknown_seed=SEED+1,unknown_limitation='Random source masking is a sensitivity stress test, not the actual SAML Debit/Cross-border semantic mapping',
        baseline_validation='Every selected baseline batch must reproduce archived full HI Test logits',
        uncertainty='500 paired cluster bootstrap resamples of original graph batches; diagnostic estimates, not full-Test census',
        causal_limit='Identifies frozen model input sensitivity on HI; cannot recover absent SAML truth or exactly decompose its cross-domain gap',
        original_inputs_modified=False,salt_remains_paused=True,script_sha256=sha(__file__))
    if (ROOT/'control_plan.json').exists():assert json.loads((ROOT/'control_plan.json').read_text())==plan
    else:write('control_plan.json',plan)
    plan_sha=sha(ROOT/'control_plan.json')
    if len(list(chunks.glob('*.npz')))==N_BATCHES:return summarize()
    log('control_start',batches=N_BATCHES,conditions=len(CASES),rows=plan['rows'])
    saved=torch.load(checkpoint,map_location='cpu',weights_only=False)
    config=replace(TrainConfig(**saved['config']),readout='all_targets')
    torch.set_num_threads(2);torch.manual_seed(42);torch.cuda.set_per_process_memory_fraction(.9)
    model=make_model('multi_fraudgt_format',config).eval().to('cuda');model.load_state_dict(saved['state_dict'],strict=True)
    graph=PeriodGraph('test','multi_fraudgt_format',config);reference=FeatureAdapter(use_ports=True)
    cache=PackedGpuInputs(graph,reference);labels=Labels();started=time.monotonic();new_count=0
    audit=[]
    with torch.inference_mode():
        for number,index in enumerate(selected):
            file=chunks/f'{index:05d}.npz'
            if file.exists():continue
            t=time.monotonic();ids=np.asarray(order[index*BATCH:(index+1)*BATCH],dtype='int64')
            sampled=sample_next(iter(graph.loader(ids,batch_size=BATCH)),config,'test',0,int(index))
            rows,batch,eu,qu=cache.materialize(graph,sampled,ids);assert np.array_equal(rows,np.arange(BATCH))
            if number in [0,N_BATCHES//2,N_BATCHES-1]:
                rr,ref,stats=reference.materialize(graph,sampled,ids);assert np.array_equal(rows,rr)
                for name,value in vars(batch).items():torch.testing.assert_close(value.cpu(),getattr(ref,name),rtol=0,atol=0)
                audit.append(dict(global_batch=int(index),input_bitwise_parity=True,stats=stats))
                del ref
            ys=labels(ids);outputs=[]
            for case in CASES:
                modified=changed(batch,case,eu,qu)
                logits,selection=model(modified)
                assert torch.equal(selection,torch.arange(BATCH,device='cuda')) and torch.isfinite(logits).all()
                outputs.append(logits.cpu().numpy());del modified,logits,selection
            archive_path=ARCH/'chunks'/f'{int(index)//64:04d}.npz';offset=(int(index)%64)*BATCH
            with np.load(archive_path) as old:
                assert np.array_equal(old['transaction_id'][offset:offset+BATCH],ids)
                assert np.array_equal(old['actual_class'][offset:offset+BATCH],ys)
                reference_scores=old['logit'][offset:offset+BATCH]
                np.testing.assert_allclose(outputs[0],reference_scores,rtol=1e-5,atol=1e-5)
                max_error=float(np.max(np.abs(outputs[0]-reference_scores)))
            temp=file.with_suffix('.tmp.npz')
            np.savez(temp,ids=ids,y=ys,logits=np.stack(outputs),conditions=np.asarray(CASES),
                     global_batch=int(index),plan_sha256=plan_sha,baseline_archive_max_error=max_error,unknown_query_count=int(qu.sum()))
            temp.replace(file)
            new_count+=1;elapsed=time.monotonic()-started
            log('control_progress',completed=number+1,total=N_BATCHES,global_batch=int(index),seconds=time.monotonic()-t,
                eta_seconds=elapsed/new_count*(N_BATCHES-number-1),baseline_archive_max_error=max_error,gpu_peak_bytes=torch.cuda.max_memory_allocated())
            del batch,sampled,eu,qu,outputs
            trim()
    write('control_input_parity.json',dict(passed=True,checks=audit))
    del model,cache,graph,reference;torch.cuda.empty_cache();trim();summarize()

def summarize():
    records=[];ys=[];scores=[];groups=[];hashes=[];unknown_count=0
    plan=json.loads((ROOT/'control_plan.json').read_text());plan_sha=sha(ROOT/'control_plan.json')
    for group,path in enumerate(sorted((ROOT/'control_chunks').glob('*.npz'))):
        with np.load(path) as p:
            assert str(p['plan_sha256'])==plan_sha and p['logits'].shape==(len(CASES),BATCH)
            ys.append(p['y']);scores.append(p['logits']);groups.append(np.full(BATCH,group,dtype='int32'))
            unknown_count+=int(p['unknown_query_count']);hashes.append(dict(path=path.name,sha256=sha(path)))
    assert len(ys)==N_BATCHES
    y=np.concatenate(ys)>0;z=np.concatenate(scores,axis=1);group=np.concatenate(groups)
    ratio=lambda a,b:np.divide(a,b,out=np.zeros_like(np.asarray(a,dtype=float)),where=np.asarray(b)!=0)
    rng=np.random.default_rng(SEED+2);weights=rng.multinomial(N_BATCHES,np.full(N_BATCHES,1/N_BATCHES),size=500)
    base_boot=None
    for i,case in enumerate(CASES):
        pred=z[i]>0;tp=y&pred;fp=~y&pred;fn=y&~pred;tn=~y&~pred
        counts={k:int(v.sum()) for k,v in [('TP',tp),('FP',fp),('FN',fn),('TN',tn)]}
        stat=dict(condition=case,rows=len(y),positive=int(y.sum()),normal=int((~y).sum()),**counts,
                  precision=float(ratio(tp.sum(),pred.sum())),recall=float(ratio(tp.sum(),y.sum())),
                  F1=float(ratio(2*tp.sum(),2*tp.sum()+fp.sum()+fn.sum())),FPR=float(ratio(fp.sum(),(~y).sum())),AP=binary_average_precision(y,z[i]))
        sums=[weights@np.bincount(group,weights=v,minlength=N_BATCHES) for v in (tp,fp,fn,tn)]
        a,b,c,d=sums
        boots=dict(precision=ratio(a,a+b),recall=ratio(a,a+c),F1=ratio(2*a,2*a+b+c),FPR=ratio(b,b+d))
        order=np.argsort(z[i],kind='mergesort')[::-1];sorted_z=z[i,order];ends=np.r_[np.flatnonzero(np.diff(sorted_z)),len(y)-1]
        sorted_y=y[order];sorted_group=group[order];ap=[]
        for w in weights:
            rw=w[sorted_group];ctp=np.cumsum(rw*sorted_y)[ends];den=np.cumsum(rw)[ends]
            precision=ratio(ctp,den);dr=np.diff(np.r_[0,ctp])/ctp[-1]
            ap.append(float(np.sum(dr*precision)))
        boots['AP']=np.asarray(ap)
        if i==0:base_boot=boots
        for key,values in boots.items():
            lo,hi=np.quantile(values,[.025,.975]);stat[key+'_CI_low']=float(lo);stat[key+'_CI_high']=float(hi)
            diff=values-base_boot[key];lo,hi=np.quantile(diff,[.025,.975]);stat[key+'_delta_CI_low']=float(lo);stat[key+'_delta_CI_high']=float(hi)
        stat['normal_negative_to_positive']=int(((~y)&(z[0]<=0)&pred).sum())
        stat['normal_positive_to_negative']=int(((~y)&(z[0]>0)&~pred).sum())
        stat['normal_mean_logit_change']=float((z[i]-z[0])[~y].mean())
        records.append(stat);log('condition_aggregated',condition=case,F1=stat['F1'],AP=stat['AP'],FPR=stat['FPR'])
    pd.DataFrame(records).to_csv(ROOT/'control_metrics.csv',index=False)
    write('control_result.json',dict(completed_utc=now(),rows=len(y),positive=int(y.sum()),batches=N_BATCHES,
        source_scope='Uniform128 batches from HI full Test',results=records,unknown_query_fraction=unknown_count/len(y),
        plan_sha256=plan_sha,baseline_all_batches_reproduce_archived_scores=True,chunks=hashes))
    log('control_complete',rows=len(y),positive=int(y.sum()))

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='summarize':summarize()
    else:main()
