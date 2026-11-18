from experiment import *
import time
from dataclasses import replace
sys.path.insert(0,str(DIAG))
import missing_control as m
m.log=lambda stage,**kw:event('validation_'+stage,**kw)
import torch,pandas as pd
from sklearn.metrics import average_precision_score

def main():
    plan=check_frozen();plan_sha=sha(ROOT/'plan.json')
    if (ROOT/'selection.json').exists():
        assert json.loads((ROOT/'selection.json').read_text())['plan_sha256']==plan_sha;return
    chunks=ROOT/'validation_chunks';chunks.mkdir(exist_ok=True)
    ids_all=np.load(PRIOR/'validation_ids.npy',mmap_mode='r')
    assert len(ids_all)==262144 and len(np.unique(ids_all))==262144
    saved=torch.load(BASE/'selected_best.pt',map_location='cpu',weights_only=False)
    config=replace(m.TrainConfig(**saved['config']),readout='all_targets')
    torch.set_num_threads(2);torch.manual_seed(42);torch.cuda.set_per_process_memory_fraction(.9)
    model=m.make_model('multi_fraudgt_format',config).eval().to('cuda');model.load_state_dict(saved['state_dict'],strict=True)
    graph=m.PeriodGraph('val','multi_fraudgt_format',config);reference=m.FeatureAdapter(use_ports=True)
    cache=m.PackedGpuInputs(graph,reference)
    tables={name:torch.tensor(np.array(owners('val',name)),device='cuda') for name in METHODS}
    median=torch.tensor(np.load(PRIOR/'owner_train_median.npy'),device='cuda')
    labels=m.Labels();parity=[];started=time.monotonic();new_count=0
    with torch.inference_mode():
        for index in range(128):
            file=chunks/f'{index:04d}.npz'
            if file.exists():continue
            ids=np.asarray(ids_all[index*2048:(index+1)*2048],np.int64);t=time.monotonic()
            sampled=m.sample_next(iter(graph.loader(ids,batch_size=2048)),config,'val',0,index)
            rows,batch,eu,qu=cache.materialize(graph,sampled,ids);assert np.array_equal(rows,np.arange(2048))
            if index in (0,64,127):
                rr,ref,_=reference.materialize(graph,sampled,ids);assert np.array_equal(rows,rr)
                for key,v in vars(batch).items():torch.testing.assert_close(v.cpu(),getattr(ref,key),rtol=0,atol=0)
                parity.append(dict(batch=index,bitwise_CPU_input_parity=True));del ref
            zero=m.changed(batch,'missing11',eu,qu);output=[];nodes=sampled['node'].n_id.to('cuda')
            for case in CASES:
                if case=='original':item=batch
                elif case=='zero':item=zero
                else:
                    fields=vars(zero).copy();fields['node_features']=zero.node_features.clone()
                    fields['node_features'][:,16:19]=median if case=='train_median' else tables[case][nodes]
                    item=m.GraphBatch(**fields)
                z,selected=model(item);assert torch.isfinite(z).all() and torch.equal(selected,torch.arange(2048,device='cuda'))
                output.append(z.cpu().numpy());del item,z,selected
            output=np.stack(output)
            with np.load(PRIOR/f'validation_chunks/{index:04d}.npz') as old:
                np.testing.assert_array_equal(ids,old['ids']);np.testing.assert_array_equal(labels(ids),old['y'])
                for j,case in enumerate(old['cases']):
                    np.testing.assert_allclose(output[CASES.index(str(case))],old['logits'][j],rtol=1e-5,atol=1e-5)
            temp=file.with_suffix('.tmp.npz');np.savez(temp,ids=ids,y=labels(ids),logits=output,cases=np.asarray(CASES),plan_sha256=plan_sha)
            temp.replace(file);new_count+=1
            event('validation_progress',completed=index+1,total=128,batch_seconds=time.monotonic()-t,
                eta_seconds=(time.monotonic()-started)/new_count*(127-index))
            del batch,zero,sampled,eu,qu,nodes,output;trim()
    write('validation_parity.json',dict(passed=True,checks=parity,all_four_prior_conditions_reproduced_for_all128_batches=True))
    del model,cache,graph,tables,reference;torch.cuda.empty_cache();trim()
    ys=[];zs=[];all_ids=[]
    for file in sorted(chunks.glob('*.npz')):
        with np.load(file) as a:
            assert str(a['plan_sha256'])==plan_sha and list(a['cases'])==CASES
            ys.append(a['y']);zs.append(a['logits']);all_ids.append(a['ids'])
    y=np.concatenate(ys)>0;z=np.concatenate(zs,axis=1)
    np.testing.assert_array_equal(np.concatenate(all_ids),ids_all)
    results=[]
    for j,case in enumerate(CASES):
        pred=z[j]>0;tp=int((y&pred).sum());fp=int((~y&pred).sum());fn=int((y&~pred).sum());tn=int((~y&~pred).sum())
        ratio=lambda a,b:a/b if b else 0.
        ap=m.binary_average_precision(y,z[j]);assert abs(ap-average_precision_score(y,z[j]))<1e-12
        results.append(dict(method=case,rows=len(y),positive=int(y.sum()),TP=tp,FP=fp,FN=fn,TN=tn,
            precision=ratio(tp,tp+fp),recall=ratio(tp,tp+fn),F1=ratio(2*tp,2*tp+fp+fn),AP=ap,FPR=ratio(fp,fp+tn)))
    chosen=next(r for r in results if r['method']==METHODS[0])
    for row in results:
        if row['method'] in METHODS and (row['AP']>chosen['AP']+1e-12 or (abs(row['AP']-chosen['AP'])<=1e-12 and row['F1']>chosen['F1'])):chosen=row
    pd.DataFrame(results).to_csv(ROOT/'validation_metrics.csv',index=False)
    write('selection.json',dict(plan_sha256=plan_sha,selected_method=chosen['method'],criterion=plan['source_selection'],
        results=results,validation_ids_sha256=sha(PRIOR/'validation_ids.npy'),saml_labels_used=False,saml_predictions_used=False,
        target_methods=METHODS,target_selection='Both methods are fixed in plan; source winner recorded before target inference'))
    event('validation_complete',selected_method=chosen['method'],results=results)

if __name__=='__main__':main()
