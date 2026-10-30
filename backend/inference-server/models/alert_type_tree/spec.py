"""Versions and fixed file of the Alert type decision tree v3.

The tree was trained on HI-Large pattern graphs without payment-format features
(worktable/worker_experiments/alert_type_tree_v2/train_v3.py, validation accuracy 97.24%). Its checksum is part of the model version, so a different file is a
different model.
"""
import hashlib
from pathlib import Path

from common.worker_transport import ProtocolError

MODEL_VERSION = "alert-type-tree-v3"
FEATURE_VERSION = "alert-graph-features-v2"

ASSETS = Path(__file__).resolve().parent / "assets"
ASSET_SHA256 = {
    "alert_type_tree_v3.json": "1b9fa545fa3d7158296740518f6f5dcef8a347e0ca89844041151ebdd4502a3e",
}


def supported_versions(model_version, feature_version):
    return model_version == MODEL_VERSION and feature_version == FEATURE_VERSION


def require_versions(model_version, feature_version):
    if not supported_versions(model_version, feature_version):
        raise ProtocolError("Unsupported alert_type_tree versions")


def asset(name):
    """Path of the delivered file after checking it is byte-identical to the package."""
    path = ASSETS / name
    expected = ASSET_SHA256.get(name)
    if expected is None or not path.is_file():
        raise ProtocolError("Missing alert_type_tree asset")
    with path.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
            raise ProtocolError("alert_type_tree asset checksum mismatch")
    return path
