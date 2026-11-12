"""Versions and fixed settings of the team's binary model Multi-FraudGT + HGB.

The delivered weights, calibration and schema files are checked against the package's own
checksums (assets/provenance.json, backend_model.preprocessing.verify_assets) before every use.
"""
from common.worker_transport import ProtocolError

MODEL_VERSION = "multi280_hgb36_v1"
FEATURE_VERSION = "materials-v1"
# A transaction's score depends on the other targets scored in its batch and on the sampling
# seed, so both stay the package defaults for this model version.
BATCH_SIZE = 2048
SAMPLING_SEED = 42


def supported_versions(model_version, feature_version):
    return model_version == MODEL_VERSION and feature_version == FEATURE_VERSION


def require_versions(model_version, feature_version):
    if not supported_versions(model_version, feature_version):
        raise ProtocolError("Unsupported multi_fraudgt_hgb versions")
