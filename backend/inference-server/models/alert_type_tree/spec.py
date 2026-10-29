"""Versions and fixed file of the Alert type decision tree v2.

The tree was trained on HI-Large pattern graphs (worktable/worker_experiments/alert_type_tree_v2,
validation accuracy 98.50%). Its checksum is part of the model version, so a different file is a
different model.
"""
import hashlib
from pathlib import Path

from common.worker_transport import ProtocolError

MODEL_VERSION = "alert-type-tree-v2"
FEATURE_VERSION = "alert-graph-features-v1"

ASSETS = Path(__file__).resolve().parent / "assets"
ASSET_SHA256 = {
    "alert_type_tree_v2.json": "1c7b4aaf4a23392ab154a1c12a776f5969c97d0ebd1a8e554c0049002d88258e",
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
