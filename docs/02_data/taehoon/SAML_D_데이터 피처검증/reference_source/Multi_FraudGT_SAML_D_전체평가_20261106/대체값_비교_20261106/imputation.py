"""HI-train-only owner-field imputers, independent of binary fraud labels."""
from pathlib import Path
import hashlib,json,ctypes,gc
from datetime import datetime,timezone
import numpy as np
ROOT=Path(__file__).resolve().parent
BASE=ROOT.parent
HI=Path('/workspace/handoff/V10_FraudGT_조건수정_20261027')
DIAG=BASE/'결측_분포진단_20261106'
METHODS=['train_median','degree_median']
WEIGHT_SHA='42d0d8002a87962291eb3f409cfbba1d1dec381c35162f11f2e11cb3a034c58f'
N=9504852

def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
    return h.hexdigest()
def write(name,value):
    path=ROOT/name;temp=path.with_suffix('.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');temp.replace(path)
def event(stage,**kw):
    a=dict(utc=datetime.now(timezone.utc).isoformat(),stage=stage,**kw)
    print(json.dumps(a,ensure_ascii=False),flush=True);write('status.json',a)
def trim():gc.collect();ctypes.CDLL('libc.so.6').malloc_trim(0)
def owners(nodes,method):
    median=np.load(ROOT/'owner_train_median.npy')
    if method=='train_median':return np.broadcast_to(median,(len(nodes),3)).copy()
    assert method=='degree_median'
    edges=np.load(ROOT/'degree_bin_edges.npy');table=np.load(ROOT/'owner_bin_medians.npy')
    out=np.searchsorted(edges,np.asarray(nodes[:,2]),side='right')
    inc=np.searchsorted(edges,np.asarray(nodes[:,3]),side='right')
    return table[out,inc].copy()

def check_frozen():
    plan=json.loads((ROOT/'plan.json').read_text())
    for name,h in plan['source_sha256'].items():assert sha(ROOT/name)==h,name
    assert sha(BASE/'selected_best.pt')==WEIGHT_SHA
    fitted=json.loads((ROOT/'fit.json').read_text())
    for name,h in fitted['artifacts'].items():assert sha(ROOT/name)==h,name
    for name,info in fitted['inputs'].items():
        st=Path(name).stat();assert (st.st_size,st.st_mtime_ns)==(info['size'],info['mtime_ns']),name
    paused=json.loads((DIAG/'salt_paused.json').read_text());salt=Path(paused['preserved'].keys().__iter__().__next__()).parent
    assert sha(salt/'runs/daily_close_001/models/A3/last.pt')==paused['last_checkpoint_sha256']
    return plan
