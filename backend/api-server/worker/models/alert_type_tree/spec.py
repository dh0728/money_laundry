"""Versions the backend binds for the Alert type tree (backend/inference-server models/alert_type_tree)."""
from common.worker_transport import ProtocolError

MODEL_VERSION = "alert-type-tree-v2"
FEATURE_VERSION = "alert-graph-features-v1"


def supported_versions(model_version, feature_version):
    return model_version == MODEL_VERSION and feature_version == FEATURE_VERSION


def require_versions(model_version, feature_version):
    if not supported_versions(model_version, feature_version):
        raise ProtocolError("Unsupported alert_type_tree versions")
