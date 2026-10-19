"""Versions and fixed files of the team's binary GNN v10 (node19_edge17_v1 features).

The assets are the delivered package files unchanged; their checksums are part of the
model version, so a different file is a different model.
"""
import hashlib
from pathlib import Path

from common.worker_transport import ProtocolError

MODEL_VERSION = "gnn-binary-v10"
FEATURE_VERSION = "materials-v1"
# Validation-selected threshold delivered with the weights (risk_score >= threshold).
RECOMMENDED_THRESHOLD = 0.4338742792606354

ASSETS = Path(__file__).resolve().parent / "assets"
ASSET_SHA256 = {
    "binary.pt": "290f42b183466b4776de7032581f6d7ef18d9c72d08620b9c80eb0bb78806926",
    "binary.json": "d22660e82875490cab1419db7b486e1454cad84d7bd6d0f44302b1b4ac552f69",
    "currency_stats.parquet": "2aa573f63fbde56917f6f25c0aac843e436fc92be3e4b78dd61e032452350f86",
    "amount_stats.parquet": "82581e84403efe55104217a09ac80a6b7e07172920c04769268a2f03ac281da0",
    "feature_schema.json": "d7ec1ac7b454d9709a31a9064179c8a1f3340d9438132b4fd3a18e5dde132e59",
}


def supported_versions(model_version, feature_version):
    return model_version == MODEL_VERSION and feature_version == FEATURE_VERSION


def require_versions(model_version, feature_version):
    if not supported_versions(model_version, feature_version):
        raise ProtocolError("Unsupported binary_v10 versions")


def asset(name):
    """Path of a delivered file after checking it is byte-identical to the package."""
    path = ASSETS / name
    expected = ASSET_SHA256.get(name)
    if expected is None or not path.is_file():
        raise ProtocolError("Missing binary_v10 asset")
    with path.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
            raise ProtocolError("binary_v10 asset checksum mismatch")
    return path
