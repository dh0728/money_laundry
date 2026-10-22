"""The v10 features kept next to the ledger copy equal the package preprocessing of the whole input.

Each day the copy appends the day's transactions and the state adds only those; the graphs it
builds for the day's targets must equal prepare_snapshot over every transaction so far with the
same account numbers. Corrections, late transactions and changed KYC rebuild the state.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import json
from pathlib import Path
import random
import tempfile
import unittest

import pyarrow as pa
import pyarrow.compute as pc

from tests.test_binary_v10 import torch_stack

AMOUNT = pa.decimal128(24, 6)
KST = timezone(timedelta(hours=9))
TRANSACTIONS = pa.schema([
    ("tx_id", pa.int64()), ("input_role", pa.string()), ("occurred_at", pa.timestamp("us", tz="UTC")),
    ("from_account_id", pa.string()), ("to_account_id", pa.string()),
    ("amount_paid", AMOUNT), ("amount_received", AMOUNT), ("payment_currency", pa.string()),
    ("receiving_currency", pa.string()), ("payment_format", pa.string()),
])
ACCOUNTS = pa.schema([("account_id", pa.string()), ("owner_id", pa.string()),
                      ("entity_type", pa.string()), ("country", pa.string())])
DAYS = [date(2023, 9, 1) + timedelta(days=i) for i in range(4)]


def ledger_days(seed=7, accounts=40, per_day=150):
    """Synthetic ledger: a hub with more than 100 transactions, self transfers, reciprocal pairs,
    shared owners, unknown KYC values and transactions around midnight."""
    rng = random.Random(seed)
    names = [f"acct-{i:03d}" for i in range(accounts)]
    kyc = [dict(account_id=name, owner_id=None if i == 5 else f"owner-{i // 2}",
                entity_type=rng.choice(["Corporation", "Individual", "Partnership", None, "Other"]),
                country=rng.choice(["KR", "US", None, ""]))
           for i, name in enumerate(names)]
    currencies = ["USD", "EUR", "GBP", "JPY", "BTC"]
    days, tx_id = [], 1
    for index, day in enumerate(DAYS):
        rows = []
        stamps = sorted(datetime(day.year, day.month, day.day, tzinfo=KST) + timedelta(minutes=rng.randrange(1440))
                        for _ in range(per_day))
        if index == 0:
            stamps += [datetime(day.year, day.month, day.day, 23, 59, tzinfo=KST)] * 2
        if index == 1:
            stamps = [datetime(day.year, day.month, day.day, 0, 0, tzinfo=KST)] * 2 + stamps
        for stamp in stamps:
            roll = rng.random()
            source = rng.choice(names[:12]) if roll < 0.5 else rng.choice(names)
            target = names[0] if roll < 0.35 else (source if roll > 0.97 else rng.choice(names))
            pay = rng.choice(currencies)
            rows.append(dict(tx_id=tx_id, input_role="TARGET", occurred_at=stamp.astimezone(timezone.utc),
                             from_account_id=source, to_account_id=target,
                             amount_paid=Decimal(rng.randrange(1, 10 ** 7)) / 100,
                             amount_received=Decimal(rng.randrange(1, 10 ** 7)) / 100,
                             payment_currency=pay, receiving_currency=pay if rng.random() < 0.8 else rng.choice(currencies),
                             payment_format=rng.choice(["ACH", "Wire", "Cheque"])))
            tx_id += 1
        days.append(rows)
    return days, kyc


def transactions(rows, role=None):
    return pa.Table.from_pylist([dict(row, input_role=role or row["input_role"]) for row in rows], schema=TRANSACTIONS)


def accounts(rows):
    return pa.Table.from_pylist(rows, schema=ACCOUNTS)


def parties(kyc, rows):
    used = {row["from_account_id"] for row in rows} | {row["to_account_id"] for row in rows}
    return [row for row in kyc if row["account_id"] in used]


def nothing():
    return pa.table({"tx_id": pa.array([], pa.int64())})


@unittest.skipUnless(torch_stack(), "torch, torch-geometric and duckdb are required")
class FeatureStateTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        from inference_worker.replica import Replica
        self.replica = Replica(self.root / "replica")
        self.days, self.kyc = ledger_days()

    def state(self, name="state"):
        from models.binary_v10.state import FeatureState
        return FeatureState(self.root / name)

    def full(self, rows, seq):
        return self.replica.apply(dict(mode="full", base_seq=0, seq=seq, rows=len(rows)),
                                  dict(transactions=transactions(rows), accounts=accounts(parties(self.kyc, rows)),
                                       removed=nothing()))

    def delta(self, rows, base, seq, total, kyc=None, removed=()):
        return self.replica.apply(dict(mode="delta", base_seq=base, seq=seq, rows=total),
                                  dict(transactions=transactions(rows), accounts=accounts(kyc or parties(self.kyc, rows)),
                                       removed=pa.table({"tx_id": pa.array(list(removed), pa.int64())})))

    def reference(self, state, ledger, targets):
        """prepare_snapshot over the copy's whole input with the state's account numbers."""
        import duckdb
        from models.binary_v10.preprocess import MemorySnapshot, prepare_snapshot
        from models.binary_v10.state import normalize_transactions
        with duckdb.connect(str(state.path), read_only=True) as c:
            nodes = c.execute("SELECT account_id,node_id,entity_id,entity_type,country FROM nodes ORDER BY node_id").to_arrow_table()
        number = dict(zip(nodes.column("account_id").to_pylist(), nodes.column("node_id").to_pylist()))
        raw = normalize_transactions(ledger.transactions())
        tx = pa.table({
            "edge_id": raw.column("edge_id"), "ts": raw.column("ts"),
            "src": pa.array([number[a] for a in raw.column("src_account").to_pylist()], pa.int64()),
            "dst": pa.array([number[a] for a in raw.column("dst_account").to_pylist()], pa.int64()),
            **{name: raw.column(name) for name in ("paid", "received", "payment_currency", "receiving_currency", "payment_format")},
            "duplicate_group_id": pa.nulls(raw.num_rows, pa.int64()),
        })
        kyc = nodes.select(["node_id", "entity_id", "entity_type", "country"])
        folder = Path(tempfile.mkdtemp(dir=self.root))
        import pyarrow.parquet as pq
        pq.write_table(tx, folder / "tx.parquet")
        pq.write_table(kyc, folder / "kyc.parquet")
        end = pc.max(pc.cast(tx.column("ts"), pa.date32())).as_py()
        return MemorySnapshot(prepare_snapshot(folder / "tx.parquet", folder / "kyc.parquet", folder / "prepared",
                                               context_end=end, target_ids=targets))

    def assert_same_graphs(self, state, ledger, targets):
        import numpy as np
        got, want = state.snapshot(targets), self.reference(state, ledger, targets)
        for edge_id in targets:
            a, b = got.build(edge_id), want.build(edge_id)
            self.assertEqual((a.edge_id, a.context_end), (b.edge_id, b.context_end))
            for index, (x, y) in enumerate(zip(a.arrays + a.topology, b.arrays + b.topology)):
                self.assertEqual(x.dtype, y.dtype, (edge_id, index))
                self.assertEqual(x.shape, y.shape, (edge_id, index))
                if x.dtype.kind == "f":  # running sums may round differently from a single avg()
                    self.assertTrue(np.allclose(x, y, rtol=0, atol=1e-6), (edge_id, index, np.abs(x - y).max()))
                else:
                    self.assertTrue(np.array_equal(x, y), (edge_id, index))

    def test_each_day_appended_equals_the_whole_input_recomputed(self):
        state, seen, base = self.state(), [], 0
        for index, rows in enumerate(self.days):
            seen += rows
            seq = 10 * (index + 1)
            ledger = self.full(rows, seq) if index == 0 else self.delta(rows, base, seq, len(seen))
            state.timings = {}
            state.sync(ledger)
            self.assertEqual(state.timings["state"], "rebuilt" if index == 0 else "appended")
            self.assert_same_graphs(state, ledger, [row["tx_id"] for row in rows])
            base = seq
        # The hub's sample really is a sample.
        import duckdb
        with duckdb.connect(str(state.path), read_only=True) as c:
            self.assertGreater(c.execute("SELECT max(n) FROM (SELECT dst,count(*) n FROM tx GROUP BY dst)").fetchone()[0], 100)

    def test_appending_day_by_day_keeps_the_same_state_as_one_rebuild(self):
        import duckdb
        appended, base, seen = self.state("appended"), 0, []
        for index, rows in enumerate(self.days):
            seen += rows
            ledger = self.full(rows, 1) if index == 0 else self.delta(rows, base, index + 1, len(seen))
            appended.sync(ledger)
            base = index + 1
        rebuilt = self.state("rebuilt")
        rebuilt.sync(ledger.__class__(ledger.root, dict(ledger.state, change={"kind": "full", "base": 0})))
        exact = {"meta": "*", "nodes": "*", "tx": "*", "edge_features": "*", "pairs": "*", "node_currency": "*",
                 "entity_pairs": "*", "node_agg": "* EXCLUDE (out_z,in_z)"}
        with duckdb.connect(str(appended.path), read_only=True) as a, duckdb.connect(str(rebuilt.path), read_only=True) as b:
            for table, columns in exact.items():
                query = f"SELECT {columns} FROM {table} ORDER BY ALL"
                self.assertEqual(a.execute(query).fetchall(), b.execute(query).fetchall(), table)
            sums = "SELECT node_id,out_z,in_z FROM node_agg ORDER BY node_id"
            for x, y in zip(a.execute(sums).fetchall(), b.execute(sums).fetchall()):
                self.assertEqual(x[0], y[0])
                self.assertAlmostEqual(x[1], y[1], places=9)
                self.assertAlmostEqual(x[2], y[2], places=9)

    def test_a_correction_late_transaction_or_kyc_change_rebuilds(self):
        first, second, third, fourth = self.days
        state = self.state()
        state.sync(self.full(first, 1))
        state.sync(self.delta(second, 1, 2, len(first) + len(second)))
        # A corrected earlier transaction: the copy is rewritten and the state rebuilt.
        corrected = dict(first[3], amount_paid=Decimal("123.45"), input_role="CONTEXT")
        ledger = self.delta(third + [corrected], 2, 3, len(first) + len(second) + len(third))
        self.assertEqual(ledger.change["kind"], "rewrite")
        state.timings = {}
        state.sync(ledger)
        self.assertEqual(state.timings["state"], "rebuilt")
        self.assert_same_graphs(state, ledger, [row["tx_id"] for row in third])
        # A transaction of an earlier day arriving late: appended to the copy, rebuilt state.
        late = dict(fourth[0], occurred_at=second[5]["occurred_at"])
        total = len(first) + len(second) + len(third) + 1
        ledger = self.delta([late], 3, 4, total)
        self.assertEqual(ledger.change["kind"], "append")
        state.timings = {}
        state.sync(ledger)
        self.assertEqual(state.timings["state"], "rebuilt")
        # Changed KYC of a known account (no new transaction needed).
        changed = [dict(self.kyc[1], entity_type="Individual" if self.kyc[1]["entity_type"] != "Individual" else "Corporation")]
        state.timings = {}
        state.sync(self.delta(fourth[1:3], 4, 5, total + 2, kyc=parties(self.kyc, fourth[1:3]) + changed))
        self.assertEqual(state.timings["state"], "rebuilt")

    def test_the_second_model_of_a_run_and_a_retried_run_need_no_rebuild(self):
        first, second = self.days[:2]
        state = self.state()
        state.sync(self.full(first, 1))
        ledger = self.delta(second, 1, 2, len(first) + len(second))
        state.sync(ledger)
        state.timings = {}
        state.sync(self.delta(second, 1, 2, len(first) + len(second)))  # the type model of the same run
        self.assertEqual(state.timings["state"], "current")
        # A retried run re-sends the same targets at a new position: nothing new to add.
        ledger = self.delta(second, 2, 3, len(first) + len(second))
        self.assertEqual(ledger.change, {"kind": "append", "base": 2, "parts": [], "accounts": ledger.change["accounts"]})
        state.timings = {}
        state.sync(ledger)
        self.assertEqual(state.timings["state"], "appended")
        self.assert_same_graphs(state, ledger, [row["tx_id"] for row in second])

    def test_model_scores_from_the_ledger_and_records_step_times(self):
        from inference_worker.model_adapter import run_model
        from models.binary_v10.spec import FEATURE_VERSION, MODEL_VERSION
        first, second = self.days[:2]
        self.full(first, 1)
        ledger = self.delta(second, 1, 2, len(first) + len(second))
        ids = [row["tx_id"] for row in second]
        scores = run_model({"targets": pa.table({"tx_id": pa.array(ids, pa.int64())}), "ledger": ledger}, "binary",
                           model_version=MODEL_VERSION, feature_version=FEATURE_VERSION)
        self.assertEqual(scores.column("tx_id").to_pylist(), ids)
        lines = (ledger.model_dir("binary_v10") / "timings.jsonl").read_text(encoding="utf-8").splitlines()
        timing = json.loads(lines[-1])
        self.assertEqual((timing["seq"], timing["targets"], timing["state"]), (2, len(ids), "rebuilt"))
        self.assertIn("graphs_and_model", timing)


if __name__ == "__main__":
    unittest.main()
