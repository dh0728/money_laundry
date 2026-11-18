"""Predeclared source-only imputation experiment, frozen Multi-FraudGT."""
from pathlib import Path
from datetime import datetime, timezone
import os, sys, json, hashlib, gc, ctypes
for k in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):
    os.environ[k]='1'
import numpy as np

ROOT=Path(__file__).resolve().parent
BASE=ROOT.parent
PRIOR=BASE/'대체값_비교_20261106'
DIAG=BASE/'결측_분포진단_20261106'
HI=Path('/workspace/handoff/V10_FraudGT_조건수정_20261027')
SALT=Path('/workspace/handoff/SALT_GNN_직접공유샘플링_20261104')
METHODS=['degree_median','behavior_donor']
CASES=['original','zero','train_median',*METHODS]
WEIGHT_SHA='42d0d8002a87962291eb3f409cfbba1d1dec381c35162f11f2e11cb3a034c58f'
N=9504852
TITLES={'original':'HI 원본','zero':'기존 0 대체','train_median':'HI 전체 중앙값',
        'degree_median':'차수 구간별 중앙값','behavior_donor':'행동 유사 계좌 대체'}

def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
    return h.hexdigest()
def write(name,value):
    p=ROOT/name;p.parent.mkdir(parents=True,exist_ok=True)
    t=p.with_suffix(p.suffix+'.tmp');t.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');t.replace(p)
def event(stage,**kw):
    a=dict(utc=datetime.now(timezone.utc).isoformat(),stage=stage,**kw)
    print(json.dumps(a,ensure_ascii=False),flush=True);write('status.json',a)
def trim():gc.collect();ctypes.CDLL('libc.so.6').malloc_trim(0)
def owners(scope,method):return np.load(ROOT/f'{scope}_{method}_owners.npy',mmap_mode='r')
def salt_check():
    paused=json.loads((DIAG/'salt_paused.json').read_text())
    for path,h in paused['preserved'].items():assert sha(path)==h,path
    assert sha(SALT/'runs/daily_close_001/models/A3/last.pt')==paused['last_checkpoint_sha256']
    sys.path.insert(0,str(SALT))
    import notebook_control
    assert notebook_control.worker() is None,'SALT unexpectedly running; do not compete with it'
def check_frozen():
    plan=json.loads((ROOT/'plan.json').read_text())
    for name,h in plan['source_sha256'].items():assert sha(ROOT/name)==h,name
    assert sha(BASE/'selected_best.pt')==WEIGHT_SHA
    fit=json.loads((ROOT/'fit.json').read_text())
    for name,h in fit['artifacts'].items():assert sha(ROOT/name)==h,name
    for path,info in fit['inputs'].items():
        st=Path(path).stat();assert (st.st_size,st.st_mtime_ns)==(info['size'],info['mtime_ns']),path
    salt_check()
    return plan
