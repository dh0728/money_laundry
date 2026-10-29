"""v10 features kept next to the ledger copy and updated one copy position at a time.

prepare_snapshot recomputes every feature from the whole history on each request. Every v10
feature is a running quantity, so this module keeps the running values in a DuckDB file and
adds only the transactions the copy appended:
- edge features (17) look only at earlier transactions, so they are computed once per new
  transaction from per-pair/per-account counts and last times, plus the last hour of history;
- node features (19) come from per-account counts and sums and from the sets of account
  pairs, account currencies and entity pairs (a "distinct" count grows when a new pair appears);
- the 100-transaction neighbour samples are drawn as before (hash with the context date), but
  only for the accounts within two hops of the request's targets.

Accounts get node numbers in the order they first appear (by tx_id, sender before receiver),
so the numbers, and with them the neighbour sampling hash, never change as the copy grows.

The state follows the copy only through appended transactions on later days. Anything else
(a rewritten copy, a missed position, a transaction not after the stored ones, changed KYC)
rebuilds the state from the whole copy with the same code, as if every transaction were new.
"""
import json
import os
from pathlib import Path
import time
from uuid import uuid4

import duckdb
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc

from common.worker_transport import ProtocolError
from models.binary_v10.materials import ENTITY_TYPES, REQUIRED, _currency
from models.binary_v10.preprocess import (EDGE_FEATURES, NODE_FEATURES, MemorySnapshot, amount,
                                          edge_feature_columns, neighbour_sql, node_frame, q)
from models.binary_v10.spec import asset

STATE_VERSION = 1
SCHEMA = """
CREATE TABLE meta(version INTEGER, seq BIGINT, max_ts TIMESTAMP, max_day DATE, max_edge BIGINT);
CREATE TABLE nodes(account_id VARCHAR, node_id BIGINT, entity_id VARCHAR, entity_type VARCHAR, country VARCHAR);
CREATE TABLE tx(edge_id BIGINT, ts TIMESTAMP, src BIGINT, dst BIGINT);
CREATE TABLE edge_features(edge_id BIGINT, {edge_columns});
CREATE TABLE node_agg(node_id BIGINT, out_n BIGINT, in_n BIGINT, self_n BIGINT, out_z DOUBLE, in_z DOUBLE,
    out_tail BIGINT, in_tail BIGINT, out_u BIGINT, in_u BIGINT, reciprocal_n BIGINT, n_currency BIGINT,
    n_days BIGINT, out_last TIMESTAMP, in_last TIMESTAMP);
CREATE TABLE pairs(src BIGINT, dst BIGINT, n BIGINT, last_ts TIMESTAMP);
CREATE TABLE node_currency(node_id BIGINT, currency VARCHAR);
CREATE TABLE entity_pairs(source_entity VARCHAR, target_entity VARCHAR);
"""


def normalize_transactions(table):
    """Ledger transactions -> the v10 columns (KST wall clock, calibration currency names)."""
    if any(column not in table.column_names for column in REQUIRED["transactions"]):
        raise ProtocolError("binary_v10 requires the transactions materials")
    occurred = table.column("occurred_at")
    if not pa.types.is_timestamp(occurred.type) or occurred.type.tz is None:
        raise ProtocolError("occurred_at must be a timezone-aware instant")
    local = pc.local_timestamp(pc.cast(occurred, pa.timestamp("us", tz="Asia/Seoul")))
    return pa.table({
        "edge_id": pc.cast(table.column("tx_id"), pa.int64()),
        "ts": pc.cast(local, pa.timestamp("us")),
        "src_account": pc.cast(table.column("from_account_id"), pa.string()),
        "dst_account": pc.cast(table.column("to_account_id"), pa.string()),
        "paid": pc.cast(table.column("amount_paid"), pa.float64()),
        "received": pc.cast(table.column("amount_received"), pa.float64()),
        "payment_currency": _currency(table.column("payment_currency")),
        "receiving_currency": _currency(table.column("receiving_currency")),
        "payment_format": pc.cast(table.column("payment_format"), pa.string()),
    })


def normalize_accounts(table):
    """Ledger accounts -> KYC rows as prepare_snapshot reads them (UNKNOWN for missing values)."""
    if table is None:
        return pa.table({"account_id": pa.array([], pa.string()), "entity_id": pa.array([], pa.string()),
                         "entity_type": pa.array([], pa.string()), "country": pa.array([], pa.string())})
    if any(column not in table.column_names for column in REQUIRED["accounts"]):
        raise ProtocolError("binary_v10 requires the accounts materials")
    rows = table.select(list(REQUIRED["accounts"])).to_pylist()
    return pa.table({
        "account_id": pa.array([row["account_id"] for row in rows], pa.string()),
        "entity_id": pa.array([row["owner_id"] for row in rows], pa.string()),
        "entity_type": pa.array([row["entity_type"] if row["entity_type"] in ENTITY_TYPES else "UNKNOWN"
                                 for row in rows], pa.string()),
        "country": pa.array([row["country"] or "UNKNOWN" for row in rows], pa.string()),
    })


class FeatureState:
    def __init__(self, folder, threads=2, memory_limit="2GB"):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        self.path = self.folder / "state.duckdb"
        self.settings = f"SET threads={int(threads)}; SET memory_limit={q(memory_limit)}"
        self.timings = {}

    def _connect(self, path):
        c = duckdb.connect(str(path))
        c.execute(self.settings)
        c.execute(f"CREATE OR REPLACE TEMP VIEW stats AS SELECT * FROM read_parquet({q(asset('currency_stats.parquet'))})")
        c.execute(f"CREATE OR REPLACE TEMP VIEW amount_stats AS SELECT * FROM read_parquet({q(asset('amount_stats.parquet'))})")
        return c

    def _timed(self, name, started):
        self.timings[name] = round(self.timings.get(name, 0) + time.perf_counter() - started, 3)

    def _meta(self):
        if not self.path.exists():
            return None
        c = duckdb.connect(str(self.path), read_only=True)
        try:
            row = c.execute("SELECT version,seq,max_ts,max_day,max_edge FROM meta").fetchone()
        except duckdb.Error:
            return None
        finally:
            c.close()
        return None if row is None or row[0] != STATE_VERSION else dict(zip(("version", "seq", "max_ts", "max_day", "max_edge"), row))

    def sync(self, ledger):
        """Bring the state to the copy's position: add the last appended part, or rebuild."""
        meta = self._meta()
        if meta is not None and meta["seq"] == ledger.seq:
            self.timings["state"] = "current"
            return
        if meta is not None and ledger.change.get("kind") == "append" and ledger.change.get("base") == meta["seq"]:
            started = time.perf_counter()
            transactions, accounts = ledger.changed()
            self._timed("read_changes", started)
            if self._append(meta, transactions, accounts, ledger.seq):
                self.timings["state"] = "appended"
                return
        started = time.perf_counter()
        transactions, accounts = ledger.transactions(), ledger.accounts()
        self._timed("read_copy", started)
        self._rebuild(transactions, accounts, ledger.seq)
        self.timings["state"] = "rebuilt"

    def _rebuild(self, transactions, accounts, seq):
        temporary = self.folder / f"state-{uuid4().hex[:8]}.duckdb"
        c = self._connect(temporary)
        try:
            c.execute(SCHEMA.format(edge_columns=",".join(f'"{name}" FLOAT' for name in EDGE_FEATURES)))
            c.execute("INSERT INTO meta VALUES (?,0,NULL,NULL,NULL)", [STATE_VERSION])
            self._add(c, normalize_transactions(transactions), normalize_accounts(accounts), seq)
            c.execute("CHECKPOINT")
        finally:
            c.close()
        Path(str(self.path) + ".wal").unlink(missing_ok=True)
        os.replace(temporary, self.path)

    def _append(self, meta, transactions, accounts, seq):
        """Add one appended part in one transaction; False if only a rebuild is equivalent."""
        accounts = normalize_accounts(accounts)
        new = normalize_transactions(transactions) if transactions is not None else None
        c = self._connect(self.path)
        try:
            c.register("incoming_accounts", accounts)
            # KYC of a known account must not change: every earlier feature used it.
            if c.execute("""SELECT count(*) FROM incoming_accounts a JOIN nodes n USING(account_id)
                WHERE (a.entity_id,a.entity_type,a.country) IS DISTINCT FROM (n.entity_id,n.entity_type,n.country)""").fetchone()[0]:
                return False
            if new is not None and new.num_rows:
                first_ts, first_edge = pc.min(new.column("ts")).as_py(), pc.min(new.column("edge_id")).as_py()
                first_day = pd.Timestamp(first_ts).date()
                if meta["max_ts"] is not None and (
                        first_edge <= meta["max_edge"] or first_day <= meta["max_day"]
                        or pd.Timestamp(first_ts) < pd.Timestamp(meta["max_ts"]) + pd.Timedelta(minutes=1)):
                    return False
            c.execute("BEGIN TRANSACTION")
            if new is not None and new.num_rows:
                self._add(c, new, accounts, seq)
            else:
                c.execute("UPDATE meta SET seq=?", [seq])
            c.execute("COMMIT")
            return True
        except Exception:
            try:
                c.execute("ROLLBACK")
            except duckdb.Error:
                pass
            raise
        finally:
            c.close()

    def _add(self, c, new, accounts, seq):
        """Add transactions that all come after the stored ones (or into an empty state)."""
        started = time.perf_counter()
        c.register("new_raw", new)
        c.register("new_accounts", accounts)
        c.execute("""CREATE OR REPLACE TEMP TABLE first_seen AS SELECT account_id,min(k) AS k FROM (
            SELECT src_account AS account_id,edge_id*2 AS k FROM new_raw UNION ALL
            SELECT dst_account,edge_id*2+1 FROM new_raw) GROUP BY account_id""")
        c.execute("""INSERT INTO nodes SELECT f.account_id,
              (SELECT coalesce(max(node_id)+1,0) FROM nodes)+row_number() OVER(ORDER BY f.k)-1,
              a.entity_id,a.entity_type,a.country
            FROM first_seen f JOIN new_accounts a USING(account_id) ANTI JOIN nodes n USING(account_id)""")
        if c.execute("SELECT count(*) FROM first_seen ANTI JOIN nodes USING(account_id)").fetchone()[0]:
            raise ProtocolError("Transaction account missing from the materials")
        c.execute("""CREATE OR REPLACE TEMP TABLE t AS SELECT r.edge_id,r.ts,s.node_id AS src,d.node_id AS dst,
              r.paid,r.received,r.payment_currency,r.receiving_currency,r.payment_format,r.ts::DATE AS day
            FROM new_raw r JOIN nodes s ON s.account_id=r.src_account JOIN nodes d ON d.account_id=r.dst_account""")
        self._timed("number_accounts", started)
        started = time.perf_counter()
        self._edge_features(c)
        self._timed("edge_features", started)
        started = time.perf_counter()
        self._aggregates(c)
        c.execute("INSERT INTO tx SELECT edge_id,ts,src,dst FROM t ORDER BY edge_id")
        # The new rows come after every stored one (or the state was empty), so they hold the maxima.
        c.execute("""UPDATE meta SET seq=?,max_ts=(SELECT max(ts) FROM t),max_day=(SELECT max(ts)::DATE FROM t),
            max_edge=(SELECT max(edge_id) FROM t)""", [seq])
        self._timed("node_aggregates", started)

    def _edge_features(self, c):
        # Every stored transaction is at least a minute before every new one, so it lies in each
        # new row's "before" window: stored counts add to window counts over the new rows only.
        # The 60-minute windows also read the stored rows of the last hour.
        windows = []
        for name, part in [("pair", "src,dst"), ("sender", "src"), ("receiver", "dst")]:
            windows += [
                f"count(*) OVER(PARTITION BY {part} ORDER BY ts RANGE BETWEEN UNBOUNDED PRECEDING AND INTERVAL '1 minute' PRECEDING) {name}_prior",
                f"max(ts) OVER(PARTITION BY {part} ORDER BY ts RANGE BETWEEN UNBOUNDED PRECEDING AND INTERVAL '1 minute' PRECEDING) {name}_last",
            ]
        c.execute("CREATE OR REPLACE TEMP TABLE w AS SELECT edge_id,src,dst," + ",".join(windows) + " FROM t")
        hours = ",".join(
            f"count(*) OVER(PARTITION BY {part} ORDER BY ts RANGE BETWEEN INTERVAL '60 minutes' PRECEDING AND INTERVAL '1 minute' PRECEDING) {name}_hour"
            for name, part in [("pair", "src,dst"), ("sender", "src"), ("receiver", "dst")])
        c.execute(f"""CREATE OR REPLACE TEMP TABLE hour_window AS SELECT edge_id,fresh,{hours} FROM (
            SELECT edge_id,ts,src,dst,false AS fresh FROM tx WHERE ts>=(SELECT min(ts) FROM t)-INTERVAL '60 minutes'
            UNION ALL SELECT edge_id,ts,src,dst,true FROM t)""")
        c.execute("""CREATE OR REPLACE TEMP TABLE z AS SELECT w.edge_id,
              w.pair_prior+coalesce(b.n,0) AS pair_prior,coalesce(w.pair_last,b.last_ts) AS pair_last,h.pair_hour,
              w.sender_prior+coalesce(s.out_n,0) AS sender_prior,coalesce(w.sender_last,s.out_last) AS sender_last,h.sender_hour,
              w.receiver_prior+coalesce(r.in_n,0) AS receiver_prior,coalesce(w.receiver_last,r.in_last) AS receiver_last,h.receiver_hour
            FROM w JOIN hour_window h ON h.edge_id=w.edge_id AND h.fresh
            LEFT JOIN pairs b ON b.src=w.src AND b.dst=w.dst
            LEFT JOIN node_agg s ON s.node_id=w.src LEFT JOIN node_agg r ON r.node_id=w.dst""")
        # Pair history on earlier days: stored totals plus new rows of earlier new days.
        c.execute("CREATE OR REPLACE TEMP TABLE daily AS SELECT src,dst,day,count(*) AS n,max(ts) AS last_ts FROM t GROUP BY src,dst,day")
        c.execute("""CREATE OR REPLACE TEMP TABLE cumulative AS SELECT src,dst,day,
              sum(n) OVER(PARTITION BY src,dst ORDER BY day ROWS UNBOUNDED PRECEDING) AS n,
              max(last_ts) OVER(PARTITION BY src,dst ORDER BY day ROWS UNBOUNDED PRECEDING) AS last_ts FROM daily""")
        c.execute("""CREATE OR REPLACE TEMP TABLE p AS SELECT d.src,d.dst,d.day,
              coalesce(bf.n,0)+coalesce(f.n,0) AS pair_n,coalesce(br.n,0)+coalesce(r.n,0) AS reverse_n,
              CASE WHEN coalesce(f.last_ts,bf.last_ts) IS NULL THEN -1
                   ELSE date_diff('minute',coalesce(f.last_ts,bf.last_ts),d.day::TIMESTAMP) END AS age
            FROM (SELECT DISTINCT src,dst,day FROM t) d
            ASOF LEFT JOIN cumulative f ON d.src=f.src AND d.dst=f.dst AND d.day>f.day
            ASOF LEFT JOIN cumulative r ON d.src=r.dst AND d.dst=r.src AND d.day>r.day
            LEFT JOIN pairs bf ON bf.src=d.src AND bf.dst=d.dst
            LEFT JOIN pairs br ON br.src=d.dst AND br.dst=d.src""")
        c.execute(f"""INSERT INTO edge_features SELECT t.edge_id,{edge_feature_columns()} FROM t JOIN z USING(edge_id)
            JOIN p ON t.src=p.src AND t.dst=p.dst AND t.day=p.day JOIN nodes sk ON sk.node_id=t.src JOIN nodes dk ON dk.node_id=t.dst
            LEFT JOIN stats ps ON ps.currency=t.payment_currency LEFT JOIN amount_stats a ON a.payment_currency=t.payment_currency
            ORDER BY t.edge_id""")

    def _aggregates(self, c):
        c.execute(f"""CREATE OR REPLACE TEMP TABLE h AS SELECT t.*,{amount('paid', 'ps')} AS paid_z,
              {amount('received', 'rs')} AS received_z,ks.entity_id AS source_entity,kd.entity_id AS target_entity
            FROM t JOIN nodes ks ON ks.node_id=t.src JOIN nodes kd ON kd.node_id=t.dst
            LEFT JOIN stats ps ON ps.currency=t.payment_currency LEFT JOIN stats rs ON rs.currency=t.receiving_currency""")
        c.execute("CREATE OR REPLACE TEMP TABLE new_pairs AS SELECT DISTINCT t.src,t.dst FROM t ANTI JOIN pairs p ON p.src=t.src AND p.dst=t.dst")
        # Reciprocal partners: a new pair (a,b) makes b a partner of a when (b,a) exists, and a a
        # partner of b when (b,a) existed before (a new (b,a) counts for b itself).
        c.execute("""CREATE OR REPLACE TEMP TABLE delta AS SELECT node_id,
              sum(out_n) out_n,sum(in_n) in_n,sum(self_n) self_n,sum(out_z) out_z,sum(in_z) in_z,
              sum(out_tail) out_tail,sum(in_tail) in_tail,sum(out_u) out_u,sum(in_u) in_u,
              sum(reciprocal_n) reciprocal_n,sum(n_currency) n_currency,sum(n_days) n_days,
              max(out_last) out_last,max(in_last) in_last FROM (
            SELECT src AS node_id,count(*) out_n,0 in_n,count(*) FILTER(WHERE src=dst) self_n,sum(paid_z) out_z,0.0 in_z,
                count(*) FILTER(WHERE abs(paid_z)>=3) out_tail,0 in_tail,0 out_u,0 in_u,0 reciprocal_n,0 n_currency,0 n_days,
                max(ts) out_last,NULL::TIMESTAMP in_last FROM h GROUP BY src
            UNION ALL SELECT dst,0,count(*),0,0.0,sum(received_z),0,count(*) FILTER(WHERE abs(received_z)>=3),0,0,0,0,0,
                NULL,max(ts) FROM h GROUP BY dst
            UNION ALL SELECT src,0,0,0,0.0,0.0,0,0,count(*),0,0,0,0,NULL,NULL FROM new_pairs GROUP BY src
            UNION ALL SELECT dst,0,0,0,0.0,0.0,0,0,0,count(*),0,0,0,NULL,NULL FROM new_pairs GROUP BY dst
            UNION ALL SELECT a.src,0,0,0,0.0,0.0,0,0,0,0,count(*),0,0,NULL,NULL FROM new_pairs a
                WHERE a.src!=a.dst AND (EXISTS(SELECT 1 FROM pairs b WHERE b.src=a.dst AND b.dst=a.src)
                                        OR EXISTS(SELECT 1 FROM new_pairs b WHERE b.src=a.dst AND b.dst=a.src)) GROUP BY a.src
            UNION ALL SELECT a.dst,0,0,0,0.0,0.0,0,0,0,0,count(*),0,0,NULL,NULL FROM new_pairs a
                JOIN pairs b ON b.src=a.dst AND b.dst=a.src WHERE a.src!=a.dst GROUP BY a.dst
            UNION ALL SELECT node_id,0,0,0,0.0,0.0,0,0,0,0,0,count(*),0,NULL,NULL FROM (
                SELECT src AS node_id,payment_currency AS currency FROM t UNION SELECT dst,receiving_currency FROM t) n
                ANTI JOIN node_currency c USING(node_id,currency) GROUP BY node_id
            UNION ALL SELECT node_id,0,0,0,0.0,0.0,0,0,0,0,0,0,count(DISTINCT day),NULL,NULL FROM (
                SELECT src AS node_id,day FROM t UNION SELECT dst,day FROM t) GROUP BY node_id
            ) GROUP BY node_id""")
        c.execute("""UPDATE node_agg a SET out_n=a.out_n+d.out_n,in_n=a.in_n+d.in_n,self_n=a.self_n+d.self_n,
              out_z=a.out_z+d.out_z,in_z=a.in_z+d.in_z,out_tail=a.out_tail+d.out_tail,in_tail=a.in_tail+d.in_tail,
              out_u=a.out_u+d.out_u,in_u=a.in_u+d.in_u,reciprocal_n=a.reciprocal_n+d.reciprocal_n,
              n_currency=a.n_currency+d.n_currency,n_days=a.n_days+d.n_days,
              out_last=coalesce(d.out_last,a.out_last),in_last=coalesce(d.in_last,a.in_last)
            FROM delta d WHERE d.node_id=a.node_id""")
        c.execute("INSERT INTO node_agg SELECT d.* FROM delta d ANTI JOIN node_agg a USING(node_id)")
        c.execute("""INSERT INTO node_currency SELECT * FROM (
              SELECT src AS node_id,payment_currency AS currency FROM t UNION SELECT dst,receiving_currency FROM t) n
            ANTI JOIN node_currency c USING(node_id,currency)""")
        c.execute("""INSERT INTO entity_pairs SELECT DISTINCT h.source_entity,h.target_entity FROM h
            ANTI JOIN entity_pairs e ON e.source_entity=h.source_entity AND e.target_entity=h.target_entity
            WHERE h.source_entity IS NOT NULL AND h.target_entity IS NOT NULL""")
        c.execute("CREATE OR REPLACE TEMP TABLE pair_delta AS SELECT src,dst,count(*) AS n,max(ts) AS last_ts FROM t GROUP BY src,dst")
        c.execute("""UPDATE pairs p SET n=p.n+d.n,last_ts=d.last_ts FROM pair_delta d WHERE d.src=p.src AND d.dst=p.dst""")
        c.execute("INSERT INTO pairs SELECT d.* FROM pair_delta d ANTI JOIN pairs p ON p.src=d.src AND p.dst=d.dst")

    def snapshot(self, target_ids):
        """Graphs of the targets: neighbour samples of the targets' accounts and of their
        sampled neighbours, with the stored features of every node and edge they reach."""
        started = time.perf_counter()
        c = self._connect(self.path)
        try:
            context_end = c.execute("SELECT max_day FROM meta").fetchone()[0]
            c.register("given", pd.DataFrame({"edge_id": np.asarray(target_ids, dtype=np.int64)}))
            c.execute("CREATE TEMP TABLE targets AS SELECT edge_id FROM given ORDER BY edge_id")
            if c.execute("SELECT count(*) FROM targets ANTI JOIN tx USING(edge_id)").fetchone()[0]:
                raise ValueError("Target transaction missing from the snapshot")
            c.execute("""CREATE TEMP TABLE roots AS SELECT DISTINCT owner FROM (
                SELECT src AS owner FROM tx JOIN targets USING(edge_id) UNION SELECT dst FROM tx JOIN targets USING(edge_id))""")
            c.execute(f"CREATE TEMP TABLE first_hop AS {neighbour_sql('roots', context_end)}")
            c.execute("""CREATE TEMP TABLE second AS SELECT DISTINCT owner FROM (
                SELECT t.src AS owner FROM first_hop a JOIN tx t USING(edge_id) WHERE a.direction='incoming'
                UNION SELECT t.dst FROM first_hop a JOIN tx t USING(edge_id) WHERE a.direction='outgoing') ANTI JOIN roots USING(owner)""")
            c.execute(f"CREATE TEMP TABLE second_hop AS {neighbour_sql('second', context_end)}")
            c.execute("CREATE TEMP TABLE adjacency AS SELECT * FROM first_hop UNION ALL SELECT * FROM second_hop")
            self._timed("neighbour_sample", started)
            started = time.perf_counter()
            c.execute("""CREATE TEMP TABLE edges AS SELECT t.edge_id,t.src,t.dst FROM tx t
                SEMI JOIN (SELECT edge_id FROM adjacency UNION SELECT edge_id FROM targets) e USING(edge_id)""")
            c.execute("CREATE TEMP TABLE needed AS SELECT src AS node_id FROM edges UNION SELECT dst FROM edges")
            frames = dict(
                tx=c.execute("SELECT * FROM edges ORDER BY edge_id").fetchdf(),
                targets=c.execute("SELECT edge_id FROM targets").fetchdf(),
                adjacency=c.execute("SELECT * FROM adjacency").fetchdf(),
                edge_features=c.execute("SELECT f.* FROM edge_features f SEMI JOIN edges USING(edge_id) ORDER BY edge_id").fetchdf(),
                node_features=self._node_features(c),
            )
            self._timed("read_graph_tables", started)
        finally:
            c.close()
        return MemorySnapshot(frames=frames, context_end=context_end)

    def _node_features(self, c):
        agg = c.execute("""WITH k AS (SELECT n.* FROM nodes n SEMI JOIN needed USING(node_id)),
              entities AS (SELECT DISTINCT entity_id FROM k WHERE entity_id IS NOT NULL),
              observed AS (SELECT entity_id,count(*) AS n FROM nodes SEMI JOIN entities USING(entity_id) GROUP BY entity_id),
              ent_out AS (SELECT source_entity AS entity_id,count(*) AS n FROM entity_pairs
                          SEMI JOIN entities ON entities.entity_id=entity_pairs.source_entity GROUP BY 1),
              ent_in AS (SELECT target_entity AS entity_id,count(*) AS n FROM entity_pairs
                         SEMI JOIN entities ON entities.entity_id=entity_pairs.target_entity GROUP BY 1)
            SELECT k.node_id,k.entity_id,k.entity_type,k.country,
              CASE WHEN k.entity_id IS NULL THEN 0 ELSE o.n END AS observed_entity_accounts,
              a.out_n,a.in_n,a.out_u,a.in_u,a.self_n,a.reciprocal_n,
              CASE WHEN a.out_n>0 THEN a.out_z/a.out_n ELSE 0 END AS out_z,
              CASE WHEN a.in_n>0 THEN a.in_z/a.in_n ELSE 0 END AS in_z,
              CASE WHEN a.out_n>0 THEN a.out_tail/a.out_n ELSE 0 END AS out_tail,
              CASE WHEN a.in_n>0 THEN a.in_tail/a.in_n ELSE 0 END AS in_tail,
              a.n_currency,a.n_days,coalesce(eo.n,0) AS ent_out_n,coalesce(ei.n,0) AS ent_in_n
            FROM k JOIN node_agg a USING(node_id) LEFT JOIN observed o USING(entity_id)
            LEFT JOIN ent_out eo USING(entity_id) LEFT JOIN ent_in ei USING(entity_id) ORDER BY node_id""").fetchdf()
        return node_frame(agg)

    def write_timings(self, document):
        with (self.folder / "timings.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(document) + "\n")
