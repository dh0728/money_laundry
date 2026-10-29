"""Model-independent TARGET and score checks shared by every model package.

Model packages add their own input/output rules on top; transport, publication and
score storage rely only on these checks. A binary request scores transactions (tx_id);
a type request classifies Alerts (alert_key, the Alert plan's number within its run).
"""
import math
from collections.abc import Iterable

import pyarrow as pa

from common.worker_transport import ProtocolError, key_ids


def target_ids(values: Iterable[int]) -> list[int]:
    """Validate frozen TARGET IDs and return them sorted."""
    ids = list(values)
    if not ids:
        raise ProtocolError("Empty TARGET must complete as EMPTY_INPUT without inference")
    if any(type(value) is not int or not 0 < value <= 2**63 - 1 for value in ids):
        raise ProtocolError("TARGET IDs must be positive int64")
    if len(set(ids)) != len(ids):
        raise ProtocolError("Duplicate TARGET ID")
    ids.sort()
    return ids


def key_column(model_kind):
    if model_kind == "binary":
        return "tx_id"
    if model_kind == "type":
        return "alert_key"
    raise ProtocolError("Unsupported model kind")


def score_columns(model_kind):
    if model_kind == "binary":
        return ["p_laundering"]
    if model_kind == "type":
        return [f"p_{index}" for index in range(9)]
    raise ProtocolError("Unsupported model kind")


def check_scores(scores: pa.Table, expected_ids: Iterable[int], model_kind: str) -> None:
    """Exact TARGET set, float64 probabilities in [0, 1], TYPE rows summing to one."""
    columns = score_columns(model_kind)
    key = key_column(model_kind)
    if scores.column_names != [key, *columns]:
        raise ProtocolError("Unexpected result columns")
    if key_ids(scores, key) != set(target_ids(expected_ids)):
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
