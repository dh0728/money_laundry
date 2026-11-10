import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = Path('/workspace/kimi/Claude_GNN/final_model')
EXPERIMENTS = PROJECT / 'experiments'
LEGACY = EXPERIMENTS / 'v10_candidate_ablation_20261026'
GRAPH = EXPERIMENTS / 'v10_gnn_verify_20261025'
FEATURES = EXPERIMENTS / 'v10_goal65_20261024/cache/gnn'
FRAUDGT = Path('/workspace/handoff/V10_FraudGT_조건수정_20261027')
FRAUDGT_RUN = FRAUDGT / 'runs/shared_corrected_001'
RUN = ROOT / 'runs/daily_close_001'
for name in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
    os.environ.setdefault(name, '1')
for folder in (PROJECT / 'feature_dependency/_deps', GRAPH / 'runtime_deps', GRAPH):
    sys.path.insert(0, str(folder))

