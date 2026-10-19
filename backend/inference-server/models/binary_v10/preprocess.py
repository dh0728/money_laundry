"""The delivered v10 preprocessing (node19_edge17_v1), from the team's 01_binary_v10.ipynb.

Normalized transaction/KYC Parquet -> node and edge features with the frozen calibration
files -> one two-hop graph per target transaction. The SQL and formulas are the team's,
unchanged; only file locations became arguments, and the targets may be given as IDs
instead of a date range. Snapshot features cover the whole context day (daily close
semantics, not transaction-time causal).
"""
from dataclasses import dataclass
import json
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import torch

from models.binary_v10.spec import asset

SCHEMA = json.loads(asset("feature_schema.json").read_text(encoding="utf-8"))
NODE_FEATURES = SCHEMA["node_features"]
EDGE_FEATURES = SCHEMA["edge_features"]
ENTITY_TYPES = SCHEMA["entity_types"]
TX_COLUMNS = ["edge_id", "ts", "src", "dst", "paid", "received", "payment_currency",
              "receiving_currency", "payment_format", "duplicate_group_id"]
KYC_COLUMNS = ["node_id", "entity_id", "entity_type", "country"]
# Original cumulative node feature formulas, selected into the frozen 19-column order.
ALL_FEATURES = (
    ["log_out_count", "log_in_count", "log_out_neighbors", "log_in_neighbors", "log_self_count",
     "log_reciprocal_neighbors", "net_count_ratio", "reciprocity_ratio", "mean_paid_currency_z",
     "mean_received_currency_z", "paid_outlier_fraction", "received_outlier_fraction",
     "log_currency_count", "log_active_days"]
    + ["type_" + x for x in ENTITY_TYPES]
    + ["log_entity_observed_accounts", "log_entity_out_diversity", "log_entity_in_diversity"]
)


def q(value):
    return "'" + str(value).replace("'", "''") + "'"


def finite(name, x):
    if not np.isfinite(x).all():
        raise ValueError(name + " contains nonfinite values")
    return x


def amount(column, prefix):
    return f"CASE WHEN {prefix}.scale IS NULL THEN 0 ELSE greatest(-8,least(8,(ln(1+t.{column}::DOUBLE/{prefix}.scale)-{prefix}.med)/{prefix}.iqr)) END"


def build_nodes(c):
    agg = c.execute(
        "WITH outgoing AS (SELECT src AS node_id,count(*) AS out_n,count(DISTINCT dst) AS out_u,\n          count(*) FILTER(WHERE src=dst) AS self_n,avg(paid_currency_z) AS out_z,\n          avg(CASE WHEN abs(paid_currency_z)>=3 THEN 1.0 ELSE 0 END) AS out_tail FROM hist GROUP BY src),\n      incoming AS (SELECT dst AS node_id,count(*) AS in_n,count(DISTINCT src) AS in_u,avg(received_currency_z) AS in_z,\n          avg(CASE WHEN abs(received_currency_z)>=3 THEN 1.0 ELSE 0 END) AS in_tail FROM hist GROUP BY dst),\n      pairs AS (SELECT DISTINCT src,dst FROM hist WHERE src!=dst),\n      reciprocal AS (SELECT a.src AS node_id,count(*) AS reciprocal_n FROM pairs a JOIN pairs b ON a.src=b.dst AND a.dst=b.src GROUP BY a.src),\n      currency_set AS (SELECT src AS node_id,payment_currency AS currency FROM hist UNION SELECT dst,receiving_currency FROM hist),\n      currencies AS (SELECT node_id,count(*) AS n_currency FROM currency_set GROUP BY node_id),\n      active AS (SELECT src AS node_id,day FROM hist UNION SELECT dst,day FROM hist),\n      active_days AS (SELECT node_id,count(*) AS n_days FROM active GROUP BY node_id),\n      ent_pairs AS (SELECT DISTINCT source_entity,target_entity FROM hist WHERE source_entity IS NOT NULL AND target_entity IS NOT NULL),\n      ent_out AS (SELECT source_entity AS entity_id,count(*) AS ent_out_n FROM ent_pairs GROUP BY source_entity),\n      ent_in AS (SELECT target_entity AS entity_id,count(*) AS ent_in_n FROM ent_pairs GROUP BY target_entity)\n      SELECT k.*,CASE WHEN k.entity_id IS NULL THEN 0 ELSE count(*) OVER(PARTITION BY k.entity_id) END AS observed_entity_accounts,coalesce(o.out_n,0) AS out_n,coalesce(i.in_n,0) AS in_n,coalesce(o.out_u,0) AS out_u,\n       coalesce(i.in_u,0) AS in_u,coalesce(o.self_n,0) AS self_n,coalesce(r.reciprocal_n,0) AS reciprocal_n,\n       coalesce(o.out_z,0) AS out_z,coalesce(i.in_z,0) AS in_z,coalesce(o.out_tail,0) AS out_tail,\n       coalesce(i.in_tail,0) AS in_tail,cu.n_currency,ad.n_days,coalesce(eo.ent_out_n,0) AS ent_out_n,\n       coalesce(ei.ent_in_n,0) AS ent_in_n\n      FROM active_days ad JOIN kyc k USING(node_id) LEFT JOIN outgoing o USING(node_id)\n      LEFT JOIN incoming i USING(node_id) LEFT JOIN reciprocal r USING(node_id)\n      JOIN currencies cu USING(node_id) LEFT JOIN ent_out eo ON k.entity_id=eo.entity_id\n      LEFT JOIN ent_in ei ON k.entity_id=ei.entity_id ORDER BY node_id"
    ).fetchdf()
    if agg.empty:
        raise ValueError("No graph history")
    v = lambda name: agg[name].to_numpy(np.float64)
    outn, inn = (v("out_n"), v("in_n"))
    ou, iu = (v("out_u"), v("in_u"))
    rec = v("reciprocal_n")
    fields = [
        np.log1p(outn), np.log1p(inn), np.log1p(ou), np.log1p(iu), np.log1p(v("self_n")), np.log1p(rec),
        (outn - inn) / np.maximum(outn + inn, 1), rec / np.maximum(ou + iu, 1),
        v("out_z"), v("in_z"), v("out_tail"), v("in_tail"),
        np.log1p(v("n_currency")), np.log1p(v("n_days")),
    ]
    fields += [(agg.entity_type == typ).to_numpy(np.float64) for typ in ENTITY_TYPES]
    fields += [np.log1p(v("observed_entity_accounts")), np.log1p(v("ent_out_n")), np.log1p(v("ent_in_n"))]
    nx = finite("daily node features", np.stack(fields, axis=1).astype(np.float32))
    node_ids = agg.node_id.to_numpy(np.int64)
    out = pd.DataFrame(nx[:, [ALL_FEATURES.index(n) for n in NODE_FEATURES]], columns=NODE_FEATURES)
    out.insert(0, "node_id", node_ids)
    return out


def validate_inputs(c, transactions, kyc):
    """Reject broken identifiers and missing KYC rather than silently losing rows."""
    c.execute(f"CREATE VIEW raw_tx AS SELECT * FROM read_parquet({q(transactions)})")
    c.execute(f"CREATE VIEW raw_kyc AS SELECT * FROM read_parquet({q(kyc)})")
    for table, columns in [("raw_tx", TX_COLUMNS), ("raw_kyc", KYC_COLUMNS)]:
        actual = set(c.execute(f"DESCRIBE {table}").fetchdf().column_name)
        if missing := (set(columns) - actual):
            raise ValueError(f"{table}: missing {sorted(missing)}")
    types = dict((row[:2] for row in c.execute("DESCRIBE raw_tx").fetchall()))
    for name in ["edge_id", "src", "dst", "duplicate_group_id"]:
        if types[name] not in ["BIGINT", "INTEGER", "SMALLINT", "TINYINT"]:
            raise ValueError(f"{name} must be a signed integer column")
    if not types["ts"].startswith("TIMESTAMP") or "WITH TIME ZONE" in types["ts"]:
        raise ValueError("ts must be a UTC-normalized timezone-naive Parquet timestamp")
    kyc_types = dict((row[:2] for row in c.execute("DESCRIBE raw_kyc").fetchall()))
    if kyc_types["node_id"] not in ["BIGINT", "INTEGER", "SMALLINT", "TINYINT"]:
        raise ValueError("KYC node_id must be a signed integer column")
    if c.execute("SELECT count(*)-count(DISTINCT edge_id) FROM raw_tx").fetchone()[0]:
        raise ValueError("edge_id must be unique")
    if c.execute("SELECT count(*)-count(DISTINCT node_id) FROM raw_kyc").fetchone()[0]:
        raise ValueError("node_id must be unique")
    bad = c.execute(
        "SELECT count(*) FROM raw_tx WHERE edge_id IS NULL OR src IS NULL OR dst IS NULL OR ts IS NULL OR edge_id<0 OR src<0 OR dst<0 OR paid IS NULL OR received IS NULL OR NOT isfinite(paid::DOUBLE) OR NOT isfinite(received::DOUBLE) OR paid<0 OR received<0 OR payment_currency IS NULL OR receiving_currency IS NULL"
    ).fetchone()[0]
    if bad:
        raise ValueError(f"{bad} transactions have invalid required fields")
    if c.execute("SELECT count(*) FROM raw_kyc WHERE node_id IS NULL OR node_id<0").fetchone()[0]:
        raise ValueError("Invalid KYC node_id")
    missing = c.execute(
        "SELECT count(*) FROM (SELECT src AS node_id FROM raw_tx UNION SELECT dst FROM raw_tx) n ANTI JOIN raw_kyc k USING(node_id)"
    ).fetchone()[0]
    if missing:
        raise ValueError(f"{missing} accounts missing from KYC mapping")
    if c.execute(
        "SELECT count(*) FROM raw_tx a ANTI JOIN raw_tx b ON a.duplicate_group_id=b.edge_id WHERE a.duplicate_group_id IS NOT NULL"
    ).fetchone()[0]:
        raise ValueError("Duplicate representative missing from input history")
    fields = ["ts", "src", "dst", "paid", "received", "payment_currency", "receiving_currency", "payment_format"]
    different = " OR ".join((f"a.{name} IS DISTINCT FROM b.{name}" for name in fields))
    invalid = c.execute(
        f"SELECT count(*) FROM raw_tx a JOIN raw_tx b ON a.duplicate_group_id=b.edge_id WHERE ({different}) OR (b.duplicate_group_id IS NOT NULL AND b.duplicate_group_id!=b.edge_id)"
    ).fetchone()[0]
    if invalid:
        raise ValueError("Duplicate group must reference an identical retained transaction")


def prepare_snapshot(transactions, kyc, root, *, context_end, target_start=None, target_end=None,
                     target_ids=None, threads=2, memory_limit="2GB"):
    """Write feature/graph Parquet into a new directory root; no labels are read.

    Targets are the given edge IDs, or every context transaction dated target_start..target_end.
    """
    root = Path(root)
    root.mkdir(parents=True)
    end = pd.Timestamp(context_end)
    if target_ids is None:
        start, target_end = pd.Timestamp(target_start), pd.Timestamp(target_end)
        if not start <= target_end <= end:
            raise ValueError("Require target_start <= target_end <= context_end")
    c = duckdb.connect(str(root / "work.duckdb"))
    try:
        c.execute(f"SET threads={int(threads)}; SET memory_limit={q(memory_limit)}")
        validate_inputs(c, transactions, kyc)
        cols = ",".join(TX_COLUMNS)
        c.execute(
            f"CREATE TABLE tx AS SELECT {cols},ts::DATE AS day FROM raw_tx WHERE (duplicate_group_id IS NULL OR edge_id=duplicate_group_id) AND ts::DATE<={q(str(end.date()))} ORDER BY edge_id"
        )
        if not c.execute("SELECT count(*) FROM tx").fetchone()[0]:
            raise ValueError("Empty snapshot")
        c.execute(
            "CREATE TABLE kyc AS SELECT node_id,entity_id,coalesce(entity_type,'UNKNOWN') AS entity_type,coalesce(country,'UNKNOWN') AS country FROM raw_kyc"
        )
        c.execute(f"CREATE VIEW stats AS SELECT * FROM read_parquet({q(asset('currency_stats.parquet'))})")
        c.execute(f"CREATE VIEW amount_stats AS SELECT * FROM read_parquet({q(asset('amount_stats.parquet'))})")
        c.execute(
            "CREATE TABLE pair_state AS SELECT src,dst,day,\n          sum(n) OVER(PARTITION BY src,dst ORDER BY day ROWS UNBOUNDED PRECEDING) AS history_count,\n          max(last_ts) OVER(PARTITION BY src,dst ORDER BY day ROWS UNBOUNDED PRECEDING) AS last_ts\n          FROM (SELECT src,dst,day,count(*) n,max(ts) last_ts FROM tx GROUP BY src,dst,day)"
        )
        c.execute(
            "CREATE TABLE pairs AS SELECT t.src,t.dst,t.day,coalesce(f.history_count,0) pair_n,coalesce(r.history_count,0) reverse_n,\n          CASE WHEN f.last_ts IS NULL THEN -1 ELSE date_diff('minute',f.last_ts,t.day::TIMESTAMP) END age\n          FROM (SELECT DISTINCT src,dst,day FROM tx) t\n          ASOF LEFT JOIN pair_state f ON t.src=f.src AND t.dst=f.dst AND t.day>f.day\n          ASOF LEFT JOIN pair_state r ON t.src=r.dst AND t.dst=r.src AND t.day>r.day"
        )
        windows = []
        for name, part in [("pair", "src,dst"), ("sender", "src"), ("receiver", "dst")]:
            windows.extend([
                f"count(*) OVER(PARTITION BY {part} ORDER BY ts RANGE BETWEEN UNBOUNDED PRECEDING AND INTERVAL '1 minute' PRECEDING) {name}_prior",
                f"max(ts) OVER(PARTITION BY {part} ORDER BY ts RANGE BETWEEN UNBOUNDED PRECEDING AND INTERVAL '1 minute' PRECEDING) {name}_last",
                f"count(*) OVER(PARTITION BY {part} ORDER BY ts RANGE BETWEEN INTERVAL '60 minutes' PRECEDING AND INTERVAL '1 minute' PRECEDING) {name}_hour",
            ])
        c.execute("CREATE TABLE temporal AS SELECT edge_id," + ",".join(windows) + " FROM tx")
        gap = lambda n: f"CASE WHEN z.{n}_last IS NULL THEN 0 ELSE ln(2+date_diff('minute',z.{n}_last,t.ts)) END"
        expressions = [
            "ln(1+z.pair_prior)", gap("pair"), "ln(1+z.pair_hour)", gap("sender"), "ln(1+z.sender_hour)",
            gap("receiver"), "ln(1+z.receiver_hour)", amount("paid", "ps"), "ln(1+p.pair_n)", "ln(1+p.reverse_n)",
            "CASE WHEN p.age<0 THEN 0 ELSE ln(2+p.age) END",
            "CASE WHEN sk.entity_id IS NOT NULL AND sk.entity_id=dk.entity_id THEN 1 ELSE 0 END",
            "CASE WHEN sk.country!='UNKNOWN' AND dk.country!='UNKNOWN' AND sk.country=dk.country THEN 1 ELSE 0 END",
            "CASE WHEN sk.country!='UNKNOWN' AND dk.country!='UNKNOWN' THEN 1 ELSE 0 END",
            "CASE WHEN t.payment_currency=t.receiving_currency THEN 1 ELSE 0 END",
            "CASE WHEN t.src=t.dst THEN 1 ELSE 0 END",
            "CASE WHEN a.m IS NULL OR a.sd IS NULL THEN 0 ELSE greatest(-10,least(10,(ln(1+t.paid::DOUBLE)-a.m)/(a.sd+0.000001))) END",
        ]
        features = ",".join((f'({value})::FLOAT AS "{name}"' for name, value in zip(EDGE_FEATURES, expressions)))
        c.execute(
            f"CREATE TABLE edge_features AS SELECT t.edge_id,{features} FROM tx t JOIN temporal z USING(edge_id)\n          JOIN pairs p ON t.src=p.src AND t.dst=p.dst AND t.day=p.day JOIN kyc sk ON sk.node_id=t.src JOIN kyc dk ON dk.node_id=t.dst\n          LEFT JOIN stats ps ON ps.currency=t.payment_currency LEFT JOIN amount_stats a ON a.payment_currency=t.payment_currency ORDER BY t.edge_id"
        )
        c.execute(
            f"CREATE VIEW hist AS SELECT t.*,{amount('paid', 'ps')} paid_currency_z,{amount('received', 'rs')} received_currency_z,\n          ks.entity_id source_entity,kd.entity_id target_entity FROM tx t JOIN kyc ks ON ks.node_id=t.src JOIN kyc kd ON kd.node_id=t.dst\n          LEFT JOIN stats ps ON ps.currency=t.payment_currency LEFT JOIN stats rs ON rs.currency=t.receiving_currency"
        )
        nodes = build_nodes(c)
        c.register("node_features", nodes)
        adjacency = []
        for direction, owner in [("incoming", "dst"), ("outgoing", "src")]:
            adjacency.append(
                f"SELECT edge_id,{owner} AS owner,{q(direction)} AS direction FROM tx QUALIFY row_number() OVER(PARTITION BY {owner} ORDER BY hash(edge_id,{owner},42,DATE {q(str(end.date()))}),edge_id)<=100"
            )
        c.execute("CREATE TABLE adjacency AS " + " UNION ALL ".join(adjacency))
        if target_ids is None:
            c.execute(
                f"CREATE TABLE targets AS SELECT edge_id FROM tx WHERE day BETWEEN {q(str(start.date()))} AND {q(str(target_end.date()))} ORDER BY edge_id"
            )
        else:
            c.register("given_targets", pd.DataFrame({"edge_id": np.asarray(target_ids, dtype=np.int64)}))
            c.execute("CREATE TABLE targets AS SELECT edge_id FROM given_targets ORDER BY edge_id")
            if c.execute("SELECT count(*) FROM targets ANTI JOIN tx USING(edge_id)").fetchone()[0]:
                raise ValueError("Target transaction missing from the snapshot")
        if not c.execute("SELECT count(*) FROM targets").fetchone()[0]:
            raise ValueError("No target transactions in selected dates")
        bad = " OR ".join((f'"{n}" IS NULL OR NOT isfinite("{n}")' for n in EDGE_FEATURES))
        if c.execute("SELECT count(*) FROM edge_features WHERE " + bad).fetchone()[0]:
            raise ValueError("Nonfinite edge features")
        orders = {"tx": "edge_id", "edge_features": "edge_id", "node_features": "node_id",
                  "adjacency": "direction,owner,edge_id", "targets": "edge_id"}
        for name, order in orders.items():
            c.execute(
                f"COPY (SELECT * FROM {name} ORDER BY {order}) TO {q(root / (name + '.parquet'))} (FORMAT PARQUET, COMPRESSION ZSTD)"
            )
        (root / "manifest.json").write_text(json.dumps(dict(schema_version="node19_edge17_v1",
                                                             context_end=str(end.date()))), encoding="utf-8")
    finally:
        c.close()
    (root / "work.duckdb").unlink(missing_ok=True)
    return root


@dataclass
class GraphInput:
    arrays: tuple
    topology: tuple
    edge_id: int
    context_end: str

    def tensors(self, device="cpu"):
        return tuple(
            torch.as_tensor(np.array(a, copy=True), device=device,
                            dtype=(torch.long if i in [1, 3] else torch.bool if i in [5, 6] else torch.float32))
            for i, a in enumerate(self.arrays)
        )


def reference_graph(path, metadata):
    with np.load(path, allow_pickle=False) as data:
        return GraphInput(tuple(data[f"b{i}"].copy() for i in range(7)), tuple(data[f"t{i}"].copy() for i in range(8)),
                          int(metadata["edge_id"]), metadata["context_end"])


class GraphSnapshot:
    """On-demand, two-hop disjoint transaction graph; avoids loading full history into RAM."""

    def __init__(self, prepared, threads=2, memory_limit="2GB"):
        self.root = Path(prepared)
        self.manifest = json.loads((self.root / "manifest.json").read_text(encoding="utf-8"))
        if self.manifest["schema_version"] != "node19_edge17_v1":
            raise ValueError("Unsupported feature schema")
        self.c = duckdb.connect()
        self.c.execute(f"SET threads={int(threads)}; SET memory_limit={q(memory_limit)}")
        for table in ["tx", "edge_features", "node_features", "adjacency", "targets"]:
            self.c.execute(f"CREATE VIEW {table} AS SELECT * FROM read_parquet({q(self.root / (table + '.parquet'))})")

    def close(self):
        self.c.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def target_ids(self):
        return self.c.execute("SELECT edge_id FROM targets ORDER BY edge_id").fetchdf().edge_id.to_numpy()

    def _select(self, nodes):
        self.c.register("frontier", pd.DataFrame({"owner": np.unique(nodes)}))
        return self.c.execute(
            "SELECT a.edge_id,t.src,t.dst,bool_or(a.direction='incoming') AS incoming,bool_or(a.direction='outgoing') AS outgoing FROM adjacency a JOIN frontier f USING(owner) JOIN tx t USING(edge_id) GROUP BY a.edge_id,t.src,t.dst ORDER BY a.edge_id"
        ).fetchdf()

    def build(self, edge_id):
        target = self.c.execute(
            "SELECT t.edge_id,t.src,t.dst FROM tx t JOIN targets a USING(edge_id) WHERE t.edge_id=?", [int(edge_id)]
        ).fetchdf()
        if len(target) != 1:
            raise ValueError("Transaction not in declared target interval")
        src, dst = (int(target.src.iloc[0]), int(target.dst.iloc[0]))
        roots = np.unique([src, dst])
        first = self._select(roots)
        neighbors = np.unique(np.r_[first.src[first.incoming], first.dst[first.outgoing]])
        second = self._select(neighbors)
        edges = (pd.concat([first, second], ignore_index=True)
                 .groupby(["edge_id", "src", "dst"], as_index=False)[["incoming", "outgoing"]].max()
                 .sort_values("edge_id"))
        nodes = np.unique(np.r_[roots, edges.src, edges.dst])
        self.c.register("needed_nodes", pd.DataFrame({"node_id": nodes}))
        features = self.c.execute(
            "SELECT n.* FROM node_features n JOIN needed_nodes u USING(node_id) ORDER BY node_id"
        ).fetchdf()
        if not np.array_equal(features.node_id, nodes):
            raise ValueError("Missing node features")
        self.c.register("needed_edges", pd.DataFrame({"edge_id": np.unique(np.r_[edges.edge_id, edge_id])}))
        attrs = self.c.execute(
            "SELECT e.* FROM edge_features e JOIN needed_edges u USING(edge_id) ORDER BY edge_id"
        ).fetchdf().set_index("edge_id")
        ego = np.isin(nodes, roots).astype(np.float32)
        x = np.column_stack([features[NODE_FEATURES].to_numpy(np.float32), ego])
        ei = np.stack([np.searchsorted(nodes, edges.src), np.searchsorted(nodes, edges.dst)])
        ti = np.array([[np.searchsorted(nodes, src)], [np.searchsorted(nodes, dst)]])
        arrays = (x, ei, attrs.loc[edges.edge_id, EDGE_FEATURES].to_numpy(np.float32), ti,
                  attrs.loc[[edge_id], EDGE_FEATURES].to_numpy(np.float32),
                  edges.incoming.to_numpy(bool), edges.outgoing.to_numpy(bool))
        flags = arrays[5].astype(np.int64) + 2 * arrays[6].astype(np.int64)
        top = (nodes, edges.edge_id.to_numpy(np.int64), ei[0], ei[1], ti[0], ti[1], flags, ego)
        return GraphInput(arrays, top, int(edge_id), self.manifest["context_end"])


class MemorySnapshot:
    """GraphSnapshot.build on in-memory arrays: the same graphs without per-target queries.

    Not part of the delivered package. The prepared tables of one request are small next to
    the materials already held whole, and GraphSnapshot spends ~0.1 s per target on DuckDB
    round trips (hours for a business day). Equality with GraphSnapshot is tested.
    """

    def __init__(self, prepared):
        root = Path(prepared)
        self.manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
        if self.manifest["schema_version"] != "node19_edge17_v1":
            raise ValueError("Unsupported feature schema")
        read = lambda name, columns=None: pd.read_parquet(root / (name + ".parquet"), columns=columns)
        tx = read("tx", ["edge_id", "src", "dst"]).sort_values("edge_id")
        self.tx_edge, self.tx_src, self.tx_dst = (tx[c].to_numpy() for c in ("edge_id", "src", "dst"))
        self.targets = np.sort(read("targets")["edge_id"].to_numpy(np.int64))
        adjacency = read("adjacency").sort_values(["owner", "edge_id"], kind="stable")
        owners = adjacency["owner"].to_numpy()
        self.owners, self.starts = np.unique(owners, return_index=True)
        self.ends = np.r_[self.starts[1:], len(owners)]
        self.adj_edge = adjacency["edge_id"].to_numpy()
        self.adj_incoming = (adjacency["direction"] == "incoming").to_numpy()
        nodes = read("node_features").sort_values("node_id")
        self.node_ids = nodes["node_id"].to_numpy()
        self.node_x = nodes[NODE_FEATURES].to_numpy(np.float32)
        edges = read("edge_features").sort_values("edge_id")
        self.edge_ids = edges["edge_id"].to_numpy()
        self.edge_x = edges[EDGE_FEATURES].to_numpy(np.float32)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def target_ids(self):
        return self.targets

    @staticmethod
    def _find(keys, values, what):
        position = np.searchsorted(keys, values)
        if len(values) and (position.max() >= len(keys) or not np.array_equal(keys[position], values)):
            raise ValueError(f"Missing {what}")
        return position

    def _select(self, nodes):
        owners = np.unique(nodes)
        position = np.searchsorted(self.owners, owners)
        hit = position < len(self.owners)
        hit[hit] = self.owners[position[hit]] == owners[hit]
        rows = np.concatenate([np.arange(self.starts[p], self.ends[p]) for p in position[hit]] or [[]]).astype(np.int64)
        edge_ids, inverse = np.unique(self.adj_edge[rows], return_inverse=True)
        incoming = np.zeros(len(edge_ids), bool)
        outgoing = np.zeros(len(edge_ids), bool)
        np.logical_or.at(incoming, inverse, self.adj_incoming[rows])
        np.logical_or.at(outgoing, inverse, ~self.adj_incoming[rows])
        return edge_ids, incoming, outgoing

    def build(self, edge_id):
        edge_id = int(edge_id)
        position = np.searchsorted(self.targets, edge_id)
        if position >= len(self.targets) or self.targets[position] != edge_id:
            raise ValueError("Transaction not in declared target interval")
        row = self._find(self.tx_edge, np.array([edge_id]), "target transaction")[0]
        src, dst = int(self.tx_src[row]), int(self.tx_dst[row])
        roots = np.unique([src, dst])
        first, first_in, first_out = self._select(roots)
        at = self._find(self.tx_edge, first, "transactions")
        neighbors = np.unique(np.r_[self.tx_src[at][first_in], self.tx_dst[at][first_out]])
        second, second_in, second_out = self._select(neighbors)
        edge_ids, inverse = np.unique(np.r_[first, second], return_inverse=True)
        incoming = np.zeros(len(edge_ids), bool)
        outgoing = np.zeros(len(edge_ids), bool)
        np.logical_or.at(incoming, inverse, np.r_[first_in, second_in])
        np.logical_or.at(outgoing, inverse, np.r_[first_out, second_out])
        at = self._find(self.tx_edge, edge_ids, "transactions")
        edge_src, edge_dst = self.tx_src[at], self.tx_dst[at]
        nodes = np.unique(np.r_[roots, edge_src, edge_dst])
        node_rows = self._find(self.node_ids, nodes, "node features")
        attrs = self.edge_x[self._find(self.edge_ids, edge_ids, "edge features")]
        target_attrs = self.edge_x[self._find(self.edge_ids, np.array([edge_id]), "edge features")]
        ego = np.isin(nodes, roots).astype(np.float32)
        x = np.column_stack([self.node_x[node_rows], ego])
        ei = np.stack([np.searchsorted(nodes, edge_src), np.searchsorted(nodes, edge_dst)])
        ti = np.array([[np.searchsorted(nodes, src)], [np.searchsorted(nodes, dst)]])
        arrays = (x, ei, attrs, ti, target_attrs, incoming, outgoing)
        flags = incoming.astype(np.int64) + 2 * outgoing.astype(np.int64)
        top = (nodes, edge_ids.astype(np.int64), ei[0], ei[1], ti[0], ti[1], flags, ego)
        return GraphInput(arrays, top, edge_id, self.manifest["context_end"])
