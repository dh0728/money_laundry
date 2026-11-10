from experiment import *
import time, signal
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,str(BASE))
import evaluate_saml as e
import torch

STOP=False
def stop(signum,frame):
    global STOP
    STOP=True

def setup():
    plan=check_frozen();selection=json.loads((ROOT/'selection.json').read_text())
    assert selection['plan_sha256']==sha(ROOT/'plan.json') and not selection['saml_labels_used']
    old=json.loads((BASE/'protocol.json').read_text())
    for name,h in old['source'].items():assert sha(BASE/name)==h,name
    cache=json.loads((BASE/'cache/complete.json').read_text())
    for name,info in cache['inputs'].items():
        st=Path(name).stat();assert (st.st_size,st.st_mtime_ns)==(info['size'],info['mtime_ns']),name
    for name,info in cache['generated'].items():
        st=(BASE/'cache'/name).stat();assert (st.st_size,st.st_mtime_ns)==(info['size'],info['mtime_ns']),name
    new={name:np.array(owners('saml',name)) for name in METHODS}
    assert all(a.shape==(855460,3) and np.isfinite(a).all() for a in new.values())
    protocol=dict(plan_sha256=sha(ROOT/'plan.json'),selection_sha256=sha(ROOT/'selection.json'),
        source_selected_method=selection['selected_method'],target_methods=METHODS,
        owner_sha256={name:sha(ROOT/f'saml_{name}_owners.npy') for name in METHODS},
        original_saml_protocol_sha256=sha(BASE/'protocol.json'),rows=N,threshold=.5,
        checkpoint_sha256=WEIGHT_SHA,graph_order_sampling='Same original SAML order and samplers; both methods share each sampled batch',
        labels_used_to_choose_methods=False,weights_retrained=False,source_sha256=plan['source_sha256'])
    if (ROOT/'target_protocol.json').exists():assert json.loads((ROOT/'target_protocol.json').read_text())==protocol
    else:write('target_protocol.json',protocol)
    return new

def preflight(model,config,graph,adapter,tables,new):
    path=ROOT/'target_preflight.json'
    if path.exists():
        assert json.loads(path.read_text())['protocol_sha256']==sha(ROOT/'target_protocol.json');return
    order=np.load(BASE/'cache/order.npy',mmap_mode='r');old=np.load(BASE/'cache/logits.npy',mmap_mode='r')
    ref_adapter=e.SamlAdapter();checks=[]
    with torch.inference_mode():
        for index in [0,1,(N//2048)//2,N//2048]:
            ids=order[index*2048:min((index+1)*2048,N)]
            sampled=e.sample_next(iter(graph.loader(ids,batch_size=2048)),config,'test',0,index)
            rows,batch,_=adapter.materialize(graph,sampled,ids);assert np.array_equal(rows,np.arange(len(ids)))
            baseline,selected=model(batch)
            np.testing.assert_allclose(baseline.cpu().numpy(),old[ids],rtol=1e-5,atol=1e-5)
            err=float(np.max(np.abs(baseline.cpu().numpy()-old[ids])))
            nodes=sampled['node'].n_id.to('cuda');batch.node_features=batch.node_features.clone()
            for name in METHODS:
                batch.node_features[:,16:19]=tables[name][nodes]
                rr,ref,_=ref_adapter.materialize(graph,sampled,ids)
                ref.node_features[:,16:19]=torch.from_numpy(new[name][sampled['node'].n_id.numpy()])
                for key,v in vars(batch).items():torch.testing.assert_close(v.cpu(),getattr(ref,key),rtol=0,atol=0)
                predicted,selected=model(batch);rz,_=model(ref.to('cuda'))
                assert torch.equal(selected,torch.arange(len(ids),device='cuda')) and torch.isfinite(predicted).all()
                torch.testing.assert_close(predicted,rz,rtol=1e-5,atol=1e-5)
                checks.append(dict(batch=index,method=name,rows=len(ids),baseline_max_error=err,
                    modified_inputs_bitwise_CPU_parity=True,modified_scores_CPU_GPU_parity=True,only_owner_fields_changed=True))
                del ref,predicted,rz
            del sampled,batch,nodes,baseline;trim()
    write('target_preflight.json',dict(passed=True,protocol_sha256=sha(ROOT/'target_protocol.json'),checks=checks))
    event('target_preflight_passed',checks=len(checks))

def run():
    new=setup();protocol_sha=sha(ROOT/'target_protocol.json')
    chunks=ROOT/'target_chunks';chunks.mkdir(exist_ok=True)
    model,config,graph,adapter=e.load()
    tables={name:torch.tensor(a,device='cuda') for name,a in new.items()}
    preflight(model,config,graph,adapter,tables,new)
    order=np.load(BASE/'cache/order.npy',mmap_mode='r');step=32*2048;already=0
    for path in chunks.glob('*.json'):
        d=json.loads(path.read_text());assert d['protocol_sha256']==protocol_sha and sha(path.with_suffix('.npz'))==d['sha256'];already+=d['rows']
    completed=already;started=time.monotonic()
    with torch.inference_mode(),ThreadPoolExecutor(max_workers=1) as pool:
        for start in range(0,N,step):
            marker=chunks/f'{start:08d}.json'
            if marker.exists():continue
            end=min(start+step,N);ids=order[start:end];count=(len(ids)+2047)//2048
            iterator=iter(graph.loader(ids,batch_size=2048))
            future=pool.submit(e.sample_next,iterator,config,'test',0,start//2048)
            z=np.empty((len(METHODS),len(ids)),np.float32);seen=np.zeros(len(ids),bool);chunk_start=time.monotonic()
            for local in range(count):
                index=start//2048+local;sampled=future.result()
                if local+1<count:future=pool.submit(e.sample_next,iterator,config,'test',0,index+1)
                rows,batch,_=adapter.materialize(graph,sampled,ids);assert not seen[rows].any()
                nodes=sampled['node'].n_id.to('cuda');batch.node_features=batch.node_features.clone()
                for j,name in enumerate(METHODS):
                    batch.node_features[:,16:19]=tables[name][nodes]
                    pred,selected=model(batch)
                    assert torch.equal(selected,torch.arange(len(rows),device='cuda')) and torch.isfinite(pred).all()
                    z[j,rows]=pred.cpu().numpy();del pred,selected
                seen[rows]=True;done=completed+int(seen.sum());speed=(done-already)/(time.monotonic()-started)
                if index%8==0 or done==N:event('target_progress',completed=done,total=N,methods=len(METHODS),
                    percent=100*done/N,rows_per_second=speed,eta_seconds=(N-done)/speed)
                del sampled,batch,nodes
            assert seen.all()
            tmp=marker.with_suffix('.tmp.npz');np.savez(tmp,ids=ids,logits=z,methods=np.asarray(METHODS));tmp.replace(marker.with_suffix('.npz'))
            write(str(marker.relative_to(ROOT)),dict(protocol_sha256=protocol_sha,rows=len(ids),start=start,end=end,
                sha256=sha(marker.with_suffix('.npz')),seconds=time.monotonic()-chunk_start))
            completed+=len(ids);trim()
            if STOP:event('interrupted',completed=completed,total=N);return
    event('target_inference_complete',rows=N,methods=METHODS,elapsed_seconds=time.monotonic()-started)
    del model,graph,adapter,tables;torch.cuda.empty_cache();trim()
    import report
    report.main()

if __name__=='__main__':
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop);run()
