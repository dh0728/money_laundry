"""The demo model of backend/inference-server, loaded for tests that play the inference peer."""
import importlib.util
from pathlib import Path

_SOURCE = Path(__file__).resolve().parents[3] / "inference-server/models/demo_random/model.py"
_loader = importlib.util.spec_from_file_location("inference_peer_demo_model", _SOURCE)
_module = importlib.util.module_from_spec(_loader)
_loader.loader.exec_module(_module)
calculate = _module.calculate
