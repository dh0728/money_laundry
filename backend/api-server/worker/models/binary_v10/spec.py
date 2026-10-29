"""Versions the backend binds for the team's binary GNN v10 (backend/inference-server models/binary_v10)."""
from common.worker_transport import ProtocolError

MODEL_VERSION = "gnn-binary-v10"
FEATURE_VERSION = "materials-v1"
# The model's validation-selected threshold; a run binding this model records it as its threshold.
RECOMMENDED_THRESHOLD = 0.4338742792606354


def supported_versions(model_version, feature_version):
    return model_version == MODEL_VERSION and feature_version == FEATURE_VERSION


def require_versions(model_version, feature_version):
    if not supported_versions(model_version, feature_version):
        raise ProtocolError("Unsupported binary_v10 versions")
