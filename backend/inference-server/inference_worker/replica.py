"""The inference server's copy of the backend's frozen input ledger.

Each request names the ledger position (seq) it was frozen at and the number of transactions
frozen there (rows). A "full" request replaces the copy with the files it carries; a "delta"
request carries only what changed since base_seq (new or changed transactions, and removed
tx_ids) and applies only on top of exactly that base. A result whose row count differs from
rows is never installed. Models still receive the whole frozen input, read from the copy, so
scores do not depend on how the copy was built.

Every read and write holds an exclusive file lock: one server runs one model process at a time,
but a model process orphaned by a server crash may still be running next to a new one.
"""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shutil
from uuid import uuid4

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq


class ReplicaMismatch(Exception):
    """The copy cannot reach the request's position; the backend must send the full input."""


def _fsync(path):
    with path.open("r+b") as stream:  # Windows refuses fsync on a read-only handle
        os.fsync(stream.fileno())


def _atomic_json(path, document):
    temporary = path.with_suffix(".partial")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(document, stream)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


class Replica:
    def __init__(self, root):
        self.root = Path(root)

    @contextmanager
    def locked(self):
        """Hold the copy for one request: apply its files, then read the inputs it needs."""
        self.root.mkdir(parents=True, exist_ok=True)
        with (self.root / "replica.lock").open("a+b") as lease:
            if os.name == "nt":
                import msvcrt
                lease.seek(0)
                msvcrt.locking(lease.fileno(), msvcrt.LK_LOCK, 1)  # retries for ~10 s, then raises
            else:
                import fcntl
                fcntl.flock(lease, fcntl.LOCK_EX)
            yield self

    def current(self):
        try:
            return json.loads((self.root / "current.json").read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None

    def _read(self, state, name):
        return pq.read_table(self.root / state["version"] / (name + ".parquet"))

    def apply(self, replica, files):
        """Bring the copy to replica["seq"] from the request's files; idempotent per position."""
        state = self.current()
        mode, base, seq, rows = replica["mode"], replica["base_seq"], replica["seq"], replica["rows"]
        if mode == "delta" and state is not None and state["seq"] == seq:
            # The other model kind of the same run already applied this position.
            if state["rows"] != rows:
                raise ReplicaMismatch()
            return
        transactions = files["transactions"].drop_columns(["input_role"])
        accounts = files["accounts"]
        if mode == "delta":
            if state is None or state["seq"] != base:
                raise ReplicaMismatch()
            stored = self._read(state, "transactions")
            removed = pa.concat_arrays([files["removed"].column("tx_id").combine_chunks(),
                                        transactions.column("tx_id").combine_chunks()])
            kept = stored.filter(pc.invert(pc.is_in(stored.column("tx_id"), value_set=removed)))
            transactions = pa.concat_tables([kept, transactions.cast(kept.schema)])
            known = self._read(state, "accounts")
            kept = known.filter(pc.invert(pc.is_in(known.column("account_id"), value_set=accounts.column("account_id"))))
            accounts = pa.concat_tables([kept, accounts.cast(kept.schema)])
        elif mode != "full":
            raise ValueError("Unknown replica mode")
        if transactions.num_rows != rows or len(pc.unique(transactions.column("tx_id"))) != rows:
            raise ReplicaMismatch()  # Missing or duplicated transactions: never install it.
        transactions = transactions.sort_by("tx_id")
        accounts = accounts.sort_by("account_id")
        version = f"v{seq}-{uuid4().hex[:8]}"
        folder = self.root / version
        folder.mkdir(parents=True)
        for name, table in (("transactions", transactions), ("accounts", accounts)):
            pq.write_table(table, folder / (name + ".parquet"))
            _fsync(folder / (name + ".parquet"))
        _atomic_json(self.root / "current.json", dict(seq=seq, rows=rows, version=version))
        for old in self.root.iterdir():
            if old.is_dir() and old.name != version:
                shutil.rmtree(old, ignore_errors=True)

    def inputs(self, targets):
        """The whole frozen input at the copy's position, shaped like the full materials files."""
        state = self.current()
        transactions = self._read(state, "transactions")
        role = pc.if_else(pc.is_in(transactions.column("tx_id"), value_set=targets.column("tx_id")),
                          "TARGET", "CONTEXT")
        transactions = transactions.add_column(1, pa.field("input_role", pa.string()), role)
        accounts = self._read(state, "accounts")
        # Only accounts the frozen transactions still reference, as the full materials carry.
        used = pa.concat_arrays([transactions.column("from_account_id").combine_chunks(),
                                 transactions.column("to_account_id").combine_chunks()])
        accounts = accounts.filter(pc.is_in(accounts.column("account_id"), value_set=used))
        return {"targets": targets, "transactions": transactions, "accounts": accounts}
