"""Opt-in PostgreSQL 17 integration tests using an isolated disposable container.

Set AML_TEST_DOCKER to the existing Docker executable. No external DB is accepted.
The repository's V1-V4 SQL is applied directly; this is not a Flyway runner test.
"""
import io
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
import unittest
from uuid import uuid4
from unittest.mock import patch

import pyarrow.parquet as pq

from frozen_input import FrozenInput, InputExecution, StaleExecution, write_demo_input
from worker_transport import ProtocolError
from pipeline import prepare_features


@unittest.skipUnless(os.environ.get("AML_TEST_DOCKER"), "AML_TEST_DOCKER is required")
class FrozenInputPostgresTests(unittest.TestCase):
    @classmethod
    def docker(cls, *args, env=None):
        result = subprocess.run([os.environ["AML_TEST_DOCKER"], *args],
                                capture_output=True, text=True, env=env, timeout=45)
        if result.returncode:
            raise RuntimeError(f"Test Docker command failed: {args[0]}")
        return result.stdout.strip()

    @classmethod
    def setUpClass(cls):
        import psycopg
        cls.psycopg = psycopg
        cls.container = "aml-frozen-input-test-" + uuid4().hex[:12]
        password = secrets.token_urlsafe(24)
        env = dict(os.environ, POSTGRES_PASSWORD=password)
        cls.docker("run", "--detach", "--rm", "--name", cls.container,
                   "--label", "aml.test=frozen-input", "--publish", "127.0.0.1::5432",
                   "--env", "POSTGRES_PASSWORD", "postgres:17-alpine", env=env)
        cls.addClassCleanup(cls.docker, "rm", "--force", "--volumes", cls.container)
        ports = json.loads(cls.docker("inspect", "--format",
                                     '{{json .NetworkSettings.Ports}}', cls.container))
        cls.connect_args = dict(host="127.0.0.1", port=ports["5432/tcp"][0]["HostPort"],
                                dbname="postgres", user="postgres", password=password,
                                autocommit=True, connect_timeout=2)
        deadline = time.monotonic() + 30
        while True:
            try:
                cls.admin = psycopg.connect(**cls.connect_args)
                break
            except psycopg.OperationalError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("Test PostgreSQL did not become ready") from None
                time.sleep(0.25)
        cls.addClassCleanup(cls.admin.close)
        migrations = Path(__file__).resolve().parents[1] / "src/main/resources/db/migration"
        for version in range(1, 5):
            files = list(migrations.glob(f"V{version}__*.sql"))
            if len(files) != 1:
                raise RuntimeError("Expected exactly one migration per version")
            with cls.admin.transaction():
                cls.admin.execute(files[0].read_text(encoding="utf-8-sig"))
        cls.admin.execute("CREATE ROLE input_reader")
        cls.admin.execute("GRANT USAGE ON SCHEMA public, analysis TO input_reader")
        cls.admin.execute("GRANT SELECT ON batch_jobs, analysis_runs, "
                          "analysis.input_transactions TO input_reader")

    def setUp(self):
        self.reader = self.psycopg.connect(**self.connect_args)
        self.addCleanup(self.reader.close)
        self.reader.execute("SET ROLE input_reader")
        self.token, self.run = uuid4(), uuid4()
        self.job = self.admin.execute("""
            INSERT INTO batch_jobs(job_type,status,current_stage,execution_id)
            VALUES('ANALYSIS','RUNNING','FEATURES',%s) RETURNING job_id
            """, (self.token,)).fetchone()[0]
        self.admin.execute("INSERT INTO analysis_runs(run_id,job_id,status) VALUES(%s,%s,'READY')",
                           (self.run, self.job))
        self.admin.execute("UPDATE batch_jobs SET current_run_id=%s WHERE job_id=%s",
                           (self.run, self.job))
        self.execution = InputExecution(self.job, self.run, self.token)
        self.source = FrozenInput(self.reader, self.execution, batch_size=2)
        self.admin.execute("INSERT INTO banks(bank_id) VALUES(12) ON CONFLICT DO NOTHING")
        entity = self.admin.execute("""
            INSERT INTO private.entities(service_entity_id,entity_lookup_token,
                identity_cipher,name_cipher,key_version) VALUES(%s,%s,'test','test','test')
            RETURNING entity_id
            """, (uuid4(), uuid4().hex)).fetchone()[0]
        account = self.admin.execute("""
            INSERT INTO private.accounts(bank_id,service_account_id,account_lookup_token,
                entity_id,identity_cipher,key_version) VALUES(12,%s,%s,%s,'test','test')
            RETURNING account_id
            """, (uuid4(), uuid4().hex, entity)).fetchone()[0]
        self.ids = []
        for role in ("TARGET", "TARGET", "TARGET", "CONTEXT"):
            tx = self.admin.execute("""
                INSERT INTO transactions(occurred_at,from_account_id,to_account_id,
                  amount_received,receiving_currency,amount_paid,payment_currency,
                  payment_format,amount_usd,fx_rate_version,business_date)
                VALUES(now(),%s,%s,1,'USD',1,'USD','ACH',1,'test','2022-09-01') RETURNING tx_id
                """, (account, account)).fetchone()[0]
            self.admin.execute("""
                INSERT INTO analysis.input_transactions(run_id,tx_id,input_role,occurred_at,
                  business_date,from_bank_id,to_bank_id,from_account_id,to_account_id,
                  from_entity_id,to_entity_id,amount_received,receiving_currency,
                  amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version)
                VALUES(%s,%s,%s,now(),'2022-09-01',12,12,%s,%s,%s,%s,1,'USD',1,'USD','ACH',1,'test')
                """, (self.run, tx, role, uuid4(), uuid4(), uuid4(), uuid4()))
            if role == "TARGET":
                self.ids.append(tx)

    def test_real_schema_pagination_and_private_data_access_denied(self):
        output = io.BytesIO()
        self.assertEqual(write_demo_input(self.source, output), 3)
        table = pq.read_table(io.BytesIO(output.getvalue()))
        self.assertEqual(table.column_names, ["tx_id", "demo_value"])
        self.assertEqual(table.column("tx_id").to_pylist(), self.ids)
        with self.assertRaises(self.psycopg.errors.InsufficientPrivilege):
            self.reader.execute("SELECT * FROM private.accounts")
        with self.assertRaises(self.psycopg.errors.InsufficientPrivilege):
            self.reader.execute("SELECT * FROM evaluation.transaction_labels")
        self.assertEqual(self.reader.info.transaction_status,
                         self.psycopg.pq.TransactionStatus.IDLE)

    def test_other_runs_and_context_are_excluded(self):
        other = uuid4()
        self.admin.execute("INSERT INTO analysis_runs(run_id,job_id,status) VALUES(%s,%s,'READY')",
                           (other, self.job))
        self.admin.execute("""
            INSERT INTO analysis.input_transactions
            SELECT %s,tx_id,input_role,occurred_at,business_date,from_bank_id,to_bank_id,
              from_account_id,to_account_id,from_entity_id,to_entity_id,amount_received,
              receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version
            FROM analysis.input_transactions WHERE run_id=%s
            """, (other, self.run))
        ids = [i for batch in self.source.batches() for i in batch.column("tx_id").to_pylist()]
        self.assertEqual(ids, self.ids)

    def test_committed_cancellation_between_pages_is_observed(self):
        batches = self.source.batches()
        self.assertEqual(next(batches).num_rows, 2)
        with self.admin.transaction():
            self.admin.execute("UPDATE analysis_runs SET status='CANCEL_REQUESTED' WHERE run_id=%s",
                               (self.run,))
        with self.assertRaises(StaleExecution):
            next(batches)

    def test_new_execution_token_between_pages_is_observed(self):
        batches = self.source.batches()
        next(batches)
        self.admin.execute("UPDATE batch_jobs SET execution_id=%s WHERE job_id=%s",
                           (uuid4(), self.job))
        with self.assertRaises(StaleExecution):
            next(batches)

    def test_replacement_run_between_pages_is_observed(self):
        batches = self.source.batches()
        next(batches)
        replacement = uuid4()
        self.admin.execute("INSERT INTO analysis_runs(run_id,job_id,status) VALUES(%s,%s,'READY')",
                           (replacement, self.job))
        self.admin.execute("UPDATE batch_jobs SET current_run_id=%s WHERE job_id=%s",
                           (replacement, self.job))
        with self.assertRaises(StaleExecution):
            next(batches)

    def test_final_check_observes_cancellation_after_last_page(self):
        list(self.source.batches())
        self.admin.execute("UPDATE analysis_runs SET status='CANCELLED' WHERE run_id=%s", (self.run,))
        with self.assertRaises(StaleExecution):
            self.source.check_current()

    def test_empty_target_run_creates_no_file(self):
        self.admin.execute("DELETE FROM analysis.input_transactions WHERE run_id=%s AND input_role='TARGET'",
                           (self.run,))
        output = io.BytesIO()
        with self.assertRaisesRegex(ProtocolError, "EMPTY_INPUT"):
            write_demo_input(self.source, output)
        self.assertEqual(output.getvalue(), b"")

    def test_real_cli_persists_checkpoint_and_retry_reuses_input(self):
        import sys
        with tempfile.TemporaryDirectory(prefix="aml-worker-test-") as root:
            env = dict(os.environ, WORKER_MODE="demo", WORKER_STORAGE_DIR=root,
                       WORKER_DB_URL=f"postgresql://127.0.0.1:{self.connect_args['port']}/postgres",
                       WORKER_DB_USER="postgres", WORKER_DB_PASSWORD=self.connect_args["password"])
            command = [sys.executable, "-B", str(Path(__file__).with_name("analysis_entry.py")),
                       "--job-id", str(self.job), "--run-id", str(self.run),
                       "--execution-id", str(self.token), "--stage", "FEATURES"]
            result = subprocess.run(command, env=env, capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout, b"")
            saved = self.admin.execute("SELECT artifact FROM analysis_run_stage_results WHERE run_id=%s",
                                       (self.run,)).fetchone()[0]
            artifact = json.loads(saved)
            self.assertEqual(artifact["row_count"], 3)
            self.assertEqual(pq.read_table(Path(root) / artifact["path"]).column("tx_id").to_pylist(), self.ids)
            new_token = uuid4()
            self.admin.execute("UPDATE batch_jobs SET execution_id=%s WHERE job_id=%s", (new_token, self.job))
            retry = prepare_features(self.admin, InputExecution(self.job, self.run, new_token), root)
            self.assertEqual(retry, saved)
            self.assertEqual(len(list(Path(root).rglob("*.parquet"))), 1)
            self.assertEqual(list(Path(root).rglob("*.partial")), [])

    def test_cancel_before_checkpoint_does_not_complete_stage(self):
        import pipeline
        original_lock = pipeline._lock
        def cancel_then_lock(connection, execution):
            connection.execute("UPDATE analysis_runs SET status='CANCELLED' WHERE run_id=%s", (self.run,))
            original_lock(connection, execution)
        with tempfile.TemporaryDirectory(prefix="aml-worker-test-") as root:
            with patch.object(pipeline, "_lock", side_effect=cancel_then_lock):
                with self.assertRaises(StaleExecution):
                    prepare_features(self.admin, self.execution, root)
            self.assertIsNone(self.admin.execute(
                "SELECT 1 FROM analysis_run_stage_results WHERE run_id=%s", (self.run,)).fetchone())
            self.assertEqual(list(Path(root).rglob("*.partial")), [])

    def test_checkpoint_with_changed_file_cannot_be_reused(self):
        with tempfile.TemporaryDirectory(prefix="aml-worker-test-") as root:
            artifact = json.loads(prepare_features(self.admin, self.execution, root))
            (Path(root) / artifact["path"]).write_bytes(b"changed")
            with self.assertRaisesRegex(ProtocolError, "changed"):
                prepare_features(self.admin, self.execution, root)


if __name__ == "__main__":
    unittest.main()
