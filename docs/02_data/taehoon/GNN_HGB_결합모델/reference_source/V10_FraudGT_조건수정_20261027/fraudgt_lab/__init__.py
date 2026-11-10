"""Reproducible, period-graph FraudGT comparison for the V10 AML project."""

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(os.environ.get("AML_PROJECT_ROOT", str(Path(__file__).resolve().parents[1] / "project"))).resolve()
EXPERIMENT_ROOT = Path(__file__).resolve().parents[1]
RUN_ROOT = Path(os.environ.get("AML_RUN_DIR", str(EXPERIMENT_ROOT / "runs/shared_corrected_001"))).resolve()
LEGACY_ROOT = PROJECT_ROOT / "experiments/v10_candidate_ablation_20261026"
GRAPH_ROOT = PROJECT_ROOT / "experiments/v10_gnn_verify_20261025"

for directory in [PROJECT_ROOT / "feature_dependency/_deps", GRAPH_ROOT / "runtime_deps", GRAPH_ROOT, LEGACY_ROOT]:
    sys.path.insert(0, str(directory))

