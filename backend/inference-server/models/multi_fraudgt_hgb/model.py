"""Team binary model Multi-FraudGT + HGB: materials -> features and graph -> laundering risk.

backend_model/, assets/ and models/ are the delivered package files, unchanged except that
prepare_snapshot also takes the target IDs instead of a date range (base_features.py). This
module connects the package to the server contract: materials -> the package's transactions
and KYC tables, preprocessing from the whole frozen input, one p_laundering per TARGET. Runs
in the model child process; no DB access.

The package keeps one of the transactions whose every field is the same (the smallest ID);
the others get that transaction's score, so every TARGET is answered.
"""
from collections.abc import Iterable
import json
import os
from pathlib import Path
import tempfile
import time

import pyarrow as pa
import pyarrow.parquet as pq

from common.model_contract import ModelExecutionError
from common.score_contract import check_scores, target_ids
from common.worker_transport import ProtocolError
from models.multi_fraudgt_hgb.spec import BATCH_SIZE, SAMPLING_SEED, require_versions

DEVICE = os.environ.get("MULTI_FRAUDGT_HGB_DEVICE", "cpu")
THREADS = int(os.environ.get("MULTI_FRAUDGT_HGB_THREADS", "2"))
MEMORY_LIMIT = os.environ.get("MULTI_FRAUDGT_HGB_MEMORY_LIMIT", "2GB")
# With a ledger copy the model reads the whole frozen input from it and appends its step
# times to timings.jsonl next to the copy (replica/models/multi_fraudgt_hgb/).
USES_LEDGER = True
# Fields the package compares when it keeps one of identical transactions.
CONTENT = ("ts", "src", "dst", "paid", "received", "payment_currency", "receiving_currency", "payment_format")


def calculate_inputs(inputs, model_kind, *, model_version, feature_version):
    require_versions(model_version, feature_version)
    if model_kind != "binary":
        raise ProtocolError("multi_fraudgt_hgb scores only the binary model kind")
    if "targets" not in inputs or "tx_id" not in inputs["targets"].column_names:
        raise ProtocolError("multi_fraudgt_hgb requires the targets file")
    ids = target_ids(inputs["targets"].column("tx_id").to_pylist())
    ledger = inputs.get("ledger")
    timings, started = {}, time.perf_counter()
    if ledger is not None:
        inputs = ledger.inputs(inputs["targets"])
    from models.multi_fraudgt_hgb.materials import normalize
    with tempfile.TemporaryDirectory(prefix="multi-fraudgt-hgb-") as folder:
        (transactions, kyc), context_end = normalize(inputs, Path(folder))
        kept, days = kept_transactions(pq.read_table(transactions), ids)
        scored = sorted(set(kept.values()))
        timings["materials"] = round(time.perf_counter() - started, 3)
        settings = dict(transactions=str(transactions), kyc=str(kyc), context_end=str(context_end),
                        target_start=str(min(days)), target_end=str(max(days)), target_ids=scored,
                        output_dir=str(Path(folder) / "run"), threads=THREADS, memory_limit=MEMORY_LIMIT)
        risk = _risk(settings, timings)
    if set(risk) != set(scored):
        raise ModelExecutionError("MODEL_OUTPUT_INVALID", "POSTPROCESS")
    timings["total"] = round(time.perf_counter() - started, 3)
    if ledger is not None:
        with (ledger.model_dir("multi_fraudgt_hgb") / "timings.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(dict(seq=ledger.seq, targets=len(ids), scored=len(scored), **timings)) + "\n")
    return pa.table({"tx_id": pa.array(ids, pa.int64()),
                     "p_laundering": pa.array([risk[kept[i]] for i in ids], pa.float64())})


def kept_transactions(transactions, ids):
    """For each TARGET, the transaction the package keeps for it (itself unless an identical
    transaction has a smaller ID), and the dates of the kept ones."""
    frame = transactions.select(["edge_id", *CONTENT]).to_pandas()
    frame["kept"] = frame.groupby(list(CONTENT), dropna=False, sort=False)["edge_id"].transform("min")
    frame = frame.set_index("edge_id")
    kept = frame["kept"].reindex(ids)
    if kept.isna().any():
        raise ProtocolError("TARGET missing from the transactions material")
    kept = dict(zip(ids, kept.astype("int64").tolist()))
    days = set(frame["ts"].reindex(sorted(set(kept.values()))).dt.date)
    return kept, days


def _risk(settings, timings):
    """Score of each kept TARGET: package preprocessing, then the delivered GNN + HGB + fusion."""
    import torch
    mark = time.perf_counter()
    try:
        from models.multi_fraudgt_hgb.backend_model.inference import Predictor
        predictor = Predictor(DEVICE, THREADS)
    except torch.cuda.OutOfMemoryError:
        raise ModelExecutionError("GPU_OUT_OF_MEMORY", "LOAD_MODEL") from None
    except Exception:
        raise ModelExecutionError("MODEL_LOAD_FAILED", "LOAD_MODEL") from None
    timings["load_model"] = round(time.perf_counter() - mark, 3)
    from models.multi_fraudgt_hgb.backend_model.preprocessing import prepare
    mark = time.perf_counter()
    prepared = prepare(settings, progress=False)
    timings["preprocess"] = round(time.perf_counter() - mark, 3)
    mark = time.perf_counter()
    try:
        result = predictor.predict(prepared, batch_size=BATCH_SIZE, seed=SAMPLING_SEED, progress=False)
    except torch.cuda.OutOfMemoryError:
        raise ModelExecutionError("GPU_OUT_OF_MEMORY", "INFERENCE") from None
    timings["inference"] = round(time.perf_counter() - mark, 3)
    return dict(zip(result["edge_id"].astype("int64").tolist(), result["risk_score"].astype(float).tolist()))


def validate_scores(scores: pa.Table, expected_ids: Iterable[int], model_kind: str,
                    *, model_version: str, feature_version: str) -> None:
    require_versions(model_version, feature_version)
    check_scores(scores, expected_ids, model_kind)
