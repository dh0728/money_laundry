"""Versions the backend binds for the team's SALT-GNN R type model (backend/inference-server models/salt_r)."""
from common.worker_transport import ProtocolError

MODEL_VERSION = "salt-gnn-r-type-v1"
# Reads each target's past transactions from the server's ledger copy (or the full materials).
FEATURE_VERSION = "ledger-history-v1"


def supported_versions(model_version, feature_version):
    return model_version == MODEL_VERSION and feature_version == FEATURE_VERSION


def require_versions(model_version, feature_version):
    if not supported_versions(model_version, feature_version):
        raise ProtocolError("Unsupported salt_r versions")
