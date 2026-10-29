#!/usr/bin/env python3
"""Empty the unused production business DB (RDS aml_prod) and give it dev's configuration.

The user approved deleting aml_prod without a backup (2026-10-29). Run with sudo on the backend
EC2 host from a dev release folder, which also holds reset_dev_rds.py.
  (no flags)            inspect only: schemas, Flyway versions, row counts
  --apply               stop the current production API and drop every aml_prod schema
  --copy-config-from-dev  after the new production release migrated the empty DB: copy dev's
                        users, banks, reporting periods and FX rates, then grant the analysis login

SQL runs inside the release API containers through deploy.py's Compose environment, so DB
credentials never reach this process, its arguments or output. aml_dev_v3 is only read.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

import reset_dev_rds as dev

DATABASE = "aml_prod"


def load_engine(environment):
    config = json.loads((dev.ROOT / "shared/split.json").read_text(encoding="utf-8"))
    state = json.loads((dev.ROOT / f"state/split/{environment}.json").read_text(encoding="utf-8"))
    current = state.get("current")
    if config.get("role") != "backend" or not current:
        raise RuntimeError(f"Run on the backend EC2 host with a current {environment} release")
    source = dev.ROOT / "releases" / environment / current["sha"] / "deploy/split/deploy.py"
    spec = importlib.util.spec_from_file_location(f"aml_deploy_{environment}", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = module.Deployment("backend", environment, config["account_id"], root=dev.ROOT)
    # Compose pulls the release image on run; an expired ECR login would refuse it.
    engine.authenticate()
    return engine, current


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--copy-config-from-dev", action="store_true")
    args = parser.parse_args(argv)
    engine, meta = load_engine("prod")
    if args.copy_config_from_dev:
        dev_engine, dev_meta = load_engine("dev")
        tables = json.loads(dev.inner(dev_engine, dev_meta, "backup"), parse_float=str)
        dev.validate_backup({"format": 1, "database": dev.DATABASE, "tables": tables})
        print("Restored rows:", dev.inner(engine, meta, "restore", tables, database=DATABASE))
        print(dev.inner(engine, meta, "grant", database=DATABASE))
        print("Next: log in, then set the business clock in the control panel before uploads.")
        return
    print(dev.inner(engine, meta, "inspect", database=DATABASE))
    if not args.apply:
        print("Inspection only. --apply stops the production API and drops every aml_prod schema.")
        return
    engine.compose(meta, "stop", "api")
    if dev.inner(engine, meta, "wipe", database=DATABASE).strip() != "EMPTIED":
        raise RuntimeError("Wipe did not confirm; the production API remains stopped")
    print(f"{DATABASE} is empty; the production API remains stopped.")
    print("Next: deploy the new production release (it migrates the empty DB), then --copy-config-from-dev.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        print(f"FAILED: {error}" if isinstance(error, RuntimeError)
              else "FAILED: configuration or tool response is invalid (details hidden)", file=sys.stderr)
        sys.exit(1)
