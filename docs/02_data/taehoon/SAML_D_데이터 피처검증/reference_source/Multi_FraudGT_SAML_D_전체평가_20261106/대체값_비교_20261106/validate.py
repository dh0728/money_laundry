from imputation import *
import sys,time
from dataclasses import replace
sys.path.insert(0,str(DIAG))
import missing_control as m
m.log=lambda stage,**kw:event('validation_'+stage,**kw)
import torch,pandas as pd
from sklearn.metrics import average_precision_score

CASES=['original','zero',*METHODS]

def main():
    plan=check_frozen();plan_sha=sha(ROOT/'plan.json')
    if (ROOT/'selection.json').exists():
        assert json.loads((ROOT/'selection.json').read_text())['plan_sha256']==plan_sha
        return
    chunks=ROOT/'validation_chunks';chunks.mkdir(exist_ok=True)
    pop=np.load(HI/'assets/val_ids.npy',mmap_mode='r')
    count=128*2048
    path=ROOT/'validation_ids.npy'
    if not path.exists():
        positions=np.random.default_rng(20261107).permutation(len(pop))[:count].copy()
        np.save(path,np.asarray(pop[positions],dtype='uint32'))
    all_ids=np.load(path,mmap_mode='r');assert len(np.unique(all_ids))==count
    saved=torch.load(BASE/'selected_best.pt',map_location='cpu',weights_only=False)
    config=replace(m.TrainConfig(**saved['config']),readout='all_targets')
    torch.set_num_threads(2);torch.manual_seed(42);torch.cuda.set_per_process_memory_fraction(.9)
    model=m.make_model('multi_fraudgt_format',config).eval().to('cuda');model.load_state_dict(saved['state_dict'],strict=True)
    graph=m.PeriodGraph('val','multi_fraudgt_format',config);reference=m.FeatureAdapter(use_ports=True)
    cache=m.PackedGpuInputs(graph,reference)
    tables={method:torch.tensor(owners(graph.nodes,method),device='cuda') for method in METHODS}
    labels=m.Labels();parity=[];started=time.monotonic();new_count=0
    with torch.inference_mode():
        for index in range(128):
            file=chunks/f'{index:04d}.npz'
            if file.exists():continue
            ids=np.asarray(all_ids[index*2048:(index+1)*2048],dtype='int64');t=time.monotonic()
            sampled=m.sample_next(iter(graph.loader(ids,batch_size=2048)),config,'val',0,index)
            rows,batch,eu,qu=cache.materialize(graph,sampled,ids);assert np.array_equal(rows,np.arange(2048))
            if index in [0,64,127]:
                rr,ref,_=reference.materialize(graph,sampled,ids);assert np.array_equal(rows,rr)
                for key,value in vars(batch).items():torch.testing.assert_close(value.cpu(),getattr(ref,key),rtol=0,atol=0)
                parity.append(dict(batch=index,bitwise_input_parity=True));del ref
            zero=m.changed(batch,'missing11',eu,qu)
            output=[];nodes=sampled['node'].n_id.to('cuda')
            for case in CASES:
                if case=='original':item=batch
                elif case=='zero':item=zero
                else:
                    fields=vars(zero).copy();fields['node_features']=zero.node_features.clone()
                    fields['node_features'][:,16:19]=tables[case][nodes];item=m.GraphBatch(**fields)
                z,selected=model(item);assert torch.isfinite(z).all() and torch.equal(selected,torch.arange(2048,device='cuda'))
                output.append(z.cpu().numpy());del item,z,selected
            temp=file.with_suffix('.tmp.npz')
            np.savez(temp,ids=ids,y=labels(ids),logits=np.stack(output),cases=np.asarray(CASES),plan_sha256=plan_sha)
            temp.replace(file);new_count+=1
            event('validation_progress',completed=index+1,total=128,batch_seconds=time.monotonic()-t,
                  eta_seconds=(time.monotonic()-started)/new_count*(127-index))
            del batch,zero,sampled,eu,qu,nodes,output;trim()
    write('validation_parity.json',dict(passed=True,checks=parity))
    del model,cache,graph,tables,reference;torch.cuda.empty_cache();trim()
    ys=[];zs=[];ids=[]
    for file in sorted(chunks.glob('*.npz')):
        with np.load(file) as p:
            assert str(p['plan_sha256'])==plan_sha
            ys.append(p['y']);zs.append(p['logits']);ids.append(p['ids'])
    y=np.concatenate(ys)>0;z=np.concatenate(zs,axis=1)
    assert len(y)==count and np.array_equal(np.concatenate(ids),all_ids)
    results=[]
    for i,case in enumerate(CASES):
        pred=z[i]>0;tp=int((pred&y).sum());fp=int((pred&~y).sum());fn=int((~pred&y).sum());tn=int((~pred&~y).sum())
        ratio=lambda a,b:a/b if b else 0.
        ap=m.binary_average_precision(y,z[i]);assert abs(ap-average_precision_score(y,z[i]))<1e-12
        results.append(dict(method=case,rows=count,positive=int(y.sum()),TP=tp,FP=fp,FN=fn,TN=tn,
            precision=ratio(tp,tp+fp),recall=ratio(tp,tp+fn),F1=ratio(2*tp,2*tp+fp+fn),FPR=ratio(fp,fp+tn),AP=ap))
    candidates=[r for r in results if r['method'] in METHODS]
    chosen=candidates[0]
    for row in candidates[1:]:
        if row['AP']>chosen['AP']+1e-12 or (abs(row['AP']-chosen['AP'])<=1e-12 and row['F1']>chosen['F1']):chosen=row
    pd.DataFrame(results).to_csv(ROOT/'validation_metrics.csv',index=False)
    write('selection.json',dict(plan_sha256=plan_sha,selected_method=chosen['method'],criterion=plan['selection'],results=results,
        validation_ids_sha256=sha(path),saml_labels_used=False,saml_predictions_used=False,checkpoint_sha256=WEIGHT_SHA))
    event('validation_complete',selected_method=chosen['method'],results=results)

if __name__=='__main__':main()
