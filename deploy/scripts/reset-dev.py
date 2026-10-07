#!/usr/bin/env python3
"""One-off EC2 dev reset. Default: inspect only. --apply: destructive named targets only.

Run on the existing EC2 host while GitHub deployment and bank uploads are idle.
Requires existing aws CLI, Docker, Python 3; does not install or grant permissions.
Keeps Docker volumes, DB roles, other databases, and all other S3 prefixes.
"""

import argparse
import base64
import json
import os
import re
import secrets
import subprocess
import sys
from pathlib import Path

REGION = "ap-northeast-2"
BUCKET = "aml-archive-s3"
PREFIX = "dev/db-v3/"
DATABASE = "aml_dev_v3"  # Reuse the active DB; never create another versioned DB.
DB_USER = "aml_dev_app"
API = "aml-dev-api-1"
POSTGRES = "aml-dev-postgres-1"
KEY_NAMES = (
    "/aml/dev/ingest/encryption-key",
    "/aml/dev/ingest/search-key",
    "/aml/dev/ingest/key-version",
)


def run(args, stdin=None):
    result = subprocess.run(args, input=stdin, text=True, capture_output=True, check=False)
    if result.returncode:
        # Do not print raw AWS, Docker, or SQL output: it may contain credentials.
        code = re.search(r"An error occurred \(([A-Za-z0-9_.-]{1,80})\)", result.stderr)
        detail = f" AWS error={code.group(1)}." if code else f" Exit code={result.returncode}."
        raise RuntimeError(f"Command failed: {' '.join(args[:3])}.{detail} Check permissions/configuration.")
    return result.stdout


def aws(*args, body=None):
    command = ["aws", *args, "--region", REGION, "--output", "json", "--no-cli-pager"]
    if body is not None:
        command += ["--cli-input-json", "file:///dev/stdin"]
    return json.loads(run(command, json.dumps(body) if body is not None else None) or "{}")


def inspect(name, service):
    items = json.loads(run(["docker", "inspect", name]))
    if len(items) != 1:
        raise RuntimeError("Unexpected container inventory")
    config = items[0]["Config"]
    labels = config.get("Labels") or {}
    if labels.get("com.docker.compose.project") != "aml-dev" or labels.get(
        "com.docker.compose.service"
    ) != service:
        raise RuntimeError("Container is outside the approved dev project")
    return dict(item.split("=", 1) for item in config.get("Env", []) if "=" in item)


def check_scope(api_env, postgres_env, parameters):
    expected_url = "jdbc:postgresql://postgres:5432/aml_dev_v3"
    if api_env.get("SPRING_PROFILES_ACTIVE") != "dev":
        raise RuntimeError("Expected exactly the dev profile")
    if api_env.get("SPRING_DATASOURCE_URL") != expected_url:
        raise RuntimeError("Unexpected API DB target")
    if (api_env.get("S3_BUCKET"), api_env.get("S3_PREFIX")) != (BUCKET, PREFIX):
        raise RuntimeError("Unexpected API S3 target")
    if postgres_env.get("POSTGRES_USER") != DB_USER or postgres_env.get("POSTGRES_DB") not in ("aml_dev", DATABASE):
        raise RuntimeError("Unexpected PostgreSQL configuration")
    expected = {"/aml/dev/db/url": expected_url, "/aml/dev/s3/bucket": BUCKET,
                "/aml/dev/s3/prefix": PREFIX}
    if any(parameters.get(name) != value for name, value in expected.items()):
        raise RuntimeError("Parameter Store differs from the approved runtime targets")


def object_versions():
    listing = aws("s3api", "list-object-versions", "--bucket", BUCKET, "--prefix", PREFIX)
    # AWS CLI automatically paginates; never use --no-paginate here.
    objects = []
    for item in listing.get("Versions", []) + listing.get("DeleteMarkers", []):
        key = item["Key"]
        if not key.startswith(PREFIX):
            raise RuntimeError("S3 returned an object outside the approved prefix")
        objects.append({"Key": key, "VersionId": item["VersionId"]})
    return objects


def psql(sql, database="postgres"):
    return run(["docker", "exec", "-i", POSTGRES, "psql", "-X", "-U", DB_USER,
                "-d", database, "-v", "ON_ERROR_STOP=1", "-At", "-q"], sql)


CONFIGURATION = {
    "users": "user_id,username,name,role,password_hash,last_assigned_at,created_at",
    "banks": "bank_id,name,country,is_reporting,report_format,created_at,updated_at",
    "bank_reporting_periods": "period_id,bank_id,effective_from_date,effective_to_date",
    "fx_rates": "fx_rate_version,currency,units_per_usd",
}


def configuration_backup(path):
    schema = psql("SELECT CASE WHEN to_regclass('core.users') IS NOT NULL THEN 'core' ELSE 'public' END;", DATABASE).strip()
    if schema not in ("core", "public"):
        raise RuntimeError("Unknown configuration schema")
    # A single SELECT gives all four configuration tables one MVCC snapshot.
    pairs = [f"'{table}',(SELECT coalesce(json_agg(t),'[]'::json) FROM (SELECT {columns} FROM {schema}.{table}) t)"
             for table, columns in CONFIGURATION.items()]
    # Preserve NUMERIC exchange rates exactly; binary floating point can lose digits.
    tables = json.loads(psql("SELECT json_build_object(" + ",".join(pairs) + ");", DATABASE), parse_float=str)
    payload = {"format": 1, "database": DATABASE, "tables": tables}
    validate_backup(payload)
    # Exclusive creation prevents overwriting the only recovery copy on a retry.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        json.dump(payload, output, ensure_ascii=False)
        output.flush()
        os.fsync(output.fileno())
    if json.loads(Path(path).read_text(encoding="utf-8")) != payload:
        raise RuntimeError("Configuration backup read-back failed; DB was not reset")


def validate_backup(payload):
    if payload.get("format") != 1 or payload.get("database") != DATABASE:
        raise RuntimeError("Configuration backup belongs to another target/format")
    tables = payload.get("tables", {})
    if set(tables) != set(CONFIGURATION):
        raise RuntimeError("Incomplete configuration backup")
    for table, columns in CONFIGURATION.items():
        if not isinstance(tables[table], list) or any(not isinstance(row, dict) or set(row) != set(columns.split(',')) for row in tables[table]):
            raise RuntimeError("Invalid configuration backup columns")


def restore_configuration(path):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    validate_backup(payload)
    sql = ["BEGIN;", "LOCK TABLE core.users,core.banks,core.bank_reporting_periods,core.fx_rates IN ACCESS EXCLUSIVE MODE;",
           "DO $$ BEGIN IF EXISTS(SELECT FROM ingest.uploads) OR EXISTS(SELECT FROM analysis.jobs) OR EXISTS(SELECT FROM ledger.transactions) OR EXISTS(SELECT FROM review.alerts) OR EXISTS(SELECT FROM review.episodes) THEN RAISE EXCEPTION 'RESTORE_REQUIRES_EMPTY_BUSINESS_DATA'; END IF; END $$;",
           "DELETE FROM core.bank_reporting_periods; DELETE FROM core.banks; DELETE FROM core.users; DELETE FROM core.fx_rates;"]
    for table, columns in CONFIGURATION.items():
        data = json.dumps(payload["tables"][table], ensure_ascii=False).replace("'", "''")
        overriding = " OVERRIDING SYSTEM VALUE" if table in ("users", "bank_reporting_periods") else ""
        sql.append(f"INSERT INTO core.{table}({columns}){overriding} SELECT {columns} FROM json_populate_recordset(NULL::core.{table},'{data}'::json);")
    for table, column in (("users", "user_id"), ("bank_reporting_periods", "period_id")):
        sql.append(f"SELECT setval(pg_get_serial_sequence('core.{table}','{column}'),coalesce(max({column}),1),max({column}) IS NOT NULL) FROM core.{table};")
    sql.append("COMMIT;")
    psql("\n".join(sql), DATABASE)
    print("Configuration restored atomically; backup retained. No secret values were printed.")


def read_parameters(names):
    response = aws("ssm", "get-parameters", "--names", *names, "--with-decryption")
    return {item["Name"]: item for item in response.get("Parameters", [])}


def ensure_keys():
    existing = read_parameters(KEY_NAMES)
    values = {name: item["Value"] for name, item in existing.items()}
    for name in KEY_NAMES[:2]:
        if name in existing and existing[name]["Type"] != "SecureString":
            raise RuntimeError("Existing protection keys must be SecureString; no key was replaced")
        if name not in values:
            values[name] = base64.b64encode(secrets.token_bytes(32)).decode("ascii")
        try:
            if len(base64.b64decode(values[name], validate=True)) != 32:
                raise ValueError()
        except ValueError:
            raise RuntimeError("Invalid existing protection key; no key was replaced") from None
    if base64.b64decode(values[KEY_NAMES[0]]) == base64.b64decode(values[KEY_NAMES[1]]):
        raise RuntimeError("Protection keys must differ")
    values.setdefault(KEY_NAMES[2], "dev-v1")
    if not values[KEY_NAMES[2]].strip():
        raise RuntimeError("Key version must not be empty")
    for name in KEY_NAMES:
        if name not in existing:
            aws("ssm", "put-parameter", body={
                "Name": name, "Value": values[name], "Type": "SecureString", "Overwrite": False
            })
    verified = read_parameters(KEY_NAMES)
    if any(verified.get(name, {}).get("Value") != values[name] for name in KEY_NAMES):
        raise RuntimeError("Protection key read-back failed")
    print("Protection parameters ready; existing keys were retained and values were not printed.")


def reset(backup_file, *, db_only=False):
    run(["docker", "stop", API])
    stopped = json.loads(run(["docker", "inspect", API]))[0]["State"]
    if stopped["Running"]:
        raise RuntimeError("API must be stopped before resetting")
    configuration_backup(backup_file)
    # Re-read after stopping uploads; external upload/deployment clients must also be idle.
    objects = [] if db_only else object_versions()
    for offset in range(0, len(objects), 1000):
        response = aws("s3api", "delete-objects", body={
            "Bucket": BUCKET, "Delete": {"Objects": objects[offset:offset + 1000], "Quiet": True}
        })
        if response.get("Errors"):
            raise RuntimeError("Some S3 versions could not be deleted; API remains stopped")
    if not db_only and object_versions():
        raise RuntimeError("S3 prefix is not empty; API remains stopped")
    psql(f'DROP DATABASE "{DATABASE}" WITH (FORCE);\n'
         f'CREATE DATABASE "{DATABASE}" OWNER "{DB_USER}" TEMPLATE template0;\n')
    storage = "S3 was not accessed or changed" if db_only else "named S3 prefix empty"
    print(f"Reset complete: only {DATABASE} is empty; configuration backup verified; {storage}.")
    print("API is stopped. Apply the new initial migration, restore configuration with --restore-config, then enable uploads/analysis.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="delete the displayed dev targets")
    mode.add_argument("--prepare-keys", action="store_true", help="prepare protection keys without deleting data")
    mode.add_argument("--restore-config", metavar="FILE", help="restore configuration after the initial migration")
    parser.add_argument("--backup-file", help="required exclusive configuration backup path for --apply")
    parser.add_argument("--db-only", action="store_true",
                        help="inspect/reset only the DB; no S3 access or protection key creation")
    args = parser.parse_args(argv)
    if os.name != "posix":
        raise RuntimeError("Run this script on the EC2 Linux host")
    api_env = inspect(API, "api")
    postgres_env = inspect(POSTGRES, "postgres")
    names = ("/aml/dev/db/url", "/aml/dev/s3/bucket", "/aml/dev/s3/prefix")
    parameters = {name: item["Value"] for name, item in read_parameters(names).items()}
    check_scope(api_env, postgres_env, parameters)
    if args.restore_config:
        restore_configuration(args.restore_config)
        return
    # Key provisioning must not depend on S3 version-list/delete or database access.
    if args.prepare_keys:
        ensure_keys()
        return
    psql("SELECT current_user;\n")
    objects = [] if args.db_only else object_versions()
    print(f"DB target: {DATABASE}; user: {DB_USER}; configuration is preserved")
    if args.db_only:
        print("DB-only mode: S3 is not accessed; existing protection keys are unchanged.")
    else:
        print(f"S3 target: s3://{BUCKET}/{PREFIX}; object versions/delete markers: {len(objects)}")
    print("Other databases, roles, volumes, S3 prefixes and deployment artifacts are excluded.")
    if not args.apply:
        print("Inspection only. --apply with --backup-file stops API, backs up configuration and resets the selected targets.")
        return
    if not args.backup_file:
        raise RuntimeError("--apply requires --backup-file; existing configuration must be backed up")
    # Missing SSM write/KMS permissions fail here, before any data deletion or API stop.
    if not args.db_only:
        ensure_keys()
    reset(args.backup_file, db_only=args.db_only)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        print(f"FAILED: {error}" if isinstance(error, RuntimeError)
              else "FAILED: tool/configuration response is invalid (details hidden)", file=sys.stderr)
        sys.exit(1)
