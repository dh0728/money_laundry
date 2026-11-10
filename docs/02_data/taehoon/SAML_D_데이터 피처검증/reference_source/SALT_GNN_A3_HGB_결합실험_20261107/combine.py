from experiment import *
import argparse,warnings,gc
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.exceptions import ConvergenceWarning
from sklearn.metrics import average_precision_score
from threadpoolctl import threadpool_limits
from salt_daily.metrics import confusion,ranking

def hgb_scores(scope):
    folder=OUT/'hgb_scores'/scope;d=read_json(folder/'complete.json')
    assert d['coverage']==1 and d['scored']==len(population(scope))
    assert d['plan_sha256']==sha(OUT/'plan.json')
    assert d['scores_sha256']==sha(folder/'scores.npy')
    return np.load(folder/'scores.npy',mmap_mode='r')

def matrix(scope):return np.column_stack((hgb_scores(scope),salt_scores(scope)))

def fusion_scores(scope,bundle):
    folder=OUT/'fusion_scores';folder.mkdir(exist_ok=True)
    data=population(scope);g=salt_scores(scope);t=hgb_scores(scope)
    result=np.lib.format.open_memmap(folder/f'{scope}.npy','w+',dtype='float64',shape=(len(data),))
    for start in range(0,len(data),250000):
        x=np.column_stack((t[start:start+250000],g[start:start+250000]))
        result[start:start+len(x)]=bundle['model'].decision_function(bundle['scaler'].transform(x))
    result.flush();assert np.isfinite(result).all()
    return result

def best_f1(y,s):
    # Unique score endpoints make threshold selection exactly reproducible with ties.
    order=np.argsort(-s,kind='stable');scores=np.asarray(s)[order]
    ends=np.r_[np.flatnonzero(scores[:-1]!=scores[1:]),len(scores)-1]
    tp=np.cumsum(np.asarray(y)[order]>0,dtype=np.int64)[ends]
    f1=2*tp/(int(np.count_nonzero(y))+ends+1)
    k=int(np.argmax(f1));threshold=float(scores[ends[k]])
    return dict(threshold_logit=threshold,selection='max full Validation F1, higher threshold on exact ties',
                **confusion(y,s,threshold))

def evaluate(scope,name,s,threshold=None):
    d=population(scope);assert len(s)==len(d)
    fixed=confusion(d.y,s,0.)
    ap,top=ranking(d.y,s,d.ids)
    independent=float(average_precision_score(d.y>0,s))
    assert abs(ap-independent)<1e-10,(ap,independent)
    row=dict(model=name,scope=scope,rows=len(d),positive=d.meta['positive'],coverage=1.,
        AP=ap,AP_sklearn=independent,AP_crosscheck=True,primary=dict(threshold_logit=0.,threshold_probability=.5,**fixed),top_k=top)
    row['validation_threshold']=(best_f1(d.y,s) if scope=='validation' else
        dict(threshold_logit=threshold,selection='frozen on full Validation, not refit on Test',**confusion(d.y,s,threshold)))
    if name=='A3':
        old=read_json(MODEL/f'{scope}.json')
        for key in ['TP','FP','FN','TN','known_pattern_TP','unmatched_TP']:assert fixed[key]==old[key]
        assert abs(ap-old['AP'])<1e-10
        row['original_a3_metrics_reproduced']=True
    log('metrics_complete',scope=scope,model=name,AP=ap,F1=fixed['F1'],
        precision=fixed['precision'],recall=fixed['recall'])
    return row

def fit_validation():
    check_frozen();plan=read_json(OUT/'plan.json')
    assert not (OUT/'frozen_validation.json').exists(),'Frozen validation already exists; do not refit'
    assert not (OUT/'hgb_scores/test/request.json').exists(),'Cannot refit after new Test scoring'
    d=population('fusion_fit');x=matrix('fusion_fit');y=(d.y>0).astype(np.int8)
    assert len(x)==plan['fit_rows'] and np.isfinite(x).all()
    log('logistic_fit_started',rows=len(x),positives=int(y.sum()))
    t=time.monotonic();scaler=StandardScaler().fit(x)
    model=LogisticRegression(C=.1,solver='lbfgs',max_iter=1000,tol=1e-7,random_state=20261107)
    with threadpool_limits(limits=4),warnings.catch_warnings():
        warnings.simplefilter('error',ConvergenceWarning)
        model.fit(scaler.transform(x),y)
    seconds=time.monotonic()-t
    assert int(model.n_iter_[0])<1000
    bundle=dict(model=model,scaler=scaler,inputs=plan['inputs'],plan_sha256=sha(OUT/'plan.json'),
        salt_checkpoint_sha256=plan['salt_checkpoint_sha256'],hgb_sha256=plan['hgb_sha256'],fit_rows=len(x))
    joblib.dump(bundle,OUT/'fusion.joblib')
    restored=joblib.load(OUT/'fusion.joblib')
    probe=np.arange(0,len(x),max(1,len(x)//1024))
    np.testing.assert_array_equal(model.decision_function(scaler.transform(x[probe])),
        restored['model'].decision_function(restored['scaler'].transform(x[probe])))
    fit=dict(rows=len(x),positives=int(y.sum()),class_weight=None,sample_weight=None,seconds=seconds,
        iterations=model.n_iter_.tolist(),coefficients=model.coef_.tolist(),intercept=model.intercept_.tolist(),
        scaler_mean=scaler.mean_.tolist(),scaler_scale=scaler.scale_.tolist(),
        unscaled_coefficients=(model.coef_[0]/scaler.scale_).tolist(),
        unscaled_intercept=float(model.intercept_[0]-np.sum(model.coef_[0]*scaler.mean_/scaler.scale_)),
        serialization_parity=True,converged=True)
    write(OUT/'fit.json',fit);log('logistic_fit_complete',**fit)
    del x,y;gc.collect()
    scores={'A3':salt_scores('validation'),'HGB':hgb_scores('validation'),
            'A3_HGB':fusion_scores('validation',bundle)}
    results={name:evaluate('validation',name,s) for name,s in scores.items()}
    write(OUT/'validation.json',dict(utc=utc(),results=results,plan_sha256=sha(OUT/'plan.json')))
    frozen=dict(utc=utc(),plan_sha256=sha(OUT/'plan.json'),fusion_sha256=sha(OUT/'fusion.joblib'),
        validation_sha256=sha(OUT/'validation.json'),thresholds={name:r['validation_threshold']['threshold_logit'] for name,r in results.items()},
        primary_threshold_logit=0.,all_three_models_will_be_reported=True,test_tuning=False,
        validation_score_sha256={name:sha(OUT/'fusion_scores/validation.npy') if name=='A3_HGB' else
            sha(OUT/'hgb_scores/validation/scores.npy') if name=='HGB' else sha(MODEL/'validation_epoch6/scores.npy') for name in scores})
    write(OUT/'frozen_validation.json',frozen);check_frozen()
    log('validation_frozen',thresholds=frozen['thresholds'])

def test():
    check_frozen();frozen=read_json(OUT/'frozen_validation.json')
    assert sha(OUT/'plan.json')==frozen['plan_sha256']
    assert sha(OUT/'fusion.joblib')==frozen['fusion_sha256']
    assert sha(OUT/'validation.json')==frozen['validation_sha256']
    bundle=joblib.load(OUT/'fusion.joblib')
    scores={'A3':salt_scores('test'),'HGB':hgb_scores('test'),'A3_HGB':fusion_scores('test',bundle)}
    results={name:evaluate('test',name,s,frozen['thresholds'][name]) for name,s in scores.items()}
    write(OUT/'test.json',dict(utc=utc(),results=results,validation_freeze_sha256=sha(OUT/'frozen_validation.json')))
    check_frozen()
    write(OUT/'complete.json',dict(status='complete',utc=utc(),fit_rows=7315599,validation_rows=8551015,
        test_rows=33429507,base_models_unchanged=True,salt_training_still_paused=True,
        plan_sha256=sha(OUT/'plan.json'),test_sha256=sha(OUT/'test.json'),all_population_metrics_verified=True))
    log('experiment_complete',test_metrics={name:{k:r['primary'][k] for k in ['precision','recall','F1']}|{'AP':r['AP']} for name,r in results.items()})

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('stage',choices=['fit_validation','test'])
    stage=parser.parse_args().stage
    fit_validation() if stage=='fit_validation' else test()
