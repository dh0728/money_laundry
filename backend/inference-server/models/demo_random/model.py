"""Model execution (inference server): targets.parquet -> binary score table. No DB access.

Scores the binary model kind only; Alert types come from models/alert_type_tree.

Pure table transformations only. Run ownership, cancellation, transport and DB
completion belong to the calling pipeline and are not simulated here.
"""
import hashlib
import random
from collections.abc import Iterable

import pyarrow as pa

from common.score_contract import check_scores, score_columns, target_ids
from common.worker_transport import ProtocolError, tx_ids
from models.demo_random.spec import LEGACY_MODEL_VERSION, require_versions


def calculate(targets: pa.Table, model_kind: str, *, model_version: str,
              feature_version: str) -> pa.Table:
    require_versions(model_version, feature_version)
    if model_kind != "binary":
        raise ProtocolError("demo_random scores only the binary model kind")
    columns = score_columns(model_kind)
    if targets.column_names != ["tx_id", "demo_value"]:
        raise ProtocolError("Unexpected demo input columns")
    ids = tx_ids(targets)
    ordered = target_ids(ids)
    if targets.schema.field("demo_value").type != pa.int64():
        raise ProtocolError("demo_value must be int64")
    if any(value != identifier % 100 for identifier, value in zip(
            targets.column("tx_id").to_pylist(), targets.column("demo_value").to_pylist())):
        raise ProtocolError("Invalid demo_value")
    values = [identifier % 100 for identifier in ordered]
    output = {"tx_id": pa.array(ordered, type=pa.int64())}
    if model_version == LEGACY_MODEL_VERSION:
        # Preserve already prepared requests without changing their version's output.
        output[columns[0]] = pa.array([(value + 0.5) / 100 for value in values], type=pa.float64())
    else:
        samples = []
        for identifier in ordered:
            seed = hashlib.sha256(f'{model_version}:{model_kind}:{identifier}'.encode()).digest()
            samples.append(random.Random(int.from_bytes(seed, 'big')).random())
        output[columns[0]] = pa.array(samples, type=pa.float64())
    return pa.table(output)


def validate_scores(scores: pa.Table, expected_ids: Iterable[int], model_kind: str,
                    *, model_version: str, feature_version: str) -> None:
    """Validate received demo output before a caller attempts DB publication."""
    require_versions(model_version, feature_version)
    check_scores(scores, expected_ids, model_kind)
