from experiment import *
from threadpoolctl import threadpool_limits

def run():
    check_frozen();folder=OUT/'scores/HGB';folder.mkdir(parents=True,exist_ok=True)
    if (folder/'complete.json').exists():scores('HGB');return
    bundle=joblib.load(ADOPTED/'tree.joblib');np.testing.assert_array_equal(bundle['model'].classes_,[0,1,2])
    np.testing.assert_array_equal(bundle['class_factors'],[1.,100.,100.])
    x=np.load(S/'cache/X.npy',mmap_mode='r');cols=read_json(OUT/'plan.json')['hgb_column_indices']
    path=folder/'scores.npy';z=np.lib.format.open_memmap(path,'w+',dtype='float64',shape=(N,));started=time.monotonic();next_log=0
    with threadpool_limits(limits=2):
        for start in range(0,N,100000):
            values=np.array(x[start:start+100000,cols],dtype='float32',copy=True)
            assert values.shape[1]==36 and np.isfinite(values).all()
            p=bundle['model'].predict_proba(values)/np.asarray(bundle['class_factors']);p/=p.sum(axis=1,keepdims=True)
            fraud=np.clip(p[:,1:].sum(axis=1),1e-12,1-1e-12);z[start:start+len(values)]=np.log(fraud)-np.log1p(-fraud)
            if time.monotonic()>next_log:
                log('hgb_progress',completed=start+len(values),total=N,seconds=time.monotonic()-started);next_log=time.monotonic()+20
    assert np.isfinite(z).all();z.flush();score_complete('HGB',dict(seconds=time.monotonic()-started))
    check_frozen();log('hgb_complete',rows=N,seconds=time.monotonic()-started)

if __name__=='__main__':run()
