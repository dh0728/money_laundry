"""Team SALT-GNN R type model: each target transaction's past ledger -> 9-class type probabilities.

salt_r_original.py is the file delivered by the model team, unchanged (graph, network,
weights, prediction). This module only connects it to the server contract: it turns the
ledger copy into the original's ledger form, scores the targets and returns the backend's
class order. Runs in the model child process; no DB access.
"""
from collections.abc import Iterable
import os

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc

from common.model_contract import ModelExecutionError
from common.score_contract import check_scores, score_columns, target_ids
from common.worker_transport import ProtocolError
from models.salt_r.spec import require_versions

# Receives the ledger copy as inputs["ledger"]; without a copy the full materials carry it.
USES_LEDGER = True
DEVICE = os.environ.get("SALT_R_DEVICE", "cpu")
THREADS = int(os.environ.get("SALT_R_THREADS", "2"))
# Targets per graph build: bounds memory, results do not depend on it (each graph is per target).
CHUNK = int(os.environ.get("SALT_R_CHUNK", "20000"))
SEEDS = (42, 43, 44)
HISTORY_COLUMNS = ("tx_id", "occurred_at", "from_account_id", "to_account_id", "amount_paid")
# Backend p_0..p_8 = NON_PATTERN, FAN-OUT, FAN-IN, GATHER-SCATTER, SCATTER-GATHER, CYCLE, RANDOM, BIPARTITE, STACK.
BACKEND_CLASSES = ("no_pattern", "FAN-OUT", "FAN-IN", "GATHER-SCATTER", "SCATTER-GATHER",
                   "CYCLE", "RANDOM", "BIPARTITE", "STACK")
_LOADED = {}


def _original():
    # The original imports torch and holds the weights: load it only in the process that scores.
    from models.salt_r import salt_r_original
    return salt_r_original


def _numpy(column):
    column = column.combine_chunks() if isinstance(column, pa.ChunkedArray) else column
    return column.to_numpy(zero_copy_only=False)


def _ledger(history):
    """History table -> (the original's ledger L, tx_id per row ascending)."""
    if any(name not in history.column_names for name in HISTORY_COLUMNS):
        raise ProtocolError("salt_r history lacks required columns")
    history = history.select(list(HISTORY_COLUMNS))
    if any(history.column(name).null_count for name in HISTORY_COLUMNS):
        raise ProtocolError("Null in salt_r history")
    tx = _numpy(history.column("tx_id")).astype(np.int64)
    order = np.argsort(tx, kind="stable")
    history, tx = history.take(pa.array(order)), tx[order]
    if len(tx) and not (np.diff(tx) > 0).all():
        raise ProtocolError("Duplicate tx_id in salt_r history")
    # Minutes since 1970 (UTC), seconds dropped as the original's 'YYYY/MM/DD HH:MM'.
    minute = _numpy(pc.cast(history.column("occurred_at"), pa.timestamp("us", tz="UTC")).cast(pa.int64())) // 60_000_000
    # ln(1 + Amount Paid) through text -> float64, as the original reads the CSV.
    paid = _numpy(pc.cast(pc.cast(history.column("amount_paid"), pa.string()), pa.float64()))
    if not np.isfinite(paid).all() or (paid < 0).any():
        raise ProtocolError("Invalid amount in salt_r history")
    both = pa.concat_arrays([_numpy_array(history.column("from_account_id")),
                             _numpy_array(history.column("to_account_id"))])
    codes = pc.dictionary_encode(both)
    index = _numpy(codes.indices).astype(np.int32)
    base = int(minute.min()) // 1440 * 1440 if len(minute) else 0
    ledger = dict(minute=(minute - base).astype(np.int32), sid=index[:len(tx)], did=index[len(tx):],
                  lap=np.log1p(paid).astype(np.float32), lab=np.zeros(len(tx), np.int8),
                  base_min=base, n_acct=len(codes.dictionary))
    return ledger, tx


def _numpy_array(column):
    column = pc.cast(column, pa.string())
    return column.combine_chunks() if isinstance(column, pa.ChunkedArray) else column


def _models(original):
    if DEVICE not in _LOADED:
        _LOADED.clear()
        _LOADED[DEVICE] = original.load_models(SEEDS, DEVICE)
    return _LOADED[DEVICE]


def probabilities(history, ids):
    """Rows of the original's 9-class probabilities (its class order), one per id in ids."""
    original = _original()
    import torch
    if DEVICE == "cpu":
        torch.set_num_threads(max(1, THREADS))
    torch.use_deterministic_algorithms(True)
    torch.backends.cudnn.benchmark = False
    ledger, tx = _ledger(history)
    ids = np.asarray(ids, np.int64)
    rows = np.searchsorted(tx, ids)
    if not len(tx) or (rows >= len(tx)).any() or (tx[np.minimum(rows, len(tx) - 1)] != ids).any():
        raise ProtocolError("salt_r target missing from the ledger")
    original.choose_bits(ledger)  # fails before scoring when the ledger is too large to pack
    try:
        models, device = _models(original)
    except torch.cuda.OutOfMemoryError:
        raise ModelExecutionError("GPU_OUT_OF_MEMORY", "LOAD_MODEL") from None
    except Exception:
        raise ModelExecutionError("MODEL_LOAD_FAILED", "LOAD_MODEL") from None
    parts = []
    for start in range(0, len(rows), CHUNK):
        part = rows[start:start + CHUNK]
        graph = original.build_graph(ledger, part, log=lambda *_: None)
        try:
            batch = original.make_batch(graph, device)
            index = np.arange(len(part))
            parts.append(np.mean([original.predict_probs(models[seed], batch, index).astype(np.float64)
                                  for seed in SEEDS], 0))
        except torch.cuda.OutOfMemoryError:
            raise ModelExecutionError("GPU_OUT_OF_MEMORY", "INFERENCE") from None
    return np.concatenate(parts)


def calculate_inputs(inputs, model_kind, *, model_version, feature_version):
    require_versions(model_version, feature_version)
    if model_kind != "type":
        raise ProtocolError("salt_r classifies only the type model kind")
    if "targets" not in inputs or "tx_id" not in inputs["targets"].column_names:
        raise ProtocolError("salt_r requires the targets file")
    ids = target_ids(inputs["targets"].column("tx_id").to_pylist())
    if "ledger" in inputs:
        history = inputs["ledger"].transactions()
    elif "transactions" in inputs:
        history = inputs["transactions"]
    else:
        # Without past transactions the model answers almost only no_pattern: refuse instead.
        raise ProtocolError("salt_r needs the ledger copy or the transactions material")
    original = _original()
    order = np.array([original.CN9.index(name) for name in BACKEND_CLASSES])
    scores = probabilities(history, ids)[:, order]
    scores = scores / scores.sum(1, keepdims=True)
    output = {"tx_id": pa.array(ids, pa.int64())}
    for index, column in enumerate(score_columns(model_kind)):
        output[column] = pa.array(scores[:, index], pa.float64())
    return pa.table(output)


def validate_scores(scores: pa.Table, expected_ids: Iterable[int], model_kind: str,
                    *, model_version: str, feature_version: str) -> None:
    require_versions(model_version, feature_version)
    check_scores(scores, expected_ids, model_kind)
