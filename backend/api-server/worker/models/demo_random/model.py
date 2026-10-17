"""Model execution (inference worker): targets.parquet -> score table. No DB access.

Pure table transformations only. Run ownership, cancellation, transport and DB
completion belong to the calling pipeline and are not simulated here.
"""
import math
import hashlib
import random
from collections.abc import Iterable

import pyarrow as pa

from common.score_contract import check_scores, score_columns
from common.worker_transport import ProtocolError, tx_ids
from models.demo_random.build_input import build_targets
from models.demo_random.spec import LEGACY_MODEL_VERSION, require_versions


def calculate(targets: pa.Table, model_kind: str, *, model_version: str,
              feature_version: str) -> pa.Table:
    require_versions(model_version, feature_version)
    columns = score_columns(model_kind)
    if targets.column_names != ["tx_id", "demo_value"]:
        raise ProtocolError("Unexpected demo input columns")
    ids = tx_ids(targets)
    expected = build_targets(ids)
    if targets.schema.field("demo_value").type != pa.int64():
        raise ProtocolError("demo_value must be int64")
    if any(value != identifier % 100 for identifier, value in zip(
            targets.column("tx_id").to_pylist(), targets.column("demo_value").to_pylist())):
        raise ProtocolError("Invalid demo_value")
    values = expected.column("demo_value").to_pylist()
    output = {"tx_id": expected.column("tx_id")}
    if model_version == LEGACY_MODEL_VERSION:
        # Preserve already prepared requests without changing their version's output.
        if model_kind == "binary":
            output[columns[0]] = pa.array([(value + 0.5) / 100 for value in values], type=pa.float64())
        else:
            for index, column in enumerate(columns):
                output[column] = pa.array([0.6 if value % 9 == index else 0.05 for value in values], type=pa.float64())
    else:
        samples = []
        for identifier in expected['tx_id'].to_pylist():
            seed = hashlib.sha256(f'{model_version}:{model_kind}:{identifier}'.encode()).digest()
            rng = random.Random(int.from_bytes(seed, 'big'))
            weights = [rng.random() for _ in columns]
            total = math.fsum(weights)
            samples.append(weights if model_kind == 'binary' else
                           [value / total for value in weights] if total else [1 / 9] * 9)
        for index, column in enumerate(columns):
            output[column] = pa.array([row[index] for row in samples], type=pa.float64())
    return pa.table(output)


def validate_scores(scores: pa.Table, expected_ids: Iterable[int], model_kind: str,
                    *, model_version: str, feature_version: str) -> None:
    """Validate received demo output before a caller attempts DB publication."""
    require_versions(model_version, feature_version)
    check_scores(scores, expected_ids, model_kind)
