"""The ledger copy rebuilds exactly the whole frozen input from full and delta requests."""
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
import tempfile
import unittest

import pyarrow as pa

from inference_worker.replica import Replica, ReplicaMismatch

AMOUNT = pa.decimal128(24, 6)
TRANSACTIONS = pa.schema([
    ("tx_id", pa.int64()), ("input_role", pa.string()), ("occurred_at", pa.timestamp("us", tz="UTC")),
    ("from_account_id", pa.string()), ("to_account_id", pa.string()), ("amount_paid", AMOUNT),
])
ACCOUNTS = pa.schema([("account_id", pa.string()), ("entity_type", pa.string())])


def transactions(rows, role="CONTEXT"):
    return pa.Table.from_pylist([dict(tx_id=tx, input_role=role, occurred_at=datetime(2023, 9, 1, tzinfo=timezone.utc),
                                      from_account_id=a, to_account_id=b, amount_paid=Decimal(amount))
                                 for tx, a, b, amount in rows], schema=TRANSACTIONS)


def accounts(rows):
    return pa.Table.from_pylist([dict(account_id=a, entity_type=t) for a, t in rows], schema=ACCOUNTS)


def removed(ids):
    return pa.table({"tx_id": pa.array(ids, pa.int64())})


def targets(ids):
    return pa.table({"tx_id": pa.array(ids, pa.int64())})


class ReplicaTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.replica = Replica(Path(folder.name) / "replica")

    def full(self, seq, rows, account_rows):
        self.replica.apply(dict(mode="full", base_seq=0, seq=seq, rows=len(rows)),
                           dict(transactions=transactions(rows), accounts=accounts(account_rows), removed=removed([])))

    def test_full_then_delta_equals_the_whole_frozen_input(self):
        self.full(5, [(1, "a", "b", "10"), (2, "b", "c", "20"), (3, "c", "a", "30")],
                  [("a", None), ("b", "Corporation"), ("c", "Individual")])
        # Day 2: tx 2 corrected (new values), tx 3 removed, tx 4 new with a new account d.
        self.replica.apply(dict(mode="delta", base_seq=5, seq=9, rows=3),
                           dict(transactions=transactions([(2, "b", "c", "25"), (4, "a", "d", "40")], "TARGET"),
                                accounts=accounts([("a", "Corporation"), ("d", None)]), removed=removed([3])))
        inputs = self.replica.inputs(targets([4]))
        got = inputs["transactions"]
        self.assertEqual(got.column("tx_id").to_pylist(), [1, 2, 4])
        self.assertEqual(got.column("input_role").to_pylist(), ["CONTEXT", "CONTEXT", "TARGET"])
        self.assertEqual(got.column("amount_paid").to_pylist(), [Decimal("10"), Decimal("25"), Decimal("40")])
        self.assertEqual(got.schema, TRANSACTIONS)
        # c is still referenced by tx 2; every account carries its latest values.
        self.assertEqual(inputs["accounts"].to_pylist(), [dict(account_id="a", entity_type="Corporation"),
                                                          dict(account_id="b", entity_type="Corporation"),
                                                          dict(account_id="c", entity_type="Individual"),
                                                          dict(account_id="d", entity_type=None)])
        self.assertEqual(self.replica.current()["seq"], 9)

    def test_accounts_no_longer_referenced_are_left_out(self):
        self.full(5, [(1, "a", "b", "10"), (2, "c", "c", "20")], [("a", None), ("b", None), ("c", None)])
        self.replica.apply(dict(mode="delta", base_seq=5, seq=6, rows=1),
                           dict(transactions=transactions([]), accounts=accounts([]), removed=removed([2])))
        self.assertEqual(self.replica.inputs(targets([1]))["accounts"].column("account_id").to_pylist(), ["a", "b"])

    def test_delta_on_another_base_is_refused_and_changes_nothing(self):
        delta = dict(transactions=transactions([(4, "a", "d", "40")]), accounts=accounts([("d", None)]), removed=removed([]))
        with self.assertRaises(ReplicaMismatch):
            self.replica.apply(dict(mode="delta", base_seq=5, seq=9, rows=2), delta)  # no copy yet
        self.full(4, [(1, "a", "b", "10")], [("a", None), ("b", None)])
        with self.assertRaises(ReplicaMismatch):
            self.replica.apply(dict(mode="delta", base_seq=5, seq=9, rows=2), delta)
        self.assertEqual(self.replica.current()["seq"], 4)
        self.assertEqual(self.replica.inputs(targets([1]))["transactions"].column("tx_id").to_pylist(), [1])

    def test_the_second_model_of_a_run_finds_the_position_applied(self):
        self.full(5, [(1, "a", "b", "10")], [("a", None), ("b", None)])
        delta = dict(transactions=transactions([(4, "a", "b", "40")]), accounts=accounts([]), removed=removed([]))
        self.replica.apply(dict(mode="delta", base_seq=5, seq=9, rows=2), delta)
        applied = self.replica.current()
        self.replica.apply(dict(mode="delta", base_seq=5, seq=9, rows=2), delta)
        self.assertEqual(self.replica.current(), applied)
        self.assertEqual(self.replica.inputs(targets([4]))["transactions"].column("tx_id").to_pylist(), [1, 4])

    def test_a_result_with_the_wrong_row_count_is_never_installed(self):
        self.full(5, [(1, "a", "b", "10"), (2, "b", "a", "20")], [("a", None), ("b", None)])
        installed = self.replica.current()
        lost = dict(transactions=transactions([(4, "a", "b", "40")]), accounts=accounts([]), removed=removed([]))
        with self.assertRaises(ReplicaMismatch):  # backend froze 4 rows; copy + delta gives 3
            self.replica.apply(dict(mode="delta", base_seq=5, seq=9, rows=4), lost)
        twice = dict(transactions=transactions([(4, "a", "b", "40"), (4, "a", "b", "40")]), accounts=accounts([]), removed=removed([]))
        with self.assertRaises(ReplicaMismatch):  # a duplicated transaction
            self.replica.apply(dict(mode="delta", base_seq=5, seq=9, rows=4), twice)
        self.assertEqual(self.replica.current(), installed)
        self.replica.apply(dict(mode="delta", base_seq=5, seq=9, rows=3), lost)
        with self.assertRaises(ReplicaMismatch):  # the sibling model disagrees about this position
            self.replica.apply(dict(mode="delta", base_seq=5, seq=9, rows=4), lost)

    def test_reads_and_writes_share_one_lock(self):
        with self.replica.locked() as held:
            self.assertIs(held, self.replica)
            self.full(5, [(1, "a", "b", "10")], [("a", None), ("b", None)])
            self.assertEqual(held.inputs(targets([1]))["transactions"].num_rows, 1)
        self.assertTrue((self.replica.root / "replica.lock").exists())

    def test_full_always_replaces_and_keeps_one_version(self):
        self.full(5, [(1, "a", "b", "10")], [("a", None), ("b", None)])
        self.full(5, [(7, "x", "y", "70")], [("x", None), ("y", None)])  # e.g. a recreated backend DB
        self.assertEqual(self.replica.inputs(targets([7]))["transactions"].column("tx_id").to_pylist(), [7])
        self.assertEqual(len(list((self.replica.root / "data").iterdir())), 2)  # one part, one accounts file

    def test_new_transactions_append_a_part_and_resent_ones_are_not_duplicated(self):
        self.full(5, [(1, "a", "b", "10")], [("a", None), ("b", None)])
        ledger = self.replica.apply(dict(mode="delta", base_seq=5, seq=6, rows=2),
                                    dict(transactions=transactions([(2, "b", "c", "20")], "TARGET"),
                                         accounts=accounts([("b", None), ("c", None)]), removed=removed([])))
        self.assertEqual((ledger.change["kind"], ledger.change["base"], len(ledger.state["parts"])), ("append", 5, 2))
        added, changed_accounts = ledger.changed()
        self.assertEqual(added.column("tx_id").to_pylist(), [2])
        self.assertEqual(changed_accounts.column("account_id").to_pylist(), ["b", "c"])
        # A retried run re-sends tx 2 unchanged with its new target tx 3.
        ledger = self.replica.apply(dict(mode="delta", base_seq=6, seq=7, rows=3),
                                    dict(transactions=transactions([(2, "b", "c", "20"), (3, "c", "a", "30")], "TARGET"),
                                         accounts=accounts([]), removed=removed([])))
        self.assertEqual(ledger.change["kind"], "append")
        self.assertEqual(ledger.changed()[0].column("tx_id").to_pylist(), [3])
        self.assertEqual(ledger.transactions().column("tx_id").to_pylist(), [1, 2, 3])
        self.assertEqual(self.replica.current()["max_tx_id"], 3)

    def test_a_copy_of_the_earlier_layout_is_read_and_replaced(self):
        import json
        import pyarrow.parquet as pq
        folder = self.replica.root / "v5-old"
        folder.mkdir(parents=True)
        pq.write_table(transactions([(1, "a", "b", "10")]).drop_columns(["input_role"]), folder / "transactions.parquet")
        pq.write_table(accounts([("a", None), ("b", None)]), folder / "accounts.parquet")
        (self.replica.root / "current.json").write_text(json.dumps(dict(seq=5, rows=1, version="v5-old")))
        ledger = self.replica.apply(dict(mode="delta", base_seq=5, seq=6, rows=2),
                                    dict(transactions=transactions([(2, "b", "a", "20")]), accounts=accounts([]),
                                         removed=removed([])))
        self.assertEqual(ledger.transactions().column("tx_id").to_pylist(), [1, 2])
        self.assertTrue(folder.exists())  # still named by the new copy
        self.replica.apply(dict(mode="delta", base_seq=6, seq=7, rows=1),
                           dict(transactions=transactions([]), accounts=accounts([]), removed=removed([1])))
        self.assertFalse(folder.exists())  # rewritten: the old folder is no longer named
        self.assertEqual(self.replica.inputs(targets([2]))["transactions"].column("tx_id").to_pylist(), [2])


if __name__ == "__main__":
    unittest.main()
