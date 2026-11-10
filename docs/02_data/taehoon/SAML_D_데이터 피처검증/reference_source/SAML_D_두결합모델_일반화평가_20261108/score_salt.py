"""Native A3 daily graph/inputs on SAML; fixed HI-trained model and delta."""
from experiment import *
import ctypes as C,gc,subprocess
import torch
from graph_runtime import SAMLInputs
from salt_daily.data import DailyData,tensors,cleanup
from salt_daily.shared_topology import SharedTopology
from salt_daily.cuda_topology import CudaTopology
from salt_daily.cuda_features import CudaFeatureStore
from salt_daily.extra_features import ExtraEdgeFeatures
from salt_daily.model import DailySALT,model_kwargs

def date(day):return str(np.datetime64('2022-10-07')+np.timedelta64(int(day),'D'))

class ResidentSamlFeatures(CudaFeatureStore):
    def __init__(self):
        self.device=torch.device('cuda');self.nodes=self.degree=None
        self.edge=torch.empty((N,24),dtype=torch.float32,device='cuda')
        edge=np.load(OLD/'cache/edge22.npy',mmap_mode='r')
        ports=[np.load(OLD/'cache'/f'{role}_ports.npy',mmap_mode='r') for role in ('incoming','outgoing')]
        for start in range(0,N,500000):
            stop=min(start+500000,N)
            values=np.column_stack([edge[start:stop],ports[0][start:stop],ports[1][start:stop]]).astype('float32')
            assert np.isfinite(values).all() and (values[:,22:]>=0).all()
            self.edge[start:stop].copy_(torch.from_numpy(values))
        torch.cuda.synchronize()
    def edges(self,ids):return self.edge[ids]

class SamlDailyData(DailyData):
    def __init__(self):
        self.topology=CudaTopology('saml',cap=100)
        self.inputs=SAMLInputs();self.edge_indices=EDGE_INDICES
        assert self.topology.width==N and self.topology.nn==855460
        self.extra_features=ExtraEdgeFeatures.__new__(ExtraEdgeFeatures)
        self.extra_features.formats=self.inputs.x[:,17]
        self.extra_features.in_ports=np.load(OLD/'cache/incoming_ports.npy',mmap_mode='r')
        self.extra_features.out_ports=np.load(OLD/'cache/outgoing_ports.npy',mmap_mode='r')
        self.gpu_features=ResidentSamlFeatures()
        self.degree=np.zeros((self.topology.nn,2),np.int64);self.degree_day=-1;self.day=None
    def set_day(self,day):
        self.day=int(day);self.inputs.set_day(date(day))
        if day<self.degree_day:self.degree[:]=0;self.degree_day=-1
        for d in range(self.degree_day+1,day+1):
            ids=self.inputs.order[self.inputs.bounds[d]:self.inputs.bounds[d+1]]
            self.degree[:,0]+=np.bincount(self.topology.dst[ids],minlength=self.topology.nn)
            self.degree[:,1]+=np.bincount(self.topology.src[ids],minlength=self.topology.nn)
        self.degree_day=day
        assert self.degree.sum(axis=0).tolist()==[int(self.inputs.bounds[day+1])]*2
        # Node counts are an independent source feature computation.
        np.testing.assert_array_equal(self.inputs.nodes[:,0],np.log1p(self.degree[:,1]).astype('float32'))
        np.testing.assert_array_equal(self.inputs.nodes[:,1],np.log1p(self.degree[:,0]).astype('float32'))
        self.gpu_features.set_day(self.inputs.nodes,self.degree)

def independent_degrees(loader,day):
    source=SALT/'salt_daily/degree.c';library=OUT/'degree_reference.so'
    if not library.exists():subprocess.run(['gcc','-O3','-fPIC','-shared',str(source),'-o',str(library)],check=True)
    lib=C.CDLL(str(library));p64=C.POINTER(C.c_int64);p32=C.POINTER(C.c_int32);pu=C.POINTER(C.c_uint32)
    lib.prefix_counts.argtypes=[p64,pu,p32,C.c_int64,C.c_int64,p64]
    for direction,offset_index in enumerate((2,6)):
        offsets,ids=loader.topology.indices[offset_index:offset_index+2]
        counts=np.empty(loader.topology.nn,np.int64)
        lib.prefix_counts(offsets.ctypes.data_as(p64),ids.ctypes.data_as(pu),loader.topology.minute.ctypes.data_as(p32),
            loader.topology.nn,(day+1)*1440,counts.ctypes.data_as(p64))
        np.testing.assert_array_equal(counts,loader.degree[:,direction])

def preflight(model,loader):
    records=[];spans=read_json(OUT/'population.json')['spans'];order=np.load(OUT/'day_order.npy',mmap_mode='r')
    for span in [spans[0],spans[len(spans)//2],spans[-1]]:
        day=span['day'];loader.set_day(day);independent_degrees(loader,day)
        ids=order[span['start']:min(span['start']+4096,span['stop'])].astype('int64')
        graph=loader.topology.batch_tensors(ids)
        reference_graph=SharedTopology.batch(loader.topology,ids)
        for a,b in zip(graph,reference_graph):np.testing.assert_array_equal(a.cpu().numpy(),b)
        gpu,_=loader.materialize_gpu(ids,graph);cpu,_=loader.materialize_cpu(ids,reference_graph)
        for a,b in zip(gpu,cpu):np.testing.assert_array_equal(a.cpu().numpy(),b)
        actual=model(*tensors(gpu,'cuda'));reference=model(*tensors(cpu,'cuda'))
        torch.testing.assert_close(actual,reference,rtol=2e-5,atol=2e-4)
        assert np.all(loader.topology.minute[reference_graph[1]]<(day+1)*1440)
        item=dict(day=date(day),targets=len(ids),sampled_edges=len(graph[1]),graph_arrays_exact=True,input_arrays_exact=True,
            all_node_degrees_match_independent_prefix_counts=True,no_later_day_context=True,
            max_logit_error=float((actual-reference).abs().max()))
        records.append(item);log('salt_preflight_pass',**item)
        del graph,reference_graph,gpu,cpu,actual,reference;cleanup()
    np.testing.assert_array_equal(loader.inputs.nodes,np.load(OLD/'cache/nodes19.npy',mmap_mode='r'))
    write(OUT/'salt_preflight.json',dict(passed=True,checks=records,final_node_state_matches_previous_saml=True,
        checkpoint_delta_unchanged=model.delta.cpu().tolist(),utc=utc()))

def run():
    check_frozen();folder=OUT/'scores/A3';folder.mkdir(parents=True,exist_ok=True)
    if (folder/'complete.json').exists():scores('A3');return
    protocol=read_json(SALT/'protocol.json');checkpoint=torch.load(A3,map_location='cpu',weights_only=False)
    assert checkpoint['epoch']==6 and checkpoint['variant']=='A3'
    torch.set_num_threads(1);torch.manual_seed(42);torch.cuda.set_per_process_memory_fraction(.9)
    model=DailySALT('A3',**model_kwargs(protocol,checkpoint['delta'])).eval().cuda();model.load_state_dict(checkpoint['model'],strict=True)
    expected_delta=torch.tensor(checkpoint['delta'],dtype=torch.float32,device='cuda');assert torch.equal(model.delta,expected_delta)
    log('salt_cuda_setup');loader=SamlDailyData();order=np.load(OUT/'day_order.npy',mmap_mode='r')
    spans=read_json(OUT/'population.json')['spans'];commits=folder/'commits';commits.mkdir(exist_ok=True)
    path=folder/'scores.npy'
    z=np.load(path,mmap_mode='r+') if path.exists() else np.lib.format.open_memmap(path,'w+',dtype='float32',shape=(N,))
    cursor=0;seconds=0.
    for file in sorted(commits.glob('*.json')):
        m=read_json(file);assert m['start']==cursor and m['plan_sha256']==sha(OUT/'plan.json')
        values=np.asarray(z[order[m['start']:m['stop']]])
        assert np.isfinite(values).all() and hashlib.sha256(values.tobytes()).hexdigest()==m['sha256']
        cursor=m['stop'];seconds+=m['seconds']
    started=time.monotonic();already=cursor;last_log=0.;data={'ids':order}
    with torch.inference_mode():
        preflight(model,loader)
        for span in spans:
            if span['stop']<=cursor:continue
            ensure_paused();loader.set_day(span['day'])
            while cursor<span['stop']:
                t=time.monotonic();stop=min(cursor+8192,span['stop']);take=np.arange(cursor,stop,dtype='int64')
                values=np.full(len(take),np.nan,np.float32);seen=np.zeros(len(take),bool)
                for part,arrays,stats in loader.microbatches(data,take,microbatch=4096,max_edges=6000000):
                    prediction=model(*tensors(arrays,'cuda')).cpu().numpy();relative=part-cursor
                    assert np.isfinite(prediction).all() and not seen[relative].any()
                    values[relative]=prediction;seen[relative]=True
                    del arrays,prediction
                assert seen.all();z[order[take]]=values;z.flush();duration=time.monotonic()-t;seconds+=duration
                write(commits/f'{cursor:012d}.json',dict(start=cursor,stop=stop,day=span['day'],seconds=duration,
                    sha256=hashlib.sha256(values.tobytes()).hexdigest(),plan_sha256=sha(OUT/'plan.json')))
                cursor=stop
                if time.monotonic()-last_log>=20 or cursor==N:
                    elapsed=time.monotonic()-started;rate=(cursor-already)/elapsed
                    log('salt_inference',day=date(span['day']),completed=cursor,total=N,percent=100*cursor/N,rows_per_second=rate,
                        eta_seconds=(N-cursor)/rate,gpu_allocated_bytes=torch.cuda.memory_allocated(),gpu_peak_bytes=torch.cuda.max_memory_allocated())
                    last_log=time.monotonic()
            cleanup()
    assert cursor==N and np.isfinite(z).all() and torch.equal(model.delta,expected_delta)
    score_complete('A3',dict(seconds=seconds,delta_unchanged=model.delta.cpu().tolist(),daily_graph_protocol=True))
    check_frozen();log('salt_complete',rows=N,seconds=seconds)

if __name__=='__main__':run()
