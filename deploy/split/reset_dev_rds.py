#!/usr/bin/env python3
"""Reset the split-layout dev business DB (RDS aml_dev_v3) for a new initial schema.

Run with sudo on the backend EC2 host while uploads and analysis are idle.
  (no flags)                   inspect only: target, schemas, row counts
  --apply --backup-file FILE   stop the dev API, back up configuration, empty the business schemas
  --restore-config FILE        after the new image migrated the empty DB: restore configuration
  --grant-analysis             after restore: grant the analysis login its table permissions

Every statement runs inside the current release's API container through deploy.py's
Compose environment, so DB credentials never reach this process, its arguments or output.
Only aml_dev_v3 is accepted. Other databases (aml_prod), roles, S3 and keys are untouched.
"""
import argparse
import base64
import importlib.util
import json
import os
import sys
from pathlib import Path

ROOT = Path("/opt/aml")
DATABASE = "aml_dev_v3"
SCHEMAS = ("core", "ingest", "ledger", "analysis", "review", "ops", "private", "evaluation")
CONFIGURATION = {
    "users": "user_id,username,name,role,password_hash,last_assigned_at,created_at",
    "banks": "bank_id,name,country,is_reporting,report_format,created_at,updated_at",
    "bank_reporting_periods": "period_id,bank_id,effective_from_date,effective_to_date",
    "fx_rates": "fx_rate_version,currency,units_per_usd",
}

# Runs inside the API container. Prints only names, counts and the configuration backup.
INNER = r'''
import base64, json, os, sys
from urllib.parse import urlsplit
import psycopg
from psycopg import sql

DATABASE, SCHEMAS, CONFIGURATION, ACTION, PAYLOAD = json.loads(base64.b64decode(ARGS))
url = os.environ["SPRING_DATASOURCE_URL"].removeprefix("jdbc:")
# reset_prod_rds.py reuses this body for aml_prod; the database name is still checked exactly.
if (os.environ.get("SPRING_PROFILES_ACTIVE") not in ("dev", "prod") or urlsplit(url).path.strip("/") != DATABASE
        or not urlsplit(url).hostname.endswith(".rds.amazonaws.com")):
    raise SystemExit("REFUSED: the API container does not target the expected business DB")
with psycopg.connect(url, user=os.environ["SPRING_DATASOURCE_USERNAME"],
                     password=os.environ["SPRING_DATASOURCE_PASSWORD"], connect_timeout=10) as db:
    if db.execute("SELECT current_database()").fetchone()[0] != DATABASE:
        raise SystemExit("REFUSED: connected to another database")
    present = [r[0] for r in db.execute("""SELECT nspname FROM pg_namespace WHERE nspname !~ '^pg_'
        AND nspname NOT IN ('information_schema','public') ORDER BY 1""")]
    extra = [s for s in present if s not in SCHEMAS]
    public = [r[0] for r in db.execute("""SELECT tablename FROM pg_tables WHERE schemaname='public'
        AND tablename<>'flyway_schema_history'""")]
    if ACTION == "inspect":
        flyway = db.execute("SELECT to_regclass('public.flyway_schema_history') IS NOT NULL").fetchone()[0]
        versions = [r[0] for r in db.execute("SELECT version FROM public.flyway_schema_history WHERE success ORDER BY installed_rank")] if flyway else []
        counts = {}
        for table in ("core.users", "core.banks", "ingest.uploads", "ledger.transactions", "analysis.jobs", "review.alerts"):
            if db.execute("SELECT to_regclass(%s) IS NOT NULL", (table,)).fetchone()[0]:
                counts[table] = db.execute(sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(*table.split(".")))).fetchone()[0]
        print(json.dumps(dict(database=DATABASE, user=db.execute("SELECT current_user").fetchone()[0],
                              schemas=present, unexpected_schemas=extra, unexpected_public_tables=public,
                              flyway_versions=versions, row_counts=counts)))
    elif ACTION == "backup":
        pairs = sql.SQL(",").join(sql.SQL("{},(SELECT coalesce(json_agg(t),'[]'::json) FROM (SELECT {} FROM core.{}) t)").format(
            sql.Literal(table), sql.SQL(",").join(map(sql.Identifier, columns.split(","))), sql.Identifier(table))
            for table, columns in CONFIGURATION.items())
        # One SELECT gives all four tables one snapshot; NUMERIC rates stay exact as text.
        tables = db.execute(sql.SQL("SELECT json_build_object({})::text").format(pairs)).fetchone()[0]
        print(tables)
    elif ACTION == "drop":
        if extra or public:
            raise SystemExit("REFUSED: unexpected schemas or public tables; nothing was dropped")
        with db.transaction():
            db.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.SQL(",").join(map(sql.Identifier, SCHEMAS))))
            db.execute("DROP TABLE IF EXISTS public.flyway_schema_history")
        print("EMPTIED")
    elif ACTION == "wipe":
        # Production only, approved without backup: drop every non-system schema and public table.
        if DATABASE != "aml_prod":
            raise SystemExit("REFUSED: wipe is only for aml_prod")
        with db.transaction():
            if present:
                db.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.SQL(",").join(map(sql.Identifier, present))))
            for table in public + ["flyway_schema_history"]:
                db.execute(sql.SQL("DROP TABLE IF EXISTS public.{} CASCADE").format(sql.Identifier(table)))
        print("EMPTIED")
    elif ACTION == "restore":
        tables = PAYLOAD
        with db.transaction():
            db.execute("LOCK TABLE core.users,core.banks,core.bank_reporting_periods,core.fx_rates IN ACCESS EXCLUSIVE MODE")
            busy = db.execute("""SELECT EXISTS(SELECT FROM ingest.uploads) OR EXISTS(SELECT FROM analysis.jobs)
                OR EXISTS(SELECT FROM ledger.transactions) OR EXISTS(SELECT FROM review.alerts)
                OR EXISTS(SELECT FROM review.episodes)""").fetchone()[0]
            if busy:
                raise SystemExit("REFUSED: business data exists; restore only into a fresh schema")
            db.execute("DELETE FROM core.bank_reporting_periods; DELETE FROM core.banks; DELETE FROM core.users; DELETE FROM core.fx_rates")
            for table, columns in CONFIGURATION.items():
                rows = tables[table]
                if table == "users":
                    # Assignment rotation is business state, never restored as configuration.
                    rows = [dict(row, last_assigned_at=None) for row in rows]
                names = sql.SQL(",").join(map(sql.Identifier, columns.split(",")))
                overriding = sql.SQL(" OVERRIDING SYSTEM VALUE" if table in ("users", "bank_reporting_periods") else "")
                db.execute(sql.SQL("INSERT INTO core.{t}({c}){o} SELECT {c} FROM json_populate_recordset(NULL::core.{t},%s::json)").format(
                    t=sql.Identifier(table), c=names, o=overriding), (json.dumps(rows),))
            for table, column in (("users", "user_id"), ("bank_reporting_periods", "period_id")):
                db.execute(sql.SQL("SELECT setval(pg_get_serial_sequence({t},{c}),coalesce(max({ci}),1),max({ci}) IS NOT NULL) FROM core.{ti}").format(
                    t=sql.Literal("core." + table), c=sql.Literal(column), ci=sql.Identifier(column), ti=sql.Identifier(table)))
        print(json.dumps({table: len(rows) for table, rows in tables.items()}))
    elif ACTION == "grant":
        role = os.environ["ANALYSIS_DB_USERNAME"]
        if not role or role == db.execute("SELECT current_user").fetchone()[0]:
            raise SystemExit("REFUSED: analysis login must differ from the application login")
        with open("/app/worker/analysis_permissions.sql", encoding="utf-8") as stream:
            grants = stream.read()
        with db.transaction():
            db.execute(sql.SQL(grants.replace(':"worker_role"', "{}")).format(*[sql.Identifier(role)] * grants.count(':"worker_role"')))
        protected = db.execute("SELECT has_schema_privilege(%s,'private','USAGE') OR has_schema_privilege(%s,'evaluation','USAGE')",
                               (role, role)).fetchone()[0]
        if protected:
            raise SystemExit("REFUSED: analysis login still reaches protected schemas")
        print("GRANTED")
'''


def load_engine():
    config = json.loads((ROOT / "shared/split.json").read_text(encoding="utf-8"))
    state = json.loads((ROOT / "state/split/dev.json").read_text(encoding="utf-8"))
    current = state.get("current")
    if config.get("role") != "backend" or not current or current.get("color") != "dev":
        raise RuntimeError("Run on the backend EC2 host with a current dev release")
    source = ROOT / "releases/dev" / current["sha"] / "deploy/split/deploy.py"
    spec = importlib.util.spec_from_file_location("aml_deploy", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = module.Deployment("backend", "dev", config["account_id"], root=ROOT)
    # Compose pulls the release image on run; an expired ECR login would refuse it.
    engine.authenticate()
    return engine, current


def inner(engine, meta, action, payload=None, database=DATABASE):
    arguments = base64.b64encode(json.dumps([database, SCHEMAS, CONFIGURATION, action, payload]).encode()).decode()
    script = f"ARGS = {arguments!r}\n" + INNER
    # The release's Compose environment carries DB credentials into the container only.
    return engine.compose(meta, "run", "--rm", "--no-deps", "-T", "--entrypoint",
                          "/usr/local/bin/python", "api", "-", data=script)


def validate_backup(payload):
    if payload.get("format") != 1 or payload.get("database") != DATABASE or set(payload.get("tables", {})) != set(CONFIGURATION):
        raise RuntimeError("Configuration backup belongs to another target or format")
    for table, columns in CONFIGURATION.items():
        rows = payload["tables"][table]
        if not isinstance(rows, list) or any(not isinstance(r, dict) or set(r) != set(columns.split(",")) for r in rows):
            raise RuntimeError("Invalid configuration backup columns")


def write_backup(path, tables):
    payload = {"format": 1, "database": DATABASE, "tables": tables}
    validate_backup(payload)
    # Exclusive creation never overwrites the only recovery copy; it holds password hashes.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        json.dump(payload, output, ensure_ascii=False)
        output.flush()
        os.fsync(output.fileno())
    if json.loads(Path(path).read_text(encoding="utf-8")) != payload:
        raise RuntimeError("Backup read-back failed; nothing was dropped")
    return payload


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--restore-config", metavar="FILE")
    mode.add_argument("--grant-analysis", action="store_true")
    parser.add_argument("--backup-file")
    args = parser.parse_args(argv)
    engine, meta = load_engine()
    if args.restore_config:
        payload = json.loads(Path(args.restore_config).read_text(encoding="utf-8"), parse_float=str)
        validate_backup(payload)
        print("Restored rows:", inner(engine, meta, "restore", payload["tables"]))
        print("Next: --grant-analysis, then log in and set the business clock before uploads.")
        return
    if args.grant_analysis:
        print(inner(engine, meta, "grant"))
        return
    report = json.loads(inner(engine, meta, "inspect"))
    print(json.dumps(report, ensure_ascii=False))
    if report["unexpected_schemas"] or report["unexpected_public_tables"]:
        raise RuntimeError("Unexpected schemas or public tables; review before resetting")
    if not args.apply:
        print("Inspection only. --apply --backup-file FILE stops the dev API, backs up configuration and empties the business schemas.")
        return
    if not args.backup_file:
        raise RuntimeError("--apply requires --backup-file")
    engine.compose(meta, "stop", "api")
    tables = json.loads(inner(engine, meta, "backup"), parse_float=str)
    write_backup(args.backup_file, tables)
    print("Configuration backup verified:", {table: len(rows) for table, rows in tables.items()})
    if inner(engine, meta, "drop").strip() != "EMPTIED":
        raise RuntimeError("Drop did not confirm; the API remains stopped")
    print(f"{DATABASE} business schemas are empty; the dev API remains stopped.")
    print("Next: deploy the new release (it migrates the empty DB), then --restore-config FILE.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        print(f"FAILED: {error}" if isinstance(error, RuntimeError)
              else "FAILED: configuration or tool response is invalid (details hidden)", file=sys.stderr)
        sys.exit(1)
