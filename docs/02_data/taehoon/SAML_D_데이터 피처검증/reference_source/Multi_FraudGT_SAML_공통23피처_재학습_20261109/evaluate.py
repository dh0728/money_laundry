"""Full paired HI/SAML test, after freezing the HI-validation-selected model."""
from experiment import *
import gc, time
from dataclasses import replace
from common_model import compact_model, ReducedGPU
from fraudgt_lab.data import FeatureAdapter
from fraudgt_lab.official_loader import PeriodGraph
from fraudgt_lab.population import Labels
from fraudgt_lab.training import sample_next
from fraudgt_lab.metrics import binary_average_precision
from fraudgt_lab.storage import write_csv

BATCH, CHUNK = 2048, 2048*64

def selected():
    folder=RUN/'models'/VARIANT
    done=read(folder/'complete.json');assert done['epochs']==MAX_EPOCHS
    cp=folder/'best.pt';assert done['checkpoint_sha256']==digest(cp)
    saved=torch.load(cp,map_location='cpu',weights_only=False)
    assert saved['epoch']==done['best']['epoch']
    assert saved['plan_sha256']==digest(OUT/'plan.json') and saved['code_manifest_sha256']==digest(OUT/'code_manifest.json')
    frozen=dict(checkpoint_sha256=digest(cp),selected_epoch=saved['epoch'],selection='HI validation F1 only',
        plan_sha256=digest(OUT/'plan.json'),code_manifest_sha256=digest(OUT/'code_manifest.json'))
    if (OUT/'frozen_selection.json').exists():assert read(OUT/'frozen_selection.json')==frozen
    else:write(OUT/'frozen_selection.json',frozen)
    c=replace(config(),readout='all_targets');model=compact_model(c).cuda().eval()
    model.load_state_dict(saved['state_dict'],strict=True)
    return model,c,frozen

def metrics(y,z):
    from sklearn.metrics import roc_auc_score,average_precision_score
    y=np.asarray(y)>0;z=np.asarray(z);assert y.shape==z.shape and np.isfinite(z).all()
    pred=z>0;tp=int((y&pred).sum());fp=int((~y&pred).sum());fn=int((y&~pred).sum());tn=int((~y&~pred).sum())
    ratio=lambda a,b:float(a/b) if b else 0.
    ap=binary_average_precision(y,z)
    reference=float(average_precision_score(y,z));assert abs(ap-reference)<1e-12
    return dict(rows=len(y),positive=int(y.sum()),normal=int((~y).sum()),coverage=1.,
        TP=tp,FP=fp,FN=fn,TN=tn,precision=ratio(tp,tp+fp),recall=ratio(tp,tp+fn),
        F1=ratio(2*tp,2*tp+fp+fn),AP=ap,ROC_AUC=float(roc_auc_score(y,z)),FPR=ratio(fp,fp+tn),
        threshold_probability=.5,threshold_rule='logit > 0')

def scope_arrays(scope):
    if scope=='hi_test':
        order=np.load(read(OUT/'plan.json')['final_evaluation']['hi_test_order'],mmap_mode='r')
        y=Labels()(order)
    else:
        order=np.load(SAML/'cache/order.npy',mmap_mode='r')
        y=np.asarray(np.load(SAML/'cache/labels.npy',mmap_mode='r')[order])
    return order,y

def baseline_scores(scope,order,y):
    if scope=='saml':return np.asarray(np.load(SAML/'cache/logits.npy',mmap_mode='r')[order])
    z=np.empty(len(order),np.float32);cursor=0
    for path in sorted((HI_TEST/'chunks').glob('*.npz')):
        with np.load(path) as part:
            n=len(part['transaction_id']);assert np.array_equal(part['transaction_id'],order[cursor:cursor+n])
            if 'actual_class' in part:assert np.array_equal(part['actual_class'],y[cursor:cursor+n])
            if 'scored' in part:assert part['scored'].all()
            z[cursor:cursor+n]=part['logit'];cursor+=n
    assert cursor==len(order) and np.isfinite(z).all()
    return z

def score(scope):
    verify_contract();torch.set_num_threads(2);torch.cuda.set_per_process_memory_fraction(.90)
    folder=OUT/'evaluation'/scope;folder.mkdir(parents=True,exist_ok=True)
    if (folder/'complete.json').exists():
        result=read(folder/'complete.json');assert result['scores_sha256']==digest(folder/'scores.npy')
        assert result['selection']==read(OUT/'frozen_selection.json')
        return
    order,y=scope_arrays(scope);model,c,frozen=selected()
    request=dict(scope=scope,rows=len(order),selection=frozen,order_sha256=digest(Path(read(OUT/'plan.json')['final_evaluation']['hi_test_order']) if scope=='hi_test' else SAML/'cache/order.npy'),
        sampler_scope='test',sampler_epoch=0,global_batch_index=True,batch_size=BATCH,readout='all_targets',threshold='logit > 0')
    if (folder/'request.json').exists():assert read(folder/'request.json')==request
    else:write(folder/'request.json',request)
    request_sha=digest(folder/'request.json')
    if scope=='hi_test':
        event('evaluation_cache_loading',scope=scope)
        graph=PeriodGraph('test',VARIANT,c);adapter=ReducedGPU(FeatureAdapter(True));adapter.set_graph(graph)
    else:
        from saml_runtime import SamlGraph,ReducedSamlGPU
        graph=SamlGraph(c);adapter=ReducedSamlGPU(graph)
    path=folder/'scores.npy'
    scores=np.load(path,mmap_mode='r+') if path.exists() else np.lib.format.open_memmap(path,'w+',dtype='float32',shape=(len(order),))
    chunks=folder/'chunks';chunks.mkdir(exist_ok=True)
    completed=0
    for path in sorted(chunks.glob('*.json')):
        meta=read(path);assert meta['start']==completed and meta['request_sha256']==request_sha
        block=np.asarray(scores[meta['start']:meta['stop']]);assert hashlib.sha256(block.tobytes()).hexdigest()==meta['scores_sha256']
        completed=meta['stop']
    begin=time.monotonic();already=completed
    # Serial sampler keeps global CPU RNG and graph construction identical.
    with torch.inference_mode():
        for start in range(completed,len(order),CHUNK):
            stop_check();ensure_salt_paused();stop=min(start+CHUNK,len(order));ids=order[start:stop]
            iterator=iter(graph.loader(ids,batch_size=BATCH));seen=np.zeros(len(ids),bool);values=np.empty(len(ids),'float32')
            for local in range((len(ids)+BATCH-1)//BATCH):
                sampled=sample_next(iterator,c,'test',0,start//BATCH+local)
                rows,batch,_=adapter.materialize(graph,sampled,ids);z,selection=model(batch.to('cuda'))
                assert torch.equal(selection,torch.arange(len(rows),device='cuda'))
                out=z.cpu().numpy();assert np.isfinite(out).all() and not seen[rows].any()
                values[rows]=out;seen[rows]=True
                if local%16==15:
                    done=start+int(seen.sum());speed=(done-already)/(time.monotonic()-begin)
                    event('evaluation_progress',scope=scope,completed=done,total=len(order),percent=100*done/len(order),
                        targets_per_second=speed,eta_seconds=(len(order)-done)/speed)
                del sampled,batch,z,selection
            assert seen.all();scores[start:stop]=values;scores.flush()
            write(chunks/f'{start:012d}.json',dict(start=start,stop=stop,request_sha256=request_sha,
                scores_sha256=hashlib.sha256(values.tobytes()).hexdigest()))
            stop_check();gc.collect()
    del model,graph,adapter;gc.collect();torch.cuda.empty_cache()
    result=metrics(y,scores);baseline=baseline_scores(scope,order,y);reference=metrics(y,baseline)
    original=read(SAML/'result.json') if scope=='saml' else read(HI_TEST/'result.json')
    # Full archived HI metrics have nested structures; comparison always derives
    # directly from the preserved transaction-aligned score shards above.
    if scope=='saml':
        for key in ('TP','FP','FN','TN'):assert reference[key]==original[key]
        assert abs(reference['AP']-original['AP'])<1e-12
    comparison=[dict(model='original_34',scope=scope,**reference),dict(model='common_23',scope=scope,**result)]
    write_csv(folder/'metrics.csv',comparison)
    write(folder/'comparison.json',dict(scope=scope,original_34=reference,common_23=result,
        delta={k:result[k]-reference[k] for k in ('AP','ROC_AUC','precision','recall','F1','FP','FPR')}))
    if scope=='saml':
        import pyarrow.parquet as pq
        truth=Path('/workspace/kimi/Claude_GNN/final_model/experiments/v10_saml_generalization_20261025/cache/truth.parquet')
        table=pq.read_table(truth,columns=['eid','pattern']);assert np.array_equal(table['eid'].to_numpy(),np.arange(len(order)))
        patterns=table['pattern'].to_pandas().to_numpy()[order];rows=[]
        for pattern in sorted(set(patterns)):
            mask=patterns==pattern;positive=y[mask]>0
            for name,z in [('original_34',baseline),('common_23',scores)]:
                pred=z[mask]>0;tp=int((positive&pred).sum());fp=int((~positive&pred).sum())
                rows.append(dict(model=name,pattern=pattern,rows=int(mask.sum()),positive=int(positive.sum()),normal=int((~positive).sum()),
                    TP=tp,FP=fp,FN=int((positive&~pred).sum()),TN=int((~positive&~pred).sum()),
                    recall=tp/int(positive.sum()) if positive.any() else None,FPR=fp/int((~positive).sum()) if (~positive).any() else None))
        write_csv(folder/'pattern_metrics.csv',rows)
        for name in ('original_34','common_23'):
            chosen=[r for r in rows if r['model']==name];expected=reference if name=='original_34' else result
            assert sum(r['rows'] for r in chosen)==len(order)
            for key in ('TP','FP','FN','TN'):assert sum(r[key] for r in chosen)==expected[key]
    write(folder/'complete.json',dict(status='complete',utc=utc(),selection=frozen,coverage=1.,scored=len(order),
        scores_sha256=digest(folder/'scores.npy'),request_sha256=request_sha,metrics=result,baseline=reference))
    verify_contract();event('evaluation_complete',scope=scope,metrics=result)

if __name__=='__main__':
    install_signals()
    try:
        with run_lock():score(sys.argv[1])
    except StopRequested as error:event('paused',detail=str(error))
