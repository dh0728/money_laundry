"""Versions the backend binds for the team's binary model Multi-FraudGT + HGB (backend/inference-server models/multi_fraudgt_hgb)."""
from common.worker_transport import ProtocolError

MODEL_VERSION = "multi280_hgb36_v1"
FEATURE_VERSION = "materials-v1"
# The one place the suspicious threshold is set: a run binding this model records it as its
# threshold (risk >= threshold). The team's validation-selected value from the fusion experiment
# (package README); tune it here only (user decision, 2026-11-12).
RECOMMENDED_THRESHOLD = 0.194997844
# Alert seed promotion (alerts/seed_promotion.py) on this model's score scale: dual-threshold
# low value and amount-ratio chaining floor. Provisional: the values picked for the previous
# binary model (Alert generator study, 2026-11-04); pick again from this model's results
# (user decision, 2026-11-12).
ALERT_SEED_LOW = 0.1
ALERT_CHAIN_FLOOR = 0.01


def supported_versions(model_version, feature_version):
    return model_version == MODEL_VERSION and feature_version == FEATURE_VERSION


def require_versions(model_version, feature_version):
    if not supported_versions(model_version, feature_version):
        raise ProtocolError("Unsupported multi_fraudgt_hgb versions")
