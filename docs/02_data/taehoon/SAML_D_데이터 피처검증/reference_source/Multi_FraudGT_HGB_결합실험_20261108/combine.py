from experiment import *
import argparse, warnings, gc
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.exceptions import ConvergenceWarning
from sklearn.metrics import average_precision_score
from threadpoolctl import threadpool_limits
from salt_daily.metrics import confusion, ranking

def align_test():
    check_frozen();data=population('test');folder=OUT/'gnn_scores/test';folder.mkdir(parents=True,exist_ok=True)
    if (folder/'complete.json').exists():gnn_scores('test');return
    # Dense inverse index avoids assumptions about day-sorted vs shuffled IDs.
    width=int(data.ids.max())+1
    inverse=np.full(width,-1,dtype='int32');inverse[data.ids]=np.arange(len(data),dtype='int32')
    assert len(np.unique(data.ids))==len(data)
    seen=np.zeros(len(data),bool)
    scores=np.lib.format.open_memmap(folder/'scores.npy','w+',dtype='float32',shape=(len(data),))
    request_sha=sha(TEST/'request.json');records=[];cursor=0
    for path in sorted((TEST/'chunks').glob('*.json')):
        meta=read_json(path);part=path.parent/meta['predictions_file']
        assert meta['request_sha256']==request_sha and meta['start']==cursor
        assert sha(part)==meta['predictions_sha256']
        with np.load(part) as values:
            ids=values['transaction_id'];s=values['logit'];y=values['actual_class']
            assert values['scored'].all() and np.isfinite(s).all() and (ids<width).all()
            take=inverse[ids]
            assert (take>=0).all() and len(np.unique(take))==len(take) and not seen[take].any()
            np.testing.assert_array_equal(data.y[take],y)
            assert len(ids)==meta['end']-meta['start']
            scores[take]=s;seen[take]=True
        records.append(dict(file=meta['predictions_file'],sha256=meta['predictions_sha256'],rows=len(ids)))
        cursor=meta['end']
    assert seen.all() and cursor==len(data);scores.flush()
    # Original Multi used >0. Audit equality before using common >=0 metrics.
    zeros=int(np.count_nonzero(scores==0));assert zeros==0,'Handle original strict >0 rule explicitly if any exact zero'
    fixed=confusion(data.y,scores);old=read_json(TEST/'result.json')
    for key,value in old['confusion_scored'].items():assert fixed[key]==value
    write(folder/'complete.json',dict(status='complete',utc=utc(),coverage=1.,scored=len(data),plan_sha256=sha(OUT/'plan.json'),
        scores_sha256=sha(folder/'scores.npy'),source_request_sha256=request_sha,source_shards=records,
        all_labels_equal=True,unique_complete_id_alignment=True,exact_zero_logits=zeros,original_confusion_reproduced=True))
    log('archived_test_aligned',rows=len(data),chunks=len(records),exact_zero_logits=zeros)

def fusion_scores(scope,bundle):
    folder=OUT/'fusion_scores';folder.mkdir(exist_ok=True)
    data=population(scope);g=gnn_scores(scope);h=hgb_scores(scope)
    result=np.lib.format.open_memmap(folder/f'{scope}.npy','w+',dtype='float64',shape=(len(data),))
    for start in range(0,len(data),250000):
        x=np.column_stack((h[start:start+250000],g[start:start+250000]))
        result[start:start+len(x)]=bundle['model'].decision_function(bundle['scaler'].transform(x))
    result.flush();assert np.isfinite(result).all();return result

def best_f1(y,s):
    order=np.argsort(-s,kind='stable');values=np.asarray(s)[order]
    ends=np.r_[np.flatnonzero(values[:-1]!=values[1:]),len(values)-1]
    tp=np.cumsum(np.asarray(y)[order]>0,dtype=np.int64)[ends]
    f1=2*tp/(int(np.count_nonzero(y))+ends+1);k=int(np.argmax(f1))
    threshold=float(values[ends[k]])
    return dict(threshold_logit=threshold,threshold_probability=float(1/(1+np.exp(-threshold))),
        selection='max full comparison Validation F1; higher threshold on exact ties',**confusion(y,s,threshold))

def evaluate(scope,name,s,threshold=None):
    data=population(scope);assert len(s)==len(data)
    zeros=int(np.count_nonzero(s==0))
    if name=='Multi_FraudGT':assert zeros==0,'Original strict >0 rule needs explicit handling'
    fixed=confusion(data.y,s,0.);ap,top=ranking(data.y,s,data.ids)
    independent=float(average_precision_score(data.y>0,s));assert abs(ap-independent)<1e-10
    row=dict(model=name,scope=scope,rows=len(data),positive=data.meta['positive'],coverage=1.,AP=ap,AP_sklearn=independent,
        AP_crosscheck=True,exact_zero_logits=zeros,primary=dict(threshold_logit=0.,threshold_probability=.5,**fixed),top_k=top)
    row['validation_threshold']=(best_f1(data.y,s) if scope=='validation' else dict(threshold_logit=threshold,
        threshold_probability=float(1/(1+np.exp(-threshold))),selection='frozen on comparison Validation',**confusion(data.y,s,threshold)))
    if name=='Multi_FraudGT' and scope=='test':
        old=read_json(TEST/'result.json')
        for key,value in old['confusion_scored'].items():assert fixed[key]==value
        assert abs(ap-old['conditional_metrics']['AP'])<1e-10
        row['original_multi_test_metrics_reproduced']=True
    if name=='HGB':
        old=read_json(PREVIOUS/f'{scope}.json')['results']['HGB']
        for key in fixed:assert fixed[key]==old['primary'][key],key
        assert abs(ap-old['AP'])<1e-10
        row['previous_hgb_metrics_reproduced']=True
    log('metrics_complete',scope=scope,model=name,AP=ap,F1=fixed['F1'],precision=fixed['precision'],recall=fixed['recall'])
    return row

def fit_validation():
    check_frozen();plan=read_json(OUT/'plan.json')
    assert not (OUT/'frozen_validation.json').exists() and not (OUT/'fusion_scores/test.npy').exists()
    data=population('fusion_fit');x=np.column_stack((hgb_scores('fusion_fit'),gnn_scores('fusion_fit')));y=(data.y>0).astype('int8')
    assert len(x)==plan['fit_rows'] and np.isfinite(x).all();log('logistic_fit_started',rows=len(x),positives=int(y.sum()))
    t=time.monotonic();scaler=StandardScaler().fit(x)
    options={k:v for k,v in plan['logistic'].items() if k not in ('scaler','sample_weight')}
    model=LogisticRegression(**options)
    with threadpool_limits(limits=4),warnings.catch_warnings():
        warnings.simplefilter('error',ConvergenceWarning);model.fit(scaler.transform(x),y)
    seconds=time.monotonic()-t;assert int(model.n_iter_[0])<1000
    bundle=dict(model=model,scaler=scaler,inputs=plan['inputs'],plan_sha256=sha(OUT/'plan.json'),
        gnn_checkpoint_sha256=plan['gnn_checkpoint_sha256'],hgb_sha256=plan['hgb_sha256'],fit_rows=len(x))
    joblib.dump(bundle,OUT/'fusion.joblib');restored=joblib.load(OUT/'fusion.joblib')
    probe=np.arange(0,len(x),max(1,len(x)//1024))
    np.testing.assert_array_equal(model.decision_function(scaler.transform(x[probe])),restored['model'].decision_function(restored['scaler'].transform(x[probe])))
    fit=dict(rows=len(x),positives=int(y.sum()),seconds=seconds,iterations=model.n_iter_.tolist(),coefficients=model.coef_.tolist(),
        intercept=model.intercept_.tolist(),scaler_mean=scaler.mean_.tolist(),scaler_scale=scaler.scale_.tolist(),
        unscaled_coefficients=(model.coef_[0]/scaler.scale_).tolist(),
        unscaled_intercept=float(model.intercept_[0]-np.sum(model.coef_[0]*scaler.mean_/scaler.scale_)),
        serialization_parity=True,converged=True,class_weight=None,sample_weight=None)
    write(OUT/'fit.json',fit);log('logistic_fit_complete',**fit);del x,y;gc.collect()
    scores={'Multi_FraudGT':gnn_scores('validation'),'HGB':hgb_scores('validation'),'Multi_FraudGT_HGB':fusion_scores('validation',bundle)}
    results={name:evaluate('validation',name,s) for name,s in scores.items()}
    write(OUT/'validation.json',dict(utc=utc(),results=results,plan_sha256=sha(OUT/'plan.json')))
    frozen=dict(utc=utc(),plan_sha256=sha(OUT/'plan.json'),fusion_sha256=sha(OUT/'fusion.joblib'),validation_sha256=sha(OUT/'validation.json'),
        thresholds={name:r['validation_threshold']['threshold_logit'] for name,r in results.items()},primary_threshold_logit=0.,test_tuning=False,
        validation_scores_sha256={name:sha(OUT/'fusion_scores/validation.npy') if name=='Multi_FraudGT_HGB' else
            sha(PREVIOUS/'hgb_scores/validation/scores.npy') if name=='HGB' else sha(OUT/'gnn_scores/validation/scores.npy') for name in scores})
    write(OUT/'frozen_validation.json',frozen);check_frozen();log('validation_frozen',thresholds=frozen['thresholds'])

def test():
    check_frozen();frozen=read_json(OUT/'frozen_validation.json')
    assert sha(OUT/'plan.json')==frozen['plan_sha256'] and sha(OUT/'fusion.joblib')==frozen['fusion_sha256']
    assert sha(OUT/'validation.json')==frozen['validation_sha256']
    align_test();bundle=joblib.load(OUT/'fusion.joblib')
    scores={'Multi_FraudGT':gnn_scores('test'),'HGB':hgb_scores('test'),'Multi_FraudGT_HGB':fusion_scores('test',bundle)}
    results={name:evaluate('test',name,s,frozen['thresholds'][name]) for name,s in scores.items()}
    write(OUT/'test.json',dict(utc=utc(),results=results,validation_freeze_sha256=sha(OUT/'frozen_validation.json')))
    check_frozen();write(OUT/'complete.json',dict(status='complete',utc=utc(),fit_rows=7315599,validation_rows=8551015,test_rows=33429507,
        base_models_unchanged=True,salt_training_still_paused=True,exploratory_selection_overlap=True,
        plan_sha256=sha(OUT/'plan.json'),test_sha256=sha(OUT/'test.json'),all_population_metrics_verified=True))
    log('experiment_complete',test_metrics={name:{k:r['primary'][k] for k in ('precision','recall','F1')}|{'AP':r['AP']} for name,r in results.items()})

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('stage',choices=['align_test','fit_validation','test']);globals()[p.parse_args().stage]()
