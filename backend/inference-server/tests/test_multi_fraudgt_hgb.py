"""multi_fraudgt_hgb gives the delivered package's scores for every TARGET from our materials.

Scoring tests run where torch, torch-geometric, pyg_lib, scikit-learn and duckdb import (the
inference server or its test image); the materials conversion runs everywhere.
"""
from datetime import timedelta, timezone
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from common.model_contract import ModelExecutionError
from common.worker_transport import ProtocolError
from inference_worker.model_adapter import run_model
from models.multi_fraudgt_hgb import materials
from models.multi_fraudgt_hgb.model import kept_transactions
from models.multi_fraudgt_hgb.spec import FEATURE_VERSION, MODEL_VERSION

FIXTURES = Path(__file__).resolve().parent / "fixtures/multi_fraudgt_hgb"
VERSIONS = dict(model_version=MODEL_VERSION, feature_version=FEATURE_VERSION)
TOLERANCE = 2e-6  # The package's parity tolerance (absolute).


def model_stack():
    try:
        return all(importlib.util.find_spec(name) for name in
                   ("torch", "torch_geometric", "pyg_lib", "sklearn", "duckdb")) and __import__("torch") is not None
    except OSError:  # torch present but its native libraries cannot load here
        return False


def materials_from_package_example():
    """The package's example transactions/KYC expressed as the backend's materials files."""
    tx = pq.read_table(FIXTURES / "transactions.parquet")
    kyc = pq.read_table(FIXTURES / "kyc.parquet").to_pylist()
    iso = {name: code for code, name in materials.CURRENCY_NAMES.items()}
    account = lambda node: f"acct-{node:06d}"  # sorted IDs keep the package's node order
    kst = timezone(timedelta(hours=9))
    occurred = [ts.replace(tzinfo=kst).astimezone(timezone.utc) for ts in tx.column("ts").to_pylist()]
    # The backend has no rows pointing at another duplicate; the package drops them too.
    keep = [row["duplicate_group_id"] in (None, row["edge_id"]) for row in tx.to_pylist()]
    transactions = pa.table({
        "tx_id": tx.column("edge_id"), "input_role": pa.array(["CONTEXT"] * tx.num_rows),
        "occurred_at": pa.array(occurred, pa.timestamp("us", tz="UTC")),
        "from_account_id": pa.array([account(v) for v in tx.column("src").to_pylist()]),
        "to_account_id": pa.array([account(v) for v in tx.column("dst").to_pylist()]),
        "amount_paid": pc.cast(tx.column("paid"), pa.decimal128(24, 6)),
        "amount_received": pc.cast(tx.column("received"), pa.decimal128(24, 6)),
        "payment_currency": pa.array([iso[v] for v in tx.column("payment_currency").to_pylist()]),
        "receiving_currency": pa.array([iso[v] for v in tx.column("receiving_currency").to_pylist()]),
        "payment_format": tx.column("payment_format"),
    }).filter(pa.array(keep))
    accounts = pa.table({
        "account_id": pa.array([account(row["node_id"]) for row in kyc]),
        "owner_id": pa.array([row["entity_id"] for row in kyc]),
        "entity_type": pa.array([row["entity_type"] for row in kyc]),
        "country": pa.array([None if row["country"] == "UNKNOWN" else row["country"] for row in kyc]),
    })
    return transactions, accounts


def expected_scores():
    """The package's own predictions for the example (targets: every transaction of 2022-10-03)."""
    rows = [json.loads(line) for line in (FIXTURES / "expected_predictions.jsonl").read_text(encoding="utf-8").splitlines()]
    return {row["edge_id"]: row["risk_score"] for row in rows}


def with_copy(transactions, of, copy_id):
    """transactions plus a transaction identical to `of` under another ID."""
    row = transactions.filter(pc.equal(transactions.column("tx_id"), of)).to_pylist()[0]
    return pa.concat_tables([transactions, pa.Table.from_pylist([dict(row, tx_id=copy_id)], schema=transactions.schema)])


def targets(ids):
    return pa.table({"tx_id": pa.array(sorted(ids), pa.int64())})


class _Ledger:
    """Stands in for inference_worker.replica.Ledger: the whole frozen input and a model folder."""

    def __init__(self, transactions, accounts, folder):
        self.materials, self.folder, self.seq = (transactions, accounts), Path(folder), 3

    def inputs(self, targets):
        return {"targets": targets, "transactions": self.materials[0], "accounts": self.materials[1]}

    def model_dir(self, name):
        folder = self.folder / "models" / name
        folder.mkdir(parents=True, exist_ok=True)
        return folder


class MaterialsTests(unittest.TestCase):
    def test_materials_become_the_package_normalized_inputs(self):
        transactions, accounts = materials_from_package_example()
        with tempfile.TemporaryDirectory() as folder:
            (tx_path, kyc_path), context_end = materials.normalize(
                {"transactions": transactions, "accounts": accounts}, Path(folder))
            got = pq.read_table(tx_path)
            kyc = pq.read_table(kyc_path)
        original = {row["edge_id"]: row for row in pq.read_table(FIXTURES / "transactions.parquet").to_pylist()}
        for row in got.to_pylist():
            source = original[row["edge_id"]]
            for column in ("ts", "src", "dst", "payment_currency", "receiving_currency", "payment_format"):
                self.assertEqual(row[column], source[column], column)
            self.assertAlmostEqual(row["paid"], source["paid"], places=6)
            self.assertIsNone(row["duplicate_group_id"])
        self.assertEqual(kyc.column("node_id").to_pylist(),
                         pq.read_table(FIXTURES / "kyc.parquet").column("node_id").to_pylist())
        self.assertEqual(context_end, max(ts.date() for ts in got.column("ts").to_pylist()))

    def test_unknown_currency_missing_account_or_partial_minute_is_an_input_error(self):
        transactions, accounts = materials_from_package_example()
        seconds = pc.add(transactions.column("occurred_at"), pa.scalar(timedelta(seconds=30)))
        for broken in ({"transactions": transactions.set_column(
                            transactions.column_names.index("payment_currency"), "payment_currency",
                            pa.array(["KRW"] * transactions.num_rows)), "accounts": accounts},
                       {"transactions": transactions, "accounts": accounts.slice(1)},
                       {"transactions": transactions.set_column(
                            transactions.column_names.index("occurred_at"), "occurred_at", seconds),
                        "accounts": accounts},
                       {"transactions": transactions}):
            with self.subTest(), tempfile.TemporaryDirectory() as folder, self.assertRaises(ProtocolError):
                materials.normalize(broken, Path(folder))

    def test_identical_transactions_take_the_smallest_id(self):
        transactions, accounts = materials_from_package_example()
        transactions = with_copy(with_copy(transactions, 63, 9999), 64, 9998)
        with tempfile.TemporaryDirectory() as folder:
            (tx_path, _), _ = materials.normalize({"transactions": transactions, "accounts": accounts}, Path(folder))
            kept, days = kept_transactions(pq.read_table(tx_path), [62, 63, 64, 9998, 9999])
        self.assertEqual(kept, {62: 62, 63: 63, 64: 64, 9998: 64, 9999: 63})
        self.assertEqual({str(day) for day in days}, {"2022-10-03"})

    def test_wrong_kind_or_missing_target_is_input_invalid(self):
        transactions, accounts = materials_from_package_example()
        inputs = {"transactions": transactions, "accounts": accounts}
        for ids, kind in (([62], "type"), ([62, 123456], "binary")):
            with self.subTest(kind=kind), self.assertRaises(ModelExecutionError) as caught:
                run_model(dict(inputs, targets=targets(ids)), kind, **VERSIONS)
            self.assertEqual(caught.exception.code, "INPUT_INVALID")


@unittest.skipUnless(model_stack(), "torch, torch-geometric, pyg_lib, scikit-learn and duckdb are required")
class PackageScoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.expected = expected_scores()
        cls.transactions, cls.accounts = materials_from_package_example()

    def assert_package_scores(self, scores, extra=None):
        ids = sorted(self.expected) + sorted(extra or {})
        run = {**self.expected, **(extra or {})}
        from models.multi_fraudgt_hgb.model import validate_scores
        validate_scores(scores, ids, "binary", **VERSIONS)
        got = dict(zip(scores.column("tx_id").to_pylist(), scores.column("p_laundering").to_pylist()))
        for edge_id, risk in run.items():
            self.assertAlmostEqual(got[edge_id], risk, delta=TOLERANCE, msg=edge_id)

    def test_backend_materials_give_the_package_scores(self):
        scores = run_model({"targets": targets(self.expected), "transactions": self.transactions,
                            "accounts": self.accounts}, "binary", **VERSIONS)
        self.assert_package_scores(scores)

    def test_identical_transaction_gets_the_kept_transaction_score(self):
        transactions = with_copy(self.transactions, 63, 9999)
        scores = run_model({"targets": targets([*self.expected, 9999]), "transactions": transactions,
                            "accounts": self.accounts}, "binary", **VERSIONS)
        self.assert_package_scores(scores, {9999: self.expected[63]})

    def test_ledger_copy_gives_the_same_scores_and_records_step_times(self):
        with tempfile.TemporaryDirectory() as folder:
            ledger = _Ledger(self.transactions, self.accounts, folder)
            scores = run_model({"targets": targets(self.expected), "ledger": ledger}, "binary", **VERSIONS)
            line, = (Path(folder) / "models/multi_fraudgt_hgb/timings.jsonl").read_text(encoding="utf-8").splitlines()
        self.assert_package_scores(scores)
        record = json.loads(line)
        self.assertEqual((record["seq"], record["targets"], record["scored"]), (3, len(self.expected), len(self.expected)))
        self.assertTrue({"materials", "load_model", "preprocess", "inference", "total"} <= set(record))


if __name__ == "__main__":
    unittest.main()
