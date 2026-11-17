"""학습(8/31)·검증(10/31) 시점까지만 누적한 그래프·계좌 피처를 만든다. 라벨은 읽지 않는다."""
import sys, json
from pathlib import Path
sys.path.insert(0,'/workspace/handoff/TransXion_외부평가_20261112')
import bootstrap
import numpy as np, pandas as pd, duckdb
from backend_model.base_features import prepare_snapshot
from backend_model.preprocessing import build_ports
from backend_model.schema import NUMERIC_FEATURES
SRC=Path('/workspace/handoff/TransXion_외부평가_20261112'); WORK=Path(__file__).resolve().parents[1]/'work'
base=json.loads((SRC/'settings.json').read_text())
full_edges=pd.read_parquet(SRC/'run/prepared/edge_features.parquet',columns=['edge_id']+NUMERIC_FEATURES).set_index('edge_id')
full_ports=pd.read_parquet(SRC/'run/prepared/ports.parquet').set_index('edge_id')
for name,end in [('train','2025-08-31'),('val','2025-10-31')]:
    out=WORK/f'context_{name}'
    if not (out/'prepared/manifest.json').exists():
        prepare_snapshot(dict(base,context_end=end,target_end=end,output_dir=str(out)))
    c=duckdb.connect(str(out/'prepared/work.duckdb')); c.execute("SET threads=2; SET memory_limit='2GB'")
    if 'ports' not in {r[0] for r in c.execute('SHOW TABLES').fetchall()}: build_ports(c)
    ports=c.execute('SELECT * FROM ports ORDER BY edge_id').df().set_index('edge_id'); c.close()
    edges=pd.read_parquet(out/'prepared/edge_features.parquet',columns=['edge_id']+NUMERIC_FEATURES).set_index('edge_id')
    # 거래 피처와 포트는 과거만 쓰므로 전체 연도 계산값과 같아야 한다.
    d=np.abs(edges.to_numpy(np.float64)-full_edges.loc[edges.index].to_numpy(np.float64)).max()
    p=np.abs(ports.to_numpy(np.float64)-full_ports.loc[ports.index,ports.columns].to_numpy(np.float64)).max()
    print(name,end,'rows',len(edges),'edge feature maxdiff',d,'port maxdiff',p,flush=True)
    assert d<1e-5 and p==0
