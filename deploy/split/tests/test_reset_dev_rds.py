"""reset_dev_rds: host-side backup handling, and the in-container SQL against real PostgreSQL 17."""
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
import unittest
import unittest.mock
from contextlib import redirect_stdout
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
spec = importlib.util.spec_from_file_location("reset_dev_rds", ROOT / "reset_dev_rds.py")
reset = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reset)
MIGRATION = REPO / "backend/api-server/src/main/resources/db/migration/V1__initial_schema.sql"
GRANTS = REPO / "backend/api-server/worker/analysis_permissions.sql"


def tables(users=1):
    return {"users": [dict(user_id=1, username="admin", name="관리자", role="ADMIN", password_hash="hash",
                           last_assigned_at=None, created_at="2026-10-13T00:00:00+00:00")][:users],
            "banks": [], "bank_reporting_periods": [], "fx_rates": []}


class BackupFileTests(unittest.TestCase):
    def test_backup_is_exclusive_owner_only_and_validated(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "config.json"
            reset.write_backup(path, tables())
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["database"], "aml_dev_v3")
            if os.name == "posix":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                reset.write_backup(path, tables())

    def test_apply_stops_api_and_backs_up_before_dropping(self):
        calls = []

        class Engine:
            def compose(self, meta, *arguments, data=None):
                calls.append(arguments[0] if data is None else "inner")
                return ""

        def inner(engine, meta, action, payload=None):
            calls.append(action)
            if action == "inspect":
                return json.dumps(dict(unexpected_schemas=[], unexpected_public_tables=[]))
            return json.dumps(tables()) if action == "backup" else "EMPTIED"

        with tempfile.TemporaryDirectory() as folder, \
                unittest.mock.patch.object(reset, "load_engine", return_value=(Engine(), {})), \
                unittest.mock.patch.object(reset, "inner", side_effect=inner), redirect_stdout(io.StringIO()):
            path = Path(folder) / "config.json"
            reset.main(["--apply", "--backup-file", str(path)])
            self.assertTrue(path.is_file())
        self.assertEqual(calls, ["inspect", "stop", "backup", "drop"])

    def test_inspection_alone_changes_nothing(self):
        actions = []
        with unittest.mock.patch.object(reset, "load_engine", return_value=(object(), {})), \
                unittest.mock.patch.object(reset, "inner", side_effect=lambda e, m, action, p=None: actions.append(action) or
                                           json.dumps(dict(unexpected_schemas=[], unexpected_public_tables=[]))), \
                redirect_stdout(io.StringIO()):
            reset.main([])
        self.assertEqual(actions, ["inspect"])

    def test_other_target_or_columns_are_rejected(self):
        for payload in (dict(format=1, database="aml_prod", tables=tables()),
                        dict(format=1, database="aml_dev_v3", tables=dict(tables(), users=[{"user_id": 1}]))):
            with self.subTest(payload=payload["database"]), self.assertRaises(RuntimeError):
                reset.validate_backup(payload)


@unittest.skipUnless(os.environ.get("AML_TEST_DOCKER"), "AML_TEST_DOCKER is required")
class InnerSqlTests(unittest.TestCase):
    """Runs the exact in-container script; only the RDS host and grants path are swapped for the fixture."""

    @classmethod
    def setUpClass(cls):
        import psycopg
        cls.psycopg = psycopg
        docker = os.environ["AML_TEST_DOCKER"]
        cls.container = "aml-reset-rds-test-" + uuid4().hex[:10]
        password = secrets.token_urlsafe(24)
        subprocess.run([docker, "run", "--detach", "--rm", "--name", cls.container, "--publish", "127.0.0.1::5432",
                        "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_DB=aml_dev_v3", "postgres:17-alpine"],
                       env=dict(os.environ, POSTGRES_PASSWORD=password), check=True, capture_output=True, timeout=60)
        cls.addClassCleanup(subprocess.run, [docker, "rm", "--force", "--volumes", cls.container],
                            capture_output=True, timeout=60)
        ports = json.loads(subprocess.run([docker, "inspect", "--format", "{{json .NetworkSettings.Ports}}", cls.container],
                                          check=True, capture_output=True, text=True).stdout)
        port = ports["5432/tcp"][0]["HostPort"]
        cls.args = dict(host="127.0.0.1", port=port, dbname="aml_dev_v3", user="postgres", password=password,
                        autocommit=True, connect_timeout=2)
        deadline = time.monotonic() + 30
        while True:
            try:
                cls.admin = psycopg.connect(**cls.args)
                break
            except psycopg.OperationalError:
                if time.monotonic() > deadline:
                    raise
                time.sleep(0.25)
        cls.addClassCleanup(cls.admin.close)
        cls.env = dict(SPRING_PROFILES_ACTIVE="dev", SPRING_DATASOURCE_URL=f"jdbc:postgresql://127.0.0.1:{port}/aml_dev_v3",
                       SPRING_DATASOURCE_USERNAME="postgres", SPRING_DATASOURCE_PASSWORD=password,
                       ANALYSIS_DB_USERNAME="aml_dev_analysis")

    def migrate(self):
        with self.admin.transaction():
            self.admin.execute(MIGRATION.read_text(encoding="utf-8-sig"))
            self.admin.execute("CREATE TABLE public.flyway_schema_history(installed_rank int, version text, success bool)")
            self.admin.execute("INSERT INTO public.flyway_schema_history VALUES(1,'1',true)")

    def run_inner(self, action, payload=None, database=reset.DATABASE):
        source = reset.INNER.replace('.endswith(".rds.amazonaws.com")', '== "127.0.0.1"').replace(
            "/app/worker/analysis_permissions.sql", GRANTS.as_posix())
        arguments = base64.b64encode(json.dumps([database, reset.SCHEMAS, reset.CONFIGURATION, action, payload]).encode()).decode()
        output = io.StringIO()
        saved = dict(os.environ)
        os.environ.update(self.env)
        try:
            with redirect_stdout(output):
                exec(compile(f"ARGS = {arguments!r}\n" + source, "inner", "exec"), {"__name__": "inner"})
        finally:
            os.environ.clear()
            os.environ.update(saved)
        return output.getvalue().strip()

    def test_backup_drop_migrate_restore_grant(self):
        self.migrate()
        self.admin.execute("UPDATE core.users SET password_hash='kept-hash' WHERE username='admin'")
        self.admin.execute("INSERT INTO core.banks(bank_id,name,is_reporting) VALUES(12,'Germany Bank #12',true)")
        self.admin.execute("INSERT INTO core.bank_reporting_periods(bank_id,effective_from_date) VALUES(12,'2023-08-31')")
        report = json.loads(self.run_inner("inspect"))
        self.assertEqual(report["unexpected_schemas"], [])
        self.assertEqual(report["flyway_versions"], ["1"])
        saved = json.loads(self.run_inner("backup"), parse_float=str)
        self.assertEqual(len(saved["banks"]), 1)
        self.assertEqual(self.run_inner("drop"), "EMPTIED")
        self.assertIsNone(self.admin.execute("SELECT to_regclass('core.users')").fetchone()[0])
        self.assertIsNone(self.admin.execute("SELECT to_regclass('public.flyway_schema_history')").fetchone()[0])
        self.migrate()
        counts = json.loads(self.run_inner("restore", saved))
        self.assertEqual(counts["banks"], 1)
        self.assertEqual(self.admin.execute("SELECT password_hash FROM core.users WHERE username='admin'").fetchone()[0], "kept-hash")
        self.assertEqual(self.admin.execute("SELECT name FROM core.banks").fetchone()[0], "Germany Bank #12")
        self.admin.execute("CREATE ROLE aml_dev_analysis LOGIN")
        self.assertEqual(self.run_inner("grant"), "GRANTED")
        self.assertTrue(self.admin.execute("SELECT has_table_privilege('aml_dev_analysis','analysis.jobs','SELECT')").fetchone()[0])
        self.assertFalse(self.admin.execute("SELECT has_schema_privilege('aml_dev_analysis','private','USAGE')").fetchone()[0])
        # Dropping with an unknown schema present is refused and leaves everything in place.
        self.admin.execute("CREATE SCHEMA stray")
        with self.assertRaises(SystemExit):
            self.run_inner("drop")
        self.assertIsNotNone(self.admin.execute("SELECT to_regclass('core.users')").fetchone()[0])

    def test_prod_wipe_drops_every_schema_and_refuses_dev(self):
        with self.assertRaises(SystemExit):
            self.run_inner("wipe")
        self.admin.execute("DROP DATABASE IF EXISTS aml_prod")
        self.admin.execute("CREATE DATABASE aml_prod")
        prod = self.psycopg.connect(**dict(self.args, dbname="aml_prod"))
        self.addCleanup(prod.close)
        prod.execute("CREATE SCHEMA old_core; CREATE TABLE old_core.t(id int); CREATE TABLE public.legacy(id int)")
        prod.execute("CREATE TABLE public.flyway_schema_history(installed_rank int, version text, success bool)")
        prod.execute("INSERT INTO public.flyway_schema_history VALUES(1,'17',true)")
        saved = self.env
        self.env = dict(saved, SPRING_PROFILES_ACTIVE="prod",
                        SPRING_DATASOURCE_URL=saved["SPRING_DATASOURCE_URL"].replace("aml_dev_v3", "aml_prod"))
        try:
            self.assertEqual(self.run_inner("wipe", database="aml_prod"), "EMPTIED")
        finally:
            self.env = saved
        left = prod.execute("""SELECT count(*) FROM pg_namespace WHERE nspname !~ '^pg_'
            AND nspname NOT IN ('information_schema','public')""").fetchone()[0]
        self.assertEqual(left, 0)
        self.assertEqual(prod.execute("SELECT count(*) FROM pg_tables WHERE schemaname='public'").fetchone()[0], 0)

    def test_wrong_database_is_refused(self):
        self.env = dict(self.env, SPRING_DATASOURCE_URL=self.env["SPRING_DATASOURCE_URL"].replace("aml_dev_v3", "aml_prod"))
        with self.assertRaises(SystemExit):
            self.run_inner("inspect")


if __name__ == "__main__":
    unittest.main()
