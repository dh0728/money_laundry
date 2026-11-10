from experiment import *
import argparse,gc
from threadpoolctl import threadpool_limits
from salt_daily.data import date

def main(scope):
    check_frozen()
    assert (OUT/'prepare_complete.json').exists()
    if scope=='test':
        frozen=read_json(OUT/'frozen_validation.json')
        assert sha(OUT/'fusion.joblib')==frozen['fusion_sha256']
        assert sha(OUT/'plan.json')==frozen['plan_sha256']
    data=population(scope);store=ScoreFile(scope,len(data));bundle=tree_model()
    sample_scope='historical_test' if scope=='test' else scope
    with np.load(LEGACY/'cache'/f'{sample_scope}.npz') as a:sample={k:a[k] for k in a.files}
    expected_path=LEGACY/'components/tree_a0083be4630f'/f'{sample_scope}.npy'
    expected=np.load(expected_path,mmap_mode='r') if expected_path.exists() else None
    parity=[]
    log('hgb_scoring_started',scope=scope,rows=len(data),resume=store.cursor,threads=4)
    with threadpool_limits(limits=4):
        for span in data.meta['spans']:
            if store.cursor>=span['stop']:continue
            ids,raw,hist=day_inputs(scope,span)
            np.testing.assert_array_equal(ids,data.ids[span['start']:span['stop']])
            q=np.flatnonzero(sample['day']==span['day'])
            q=q[np.linspace(0,len(q)-1,min(128,len(q)),dtype=int)]
            positions=np.searchsorted(ids,sample['ids'][q])
            np.testing.assert_array_equal(ids[positions],sample['ids'][q])
            np.testing.assert_array_equal(data.y[span['start']+positions],
                np.where(sample['y'][q]==9,9,(sample['y'][q]>0).astype(np.int8)))
            if expected is not None:
                observed=tree_scores(bundle,tree_columns(raw,hist,positions))
                np.testing.assert_allclose(observed,expected[q],rtol=0,atol=2e-6)
                parity.append(dict(day=date(span['day']),rows=len(q),max_abs_error=float(np.max(np.abs(observed-expected[q])))))
            while store.cursor<span['stop']:
                start=store.cursor;stop=min(start+100000,span['stop'])
                t=time.monotonic();take=np.arange(start-span['start'],stop-span['start'])
                values=tree_scores(bundle,tree_columns(raw,hist,take))
                seconds=time.monotonic()-t;store.commit(values,seconds)
                log('hgb_progress',scope=scope,day=date(span['day']),scored=store.cursor,total=len(data),
                    batch_seconds=seconds,targets_per_second=len(values)/seconds)
            del ids,raw,hist;gc.collect()
    assert store.cursor==len(data)
    check_frozen()
    write(store.folder/'complete.json',dict(status='complete',utc=utc(),scored=len(data),requested=len(data),
        coverage=1.,seconds=store.seconds,scores_sha256=sha(store.folder/'scores.npy'),
        plan_sha256=sha(OUT/'plan.json'),cached_score_parity=parity))
    log('hgb_scoring_complete',scope=scope,rows=len(data),seconds=store.seconds)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('scope',choices=['fusion_fit','validation','test'])
    main(parser.parse_args().scope)
