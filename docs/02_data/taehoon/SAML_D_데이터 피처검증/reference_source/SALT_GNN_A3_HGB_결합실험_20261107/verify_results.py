"""Independent algebra, confusion counts, and Validation threshold checks."""
from experiment import *
from sklearn.metrics import precision_recall_curve

def main():
    assert read_json(OUT/'complete.json')['status']=='complete'
    check_frozen()
    fit=read_json(OUT/'fit.json');frozen=read_json(OUT/'frozen_validation.json')
    coefficient=np.asarray(fit['unscaled_coefficients']);intercept=fit['unscaled_intercept']
    records=[]
    for scope in ['validation','test']:
        data=population(scope)
        a=salt_scores(scope)
        h=np.load(OUT/'hgb_scores'/scope/'scores.npy',mmap_mode='r')
        f=np.load(OUT/'fusion_scores'/f'{scope}.npy',mmap_mode='r')
        maximum=0.
        for start in range(0,len(data),250000):
            stop=start+250000
            expected=coefficient[0]*np.asarray(h[start:stop],dtype=np.float64)+coefficient[1]*np.asarray(a[start:stop],dtype=np.float64)+intercept
            maximum=max(maximum,float(np.max(np.abs(expected-f[start:stop]))))
        assert maximum<1e-11,maximum
        results=read_json(OUT/f'{scope}.json')['results']
        for name,scores in [('A3',a),('HGB',h),('A3_HGB',f)]:
            for mode,threshold in [('primary',0.),('validation_threshold',frozen['thresholds'][name])]:
                counts=np.zeros(4,np.int64)
                for start in range(0,len(data),250000):
                    y=(data.y[start:start+250000]>0).astype(np.int8)
                    pred=(scores[start:start+250000]>=threshold).astype(np.int8)
                    counts+=np.bincount(2*y+pred,minlength=4)
                m=results[name][mode]
                np.testing.assert_array_equal(counts,[m['TN'],m['FP'],m['FN'],m['TP']])
            if scope=='validation':
                p,r,_=precision_recall_curve(data.y>0,scores)
                f1=np.divide(2*p*r,p+r,out=np.zeros_like(p),where=p+r>0)
                assert abs(float(f1.max())-results[name]['validation_threshold']['F1'])<1e-12
        records.append(dict(scope=scope,rows=len(data),max_algebra_abs_error=maximum,
            six_confusion_counts_verified=True,validation_threshold_sklearn_checked=scope=='validation'))
    stages=[]
    for line in (OUT/'events.jsonl').read_text().splitlines():
        event=json.loads(line)
        if event.get('event')=='pipeline_stage_started' and event.get('command')==['score_hgb.py','test']:
            stages.append(event['utc'])
    assert stages and frozen['utc']<min(stages)
    check_frozen()
    write(OUT/'independent_verification.json',dict(all_passed=True,utc=utc(),records=records,
        freeze_precedes_new_test_scoring=True,original_models_and_paused_A1_unchanged=True))
    print(json.dumps(dict(independent_verification='pass',records=records),ensure_ascii=False))

if __name__=='__main__':main()
