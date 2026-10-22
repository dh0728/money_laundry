"""The inference server's copy of the backend's frozen input ledger.

Each request names the ledger position (seq) it was frozen at and the number of transactions
frozen there (rows). A "full" request replaces the copy with the files it carries; a "delta"
request carries only what changed since base_seq (new or changed transactions, and removed
tx_ids) and applies only on top of exactly that base. A result whose row count differs from
rows is never installed.

The copy is a list of immutable Parquet parts named in current.json. A delta that only adds
transactions appends one part, so a day costs the size of that day; a delta that removes or
changes a stored transaction rewrites the copy as one part. current.json also records the last
change, so a model keeping its own state can follow the copy one position at a time and rebuild
otherwise. Files no longer named are deleted after current.json is replaced.

Every read and write holds an exclusive file lock: one server runs one model process at a time,
but a model process orphaned by a server crash may still be running next to a new one. The
model runs inside the lock, so the parts it reads cannot be deleted under it.
"""
from contextlib import contextmanager
import json
import os
from pathlib import Path
from uuid import uuid4

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

# Accounts parts are merged into one once there are more than this many.
ACCOUNT_PARTS = 32


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


def _latest_accounts(tables):
    """One row per account_id, the last listed part winning."""
    if not tables:
        return None
    merged = pa.concat_tables(tables, promote_options="default")
    order = pa.array(range(merged.num_rows), pa.int64())
    merged = merged.append_column("_order", order)
    last = merged.group_by("account_id").aggregate([("_order", "max")]).column("_order_max")
    return merged.take(last).drop_columns(["_order"]).sort_by("account_id")


class Ledger:
    """The copy at one position, read inside the lock. Handed to the model as inputs["ledger"]."""

    def __init__(self, root, state):
        self.root, self.state = Path(root), state
        self.seq, self.rows = state["seq"], state["rows"]
        self.change = state.get("change", {"kind": "full", "base": 0})

    def _path(self, name):
        return self.root / name

    def transactions(self, parts=None):
        names = self.state["parts"] if parts is None else parts
        tables = [pq.read_table(self._path(name)) for name in names]
        return pa.concat_tables(tables, promote_options="default").sort_by("tx_id") if tables else None

    def accounts(self):
        return _latest_accounts([pq.read_table(self._path(name)) for name in self.state["accounts"]])

    def changed(self):
        """Transactions and accounts the last change added: a model following the copy from
        change["base"] applies exactly these. Only meaningful for kind "append"."""
        transactions = self.transactions(self.change.get("parts", []))
        accounts = _latest_accounts([pq.read_table(self._path(name)) for name in self.change.get("accounts", [])])
        return transactions, accounts

    def model_dir(self, name):
        """A folder a model keeps its own state in, next to the copy."""
        folder = self.root / "models" / name
        folder.mkdir(parents=True, exist_ok=True)
        return folder

    def inputs(self, targets):
        """The whole frozen input at this position, shaped like the full materials files."""
        transactions = self.transactions()
        role = pc.if_else(pc.is_in(transactions.column("tx_id"), value_set=targets.column("tx_id")),
                          "TARGET", "CONTEXT")
        transactions = transactions.add_column(1, pa.field("input_role", pa.string()), role)
        accounts = self.accounts()
        # Only accounts the frozen transactions still reference, as the full materials carry.
        used = pa.concat_arrays([transactions.column("from_account_id").combine_chunks(),
                                 transactions.column("to_account_id").combine_chunks()])
        accounts = accounts.filter(pc.is_in(accounts.column("account_id"), value_set=used))
        return {"targets": targets, "transactions": transactions, "accounts": accounts}


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
            state = json.loads((self.root / "current.json").read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        if "version" in state:  # copy written before parts: one folder with two files
            state = dict(seq=state["seq"], rows=state["rows"],
                         parts=[state["version"] + "/transactions.parquet"],
                         accounts=[state["version"] + "/accounts.parquet"],
                         max_tx_id=None, change={"kind": "full", "base": 0})
        return state

    def ledger(self):
        state = self.current()
        return None if state is None else Ledger(self.root, state)

    def _write(self, table, prefix, seq):
        name = f"data/{prefix}-{seq}-{uuid4().hex[:8]}.parquet"
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        pq.write_table(table, path)
        _fsync(path)
        return name

    def _stored(self, state, ids):
        """Stored rows among ids (only parts that can hold them are read)."""
        found = []
        for name in state["parts"]:
            table = pq.read_table(self.root / name)
            hit = table.filter(pc.is_in(table.column("tx_id"), value_set=ids))
            if hit.num_rows:
                found.append(hit)
        return pa.concat_tables(found, promote_options="default") if found else None

    def apply(self, replica, files):
        """Bring the copy to replica["seq"] from the request's files; idempotent per position.

        Returns the Ledger at that position.
        """
        state = self.current()
        mode, base, seq, rows = replica["mode"], replica["base_seq"], replica["seq"], replica["rows"]
        if mode == "delta" and state is not None and state["seq"] == seq:
            # The other model kind of the same run already applied this position.
            if state["rows"] != rows:
                raise ReplicaMismatch()
            return Ledger(self.root, state)
        transactions = files["transactions"].drop_columns(["input_role"]).sort_by("tx_id")
        accounts = files["accounts"].sort_by("account_id")
        if len(pc.unique(transactions.column("tx_id"))) != transactions.num_rows:
            raise ReplicaMismatch()  # a duplicated transaction: never install it
        if mode == "full":
            if transactions.num_rows != rows:
                raise ReplicaMismatch()
            new = dict(parts=[self._write(transactions, "tx", seq)], accounts=[self._write(accounts, "accounts", seq)],
                       change={"kind": "full", "base": 0})
        elif mode == "delta":
            if state is None or state["seq"] != base:
                raise ReplicaMismatch()
            new = self._delta(state, transactions, accounts, files["removed"].column("tx_id"), seq, rows)
        else:
            raise ValueError("Unknown replica mode")
        stored = self._all_ids(new) if new["change"]["kind"] != "append" else None
        if stored is not None and (len(stored) != rows or len(pc.unique(stored)) != rows):
            raise ReplicaMismatch()
        maximum = self._max_id(new, state, transactions)
        document = dict(seq=seq, rows=rows, max_tx_id=maximum, format=2, **new)
        _atomic_json(self.root / "current.json", document)
        self._collect(document)
        return Ledger(self.root, document)

    def _delta(self, state, transactions, accounts, removed, seq, rows):
        incoming, ids = transactions, transactions.column("tx_id")
        maximum = state.get("max_tx_id")
        # Transactions the copy may already hold: a retried run re-sends its targets unchanged.
        maybe = ids if maximum is None else ids.filter(pc.less_equal(ids, maximum))
        stored = self._stored(state, maybe) if len(maybe) else None
        changed = False
        if stored is not None:
            known = stored.column("tx_id")
            stored = stored.sort_by("tx_id").select(incoming.column_names).cast(incoming.schema)
            changed = not incoming.filter(pc.is_in(ids, value_set=known)).equals(stored)
            transactions = incoming.filter(pc.invert(pc.is_in(ids, value_set=known)))
        account_parts = list(state["accounts"])
        if accounts.num_rows:
            account_parts.append(self._write(accounts, "accounts", seq))
        if not changed and len(removed) == 0:
            if state["rows"] + transactions.num_rows != rows:
                raise ReplicaMismatch()
            added = [self._write(transactions, "tx", seq)] if transactions.num_rows else []
            change = {"kind": "append", "base": state["seq"], "parts": added,
                      "accounts": account_parts[-1:] if accounts.num_rows else []}
            if len(account_parts) > ACCOUNT_PARTS:
                account_parts = [self._write(Ledger(self.root, dict(state, accounts=account_parts)).accounts(),
                                             "accounts", seq)]
                change["accounts"] = [self._write(accounts, "accounts", seq)] if accounts.num_rows else []
            return dict(parts=list(state["parts"]) + added, accounts=account_parts, change=change)
        # A change or removal of a stored transaction: rewrite the copy as one part.
        whole = Ledger(self.root, state).transactions()
        drop = pa.concat_arrays([removed.combine_chunks(), ids.combine_chunks()]).cast(pa.int64())
        kept = whole.filter(pc.invert(pc.is_in(whole.column("tx_id"), value_set=drop)))
        merged = pa.concat_tables([kept, incoming.select(kept.column_names).cast(kept.schema)]).sort_by("tx_id")
        latest = Ledger(self.root, dict(state, accounts=account_parts)).accounts()
        return dict(parts=[self._write(merged, "tx", seq)], accounts=[self._write(latest, "accounts", seq)],
                    change={"kind": "rewrite", "base": state["seq"]})

    def _all_ids(self, new):
        return pa.concat_arrays([pq.read_table(self.root / name, columns=["tx_id"]).column("tx_id").combine_chunks()
                                 for name in new["parts"]] or [pa.array([], pa.int64())])

    def _max_id(self, new, state, transactions):
        if new["change"]["kind"] == "append" and state.get("max_tx_id") is not None:
            values = [state["max_tx_id"]]
            if transactions.num_rows:
                values.append(pc.max(transactions.column("tx_id")).as_py())
            return max(values)
        ids = self._all_ids(new)
        return pc.max(ids).as_py() if len(ids) else None

    def _collect(self, document):
        """Delete files the current copy no longer names, and folders left empty."""
        named = document["parts"] + document["accounts"] + document["change"].get("accounts", [])
        keep = {(self.root / name).resolve() for name in named}
        for folder in [path for path in self.root.iterdir() if path.is_dir() and path.name != "models"]:
            for path in folder.iterdir():
                if path.resolve() not in keep:
                    path.unlink(missing_ok=True)
            if not any(folder.iterdir()):
                folder.rmdir()

    def inputs(self, targets):
        """The whole frozen input at the current position (see Ledger.inputs)."""
        return self.ledger().inputs(targets)
