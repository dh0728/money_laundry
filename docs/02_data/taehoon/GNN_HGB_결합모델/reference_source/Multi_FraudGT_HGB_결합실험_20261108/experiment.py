"""Isolated frozen Multi-FraudGT + HGB exploratory stacking experiment."""
import os
for name in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ.setdefault(name, '2')
from pathlib import Path
import sys, json, hashlib, time
from datetime import datetime, timezone
from functools import lru_cache
OUT = Path(__file__).resolve().parent
FROOT = OUT.parent/'V10_FraudGT_조건수정_20261027'
SALT = OUT.parent/'SALT_GNN_직접공유샘플링_20261104'
PREVIOUS = OUT.parent/'SALT_GNN_A3_HGB_결합실험_20261107'
ADOPTED = OUT.parent/'V10_최종채택_41종_20261026'
RUN = FROOT/'runs/shared_corrected_001'
MODEL = RUN/'models/multi_fraudgt_format/best.pt'
TEST = RUN/'evaluations/multi_alltargets_fulltest_20261103'
sys.path.insert(0, str(FROOT))
import fraudgt_lab
sys.path.insert(0, str(SALT))
from salt_daily import config as salt_config
import numpy as np
import joblib
from salt_daily.storage import sha, read_json
from salt_daily.population import FullPopulation

def utc(): return datetime.now(timezone.utc).isoformat()

def write(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix+f'.{os.getpid()}.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n')
    tmp.replace(path)

def log(event, **values):
    record = dict(utc=utc(), event=event, **values)
    with (OUT/'events.jsonl').open('a') as f: f.write(json.dumps(record,ensure_ascii=False)+'\n')
    write(OUT/'status.json',record)
    print(json.dumps(record,ensure_ascii=False),flush=True)

def population(scope):
    return FullPopulation(scope, PREVIOUS/'population' if scope=='fusion_fit' else None)

def ensure_paused():
    from notebook_control import worker
    from run import lock_held
    assert not worker() and not lock_held(salt_config.RUN/'run.lock'), 'SALT must remain paused'

def check_frozen():
    ensure_paused()
    p=read_json(OUT/'plan.json')
    for path,digest in p['preserved'].items():
        assert sha(Path(path))==digest, f'Preserved input changed: {path}'
    for name,digest in read_json(OUT/'code_manifest.json').items():
        assert sha(OUT/name)==digest, name

@lru_cache(None)
def hgb_scores(scope):
    folder=PREVIOUS/'hgb_scores'/scope
    d=read_json(folder/'complete.json')
    request=read_json(folder/'request.json')
    data=population(scope)
    assert d['coverage']==1 and d['scored']==len(data)
    assert request['population']==data.meta['files']
    assert d['scores_sha256']==sha(folder/'scores.npy')
    assert d['scores_sha256']==read_json(OUT/'plan.json')['hgb_scores'][scope]
    return np.load(folder/'scores.npy',mmap_mode='r')

@lru_cache(None)
def gnn_scores(scope):
    folder=OUT/'gnn_scores'/scope; d=read_json(folder/'complete.json')
    assert d['coverage']==1 and d['scored']==len(population(scope))
    assert d['plan_sha256']==sha(OUT/'plan.json')
    assert d['scores_sha256']==sha(folder/'scores.npy')
    return np.load(folder/'scores.npy',mmap_mode='r')

def initialize():
    assert not (OUT/'plan.json').exists(), 'Do not overwrite a frozen plan'
    ensure_paused()
    preserved=read_json(PREVIOUS/'salt_paused.json')['preserved'].copy()
    paths=[MODEL,ADOPTED/'tree.joblib',RUN/'protocol.json',TEST/'request.json',TEST/'result.json',TEST/'protocol.json',
           PREVIOUS/'plan.json',PREVIOUS/'fusion.joblib',PREVIOUS/'validation.json',PREVIOUS/'test.json',
           PREVIOUS/'frozen_validation.json',FROOT/'assets/splits.json',FROOT/'assets/positive_ids.npy',FROOT/'assets/positive_classes.npy']
    paths+=list((FROOT/'fraudgt_lab').glob('*.py'))
    paths+=[SALT/'salt_daily'/name for name in ('config.py','population.py','metrics.py','cuda_features.py')]
    source_hgb={}
    for scope in ('fusion_fit','validation','test'):
        data=population(scope)
        directory=PREVIOUS/'population' if scope=='fusion_fit' else SALT/'cache/population'
        for name,digest in data.meta['files'].items():
            path=directory/name;assert sha(path)==digest;preserved[str(path)]=digest
        for name in ('scores.npy','complete.json','request.json'):
            paths.append(PREVIOUS/'hgb_scores'/scope/name)
        source_hgb[scope]=read_json(PREVIOUS/'hgb_scores'/scope/'complete.json')['scores_sha256']
    preserved.update({str(p):sha(p) for p in paths})
    assert sha(MODEL)=='42d0d8002a87962291eb3f409cfbba1d1dec381c35162f11f2e11cb3a034c58f'
    plan=dict(created_utc=utc(),name='Frozen Multi-FraudGT epoch280 + adopted HGB exploratory stacking',
        gnn_checkpoint_sha256=sha(MODEL),hgb_sha256=sha(ADOPTED/'tree.joblib'),preserved=preserved,hgb_scores=source_hgb,
        fit_rows=7315599,validation_rows=8551015,test_rows=33429507,
        windows={'fusion_fit':['2022-10-05','2022-10-08'],'validation':['2022-10-09','2022-10-13'],'test':['2022-10-14','2022-10-31']},
        inputs=['HGB corrected fraud logit (class factors 1/100/100 divided once)','Multi-FraudGT raw logit'],
        logistic=dict(scaler='StandardScaler',C=.1,solver='lbfgs',max_iter=1000,tol=1e-7,random_state=20261108,class_weight=None,sample_weight=None),
        primary_threshold=dict(probability=.5,logit=0.,comparison='>=; exact-zero Multi logits audited against original strict > rule'),
        secondary_threshold='Each model: maximum full Validation F1; ties choose higher threshold; freeze before new fused Test evaluation',
        test_tuning=False,base_retraining=False,scope='HI-Large, same canonical populations/HGB scores as A3+HGB; not SAML-D',
        inference=dict(readout='all_targets',seed_batch=2048,fanout=[50,50],graph='original split-end cumulative graph',
            validation_graph_end='2022-10-13',test_graph_end='2022-10-31',query_order='separate whole-population uniform permutation in each scope',
            order_seed=1000045,sampler_scope='val',sampler_epoch=0,sampler_index='global index per scope; maintained across chunks and resumes',
            feature_cache='lossless compact CUDA; CPU PyG sampler with one-batch prefetch',dtype='float32',
            test_predictions='reuse original full all_targets Test shards by original transaction ID; no Test resampling'),
        limitations=[
            'Multi epoch280 was selected using subsets of original Validation 2022-09-26 through 2022-10-13; fusion_fit and comparison Validation overlap that earlier selection period. This is exploratory reuse, not independent held-out stacking.',
            'The original split-end cumulative graph includes later observed edges/nodes within its period. This is not causal transaction-time inference.',
            'Both historical Test and Validation have already been examined in prior experiments; this is not a fresh unseen holdout claim.',
            'A3 and Multi differ in graph, training, and selection protocols. Comparison measures existing systems and cannot isolate architecture effects.'
        ],salt_training_must_remain_paused=True)
    write(OUT/'plan.json',plan)
    write(OUT/'code_manifest.json',{p.name:sha(p) for p in sorted(OUT.glob('*.py'))})
    check_frozen();log('plan_frozen',plan_sha256=sha(OUT/'plan.json'))

if __name__=='__main__':initialize()
