"""Alert type decision tree v2: each Alert's core transactions -> probabilities of the 9 types.

Runs in the inference server's model child process; no DB access and no ledger copy. The request
carries the Alerts to classify (targets: alert_key) and the core transactions of each Alert
(alert_transactions). Class order is p_0 NON_PATTERN, p_1 FAN-OUT, p_2 FAN-IN, p_3 GATHER-SCATTER,
p_4 SCATTER-GATHER, p_5 CYCLE, p_6 RANDOM, p_7 BIPARTITE, p_8 STACK.
"""
from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
import json
import math

import pyarrow as pa

from common.score_contract import check_scores, score_columns, target_ids
from common.worker_transport import ProtocolError, key_ids
from models.alert_type_tree.features import FEATURES, features
from models.alert_type_tree.spec import asset, require_versions

CLASSES = ("NON_PATTERN", "FAN-OUT", "FAN-IN", "GATHER-SCATTER", "SCATTER-GATHER",
           "CYCLE", "RANDOM", "BIPARTITE", "STACK")
TRANSACTIONS = pa.schema([
    ("alert_key", pa.int64()), ("tx_id", pa.int64()), ("occurred_at", pa.timestamp("us", tz="UTC")),
    ("from_account_id", pa.string()), ("to_account_id", pa.string()),
    ("amount_usd", pa.decimal128(24, 6)), ("payment_format", pa.string()),
])
EPOCH, MICROSECOND = datetime(1970, 1, 1, tzinfo=timezone.utc), timedelta(microseconds=1)


def load_tree():
    tree = json.loads(asset("alert_type_tree_v2.json").read_text(encoding="utf-8"))
    if tuple(tree["features"]) != FEATURES or tuple(tree["classes"]) != CLASSES:
        raise ProtocolError("alert_type_tree features or classes differ from the package")
    return tree["nodes"]


def predict(nodes, rows):
    """Leaf probabilities for one Alert, rescaled so the 6-decimal values sum to one."""
    values = dict(zip(FEATURES, features(rows)))
    node = nodes[0]
    while "feature" in node:
        node = nodes[node["left"] if values[node["feature"]] <= node["threshold"] else node["right"]]
    total = math.fsum(node["probabilities"])
    return [value / total for value in node["probabilities"]]


def calculate_inputs(inputs, model_kind, *, model_version, feature_version):
    require_versions(model_version, feature_version)
    if model_kind != "type":
        raise ProtocolError("alert_type_tree classifies only the type model kind")
    if set(inputs) != {"targets", "alert_transactions"} or inputs["targets"].column_names != ["alert_key"]:
        raise ProtocolError("alert_type_tree requires targets and alert_transactions")
    keys = target_ids(key_ids(inputs["targets"], "alert_key"))
    transactions = inputs["alert_transactions"]
    if not transactions.schema.equals(TRANSACTIONS, check_metadata=False):
        raise ProtocolError("Unexpected alert_transactions columns")
    if any(transactions.column(name).null_count for name in TRANSACTIONS.names):
        raise ProtocolError("Null in alert_transactions")
    rows, seen = defaultdict(list), set()
    for item in transactions.to_pylist():
        if (item["alert_key"], item["tx_id"]) in seen:
            raise ProtocolError("Duplicate Alert transaction")
        seen.add((item["alert_key"], item["tx_id"]))
        rows[item["alert_key"]].append((
            (item["occurred_at"] - EPOCH) // MICROSECOND, item["tx_id"], item["from_account_id"],
            item["to_account_id"], float(item["amount_usd"]), item["payment_format"]))
    if set(rows) != set(keys):
        raise ProtocolError("Every Alert needs its core transactions, and only listed Alerts")
    nodes = load_tree()
    # Time then tx_id order, so transactions at the same time give the same chain whatever the file order.
    probabilities = [predict(nodes, [(row[0], *row[2:]) for row in sorted(rows[key])]) for key in keys]
    output = {"alert_key": pa.array(keys, pa.int64())}
    for index, column in enumerate(score_columns("type")):
        output[column] = pa.array([row[index] for row in probabilities], pa.float64())
    return pa.table(output)


def validate_scores(scores: pa.Table, expected_ids: Iterable[int], model_kind: str,
                    *, model_version: str, feature_version: str) -> None:
    require_versions(model_version, feature_version)
    check_scores(scores, expected_ids, model_kind)
