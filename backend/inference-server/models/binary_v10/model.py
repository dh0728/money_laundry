"""Team binary GNN v10: materials -> v10 features and two-hop graphs -> laundering risk.

Runs in the inference server's model child process; no DB access. Scores every target
transaction of the request against the whole frozen context: recomputed from the materials,
or, with the server's ledger copy, read from the features kept next to the copy.
"""
from collections.abc import Iterable
import os
from pathlib import Path
import tempfile
import time

import pyarrow as pa

from common.score_contract import check_scores, target_ids
from common.worker_transport import ProtocolError
from models.binary_v10.spec import require_versions

THREADS = int(os.environ.get("BINARY_V10_THREADS", "2"))
MEMORY_LIMIT = os.environ.get("BINARY_V10_MEMORY_LIMIT", "2GB")
DEVICE = os.environ.get("BINARY_V10_DEVICE", "cpu")
# With a ledger copy the model keeps its features next to it (state.py) instead of the whole input.
USES_LEDGER = True


def calculate_inputs(inputs, model_kind, *, model_version, feature_version):
    require_versions(model_version, feature_version)
    if model_kind != "binary":
        raise ProtocolError("binary_v10 scores only the binary model kind")
    if "targets" not in inputs or "tx_id" not in inputs["targets"].column_names:
        raise ProtocolError("binary_v10 requires the targets file")
    ids = target_ids(inputs["targets"].column("tx_id").to_pylist())
    if "ledger" in inputs:
        return _from_ledger(inputs["ledger"], ids)
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


def _from_ledger(ledger, ids):
    """Scores from the features kept next to the server's ledger copy (models/binary_v10/state.py).

    Step times of every request are appended to timings.jsonl in the state folder.
    """
    from models.binary_v10.network import Predictor
    from models.binary_v10.state import FeatureState
    started = time.perf_counter()
    state = FeatureState(ledger.model_dir("binary_v10"), threads=THREADS, memory_limit=MEMORY_LIMIT)
    state.sync(ledger)
    snapshot = state.snapshot(ids)
    mark = time.perf_counter()
    predictor = Predictor(device=DEVICE, threads=THREADS)
    scores = [predictor.risk(snapshot.build(identifier)) for identifier in ids]
    state.timings["graphs_and_model"] = round(time.perf_counter() - mark, 3)
    state.timings["total"] = round(time.perf_counter() - started, 3)
    state.write_timings(dict(seq=ledger.seq, targets=len(ids), **state.timings))
    return pa.table({"tx_id": pa.array(ids, pa.int64()), "p_laundering": pa.array(scores, pa.float64())})


def validate_scores(scores: pa.Table, expected_ids: Iterable[int], model_kind: str,
                    *, model_version: str, feature_version: str) -> None:
    require_versions(model_version, feature_version)
    check_scores(scores, expected_ids, model_kind)
