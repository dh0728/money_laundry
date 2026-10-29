"""Versions this model package accepts. Bindings store these values per model kind."""
from common.worker_transport import ProtocolError

MODEL_VERSION = "demo-random-v1"
LEGACY_MODEL_VERSION = "demo-calculator-v1"
FEATURE_VERSION = "demo-input-v1"


def supported_versions(model_version, feature_version):
    return model_version in (MODEL_VERSION, LEGACY_MODEL_VERSION) and feature_version == FEATURE_VERSION


def require_versions(model_version, feature_version):
    if not supported_versions(model_version, feature_version):
        raise ProtocolError("Unsupported demo versions")
