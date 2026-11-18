"""Portable V10 FraudGT: immutable prepared inputs; isolated writable work directory."""
import json, os
from pathlib import Path
PACKAGE_ROOT = Path(__file__).resolve().parents[1]
EXPERIMENT_ROOT = Path(os.environ.get("FRAUDGT_WORK_DIR", PACKAGE_ROOT / "work")).expanduser().resolve()
RUN_ROOT = EXPERIMENT_ROOT / "runs" / os.environ.get("FRAUDGT_RUN_NAME", "shared_seed42")
if RUN_ROOT.parent != EXPERIMENT_ROOT / "runs":
    raise ValueError("FRAUDGT_RUN_NAME must be a single directory name")
settings_path = EXPERIMENT_ROOT / "inputs.json"
SETTINGS = json.loads(settings_path.read_text()) if settings_path.exists() else {}
def input_path(key, default):
    return Path(SETTINGS.get(key, EXPERIMENT_ROOT / "data" / default)).expanduser().resolve()
G = input_path("feature_root", "features")
STRUCTURAL_ROOT = input_path("structural_root", "structural")
HI_ROOT = input_path("hi_root", "hi")
PORT_ROOT = input_path("port_root", "ports")
