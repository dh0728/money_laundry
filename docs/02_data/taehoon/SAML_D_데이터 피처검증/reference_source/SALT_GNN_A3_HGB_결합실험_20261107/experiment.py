"""Isolated, full-population A3 + HGB stacking experiment."""
import os
for name in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ.setdefault(name, '2')
from pathlib import Path
import sys, json, hashlib, time
from datetime import datetime, timezone
OUT = Path(__file__).resolve().parent
SALT = OUT.parent/'SALT_GNN_직접공유샘플링_20261104'
ADOPTED = OUT.parent/'V10_최종채택_41종_20261026'
sys.path.insert(0, str(SALT))
from salt_daily import config
import numpy as np
import joblib
from salt_daily.storage import sha, read_json
from salt_daily.population import FullPopulation
H = config.EXPERIMENTS/'v10_goal65_20261024'
LEGACY = config.EXPERIMENTS/'v10_candidate_ablation_20261026'
MODEL = SALT/'runs/daily_close_001/models/A3'
NAMES = read_json(ADOPTED/'adoption.json')['tree_names']
ALL_NAMES = sum([read_json(H/name)['names'] for name in
    ('06_daily_scalar_contract.json','08_dayflow_contract.json','16_amount_history_contract.json')], [])

def utc(): return datetime.now(timezone.utc).isoformat()

def write(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix+f'.{os.getpid()}.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n')
    temp.replace(path)

def log(event, **values):
    record = dict(utc=utc(), event=event, **values)
    with (OUT/'events.jsonl').open('a') as f: f.write(json.dumps(record, ensure_ascii=False)+'\n')
    write(OUT/'status.json', record)
    print(json.dumps(record, ensure_ascii=False), flush=True)

def check_frozen():
    from notebook_control import worker
    from run import lock_held
    assert not worker() and not lock_held(config.RUN/'run.lock'), 'SALT training must stay paused'
    for path, digest in read_json(OUT/'salt_paused.json')['preserved'].items():
        assert sha(Path(path)) == digest, f'Preserved artifact changed: {path}'
    plan = read_json(OUT/'plan.json')
    assert sha(ADOPTED/'tree.joblib') == plan['hgb_sha256']
    for path, digest in plan['source_code_sha256'].items():
        assert sha(Path(path)) == digest, path
    if (OUT/'code_manifest.json').exists():
        for name,digest in read_json(OUT/'code_manifest.json').items():
            assert sha(OUT/name) == digest, name

def population(scope):
    return FullPopulation(scope, OUT/'population' if scope == 'fusion_fit' else None)

def tree_model():
    bundle = joblib.load(ADOPTED/'tree.joblib')
    assert bundle['feature_names'] == NAMES
    assert bundle['model'].n_features_in_ == 36
    np.testing.assert_array_equal(bundle['model'].classes_, [0,1,2])
    np.testing.assert_array_equal(bundle['class_factors'], [1.,100.,100.])
    return bundle

def tree_scores(bundle, values):
    p = bundle['model'].predict_proba(values)/np.asarray(bundle['class_factors'])
    p /= p.sum(axis=1,keepdims=True)
    fraud = np.clip(p[:,1:].sum(axis=1),1e-12,1-1e-12)
    scores = np.log(fraud)-np.log1p(-fraud)
    assert np.isfinite(scores).all()
    return scores

def day_inputs(scope, span):
    from salt_daily.data import date
    day = date(span['day'])
    folder = (OUT/'features'/day if scope == 'fusion_fit' else
              H/'cache'/('full_validation' if scope == 'validation' else 'historical_test')/day)
    ids = np.load(folder/'ids.npy', mmap_mode='r')
    raw = np.load(folder/'X.npy', mmap_mode='r')
    hp = H/'cache/amount_history'/day
    hist_ids = np.load(hp/'ids.npy', mmap_mode='r')
    np.testing.assert_array_equal(ids,hist_ids)
    hist = np.load(hp/'X.npy',mmap_mode='r')
    assert raw.shape == (len(ids),78) and hist.shape == (len(ids),11)
    return ids,raw,hist

def tree_columns(raw,hist,take):
    x = np.empty((len(take),36),np.float32)
    for j,name in enumerate(NAMES):
        k = ALL_NAMES.index(name)
        x[:,j] = raw[take,k] if k < 78 else hist[take,k-78]
    assert np.isfinite(x).all()
    return x

def salt_scores(scope):
    folder = (OUT/'salt_scores/fusion_fit_epoch6' if scope == 'fusion_fit' else MODEL/f'{scope}_epoch6')
    complete = read_json(folder/'complete.json')
    assert complete['coverage'] == 1 and complete['scored'] == len(population(scope))
    path = folder/'scores.npy'
    assert sha(path) == complete['scores_sha256']
    request = read_json(folder/'request.json')
    assert request['protocol_sha256'] == read_json(OUT/'plan.json')['salt_protocol_sha256']
    assert request['population'] == population(scope).meta['files']
    return np.load(path,mmap_mode='r')

class ScoreFile:
    """Float64 score storage, bounded-memory checkpoints, explicit request identity."""
    def __init__(self, scope, rows):
        self.folder = OUT/'hgb_scores'/scope; self.folder.mkdir(parents=True,exist_ok=True)
        self.request = dict(scope=scope,rows=rows,plan_sha256=sha(OUT/'plan.json'),
                            population=population(scope).meta['files'],dtype='float64')
        marker=self.folder/'request.json'
        if marker.exists(): assert read_json(marker) == self.request
        else: write(marker,self.request)
        path=self.folder/'scores.npy'
        self.scores=(np.load(path,mmap_mode='r+') if path.exists() else
            np.lib.format.open_memmap(path,'w+',dtype='float64',shape=(rows,)))
        assert self.scores.shape == (rows,) and self.scores.dtype == np.float64
        self.cursor=0;self.seconds=0.
        self.commits=self.folder/'commits';self.commits.mkdir(exist_ok=True)
        for p in sorted(self.commits.glob('*.json')):
            d=read_json(p);assert d['start'] == self.cursor
            values=self.scores[d['start']:d['stop']]
            assert np.isfinite(values).all() and hashlib.sha256(values.tobytes()).hexdigest()==d['sha256']
            self.cursor=d['stop'];self.seconds+=d['seconds']

    def commit(self,values,seconds):
        values=np.asarray(values,dtype=np.float64);assert np.isfinite(values).all()
        start=self.cursor;stop=start+len(values);assert stop<=len(self.scores)
        self.scores[start:stop]=values;self.scores.flush()
        write(self.commits/f'{start:012d}.json',dict(start=start,stop=stop,seconds=seconds,
            sha256=hashlib.sha256(values.tobytes()).hexdigest()))
        self.cursor=stop;self.seconds+=seconds

