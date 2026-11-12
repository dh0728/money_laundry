"""Label-free exact-deduplicated node19/edge17 preprocessing with frozen calibration.

Inputs are normalized transaction/KYC Parquet, not a vendor-specific raw CSV.
All historical transactions through context_end must be supplied. Snapshot
features include that whole day: daily close semantics, never streaming claims.
"""

from pathlib import Path
import json
import duckdb
import pandas as pd
from .schema import ROOT, EDGE_FEATURES
from .io import sql_string as q, write_json, sha256

TX_COLUMNS = [
    "edge_id",
    "ts",
    "src",
    "dst",
    "paid",
    "received",
    "payment_currency",
    "receiving_currency",
    "payment_format",
    "duplicate_group_id",
]
KYC_COLUMNS = ["node_id", "entity_id", "entity_type", "country"]


def amount(column, prefix):
    return f"CASE WHEN {prefix}.scale IS NULL THEN 0 ELSE greatest(-8,least(8,(ln(1+t.{column}::DOUBLE/{prefix}.scale)-{prefix}.med)/{prefix}.iqr)) END"


def validate_inputs(c, transactions, kyc):
    """Reject broken identifiers and missing KYC rather than silently losing rows."""
    c.execute(f"CREATE VIEW raw_tx AS SELECT * FROM read_parquet({q(transactions)})")
    c.execute(f"CREATE VIEW raw_kyc AS SELECT * FROM read_parquet({q(kyc)})")
    for table, columns in [("raw_tx", TX_COLUMNS), ("raw_kyc", KYC_COLUMNS)]:
        actual = set(c.execute(f"DESCRIBE {table}").fetchdf().column_name)
        if missing := set(columns) - actual:
            raise ValueError(f"{table}: missing {sorted(missing)}")
    types = dict(row[:2] for row in c.execute("DESCRIBE raw_tx").fetchall())
    for name in ["edge_id", "src", "dst", "duplicate_group_id"]:
        if types[name] not in ["BIGINT", "INTEGER", "SMALLINT", "TINYINT"]:
            raise ValueError(f"{name} must be a signed integer column")
    if not types["ts"].startswith("TIMESTAMP") or "WITH TIME ZONE" in types["ts"]:
        raise ValueError("ts must be a UTC-normalized timezone-naive Parquet timestamp")
    kyc_types = dict(row[:2] for row in c.execute("DESCRIBE raw_kyc").fetchall())
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
    if c.execute("SELECT count(*) FROM raw_tx WHERE ts<>date_trunc('minute',ts)").fetchone()[0]:
        raise ValueError("Frozen temporal features require minute-resolution timestamps")
    if c.execute(
        "SELECT count(*) FROM raw_kyc WHERE node_id IS NULL OR node_id<0"
    ).fetchone()[0]:
        raise ValueError("Invalid KYC node_id")
    missing = c.execute(
        "SELECT count(*) FROM (SELECT src AS node_id FROM raw_tx UNION SELECT dst FROM raw_tx) n ANTI JOIN raw_kyc k USING(node_id)"
    ).fetchone()[0]
    if missing:
        raise ValueError(f"{missing} accounts missing from KYC mapping")
    # Reject duplicate pointers that would discard a different transaction.
    if c.execute(
        "SELECT count(*) FROM raw_tx a ANTI JOIN raw_tx b ON a.duplicate_group_id=b.edge_id WHERE a.duplicate_group_id IS NOT NULL"
    ).fetchone()[0]:
        raise ValueError("Duplicate representative missing from input history")
    fields = [
        "ts",
        "src",
        "dst",
        "paid",
        "received",
        "payment_currency",
        "receiving_currency",
        "payment_format",
    ]
    different = " OR ".join(f"a.{name} IS DISTINCT FROM b.{name}" for name in fields)
    invalid = c.execute(
        f"SELECT count(*) FROM raw_tx a JOIN raw_tx b ON a.duplicate_group_id=b.edge_id WHERE ({different}) OR (b.duplicate_group_id IS NOT NULL AND b.duplicate_group_id!=b.edge_id)"
    ).fetchone()[0]
    if invalid:
        raise ValueError(
            "Duplicate group must reference an identical retained transaction"
        )


def prepare_snapshot(settings):
    """Write feature/graph Parquet and a completion manifest; no labels are read."""
    root = Path(settings["output_dir"]) / "prepared"
    if root.exists():
        raise FileExistsError(
            f"{root}: use a fresh output directory, or explicitly remove generated outputs"
        )
    end = pd.Timestamp(settings["context_end"])
    start = pd.Timestamp(settings["target_start"])
    target_end = pd.Timestamp(settings["target_end"])
    if not start <= target_end <= end:
        raise ValueError("Require target_start <= target_end <= context_end")
    if any(x.tzinfo is not None for x in [start, target_end, end]):
        raise ValueError("Dates must follow the timezone-naive source calendar")
    root.mkdir(parents=True)
    c = duckdb.connect(str(root / "work.duckdb"))
    try:
        c.execute(
            f"SET threads={int(settings.get('threads',2))}; SET memory_limit={q(settings.get('memory_limit','2GB'))}"
        )
        validate_inputs(c, settings["transactions"], settings["kyc"])
        cols = ",".join(TX_COLUMNS)
        c.execute(
            f"""CREATE TABLE tx AS SELECT {cols},ts::DATE AS day FROM raw_tx
            WHERE (duplicate_group_id IS NULL OR edge_id=duplicate_group_id)
            AND ts::DATE<={q(str(end.date()))}
            QUALIFY row_number() OVER(PARTITION BY ts,src,dst,paid,received,
              payment_currency,receiving_currency,payment_format ORDER BY edge_id)=1
            ORDER BY edge_id"""
        )
        if not c.execute("SELECT count(*) FROM tx").fetchone()[0]:
            raise ValueError("Empty snapshot")
        c.execute(
            "CREATE TABLE kyc AS SELECT node_id,entity_id,coalesce(nullif(trim(entity_type),''),'UNKNOWN') AS entity_type,coalesce(nullif(trim(country),''),'UNKNOWN') AS country FROM raw_kyc"
        )
        c.execute(
            f'CREATE VIEW stats AS SELECT * FROM read_parquet({q(ROOT/"assets/currency_stats.parquet")})'
        )
        c.execute(
            f'CREATE VIEW amount_stats AS SELECT * FROM read_parquet({q(ROOT/"assets/amount_stats.parquet")})'
        )
        c.execute(
            """CREATE TABLE pair_state AS SELECT src,dst,day,
          sum(n) OVER(PARTITION BY src,dst ORDER BY day ROWS UNBOUNDED PRECEDING) AS history_count,
          max(last_ts) OVER(PARTITION BY src,dst ORDER BY day ROWS UNBOUNDED PRECEDING) AS last_ts
          FROM (SELECT src,dst,day,count(*) n,max(ts) last_ts FROM tx GROUP BY src,dst,day)"""
        )
        c.execute(
            """CREATE TABLE pairs AS SELECT t.src,t.dst,t.day,coalesce(f.history_count,0) pair_n,coalesce(r.history_count,0) reverse_n,
          CASE WHEN f.last_ts IS NULL THEN -1 ELSE date_diff('minute',f.last_ts,t.day::TIMESTAMP) END age
          FROM (SELECT DISTINCT src,dst,day FROM tx) t
          ASOF LEFT JOIN pair_state f ON t.src=f.src AND t.dst=f.dst AND t.day>f.day
          ASOF LEFT JOIN pair_state r ON t.src=r.dst AND t.dst=r.src AND t.day>r.day"""
        )
        windows = []
        for name, part in [("pair", "src,dst"), ("sender", "src"), ("receiver", "dst")]:
            windows.extend(
                [
                    f"count(*) OVER(PARTITION BY {part} ORDER BY ts RANGE BETWEEN UNBOUNDED PRECEDING AND INTERVAL '1 minute' PRECEDING) {name}_prior",
                    f"max(ts) OVER(PARTITION BY {part} ORDER BY ts RANGE BETWEEN UNBOUNDED PRECEDING AND INTERVAL '1 minute' PRECEDING) {name}_last",
                    f"count(*) OVER(PARTITION BY {part} ORDER BY ts RANGE BETWEEN INTERVAL '60 minutes' PRECEDING AND INTERVAL '1 minute' PRECEDING) {name}_hour",
                ]
            )
        c.execute(
            "CREATE TABLE temporal AS SELECT edge_id," + ",".join(windows) + " FROM tx"
        )
        gap = (
            lambda n: f"CASE WHEN z.{n}_last IS NULL THEN 0 ELSE ln(2+date_diff('minute',z.{n}_last,t.ts)) END"
        )
        expressions = [
            "ln(1+z.pair_prior)",
            gap("pair"),
            "ln(1+z.pair_hour)",
            gap("sender"),
            "ln(1+z.sender_hour)",
            gap("receiver"),
            "ln(1+z.receiver_hour)",
            amount("paid", "ps"),
            "ln(1+p.pair_n)",
            "ln(1+p.reverse_n)",
            "CASE WHEN p.age<0 THEN 0 ELSE ln(2+p.age) END",
            "CASE WHEN sk.entity_id IS NOT NULL AND sk.entity_id=dk.entity_id THEN 1 ELSE 0 END",
            "CASE WHEN sk.country!='UNKNOWN' AND dk.country!='UNKNOWN' AND sk.country=dk.country THEN 1 ELSE 0 END",
            "CASE WHEN sk.country!='UNKNOWN' AND dk.country!='UNKNOWN' THEN 1 ELSE 0 END",
            "CASE WHEN t.payment_currency=t.receiving_currency THEN 1 ELSE 0 END",
            "CASE WHEN t.src=t.dst THEN 1 ELSE 0 END",
            "CASE WHEN a.m IS NULL OR a.sd IS NULL THEN 0 ELSE greatest(-10,least(10,(ln(1+t.paid::DOUBLE)-a.m)/(a.sd+0.000001))) END",
        ]
        features = ",".join(
            f'({value})::FLOAT AS "{name}"'
            for name, value in zip(EDGE_FEATURES, expressions)
        )
        c.execute(
            f"""CREATE TABLE edge_features AS SELECT t.edge_id,{features} FROM tx t JOIN temporal z USING(edge_id)
          JOIN pairs p ON t.src=p.src AND t.dst=p.dst AND t.day=p.day JOIN kyc sk ON sk.node_id=t.src JOIN kyc dk ON dk.node_id=t.dst
          LEFT JOIN stats ps ON ps.currency=t.payment_currency LEFT JOIN amount_stats a ON a.payment_currency=t.payment_currency ORDER BY t.edge_id"""
        )
        c.execute(
            f"""CREATE VIEW hist AS SELECT t.*,{amount('paid','ps')} paid_currency_z,{amount('received','rs')} received_currency_z,
          ks.entity_id source_entity,kd.entity_id target_entity FROM tx t JOIN kyc ks ON ks.node_id=t.src JOIN kyc kd ON kd.node_id=t.dst
          LEFT JOIN stats ps ON ps.currency=t.payment_currency LEFT JOIN stats rs ON rs.currency=t.receiving_currency"""
        )
        from .node_features import build_nodes

        nodes = build_nodes(c)
        c.register("node_features", nodes)
        if settings.get("target_ids") is not None:
            # Backend connection (only change to the delivered file): the given IDs instead of a date range.
            c.register("given_targets", pd.DataFrame({"edge_id": pd.array(settings["target_ids"], dtype="int64")}))
            c.execute("CREATE TABLE targets AS SELECT edge_id FROM tx SEMI JOIN given_targets USING(edge_id) ORDER BY edge_id")
        else:
            c.execute(
                f"CREATE TABLE targets AS SELECT edge_id FROM tx WHERE day BETWEEN {q(str(start.date()))} AND {q(str(target_end.date()))} ORDER BY edge_id"
            )
        if not c.execute("SELECT count(*) FROM targets").fetchone()[0]:
            raise ValueError("No target transactions in selected dates")
        bad = " OR ".join(
            f'"{n}" IS NULL OR NOT isfinite("{n}")' for n in EDGE_FEATURES
        )
        if c.execute("SELECT count(*) FROM edge_features WHERE " + bad).fetchone()[0]:
            raise ValueError("Nonfinite edge features")
        orders = {
            "tx": "edge_id",
            "edge_features": "edge_id",
            "node_features": "node_id",
            "targets": "edge_id",
        }
        counts = {}
        for name, order in orders.items():
            counts[name] = c.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
            c.execute(
                f'COPY (SELECT * FROM {name} ORDER BY {order}) TO {q(root/(name+".parquet"))} (FORMAT PARQUET, COMPRESSION ZSTD)'
            )
        manifest = dict(
            schema_version="legacy17_intermediate_current14_export",
            counts=counts,
            context_end=str(end.date()),
            target_start=str(start.date()),
            target_end=str(target_end.date()),
            history_start=str(c.execute("SELECT min(day) FROM tx").fetchone()[0]),
            neighbors=[50, 50],
            sampling_seed=42,
            duckdb_version=duckdb.__version__,
            labels_used=False,
            context_policy="cumulative through context_end inclusive; not transaction-time causal",
            inputs={
                k: dict(path=settings[k], sha256=sha256(settings[k]))
                for k in ["transactions", "kyc"]
            },
            calibration={
                p.name: sha256(p)
                for p in [
                    ROOT / "assets/currency_stats.parquet",
                    ROOT / "assets/amount_stats.parquet",
                ]
            },
        )
        write_json(root / "manifest.json", manifest)
    finally:
        c.close()
    return root

