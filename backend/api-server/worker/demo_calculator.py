"""Approved September demo calculator; probabilities are not risk estimates.

Pure table transformations only. Run ownership, cancellation, transport and DB
completion belong to the calling pipeline and are not simulated here.
"""
import math
from collections.abc import Iterable

import pyarrow as pa

from worker_transport import ProtocolError, tx_ids

MODEL_VERSION = "demo-calculator-v1"
FEATURE_VERSION = "demo-input-v1"


def _versions(model_version, feature_version):
    if (model_version, feature_version) != (MODEL_VERSION, FEATURE_VERSION):
        raise ProtocolError("Unsupported demo versions")


def _columns(model_kind):
    if model_kind == "binary":
        return ["p_laundering"]
    if model_kind == "type":
        return [f"p_{index}" for index in range(9)]
    raise ProtocolError("Unsupported model kind")


def build_targets(target_ids: Iterable[int]) -> pa.Table:
    """Accept frozen TARGET IDs only; never copy raw report or label columns."""
    ids = list(target_ids)
    if not ids:
        raise ProtocolError("Empty TARGET must complete as EMPTY_INPUT without inference")
    if any(type(value) is not int or not 0 < value <= 2**63 - 1 for value in ids):
        raise ProtocolError("TARGET IDs must be positive int64")
    if len(set(ids)) != len(ids):
        raise ProtocolError("Duplicate TARGET ID")
    ids.sort()
    return pa.table({
        "tx_id": pa.array(ids, type=pa.int64()),
        "demo_value": pa.array([value % 100 for value in ids], type=pa.int64()),
    })


def calculate(targets: pa.Table, model_kind: str, *, model_version: str,
              feature_version: str) -> pa.Table:
    _versions(model_version, feature_version)
    columns = _columns(model_kind)
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
    if model_kind == "binary":
        output[columns[0]] = pa.array([(value + 0.5) / 100 for value in values],
                                     type=pa.float64())
    else:
        for index, column in enumerate(columns):
            output[column] = pa.array([0.6 if value % 9 == index else 0.05
                                       for value in values], type=pa.float64())
    return pa.table(output)


def validate_scores(scores: pa.Table, expected_ids: Iterable[int], model_kind: str,
                    *, model_version: str, feature_version: str) -> None:
    """Validate received demo output before a caller attempts DB publication."""
    _versions(model_version, feature_version)
    columns = _columns(model_kind)
    if scores.column_names != ["tx_id", *columns]:
        raise ProtocolError("Unexpected demo result columns")
    expected = tx_ids(build_targets(expected_ids))
    if tx_ids(scores) != expected:
        raise ProtocolError("Result TARGET set mismatch")
    probabilities = []
    for column in columns:
        if scores.schema.field(column).type != pa.float64():
            raise ProtocolError("Probability must be float64")
        values = scores.column(column).to_pylist()
        if any(value is None or not math.isfinite(value) or not 0 <= value <= 1
               for value in values):
            raise ProtocolError("Invalid probability")
        probabilities.append(values)
    if model_kind == "type" and any(
            abs(math.fsum(row) - 1) > 1e-9 for row in zip(*probabilities)):
        raise ProtocolError("Type probabilities must sum to one")
