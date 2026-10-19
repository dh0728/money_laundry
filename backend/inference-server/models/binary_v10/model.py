"""Team binary GNN v10: materials -> v10 features and two-hop graphs -> laundering risk.

Runs in the inference server's model child process; no DB access. Scores every target
transaction of the request against the whole frozen context in the materials.
"""
from collections.abc import Iterable
import os
from pathlib import Path
import tempfile

import pyarrow as pa

from common.score_contract import check_scores, target_ids
from common.worker_transport import ProtocolError
from models.binary_v10.spec import require_versions

THREADS = int(os.environ.get("BINARY_V10_THREADS", "2"))
MEMORY_LIMIT = os.environ.get("BINARY_V10_MEMORY_LIMIT", "2GB")
DEVICE = os.environ.get("BINARY_V10_DEVICE", "cpu")


def calculate_inputs(inputs, model_kind, *, model_version, feature_version):
    require_versions(model_version, feature_version)
    if model_kind != "binary":
        raise ProtocolError("binary_v10 scores only the binary model kind")
    if "targets" not in inputs or "tx_id" not in inputs["targets"].column_names:
        raise ProtocolError("binary_v10 requires the targets file")
    ids = target_ids(inputs["targets"].column("tx_id").to_pylist())
    # Heavy imports load only in the model process that needs them.
    from models.binary_v10.materials import normalize
    from models.binary_v10.network import Predictor
    from models.binary_v10.preprocess import MemorySnapshot, prepare_snapshot
    with tempfile.TemporaryDirectory(prefix="binary-v10-") as folder:
        (transactions, kyc), context_end = normalize(inputs, Path(folder))
        prepared = prepare_snapshot(transactions, kyc, Path(folder) / "prepared", context_end=context_end,
                                    target_ids=ids, threads=THREADS, memory_limit=MEMORY_LIMIT)
        predictor = Predictor(device=DEVICE, threads=THREADS)
        with MemorySnapshot(prepared) as snapshot:
            scores = [predictor.risk(snapshot.build(identifier)) for identifier in ids]
    return pa.table({"tx_id": pa.array(ids, pa.int64()), "p_laundering": pa.array(scores, pa.float64())})


def validate_scores(scores: pa.Table, expected_ids: Iterable[int], model_kind: str,
                    *, model_version: str, feature_version: str) -> None:
    require_versions(model_version, feature_version)
    check_scores(scores, expected_ids, model_kind)
