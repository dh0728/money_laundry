"""Independent full-population alignment, fusion arithmetic and count audit."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from experiment import *

def main():
    check_frozen();frozen=read_json(OUT/'frozen_validation.json');fit=read_json(OUT/'fit.json')
    complete=read_json(OUT/'complete.json');assert complete['status']=='complete'
    assert frozen['utc']<read_json(OUT/'test.json')['utc']
    audit=[]
    for scope in ('validation','test'):
        data=population(scope);g=gnn_scores(scope);h=hgb_scores(scope)
        z=np.load(OUT/'fusion_scores'/f'{scope}.npy',mmap_mode='r')
        expected=read_json(OUT/f'{scope}.json')['results']['Multi_FraudGT_HGB']
        cuts=[0.,frozen['thresholds']['Multi_FraudGT_HGB']]
        counts=np.zeros((2,4),dtype=np.int64);maximum=0.
        for start in range(0,len(data),1000000):
            stop=min(start+1000000,len(data));y=data.y[start:stop]>0
            manual=fit['unscaled_intercept']+fit['unscaled_coefficients'][0]*h[start:stop]+fit['unscaled_coefficients'][1]*g[start:stop].astype('float64')
            maximum=max(maximum,float(np.max(np.abs(manual-z[start:stop]))))
            assert np.isfinite(z[start:stop]).all()
            for i,threshold in enumerate(cuts):
                p=z[start:stop]>=threshold
                counts[i]+=np.asarray([np.count_nonzero(y&p),np.count_nonzero(~y&p),np.count_nonzero(y&~p),np.count_nonzero(~y&~p)])
        assert maximum<1e-10
        for i,name in enumerate(('primary','validation_threshold')):
            np.testing.assert_array_equal(counts[i],[expected[name][k] for k in ('TP','FP','FN','TN')])
        audit.append(dict(scope=scope,rows=len(data),all_fusion_scores_independently_recomputed=True,max_abs_error=maximum,
            primary_and_frozen_confusions_verified=True,fusion_scores_sha256=sha(OUT/'fusion_scores'/f'{scope}.npy')))
    # Resume order is a full permutation of canonical population indices.
    orders=[]
    for scope in ('fusion_fit','validation'):
        folder=OUT/'gnn_scores'/scope;order=np.load(folder/'order.npy',mmap_mode='r');data=population(scope)
        assert order.shape==(len(data),) and order.min()==0 and order.max()==len(data)-1
        assert len(np.unique(order))==len(data)
        cursor=0
        for path in sorted((folder/'chunks').glob('*.json')):
            m=read_json(path);assert m['start']==cursor;cursor=m['stop']
        assert cursor==len(data)
        orders.append(dict(scope=scope,rows=cursor,complete_unique_permutation=True))
    check_frozen()
    result=dict(passed=True,utc=utc(),checks=audit,orders=orders,plan_sha256=sha(OUT/'plan.json'),
        code_manifest_sha256=sha(OUT/'code_manifest.json'),audit_script_sha256=sha(Path(__file__)),
        base_artifacts_preserved=True,salt_training_still_paused=True,validation_frozen_before_fused_test=True,
        original_multi_test_reproduced=read_json(OUT/'test.json')['results']['Multi_FraudGT']['original_multi_test_metrics_reproduced'])
    write(OUT/'independent_verification.json',result);print(json.dumps(result,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
