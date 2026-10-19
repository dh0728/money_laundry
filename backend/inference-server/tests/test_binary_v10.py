"""binary_v10 reproduces the team's delivered outputs, from weights alone and from our materials.

Torch-dependent tests run where torch, torch-geometric and duckdb import (the inference
server or its test image); the materials conversion runs everywhere.
"""
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from models.binary_v10 import materials
from models.binary_v10.spec import FEATURE_VERSION, MODEL_VERSION

FIXTURES = Path(__file__).resolve().parent / "fixtures/binary_v10"
TOLERANCE = 2e-5  # The team's parity tolerance (absolute, relative 0).


def torch_stack():
    try:
        return all(importlib.util.find_spec(name) for name in ("torch", "torch_geometric", "duckdb")) and \
            __import__("torch") is not None
    except OSError:  # torch present but its native libraries cannot load here
        return False


def materials_from_package_example():
    """The team's example transactions/KYC expressed as the backend's materials files."""
    tx = pq.read_table(FIXTURES / "transactions.parquet")
    kyc = pq.read_table(FIXTURES / "kyc.parquet").to_pylist()
    iso = {name: code for code, name in materials.CURRENCY_NAMES.items()}
    account = lambda node: f"acct-{node:06d}"  # sorted IDs keep the package's node order
    kst = timezone(timedelta(hours=9))
    occurred = [ts.replace(tzinfo=kst).astimezone(timezone.utc) for ts in tx.column("ts").to_pylist()]
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


class MaterialsTests(unittest.TestCase):
    def test_materials_become_the_package_normalized_inputs(self):
        transactions, accounts = materials_from_package_example()
        with tempfile.TemporaryDirectory() as folder:
            (tx_path, kyc_path), context_end = materials.normalize(
                {"transactions": transactions, "accounts": accounts}, Path(folder))
            got = pq.read_table(tx_path)
            kyc = pq.read_table(kyc_path)
        original = pq.read_table(FIXTURES / "transactions.parquet")
        kept = {row["edge_id"]: row for row in original.to_pylist()}
        for row in got.to_pylist():
            source = kept[row["edge_id"]]
            for column in ("ts", "src", "dst", "payment_currency", "receiving_currency", "payment_format"):
                self.assertEqual(row[column], source[column], column)
            self.assertAlmostEqual(row["paid"], source["paid"], places=6)
        self.assertEqual(kyc.column("node_id").to_pylist(), pq.read_table(FIXTURES / "kyc.parquet").column("node_id").to_pylist())
        self.assertEqual(context_end, max(ts.date() for ts in got.column("ts").to_pylist()))

    def test_unknown_currency_or_missing_account_is_an_input_error(self):
        from common.worker_transport import ProtocolError
        transactions, accounts = materials_from_package_example()
        for broken in ({"transactions": transactions.set_column(
                            transactions.column_names.index("payment_currency"), "payment_currency",
                            pa.array(["KRW"] * transactions.num_rows)), "accounts": accounts},
                       {"transactions": transactions, "accounts": accounts.slice(1)},
                       {"transactions": transactions}):
            with self.subTest(), tempfile.TemporaryDirectory() as folder, self.assertRaises(ProtocolError):
                materials.normalize(broken, Path(folder))


@unittest.skipUnless(torch_stack(), "torch, torch-geometric and duckdb are required")
class ParityTests(unittest.TestCase):
    def test_weights_reproduce_reference_graphs(self):
        from models.binary_v10.network import Predictor
        from models.binary_v10.preprocess import reference_graph
        predictor = Predictor()
        for name in ("reference_known", "reference_unmatched"):
            metadata = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
            risk = predictor.risk(reference_graph(FIXTURES / f"{name}.npz", metadata))
            with self.subTest(name=name):
                self.assertAlmostEqual(risk, metadata["expected"]["binary"]["risk_score"], delta=TOLERANCE)

    def test_package_preprocessing_reproduces_raw_predictions(self):
        from models.binary_v10.network import Predictor
        from models.binary_v10.preprocess import GraphSnapshot, prepare_snapshot
        expected = json.loads((FIXTURES / "expected_raw_predictions.json").read_text(encoding="utf-8"))
        predictor = Predictor()
        with tempfile.TemporaryDirectory() as folder:
            prepared = prepare_snapshot(FIXTURES / "transactions.parquet", FIXTURES / "kyc.parquet",
                                        Path(folder) / "prepared", context_end="2022-10-03",
                                        target_start="2022-10-03", target_end="2022-10-03")
            with GraphSnapshot(prepared) as snapshot:
                got = {int(i): predictor.risk(snapshot.build(int(i))) for i in snapshot.target_ids()}
        self.assertEqual(sorted(got), [row["edge_id"] for row in expected])
        for row in expected:
            self.assertAlmostEqual(got[row["edge_id"]], row["risk_score"], delta=TOLERANCE)

    def test_memory_snapshot_builds_the_package_graphs(self):
        import numpy as np
        from models.binary_v10.preprocess import GraphSnapshot, MemorySnapshot, prepare_snapshot
        with tempfile.TemporaryDirectory() as folder:
            # Every retained context transaction as a target, not only the example day.
            prepared = prepare_snapshot(FIXTURES / "transactions.parquet", FIXTURES / "kyc.parquet",
                                        Path(folder) / "prepared", context_end="2022-10-03",
                                        target_start="1970-01-01", target_end="2022-10-03")
            with GraphSnapshot(prepared) as package, MemorySnapshot(prepared) as memory:
                ids = package.target_ids()
                self.assertTrue(np.array_equal(memory.target_ids(), ids))
                self.assertGreater(len(ids), 18)  # more than the example day
                for edge_id in ids:
                    want, got = package.build(int(edge_id)), memory.build(int(edge_id))
                    self.assertEqual((got.edge_id, got.context_end), (want.edge_id, want.context_end))
                    for a, b in zip(want.arrays + want.topology, got.arrays + got.topology):
                        self.assertEqual(a.dtype, b.dtype, edge_id)
                        self.assertTrue(np.array_equal(a, b), edge_id)
                with self.assertRaises(ValueError):
                    memory.build(-1)

    def test_model_on_backend_materials_matches_package_predictions(self):
        from models.binary_v10.model import calculate_inputs, validate_scores
        expected = json.loads((FIXTURES / "expected_raw_predictions.json").read_text(encoding="utf-8"))
        ids = [row["edge_id"] for row in expected]
        transactions, accounts = materials_from_package_example()
        inputs = {"targets": pa.table({"tx_id": pa.array(ids, pa.int64())}),
                  "transactions": transactions, "accounts": accounts}
        versions = dict(model_version=MODEL_VERSION, feature_version=FEATURE_VERSION)
        scores = calculate_inputs(inputs, "binary", **versions)
        validate_scores(scores, ids, "binary", **versions)
        got = dict(zip(scores.column("tx_id").to_pylist(), scores.column("p_laundering").to_pylist()))
        for row in expected:
            self.assertAlmostEqual(got[row["edge_id"]], row["risk_score"], delta=TOLERANCE)


if __name__ == "__main__":
    unittest.main()
