"""The demo model of backend/inference-server, loaded for tests that play the inference peer."""
import importlib.util
from pathlib import Path

import pyarrow as pa

_SOURCE = Path(__file__).resolve().parents[3] / "inference-server/models/demo_random/model.py"
_loader = importlib.util.spec_from_file_location("inference_peer_demo_model", _SOURCE)
_module = importlib.util.module_from_spec(_loader)
_loader.loader.exec_module(_module)
calculate = _module.calculate


def classify_alerts(targets):
    """Stand-in Alert type result (the tree itself is tested on the inference server): type alert_key % 9."""
    keys = targets.column("alert_key").to_pylist()
    return pa.table({"alert_key": pa.array(keys, pa.int64()),
                     **{f"p_{i}": pa.array([1.0 if key % 9 == i else 0.0 for key in keys], pa.float64())
                        for i in range(9)}})
