"""alert_type_tree: Alert inputs -> 9 type probabilities, and the input rules it enforces."""
from datetime import datetime, timezone
from decimal import Decimal
import random
import unittest

import pyarrow as pa

from common.worker_transport import ProtocolError
from models.alert_type_tree import features as alert_features
from models.alert_type_tree.model import CLASSES, TRANSACTIONS, calculate_inputs, validate_scores
from models.alert_type_tree.spec import FEATURE_VERSION, MODEL_VERSION
from tests.demo_inputs import build_alerts

VERSIONS = dict(model_version=MODEL_VERSION, feature_version=FEATURE_VERSION)


def alert(key, edges, formats=("ACH",)):
    """Inputs of one Alert from (hour, from, to, amount) edges; payment formats cycle through formats."""
    rows = [dict(alert_key=key, tx_id=index + 1, occurred_at=datetime(2023, 8, 1, hour, tzinfo=timezone.utc),
                 from_account_id=source, to_account_id=target, amount_usd=Decimal(amount),
                 payment_format=formats[index % len(formats)])
            for index, (hour, source, target, amount) in enumerate(edges)]
    return dict(targets=pa.table({"alert_key": pa.array([key], pa.int64())}),
                alert_transactions=pa.Table.from_pylist(rows, schema=TRANSACTIONS))


def predicted(inputs):
    scores = calculate_inputs(inputs, "type", **VERSIONS)
    return [CLASSES[max(range(9), key=lambda i: row[f"p_{i}"])] for row in scores.to_pylist()]


class AlertTypeTreeTests(unittest.TestCase):
    def test_canonical_shapes_get_their_type_and_probabilities_sum_to_one(self):
        shapes = {
            "FAN-OUT": [(i, "hub", f"leaf{i}", "100") for i in range(5)],
            "FAN-IN": [(i, f"leaf{i}", "hub", "100") for i in range(5)],
            "CYCLE": [(i, f"a{i}", f"a{(i + 1) % 4}", "100") for i in range(4)],
            "SCATTER-GATHER": [(0, "s", f"m{i}", "100") for i in range(3)] + [(1, f"m{i}", "t", "90") for i in range(3)],
        }
        for expected, edges in shapes.items():
            inputs = alert(7, edges)
            self.assertEqual(predicted(inputs), [expected])
            validate_scores(calculate_inputs(inputs, "type", **VERSIONS), [7], "type", **VERSIONS)

    def test_payment_format_does_not_change_the_result(self):
        # v2 called a fan-out with mixed formats NON_PATTERN; v3 has no format feature.
        edges = [(i, "hub", f"leaf{i}", str(500 + 1000 * i)) for i in range(8)]
        one = calculate_inputs(alert(7, edges), "type", **VERSIONS)
        mixed = alert(7, edges, ("Cheque", "Credit Card", "Cash"))
        self.assertEqual(predicted(mixed), ["FAN-OUT"])
        self.assertTrue(one.equals(calculate_inputs(mixed, "type", **VERSIONS)))

    def test_result_follows_alert_keys_not_file_order(self):
        inputs = build_alerts([3, 1, 2])
        shuffled = dict(inputs, alert_transactions=inputs["alert_transactions"].take(
            pa.array(list(reversed(range(inputs["alert_transactions"].num_rows))))))
        scores = calculate_inputs(inputs, "type", **VERSIONS)
        self.assertEqual(scores.column("alert_key").to_pylist(), [1, 2, 3])
        self.assertTrue(scores.equals(calculate_inputs(shuffled, "type", **VERSIONS)))

    def test_amount_ratio_chain_matches_the_training_formula(self):
        # The training code compared every pair of transactions; the package indexes by account.
        rng = random.Random(0)
        for _ in range(300):
            accounts = [f"a{i}" for i in range(rng.randint(2, 6))]
            rows = [(rng.randint(0, 4), rng.choice(accounts), rng.choice(accounts),
                     rng.choice([0.0, 1.0, 5.5, 100.0]), "ACH") for _ in range(rng.randint(1, 15))]
            ratios = sorted(rows[j][3] / rows[i][3] for i in range(len(rows)) for j in range(len(rows))
                            if rows[i][2] == rows[j][1] and rows[i][0] <= rows[j][0] and i != j and rows[i][3] > 0)
            value = dict(zip(alert_features.FEATURES, alert_features.features(rows)))["amount_ratio_chain"]
            self.assertEqual(value, ratios[len(ratios) // 2] if ratios else 1.0)

    def test_invalid_inputs_rejected(self):
        inputs = build_alerts([1, 2])
        transactions = inputs["alert_transactions"]
        bad = [
            dict(inputs, targets=pa.table({"alert_key": pa.array([1, 2, 3], pa.int64())})),  # Alert without rows
            dict(inputs, targets=pa.table({"alert_key": pa.array([1], pa.int64())})),  # rows of an unlisted Alert
            dict(inputs, targets=pa.table({"alert_key": pa.array([1, 1, 2], pa.int64())})),
            dict(inputs, targets=pa.table({"alert_key": pa.array([0, 2], pa.int64())})),
            dict(inputs, alert_transactions=pa.concat_tables([transactions, transactions.slice(0, 1)])),
            dict(inputs, alert_transactions=transactions.drop_columns(["payment_format"])),
            dict(inputs, alert_transactions=transactions.set_column(
                5, "amount_usd", pa.array([None] * transactions.num_rows, pa.decimal128(24, 6)))),
            dict(targets=inputs["targets"]),
            dict(inputs, transactions=transactions),
        ]
        for index, case in enumerate(bad):
            with self.subTest(case=index), self.assertRaises(ProtocolError):
                calculate_inputs(case, "type", **VERSIONS)
        for kind, versions in (("binary", VERSIONS), ("type", dict(VERSIONS, model_version="alert-type-tree-v1"))):
            with self.assertRaises(ProtocolError):
                calculate_inputs(inputs, kind, **versions)


if __name__ == "__main__":
    unittest.main()
