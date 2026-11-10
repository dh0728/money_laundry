from experiment import *
import importlib.util, gc
from salt_daily.population import build_population
from salt_daily.data import date

def main():
    check_frozen()
    marker=OUT/'population/population.json'
    if not marker.exists():
        log('build_fusion_population_started')
        build_population(OUT/'population',np.load(config.FEATURES/'minute.npy',mmap_mode='r'),
            np.load(config.FEATURES/'present.npy',mmap_mode='r'),
            np.load(config.FRAUDGT/'assets/positive_ids.npy',mmap_mode='r'),
            np.load(config.FRAUDGT/'assets/positive_classes.npy',mmap_mode='r'),
            windows={'fusion_fit':(65,68)})
    data=population('fusion_fit');assert len(data)==7315599 and data.meta['positive']==9637
    with np.load(LEGACY/'cache/fusion_fit.npz') as a: sample={k:a[k] for k in a.files}
    assert np.all((sample['day']>=65)&(sample['day']<=68))
    original_arrays=[np.load(H/'cache'/name,mmap_mode='r') for name in
                     ('daily60_X.npy','dayflow18_X.npy','amount_history11_X.npy')]
    saved_scores=np.load(LEGACY/'components/tree_a0083be4630f/fusion_fit.npy',mmap_mode='r')
    bundle=tree_model()
    sys.path.insert(0,str(H))
    spec=importlib.util.spec_from_file_location('original_full_feature_builder',H/'11_prepare_full_validation.py')
    builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
    import duckdb
    c=duckdb.connect(str(H.parents[1]/'daily_v1/daily.duckdb'),read_only=True)
    (OUT/'spill').mkdir(exist_ok=True)
    c.execute("SET threads=2; SET memory_limit='4GB'; SET preserve_insertion_order=false")
    c.execute(f"SET temp_directory='{OUT/'spill'}'")
    edges=np.load(config.EXPERIMENTS/'gnn36_structural_v8/cache/edges/x.npy',mmap_mode='r')
    present=np.load(config.EXPERIMENTS/'gnn36_structural_v8/cache/edges/present.npy',mmap_mode='r')
    records=[]
    for span in data.meta['spans']:
        day=date(span['day']);folder=OUT/'features'/day;folder.mkdir(parents=True,exist_ok=True)
        marker=folder/'complete.json'
        if marker.exists():
            record=read_json(marker)
            assert sha(folder/'X.npy')==record['features_sha256']
            records.append(record);continue
        log('build_hgb_features_started',day=day,rows=span['stop']-span['start'])
        ids,x=builder.day_features(c,day,edges,present,folder)
        np.testing.assert_array_equal(ids,data.ids[span['start']:span['stop']])
        hist=np.load(H/'cache/amount_history'/day/'X.npy',mmap_mode='r')
        np.testing.assert_array_equal(ids,np.load(H/'cache/amount_history'/day/'ids.npy',mmap_mode='r'))
        q=np.flatnonzero(sample['day']==span['day']);positions=np.searchsorted(ids,sample['ids'][q])
        np.testing.assert_array_equal(ids[positions],sample['ids'][q])
        labels=data.y[span['start']+positions]
        np.testing.assert_array_equal(labels,np.where(sample['y'][q]==9,9,(sample['y'][q]>0).astype(np.int8)))
        expected=np.empty((len(q),36),np.float32)
        for j,name in enumerate(NAMES):
            k=ALL_NAMES.index(name);part=0 if k<60 else 1 if k<78 else 2
            expected[:,j]=original_arrays[part][sample['control_position'][q],k-(0,60,78)[part]]
        actual=tree_columns(x,hist,positions)
        np.testing.assert_allclose(actual,expected,rtol=0,atol=2e-6)
        pred=tree_scores(bundle,actual)
        np.testing.assert_allclose(pred,saved_scores[q],rtol=0,atol=2e-6)
        record=dict(day=day,rows=len(ids),feature_columns=78,feature_parity_rows=len(q),
            max_feature_abs_error=float(np.max(np.abs(actual-expected))),
            max_hgb_score_abs_error=float(np.max(np.abs(pred-saved_scores[q]))),
            features_sha256=sha(folder/'X.npy'),ids_sha256=sha(folder/'ids.npy'),labels_not_inputs=True)
        write(marker,record);records.append(record);log('hgb_features_verified',**record)
        del x,hist,ids,actual,expected;gc.collect()
    c.close()
    evaluation=[]
    for scope in ('validation','test'):
        d=population(scope)
        for span in d.meta['spans']:
            ids,raw,hist=day_inputs(scope,span)
            np.testing.assert_array_equal(ids,d.ids[span['start']:span['stop']])
        evaluation.append(dict(scope=scope,rows=len(d),all_ids_aligned=True,columns=36))
    check_frozen()
    write(OUT/'prepare_complete.json',dict(status='pass',utc=utc(),fusion_fit=data.meta,
        records=records,evaluation_inputs=evaluation,existing_hgb_parity_rows=sum(x['feature_parity_rows'] for x in records),
        full_population=True,ipw=False,source_models_unchanged=True))
    log('prepare_complete',rows=len(data),positives=data.meta['positive'])

if __name__=='__main__':main()
