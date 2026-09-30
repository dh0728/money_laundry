"""Approved September demo calculator; probabilities are not risk estimates.

Pure table transformations only. Run ownership, cancellation, transport and DB
completion belong to the calling pipeline and are not simulated here.
"""
import math
import hashlib
import random
from collections.abc import Iterable

import pyarrow as pa

from worker_transport import ProtocolError, tx_ids

MODEL_VERSION = "demo-calculator-v1"
FEATURE_VERSION = "demo-input-v1"
LABEL_MODEL_VERSION = "demo-labels-v2"
FIXED_LABEL_MODEL_VERSION = "demo-labels-v1"
LABEL_FEATURE_VERSION = "demo-label-input-v1"


def supported_versions(model_version, feature_version):
    return (model_version, feature_version) in (
        (MODEL_VERSION, FEATURE_VERSION), (LABEL_MODEL_VERSION, LABEL_FEATURE_VERSION),
        (FIXED_LABEL_MODEL_VERSION, LABEL_FEATURE_VERSION))


def _versions(model_version, feature_version):
    if not supported_versions(model_version, feature_version):
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
    if model_version in (LABEL_MODEL_VERSION, FIXED_LABEL_MODEL_VERSION):
        return calculate_labels(targets, model_kind, model_version)
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


def build_label_targets(rows):
    rows = sorted(rows)
    build_targets([r[0] for r in rows])  # Shared positive/unique ID checks only.
    if any(type(label) is not bool or type(kind) is not int or not 0 <= kind <= 8
           or (not label and kind != 0) for _, label, kind in rows):
        raise ProtocolError("Invalid demo annotation")
    return pa.table({"tx_id": pa.array([r[0] for r in rows], type=pa.int64()),
                     "demo_label": pa.array([r[1] for r in rows], type=pa.bool_()),
                     "demo_type": pa.array([r[2] for r in rows], type=pa.int64())})


def _random_for(tx_id, model_kind):
    # Local RNG: batch order, retries and parallel model execution cannot affect it.
    seed = hashlib.sha256(f'{LABEL_MODEL_VERSION}:{model_kind}:{tx_id}'.encode()).digest()
    return random.Random(int.from_bytes(seed, 'big'))


def _binary_sample(tx_id, label):
    rng = _random_for(tx_id, 'binary')
    # Calibrated for the application suspicion threshold of 0.7.
    low, high, mean, deviation = (.30, .99, .85, .10) if label else (.01, .99, .25, .18)
    # Rejection sampling gives a truncated normal, not a pile-up at clipped bounds.
    while True:
        value = rng.gauss(mean, deviation)
        if low <= value <= high:
            return value


def _type_sample(tx_id, kind):
    rng = _random_for(tx_id, 'type')
    weights = [rng.gammavariate(8.0 if i == kind else 1.0, 1.0) for i in range(9)]
    total = math.fsum(weights)
    return [v / total for v in weights]


def calculate_labels(targets, model_kind, model_version):
    if targets.column_names != ["tx_id", "demo_label", "demo_type"]:
        raise ProtocolError("Unexpected label-demo input columns")
    if targets.schema.types != [pa.int64(), pa.bool_(), pa.int64()]:
        raise ProtocolError("Invalid label-demo input types")
    ordered = build_label_targets(list(zip(*(targets.column(c).to_pylist() for c in targets.column_names))))
    output = {"tx_id": ordered.column("tx_id")}
    ids = ordered['tx_id'].to_pylist()
    if model_version == LABEL_MODEL_VERSION:
        if model_kind == 'binary':
            output['p_laundering'] = pa.array([_binary_sample(i, label) for i, label in
                zip(ids, ordered['demo_label'].to_pylist())], type=pa.float64())
        else:
            samples = [_type_sample(i, kind) for i, kind in zip(ids, ordered['demo_type'].to_pylist())]
            for i in range(9):
                output[f'p_{i}'] = pa.array([r[i] for r in samples], type=pa.float64())
        return pa.table(output)
    if model_kind == "binary":
        output['p_laundering'] = pa.array([.95 if v else .05 for v in ordered['demo_label'].to_pylist()], type=pa.float64())
    else:
        for i in range(9):
            output[f'p_{i}'] = pa.array([.92 if v == i else .01 for v in ordered['demo_type'].to_pylist()], type=pa.float64())
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
