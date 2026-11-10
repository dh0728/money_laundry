"""Frozen HI-trained fusion models on the complete SAML-D population."""
import os
for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):os.environ.setdefault(key,'2')
from pathlib import Path
import sys,json,time,hashlib
from datetime import datetime,timezone
OUT=Path(__file__).resolve().parent
SALT=OUT.parent/'SALT_GNN_직접공유샘플링_20261104'
AOUT=OUT.parent/'SALT_GNN_A3_HGB_결합실험_20261107'
MOUT=OUT.parent/'Multi_FraudGT_HGB_결합실험_20261108'
OLD=OUT.parent/'Multi_FraudGT_SAML_D_전체평가_20261106'
ADOPTED=OUT.parent/'V10_최종채택_41종_20261026'
sys.path.insert(0,str(SALT))
from salt_daily import config
from salt_daily.storage import sha,read_json
import numpy as np
import joblib
S=config.EXPERIMENTS/'v10_saml_generalization_20261025'
SG=config.GRAPH/'cache/saml'
A3=SALT/'runs/daily_close_001/models/A3/best.pt'
N=9504852
POS=9873
EDGE_INDICES=[0,1,2,3,4,5,6,7,9,10,12,13,14,15]

def utc():return datetime.now(timezone.utc).isoformat()
def write(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+f'.{os.getpid()}.tmp')
    temp.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n');temp.replace(path)
def log(event,**values):
    record=dict(utc=utc(),event=event,**values)
    with (OUT/'events.jsonl').open('a') as f:f.write(json.dumps(record,ensure_ascii=False)+'\n')
    write(OUT/'status.json',record);print(json.dumps(record,ensure_ascii=False),flush=True)
def ensure_paused():
    from notebook_control import worker
    from run import lock_held
    assert not worker() and not lock_held(config.RUN/'run.lock'),'SALT training must remain paused'
def check_frozen():
    ensure_paused()
    for path,digest in read_json(OUT/'plan.json')['preserved'].items():assert sha(Path(path))==digest,path
    for name,digest in read_json(OUT/'code_manifest.json').items():assert sha(OUT/name)==digest,name
def labels():return np.load(OLD/'cache/labels.npy',mmap_mode='r')
def scores(name):
    if name=='Multi_FraudGT':
        path=OLD/'cache/logits.npy';assert sha(path)==read_json(OLD/'result.json')['logits_sha256']
    else:
        folder=OUT/'scores'/name;d=read_json(folder/'complete.json');path=folder/'scores.npy'
        assert d['scored']==N and d['coverage']==1. and d['plan_sha256']==sha(OUT/'plan.json')
        assert sha(path)==d['scores_sha256']
    z=np.load(path,mmap_mode='r');assert z.shape==(N,) and np.isfinite(z).all();return z
def score_complete(name,extra=None):
    path=OUT/'scores'/name/'scores.npy'
    write(path.parent/'complete.json',dict(utc=utc(),status='complete',scored=N,coverage=1.,
        ordering='original SAML eid 0..N-1',scores_sha256=sha(path),plan_sha256=sha(OUT/'plan.json'),**(extra or {})))

def initialize():
    assert not (OUT/'plan.json').exists(),'Do not overwrite the frozen plan'
    ensure_paused();import graph_runtime,common
    original=read_json(OLD/'result.json');assert original['rows']==N and original['positive']==POS and original['coverage']==1
    assert sha(OLD/'cache/logits.npy')==original['logits_sha256']
    assert sha(A3)=='86326a538768634ec06799abac69da603951dfb004038c7cfb1937cd67cc25ab'
    assert sha(ADOPTED/'tree.joblib')=='fa78dfe12c2e8ceb790850890f6d8966bad29e0e5de697219dcf0f0e85a5cf4c'
    assert read_json(OLD/'protocol.json')['checkpoint_sha256']==read_json(MOUT/'plan.json')['gnn_checkpoint_sha256']
    preserved=read_json(AOUT/'salt_paused.json')['preserved'].copy()
    paths=[A3,ADOPTED/'tree.joblib',OLD/'protocol.json',OLD/'result.json',OLD/'cache/complete.json',OLD/'cache/logits.npy',
           S/'01_features_complete.json',S/'features.py',S/'common.py',S/'cache/X.npy',S/'cache/ids.npy',
           S/'cache/truth.parquet',S/'cache/observations.parquet',Path(graph_runtime.__file__),Path(common.__file__)]
    paths+=list((SALT/'salt_daily').glob('*.py'))+list((SALT/'salt_daily').glob('*.c'))+list((SALT/'salt_daily').glob('*.cu'))
    paths+=list(SG.glob('*.npy'))+[SG/'complete.json']
    paths+=[OLD/'cache'/name for name in ('labels.npy','edge22.npy','incoming_ports.npy','outgoing_ports.npy','nodes19.npy')]
    for root in (MOUT,AOUT):paths+=[root/n for n in ('fusion.joblib','plan.json','fit.json','frozen_validation.json','validation.json','test.json')]
    preserved.update({str(p):sha(p) for p in paths})
    for path,meta in read_json(OLD/'cache/complete.json')['inputs'].items():assert sha(Path(path))==meta['sha256']
    bundle=joblib.load(ADOPTED/'tree.joblib');names=read_json(S/'01_features_complete.json')['names']
    assert len(bundle['feature_names'])==36 and all(n in names for n in bundle['feature_names'])
    y=labels();assert y.shape==(N,) and set(np.unique(y))=={0,1} and int(y.sum())==POS
    import pyarrow.parquet as pq
    truth=pq.read_table(S/'cache/truth.parquet').to_pandas()
    np.testing.assert_array_equal(truth.eid,np.arange(N));np.testing.assert_array_equal(truth.y,y)
    obs=pq.read_table(S/'cache/observations.parquet',columns=['eid','src','dst','ts']).to_pandas()
    np.testing.assert_array_equal(obs.eid,np.arange(N))
    minute=np.load(SG/'minute.npy',mmap_mode='r');day=minute//1440
    for name in ('src','dst'):np.testing.assert_array_equal(obs[name],np.load(SG/(name+'.npy'),mmap_mode='r'))
    np.testing.assert_array_equal(((obs.ts-obs.ts.min().normalize()).dt.total_seconds()/60).to_numpy().astype('int32'),minute)
    order=np.argsort(day,kind='stable').astype('uint32');np.save(OUT/'day_order.npy',order)
    boundaries=np.searchsorted(day[order],np.arange(int(day.max())+2))
    spans=[dict(day=d,start=int(boundaries[d]),stop=int(boundaries[d+1])) for d in range(len(boundaries)-1) if boundaries[d+1]>boundaries[d]]
    write(OUT/'population.json',dict(rows=N,positive=POS,normal=N-POS,spans=spans,order_sha256=sha(OUT/'day_order.npy'),
        original_ids='0..9504851, same row namespace across labels, HGB, GNN and fusion scores',ids_and_labels_checked=True))
    fixed={key:read_json(root/'frozen_validation.json')['thresholds'][key] for key,root in [('Multi_FraudGT_HGB',MOUT),('A3_HGB',AOUT)]}
    plan=dict(created_utc=utc(),name='HI-trained Multi-FraudGT+HGB and SALT-GNN A3+HGB on full SAML-D',
        rows=N,positive=POS,dates=['2022-10-07','2023-08-23'],preserved=preserved,models_retrained=False,scalers_refit=False,
        labels_used_only_for_evaluation=True,primary_probability=.5,primary_logit=0.,secondary_frozen_hi_validation_logits=fixed,
        new_threshold_selection_on_saml=False,feature_policy='Unchanged established SAML baseline: zero for unavailable fields, HI scaling, payment Unknown',
        hgb_feature_names=bundle['feature_names'],hgb_column_indices=[names.index(n) for n in bundle['feature_names']],
        hgb_correction='Divide three-class probabilities by [1,100,100], renormalize, sum fraud classes, clip to [1e-12,1-1e-12], logit',
        fusion='Existing StandardScaler and LogisticRegression decision_function; NO additional class-prior subtraction',
        salt=dict(checkpoint_epoch=6,checkpoint_sha256=sha(A3),graph='native daily-close SAML graph; day origin 2022-10-07',
            degree='full original incoming/outgoing transaction counts through day close; HI checkpoint delta remains fixed',
            sampler='original CUDA two-hop shared sampler, cap100 per direction; same-minute treatment unchanged',
            score_commit_targets=8192,microbatch_max=4096,max_edges_per_microbatch=6000000,
            target_order='ascending day, then ascending original eid; scatter scores back to original eid',
            node_state='cumulative SAML node state through current day; no later-day observations'),
        multi=dict(checkpoint_epoch=280,predictions='reuse verified original full-population baseline',
            source=str(OLD/'cache/logits.npy'),graph='original entire-period cumulative graph through 2023-08-23'),
        limitations=['SAML was already examined in earlier experiments; this is a historical domain-transfer evaluation, not pristine holdout.',
            'KYC/country/received-amount inputs are unavailable in SAML and retain zero imputation. Unknown payment formats and unsupported currencies retain their established mappings.',
            'The systems retain their native graph protocols: Multi entire-period cumulative, SALT daily-close. This cannot isolate architecture differences or claim transaction-time causal inference.',
            'Multi original HI epoch-selection Validation overlaps its later fusion-fit/comparison Validation periods. HI selection limitations persist.',
            'SAML patterns are reported in their own taxonomy; HI unmatched/known-pattern labels are not assigned to SAML.'],
        salt_training_must_remain_paused=True)
    write(OUT/'plan.json',plan);write(OUT/'code_manifest.json',{p.name:sha(p) for p in sorted(OUT.glob('*.py'))})
    check_frozen();log('plan_frozen',rows=N,positive=POS,days=len(spans),plan_sha256=sha(OUT/'plan.json'))

if __name__=='__main__':initialize()
