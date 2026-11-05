"""Versions the backend binds for the team's binary GNN v10 (backend/inference-server models/binary_v10)."""
from common.worker_transport import ProtocolError

MODEL_VERSION = "gnn-binary-v10"
FEATURE_VERSION = "materials-v1"
# The model's validation-selected threshold; a run binding this model records it as its threshold.
RECOMMENDED_THRESHOLD = 0.4338742792606354
# Alert seed promotion (alerts/seed_promotion.py) on this model's score scale: dual-threshold
# low value and amount-ratio chaining floor. Picked on HI-Small, tested on HI-Medium with v10
# scores (Alert generator study, 2026-11-04); pick again for another model.
ALERT_SEED_LOW = 0.1
ALERT_CHAIN_FLOOR = 0.01


def supported_versions(model_version, feature_version):
    return model_version == MODEL_VERSION and feature_version == FEATURE_VERSION


def require_versions(model_version, feature_version):
    if not supported_versions(model_version, feature_version):
        raise ProtocolError("Unsupported binary_v10 versions")
