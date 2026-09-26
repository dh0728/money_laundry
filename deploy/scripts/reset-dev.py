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

REGION = "ap-northeast-2"
BUCKET = "aml-archive-s3"
PREFIX = "dev/db-v3/"
DATABASES = ("aml_dev", "aml_dev_v3")
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
    if postgres_env.get("POSTGRES_USER") != DB_USER or postgres_env.get("POSTGRES_DB") not in DATABASES:
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


def psql(sql):
    return run(["docker", "exec", "-i", POSTGRES, "psql", "-X", "-U", DB_USER,
                "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], sql)


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


def reset():
    run(["docker", "stop", API])
    stopped = json.loads(run(["docker", "inspect", API]))[0]["State"]
    if stopped["Running"]:
        raise RuntimeError("API must be stopped before resetting")
    # Re-read after stopping uploads; external upload/deployment clients must also be idle.
    objects = object_versions()
    for offset in range(0, len(objects), 1000):
        response = aws("s3api", "delete-objects", body={
            "Bucket": BUCKET, "Delete": {"Objects": objects[offset:offset + 1000], "Quiet": True}
        })
        if response.get("Errors"):
            raise RuntimeError("Some S3 versions could not be deleted; API remains stopped")
    if object_versions():
        raise RuntimeError("S3 prefix is not empty; API remains stopped")
    for database in DATABASES:
        # All SQL identifiers are fixed constants, never arbitrary user input.
        psql(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE);\n'
             f'CREATE DATABASE "{database}" OWNER "{DB_USER}" TEMPLATE template0;\n')
    print("Reset complete: aml_dev and aml_dev_v3 are empty; the named S3 prefix is empty.")
    print("API is stopped. Deploy the updated Compose, deploy script, and backend together.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="delete the displayed dev targets")
    mode.add_argument("--prepare-keys", action="store_true", help="prepare protection keys without deleting data")
    args = parser.parse_args(argv)
    if os.name != "posix":
        raise RuntimeError("Run this script on the EC2 Linux host")
    api_env = inspect(API, "api")
    postgres_env = inspect(POSTGRES, "postgres")
    names = ("/aml/dev/db/url", "/aml/dev/s3/bucket", "/aml/dev/s3/prefix")
    parameters = {name: item["Value"] for name, item in read_parameters(names).items()}
    check_scope(api_env, postgres_env, parameters)
    # Key provisioning must not depend on S3 version-list/delete or database access.
    if args.prepare_keys:
        ensure_keys()
        return
    psql("SELECT current_user;\n")
    objects = object_versions()
    print(f"DB targets: {', '.join(DATABASES)}; user: {DB_USER}")
    print(f"S3 target: s3://{BUCKET}/{PREFIX}; object versions/delete markers: {len(objects)}")
    print("Other databases, roles, volumes, S3 prefixes and deployment artifacts are excluded.")
    if not args.apply:
        print("Inspection only. --apply creates missing protection keys, stops API and deletes these targets.")
        return
    # Missing SSM write/KMS permissions fail here, before any data deletion or API stop.
    ensure_keys()
    reset()


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        print(f"FAILED: {error}" if isinstance(error, RuntimeError)
              else "FAILED: tool/configuration response is invalid (details hidden)", file=sys.stderr)
        sys.exit(1)
