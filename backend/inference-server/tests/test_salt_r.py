"""SALT-GNN R type model: the server connection gives the delivered original's probabilities."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc

from common.model_contract import ModelExecutionError
from inference_worker.model_adapter import run_model
from models.salt_r import model, salt_r_original as original
from models.salt_r.spec import FEATURE_VERSION, MODEL_VERSION

VERSIONS = dict(model_version=MODEL_VERSION, feature_version=FEATURE_VERSION)


class _Ledger:
    """Stands in for inference_worker.replica.Ledger: the copy's transactions only."""

    def __init__(self, table):
        self.table = table

    def transactions(self):
        return self.table


def _data(n=6000, accounts=400, seed=7):
    rng = np.random.default_rng(seed)
    hexes = np.array([f"{v:09X}" for v in rng.integers(0x100000000, 0xFFFFFFFFF, accounts)])
    banks = rng.integers(1, 300, accounts)
    source, target = rng.integers(0, accounts, n), rng.integers(0, accounts, n)
    minutes = np.sort(rng.integers(0, 3 * 1440, n))
    stamps = (np.datetime64("2023-01-01T00:00") + minutes.astype("timedelta64[m]")).astype("datetime64[m]")
    laundering = (rng.random(n) < 0.03).astype(int)
    amounts = [f"{value:.2f}" for value in rng.random(n) * 1e4]
    return hexes, banks, source, target, stamps, laundering, amounts


def _csv(folder, data):
    hexes, banks, source, target, stamps, laundering, amounts = data
    rows = ["Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,"
            "Amount Paid,Payment Currency,Payment Format,Is Laundering"]
    for i, stamp in enumerate(stamps.astype(str)):
        rows.append(f"{stamp.replace('-', '/').replace('T', ' ')},{banks[source[i]]},{hexes[source[i]]},"
                    f"{banks[target[i]]},{hexes[target[i]]},{amounts[i]},US Dollar,{amounts[i]},"
                    f"US Dollar,ACH,{laundering[i]}")
    path = Path(folder) / "transactions.csv"
    path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    return path


def _history(data):
    hexes, banks, source, target, stamps, _, amounts = data
    names = np.array([f"acct-{bank}-{value}" for bank, value in zip(banks, hexes)])  # pseudonymous ids
    occurred = pa.array(stamps.astype("datetime64[us]")).cast(pa.timestamp("us", tz="UTC"))
    return pa.table({"tx_id": pa.array(np.arange(1, len(stamps) + 1) * 10, pa.int64()), "occurred_at": occurred,
                     "from_account_id": pa.array(names[source]), "to_account_id": pa.array(names[target]),
                     "amount_paid": pc.cast(pa.array(amounts), pa.decimal128(24, 6))})


class SaltRTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = _data()
        cls.history = _history(cls.data)
        cls.rows = np.flatnonzero(cls.data[5] == 1)
        cls.ids = (cls.rows + 1) * 10
        with tempfile.TemporaryDirectory() as folder:
            frame = original.classify([_csv(folder, cls.data)], "laundering", "mean", "cpu", log=lambda *_: None)
        cls.expected = frame[[f"P_{name}" for name in original.CN9]].to_numpy()
        cls.targets = pa.table({"tx_id": pa.array(cls.ids, pa.int64())})

    def scores(self, inputs):
        return run_model(inputs, "type", **VERSIONS)

    def test_ledger_copy_gives_the_original_probabilities_in_backend_order(self):
        scores = self.scores({"targets": self.targets, "ledger": _Ledger(self.history)})
        model.validate_scores(scores, self.ids.tolist(), "type", **VERSIONS)
        self.assertEqual(scores.column("tx_id").to_pylist(), sorted(self.ids.tolist()))
        got = np.stack([scores.column(f"p_{i}").to_numpy() for i in range(9)], 1)
        order = [original.CN9.index(name) for name in model.BACKEND_CLASSES]
        self.assertLess(np.abs(got - self.expected[:, order]).max(), 1e-5)

    def test_materials_row_order_and_chunks_do_not_change_results(self):
        first = self.scores({"targets": self.targets, "ledger": _Ledger(self.history)})
        shuffled = self.history.take(pa.array(np.random.default_rng(1).permutation(self.history.num_rows)))
        with patch.object(model, "CHUNK", 7):
            again = self.scores({"targets": self.targets.take(pa.array(np.arange(len(self.ids))[::-1].copy())),
                                 "transactions": shuffled, "accounts": pa.table({"x": [1]})})
        for column in first.column_names[1:]:
            self.assertLess(np.abs(first.column(column).to_numpy() - again.column(column).to_numpy()).max(), 1e-6)

    def test_wrong_inputs_are_input_invalid(self):
        ledger = _Ledger(self.history)
        missing = pa.table({"tx_id": pa.array([5], pa.int64())})
        cases = [({"targets": self.targets}, "type", VERSIONS),
                 ({"targets": missing, "ledger": ledger}, "type", VERSIONS),
                 ({"targets": self.targets, "ledger": ledger}, "binary", VERSIONS),
                 ({"targets": self.targets, "ledger": _Ledger(self.history.drop_columns(["amount_paid"]))}, "type", VERSIONS)]
        for inputs, kind, versions in cases:
            with self.assertRaises(ModelExecutionError) as caught:
                run_model(inputs, kind, **versions)
            self.assertEqual(caught.exception.code, "INPUT_INVALID")


if __name__ == "__main__":
    unittest.main()
