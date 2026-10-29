"""Opt-in PostgreSQL 17 integration tests using an isolated disposable container.

Set AML_TEST_DOCKER to the existing Docker executable. No external DB is accepted.
The repository's initial schema is applied directly; this is not a Flyway runner test.
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

from common.frozen_input import FrozenInput, InputExecution, StaleExecution
from models.demo_random.build_input import write_input as write_demo_input
from common.worker_transport import ProtocolError
from features import materials
from features.prepare_features import prepare_features


def input_path(model, name="targets"):
    return next(entry["path"] for entry in model["files"] if entry["name"] == name)


class MemoryS3:
    """Network double; production always uses its configured S3 client."""
    def __init__(self):
        self.objects = {}

    def put_object(self, **args):
        from botocore.exceptions import ClientError
        key = args['Key']
        if key in self.objects and args.get('IfNoneMatch') == '*':
            raise ClientError({'Error': {'Code': 'PreconditionFailed'}}, 'PutObject')
        self.objects[key] = args['Body']

    def get_object(self, **args):
        return {'Body': io.BytesIO(self.objects[args['Key']])}

    def generate_presigned_url(self, method, *, Params, ExpiresIn):
        assert ExpiresIn == 6 * 3600, 'model links must outlive a long inference'
        return 'https://objects.example/' + Params['Key'] + '?signature=not-for-db'


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
        migrations = Path(__file__).resolve().parents[2] / 'src/main/resources/db/migration'
        with cls.admin.transaction():
            for script in sorted(migrations.glob('V*__*.sql'), key=lambda p: int(p.name[1:].split('__')[0])):
                cls.admin.execute(script.read_text(encoding='utf-8-sig'))
        from configure_analysis_db import configure
        cls.worker_user = 'analysis_fixture'
        cls.worker_password = secrets.token_urlsafe(32)
        configure(cls.admin, cls.worker_user, cls.worker_password)
        cls.admin.execute("CREATE ROLE input_reader")
        cls.admin.execute("GRANT USAGE ON SCHEMA core, analysis TO input_reader")
        cls.admin.execute("GRANT SELECT ON analysis.jobs, analysis.runs, "
                          "analysis.input_transactions TO input_reader")

    def setUp(self):
        # These tests play the inference peer with the demo model; v10 binding has its own tests.
        from models import registry
        demo_only = patch.dict(registry.DEFAULTS, BINARY=registry.DEMO_RANDOM)
        demo_only.start()
        self.addCleanup(demo_only.stop)
        self.reader = self.psycopg.connect(**self.connect_args)
        self.addCleanup(self.reader.close)
        self.reader.execute("SET ROLE input_reader")
        self.token, self.run = uuid4(), uuid4()
        self.job = self.admin.execute("""
            INSERT INTO analysis.jobs(analysis_date,business_at,analysis_cutoff_at,threshold_value,status,current_stage,execution_id,execution_owner)
            VALUES(date '2100-01-01'+nextval('core.work_id')::int,now(),now(),.7,'RUNNING','FEATURES',%s,gen_random_uuid()) RETURNING job_id
            """, (self.token,)).fetchone()[0]
        self.admin.execute("INSERT INTO analysis.runs(run_id,job_id,status) VALUES(%s,%s,'READY')",
                           (self.run, self.job))
        self.admin.execute("UPDATE analysis.jobs SET current_run_id=%s WHERE job_id=%s",
                           (self.run, self.job))
        self.execution = InputExecution(self.job, self.run, self.token)
        self.source = FrozenInput(self.reader, self.execution, batch_size=2)
        self.admin.execute("INSERT INTO core.banks(bank_id) VALUES(12) ON CONFLICT DO NOTHING")
        self.admin.execute("UPDATE core.users SET password_hash='test-hash' WHERE username='l1a'")
        entity = self.admin.execute("""
            INSERT INTO core.owners(service_owner_id,display_name) VALUES(%s,%s)
            RETURNING owner_id
            """, (uuid4(), uuid4().hex)).fetchone()[0]
        account = self.admin.execute("""
            INSERT INTO core.accounts(bank_id,service_account_id,owner_id) VALUES(12,%s,%s)
            RETURNING account_id
            """, (uuid4(), entity)).fetchone()[0]
        self.ids = []
        for role in ("TARGET", "TARGET", "TARGET", "CONTEXT"):
            tx = self.admin.execute("""
                INSERT INTO ledger.transactions(occurred_at,from_account_id,to_account_id,
                  amount_received,receiving_currency,amount_paid,payment_currency,
                  payment_format,amount_usd,fx_rate_version,business_date)
                VALUES(now(),%s,%s,1,'USD',1,'USD','ACH',1,'test','2022-09-01') RETURNING tx_id
                """, (account, account)).fetchone()[0]
            self.admin.execute("""
                INSERT INTO analysis.input_transactions(run_id,tx_id,input_role,occurred_at,
                  business_date,from_bank_id,to_bank_id,from_account_id,to_account_id,
                  from_owner_id,to_owner_id,amount_received,receiving_currency,
                  amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version)
                VALUES(%s,%s,%s,now(),'2022-09-01',12,12,%s,%s,%s,%s,1,'USD',1,'USD','ACH',1,'test')
                """, (self.run, tx, role, uuid4(), uuid4(), uuid4(), uuid4()))
            if role == "TARGET":
                self.ids.append(tx)
                self.admin.execute("INSERT INTO analysis.target_ownership VALUES(%s,%s)",(tx,self.run))

    def test_real_schema_pagination_and_private_data_access_denied(self):
        output = io.BytesIO()
        self.assertEqual(write_demo_input(self.source, output), 3)
        table = pq.read_table(io.BytesIO(output.getvalue()))
        self.assertEqual(table.column_names, ["tx_id", "demo_value"])
        self.assertEqual(table.column("tx_id").to_pylist(), self.ids)
        with self.assertRaises(self.psycopg.errors.InsufficientPrivilege):
            self.reader.execute("SELECT * FROM private.account_identities")
        with self.assertRaises(self.psycopg.errors.InsufficientPrivilege):
            self.reader.execute("SELECT * FROM evaluation.transaction_labels")
        # The analysis login reads name-free categories, never pseudonyms or bank names.
        with self.psycopg.connect(**dict(self.connect_args, user=self.worker_user,
                                         password=self.worker_password)) as worker:
            worker.execute("SELECT service_owner_id,entity_type FROM core.owners").fetchall()
            worker.execute("SELECT bank_id,country FROM core.banks").fetchall()
            for statement in ("SELECT display_name FROM core.owners", "SELECT owner_id FROM core.owners",
                              "SELECT name FROM core.banks", "SELECT owner_id FROM core.accounts"):
                with self.subTest(statement=statement), self.assertRaises(self.psycopg.errors.InsufficientPrivilege):
                    worker.execute(statement)
        self.assertEqual(self.reader.info.transaction_status,
                         self.psycopg.pq.TransactionStatus.IDLE)

    def test_other_runs_and_context_are_excluded(self):
        other = uuid4()
        self.admin.execute("INSERT INTO analysis.runs(run_id,job_id,status) VALUES(%s,%s,'READY')",
                           (other, self.job))
        self.admin.execute("""
            INSERT INTO analysis.input_transactions
            SELECT %s,tx_id,input_role,occurred_at,business_date,from_bank_id,to_bank_id,
              from_account_id,to_account_id,from_owner_id,to_owner_id,amount_received,
              receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version
            FROM analysis.input_transactions WHERE run_id=%s
            """, (other, self.run))
        ids = [i for page in self.source.target_pages() for i in page]
        self.assertEqual(ids, self.ids)

    def test_committed_cancellation_between_pages_is_observed(self):
        batches = self.source.target_pages()
        self.assertEqual(len(next(batches)), 2)
        with self.admin.transaction():
            self.admin.execute("UPDATE analysis.runs SET status='CANCEL_REQUESTED' WHERE run_id=%s",
                               (self.run,))
        with self.assertRaises(StaleExecution):
            next(batches)

    def test_new_execution_token_between_pages_is_observed(self):
        batches = self.source.target_pages()
        next(batches)
        self.admin.execute("UPDATE analysis.jobs SET execution_id=%s WHERE job_id=%s",
                           (uuid4(), self.job))
        with self.assertRaises(StaleExecution):
            next(batches)

    def test_replacement_run_between_pages_is_observed(self):
        batches = self.source.target_pages()
        next(batches)
        replacement = uuid4()
        self.admin.execute("INSERT INTO analysis.runs(run_id,job_id,status) VALUES(%s,%s,'READY')",
                           (replacement, self.job))
        self.admin.execute("UPDATE analysis.jobs SET current_run_id=%s WHERE job_id=%s",
                           (replacement, self.job))
        with self.assertRaises(StaleExecution):
            next(batches)

    def test_final_check_observes_cancellation_after_last_page(self):
        list(self.source.target_pages())
        self.admin.execute("UPDATE analysis.runs SET status='CANCELLED' WHERE run_id=%s", (self.run,))
        with self.assertRaises(StaleExecution):
            self.source.check_current()

    def test_empty_target_run_creates_no_file(self):
        self.admin.execute("DELETE FROM analysis.target_ownership WHERE run_id=%s",(self.run,))
        self.admin.execute("DELETE FROM analysis.input_transactions WHERE run_id=%s AND input_role='TARGET'",
                           (self.run,))
        output = io.BytesIO()
        with self.assertRaisesRegex(ProtocolError, "EMPTY_INPUT"):
            write_demo_input(self.source, output)
        self.assertEqual(output.getvalue(), b"")

    def annotate_demo(self, ids):
        upload = self.admin.execute("INSERT INTO ingest.uploads(bank_id,file_name,file_hash,size_bytes,business_date,status) VALUES(12,'fixture.csv',repeat('a',64),1,'2022-09-01','COMPLETED') RETURNING upload_id").fetchone()[0]
        report_set = self.admin.execute("INSERT INTO ingest.report_sets(bank_id,business_date) VALUES(12,'2022-09-01') ON CONFLICT(bank_id,business_date) DO UPDATE SET bank_id=excluded.bank_id RETURNING set_id").fetchone()[0]
        version = self.admin.execute("INSERT INTO ingest.report_versions(set_id,upload_id,version_no,received_at,stage_status) VALUES(%s,%s,%s,now(),'ACTIVE') RETURNING version_id", (report_set, upload, upload)).fetchone()[0]
        for i, tx_id in enumerate(ids):
            report = self.admin.execute("INSERT INTO private.bank_reports(version_id,source_row,match_key,payload_cipher,key_version) VALUES(%s,%s,'test','test','test') RETURNING report_id", (version, i + 2)).fetchone()[0]
            self.admin.execute("INSERT INTO evaluation.report_labels VALUES(%s,%s)", (report, i != 1))

    def test_legacy_hints_do_not_affect_random_input(self):
        from models.demo_random.spec import MODEL_VERSION
        self.annotate_demo(self.ids)
        self.annotate_demo([self.ids[1]])
        with tempfile.TemporaryDirectory(prefix='aml-random-input-') as root:
            result = json.loads(prepare_features(self.admin, self.execution, root))
            for model in result['models'].values():
                self.assertEqual(model['model_version'], MODEL_VERSION)
                self.assertEqual(pq.read_table(Path(root) / input_path(model)).column_names,
                                 ['tx_id', 'demo_value'])
            self.assertEqual(result, json.loads(prepare_features(self.admin, self.execution, root)))
        with self.assertRaises(self.psycopg.errors.InsufficientPrivilege):
            self.reader.execute('SELECT * FROM evaluation.report_labels')

    def test_prepared_legacy_version_is_preserved_on_retry(self):
        from models.demo_random.spec import LEGACY_MODEL_VERSION
        with tempfile.TemporaryDirectory(prefix='aml-random-retry-') as root:
            with patch('models.demo_random.spec.MODEL_VERSION', LEGACY_MODEL_VERSION):
                original = json.loads(prepare_features(self.admin, self.execution, root))
            repeated = json.loads(prepare_features(self.admin, self.execution, root))
            self.assertEqual(original, repeated)
            for model in repeated['models'].values():
                self.assertEqual(model['model_version'], LEGACY_MODEL_VERSION)

    def test_partial_catalog_does_not_block_input_preparation(self):
        self.annotate_demo(self.ids[:1])
        with tempfile.TemporaryDirectory(prefix='aml-random-input-') as root:
            result = json.loads(prepare_features(self.admin, self.execution, root))
            for model in result['models'].values():
                table = pq.read_table(Path(root) / input_path(model))
                self.assertEqual(table['tx_id'].to_pylist(), sorted(self.ids))
                self.assertEqual(table.column_names, ['tx_id', 'demo_value'])

    def test_binary_v10_binding_sends_target_ids_and_records_its_threshold(self):
        from models import registry
        from models.binary_v10 import spec
        with patch.dict(registry.DEFAULTS, BINARY=registry.BINARY_V10), \
                tempfile.TemporaryDirectory(prefix='aml-v10-input-') as root:
            result = json.loads(prepare_features(self.admin, self.execution, root))
            self.assertEqual(set(result['models']), {'BINARY'})
            binary = result['models']['BINARY']
            self.assertEqual((binary['model_version'], binary['feature_version']),
                             (spec.MODEL_VERSION, spec.FEATURE_VERSION))
            table = pq.read_table(Path(root) / input_path(binary))
            self.assertEqual(table.column_names, ['tx_id'])
            self.assertEqual(table['tx_id'].to_pylist(), sorted(self.ids))
            self.assertEqual([f['name'] for f in binary['files']], ['targets', *materials.MATERIALS])
            threshold = self.admin.execute('SELECT threshold_value FROM analysis.jobs WHERE job_id=%s',
                                           (self.job,)).fetchone()[0]
            self.assertAlmostEqual(float(threshold), spec.RECOMMENDED_THRESHOLD, places=6)
            # A resumed run keeps its binding and does not touch the threshold again.
            self.admin.execute('UPDATE analysis.jobs SET threshold_value=.7 WHERE job_id=%s', (self.job,))
            self.assertEqual(json.loads(prepare_features(self.admin, self.execution, root)), result)
            self.assertEqual(float(self.admin.execute('SELECT threshold_value FROM analysis.jobs WHERE job_id=%s',
                                                      (self.job,)).fetchone()[0]), .7)

    def test_real_cli_persists_checkpoint_and_retry_reuses_input(self):
        import sys
        with tempfile.TemporaryDirectory(prefix="aml-worker-test-") as root:
            env = dict(os.environ, WORKER_MODE="demo", WORKER_STORAGE_DIR=root,
                       WORKER_DB_URL=f"postgresql://127.0.0.1:{self.connect_args['port']}/postgres",
                       WORKER_DB_USER=self.worker_user, WORKER_DB_PASSWORD=self.worker_password)
            command = [sys.executable, "-B", str(Path(__file__).resolve().parents[1] / "analysis_entry.py"),
                       "--job-id", str(self.job), "--run-id", str(self.run),
                       "--execution-id", str(self.token), "--stage", "FEATURES"]
            result = subprocess.run(command, env=env, capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout, b"")
            saved = self.admin.execute("SELECT artifact FROM analysis.stage_results WHERE run_id=%s",
                                       (self.run,)).fetchone()[0]
            artifact = json.loads(saved)
            self.assertEqual(artifact["protocol_version"], 2)
            self.assertEqual(set(artifact["models"]), {"BINARY"})
            for kind, model in artifact["models"].items():
                self.assertEqual(model["model_kind"], kind)
                self.assertEqual(model["row_count"], 3)
                self.assertEqual(pq.read_table(Path(root) / input_path(model)).column("tx_id").to_pylist(), self.ids)
                # Every model gets the same materials, read with the analysis login's own grants.
                transactions = pq.read_table(Path(root) / input_path(model, "transactions"))
                self.assertEqual(transactions.schema, materials.TRANSACTIONS)
                self.assertEqual(sorted(transactions.column("input_role").to_pylist()),
                                 ["CONTEXT", "TARGET", "TARGET", "TARGET"])
                accounts = pq.read_table(Path(root) / input_path(model, "accounts"))
                self.assertEqual(accounts.schema, materials.ACCOUNTS)
                self.assertEqual(accounts.num_rows, 8)
            self.assertEqual(self.admin.execute(
                "SELECT count(*) FROM analysis.features WHERE run_id=%s", (self.run,)).fetchone()[0], 3)
            new_token = uuid4()
            self.admin.execute("UPDATE analysis.jobs SET execution_id=%s WHERE job_id=%s", (new_token, self.job))
            retry = prepare_features(self.admin, InputExecution(self.job, self.run, new_token), root)
            self.assertEqual(retry, saved)
            self.assertEqual(len(list(Path(root).rglob("*.parquet"))), 3)
            self.assertEqual(list(Path(root).rglob("*.partial")), [])

    def test_cancel_before_checkpoint_does_not_complete_stage(self):
        from features import prepare_features as pipeline
        original_save = pipeline._save_prepared
        def cancel_then_save(connection, execution, kind, token, document, *stage):
            # Commit on another connection after the file and staging rows exist.
            # Cancelling inside the writer's own transaction would roll back the
            # cancellation itself and would not exercise a real correction race.
            with self.psycopg.connect(**self.connect_args) as other:
                other.execute("UPDATE analysis.runs SET status='CANCELLED' WHERE run_id=%s",
                              (self.run,))
            original_save(connection, execution, kind, token, document, *stage)
        with tempfile.TemporaryDirectory(prefix="aml-worker-test-") as root:
            with patch.object(pipeline, "_save_prepared", side_effect=cancel_then_save):
                with self.assertRaises(StaleExecution):
                    prepare_features(self.admin, self.execution, root)
            self.assertIsNone(self.admin.execute(
                "SELECT 1 FROM analysis.stage_results WHERE run_id=%s", (self.run,)).fetchone())
            self.assertEqual(self.admin.execute(
                "SELECT status FROM analysis.runs WHERE run_id=%s", (self.run,)).fetchone()[0], "CANCELLED")
            self.assertEqual(self.admin.execute(
                "SELECT count(*) FROM analysis.features WHERE run_id=%s", (self.run,)).fetchone()[0], 0)
            self.assertEqual(self.admin.execute(
                "SELECT count(*) FROM analysis.model_tasks WHERE run_id=%s AND input_artifact IS NOT NULL",
                (self.run,)).fetchone()[0], 0)
            self.assertEqual(len(list(Path(root).rglob("*.parquet"))), 3)
            self.assertEqual(list(Path(root).rglob("*.partial")), [])

    def test_replaced_parent_token_cannot_save_an_already_prepared_file(self):
        from features import prepare_features as pipeline
        original_save = pipeline._save_prepared
        new_token = uuid4()
        def replace_then_save(connection, execution, kind, token, document, *stage):
            with self.psycopg.connect(**self.connect_args) as other:
                other.execute("UPDATE analysis.jobs SET execution_id=%s WHERE job_id=%s",
                              (new_token, self.job))
            original_save(connection, execution, kind, token, document, *stage)
        with tempfile.TemporaryDirectory(prefix="aml-worker-test-") as root:
            with patch.object(pipeline, "_save_prepared", side_effect=replace_then_save):
                with self.assertRaises(StaleExecution):
                    prepare_features(self.admin, self.execution, root)
            self.assertEqual(self.admin.execute(
                "SELECT count(*) FROM analysis.features WHERE run_id=%s", (self.run,)).fetchone()[0], 0)
            self.assertIsNone(self.admin.execute(
                "SELECT 1 FROM analysis.stage_results WHERE run_id=%s", (self.run,)).fetchone())
            prepare_features(self.admin, InputExecution(self.job, self.run, new_token), root)
            self.assertEqual(self.admin.execute(
                "SELECT count(*) FROM analysis.model_tasks WHERE run_id=%s AND phase='PUBLISH' AND status='READY'",
                (self.run,)).fetchone()[0], 1)

    def test_checkpoint_with_changed_file_cannot_be_reused(self):
        with tempfile.TemporaryDirectory(prefix="aml-worker-test-") as root:
            artifact = json.loads(prepare_features(self.admin, self.execution, root))
            (Path(root) / input_path(artifact["models"]["BINARY"])).write_bytes(b"changed")
            with self.assertRaisesRegex(ProtocolError, "changed"):
                prepare_features(self.admin, self.execution, root)

    def publication_setup(self, root):
        from inference.model_publication import Settings
        prepare_features(self.admin, self.execution, root)
        self.admin.execute("UPDATE analysis.jobs SET current_stage='INFERENCE' WHERE job_id=%s", (self.job,))
        return Settings('https://inference.example', 'x' * 32, 'test-bucket', 'dev/test/', 'ap-northeast-2'), MemoryS3()

    def test_publication_lost_response_reuses_request_and_enters_durable_wait(self):
        import httpx
        from inference.model_publication import publish_model
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            bodies = []
            def remote(request):
                body = json.loads(request.content)
                bodies.append(body)
                self.assertEqual(self.admin.execute('''SELECT status FROM analysis.model_requests
                    WHERE request_id=%s AND execution_round=1''', (body['request_id'],)).fetchone()[0], 'PUBLISHED')
                if len(bodies) == 1:
                    raise httpx.ReadTimeout('ambiguous response')
                return httpx.Response(202, json={**body, 'status': 'ACCEPTED', 'revision': 1})
            transport = httpx.MockTransport(remote)
            with self.assertRaises(httpx.ReadTimeout):
                publish_model(self.admin, self.execution, 'BINARY', root, settings, s3, transport=transport)
            publish_model(self.admin, self.execution, 'BINARY', root, settings, s3, transport=transport)
            self.assertEqual(bodies[0], bodies[1])
            publish_model(self.admin, self.execution, 'BINARY', root, settings, s3, transport=transport)
            self.assertEqual(len(bodies), 2)
            task = self.admin.execute('''SELECT phase,status,execution_id,binding::text FROM analysis.model_tasks
                WHERE run_id=%s AND model_kind='BINARY' ''', (self.run,)).fetchone()
            self.assertEqual(task[:3], ('WAIT_REMOTE', 'WAITING', None))
            self.assertNotIn('signature=', task[3])
            self.assertNotIn(settings.token, task[3])
            self.assertIsNone(self.admin.execute("SELECT 1 FROM analysis.stage_results WHERE run_id=%s AND stage='INFERENCE'", (self.run,)).fetchone())
            self.assertEqual(len(s3.objects), 5)  # targets, transactions, accounts, input bundle, manifest

    def test_publication_rejects_wrong_receipt_and_changed_destination(self):
        import httpx
        from dataclasses import replace
        from inference.model_publication import publish_model
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            def wrong(request):
                return httpx.Response(202, json={**json.loads(request.content), 'run_id': str(uuid4()), 'status': 'QUEUED'})
            with self.assertRaises(ProtocolError):
                publish_model(self.admin, self.execution, 'BINARY', root, settings, s3, transport=httpx.MockTransport(wrong))
            with self.assertRaisesRegex(ProtocolError, 'destination changed'):
                publish_model(self.admin, self.execution, 'BINARY', root, replace(settings, prefix='another/'), s3)
            self.assertEqual(self.admin.execute("SELECT phase,status FROM analysis.model_tasks WHERE run_id=%s AND model_kind='BINARY'", (self.run,)).fetchone(), ('PUBLISH', 'FAILED'))

    def test_cancellation_after_s3_upload_prevents_remote_submission(self):
        import httpx
        from inference.model_publication import publish_model
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            def cancel_before_http(*args, **kwargs):
                with self.psycopg.connect(**self.connect_args) as other:
                    other.execute("UPDATE analysis.runs SET status='CANCELLED' WHERE run_id=%s", (self.run,))
                return 'https://objects.example/test'
            s3.generate_presigned_url = cancel_before_http
            calls = []
            with self.assertRaises(StaleExecution):
                publish_model(self.admin, self.execution, 'BINARY', root, settings, s3,
                              transport=httpx.MockTransport(lambda request: calls.append(request)))
            self.assertEqual(calls, [])
            self.assertEqual(self.admin.execute("SELECT status FROM analysis.model_requests WHERE run_id=%s", (self.run,)).fetchone()[0], 'REGISTERED')

    def test_cancellation_after_remote_acceptance_blocks_local_wait_commit(self):
        import httpx
        from inference.model_publication import publish_model
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            def cancelled(request):
                with self.psycopg.connect(**self.connect_args) as other:
                    other.execute("UPDATE analysis.runs SET status='CANCEL_REQUESTED' WHERE run_id=%s", (self.run,))
                return httpx.Response(202, json={**json.loads(request.content), 'status': 'QUEUED'})
            with self.assertRaises(StaleExecution):
                publish_model(self.admin, self.execution, 'BINARY', root, settings, s3, transport=httpx.MockTransport(cancelled))
            self.assertEqual(self.admin.execute("SELECT status FROM analysis.model_requests WHERE run_id=%s", (self.run,)).fetchone()[0], 'PUBLISHED')
            self.assertEqual(self.admin.execute("SELECT phase FROM analysis.model_tasks WHERE run_id=%s AND model_kind='BINARY'", (self.run,)).fetchone()[0], 'PUBLISH')

    def test_single_entry_dispatches_publication_without_completing_inference(self):
        import httpx
        from analysis_entry import main
        from inference.model_publication import publish_model
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            transport = httpx.MockTransport(lambda request: httpx.Response(
                202, json={**json.loads(request.content), 'status': 'QUEUED'}))
            env = dict(WORKER_MODE='demo', WORKER_STORAGE_DIR=root,
                       WORKER_DB_URL=f"postgresql://127.0.0.1:{self.connect_args['port']}/postgres",
                       WORKER_DB_USER=self.worker_user, WORKER_DB_PASSWORD=self.worker_password)
            def dispatch(*args, **kwargs):
                return publish_model(*args, **kwargs, transport=transport)
            with patch.dict(os.environ, env), patch('inference.model_publication.configured', return_value=(settings, s3)), patch(
                    'inference.model_publication.publish_model', side_effect=dispatch):
                code = main(['--job-id', str(self.job), '--run-id', str(self.run),
                             '--execution-id', str(self.token), '--stage', 'INFERENCE',
                             '--operation', 'PUBLISH', '--model-kind', 'BINARY'])
            self.assertEqual(code, 0)
            self.assertEqual(self.admin.execute("SELECT phase,status FROM analysis.model_tasks WHERE run_id=%s AND model_kind='BINARY'", (self.run,)).fetchone(), ('WAIT_REMOTE', 'WAITING'))
            self.assertIsNone(self.admin.execute("SELECT 1 FROM analysis.stage_results WHERE run_id=%s AND stage='INFERENCE'", (self.run,)).fetchone())

    def test_unstopped_predecessor_blocks_publication_without_side_effects(self):
        from inference.model_publication import publish_model
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            old = uuid4()
            self.admin.execute("INSERT INTO analysis.runs(run_id,job_id,status) VALUES(%s,%s,'CANCEL_REQUESTED')", (old, self.job))
            self.admin.execute("INSERT INTO analysis.run_replacements VALUES(%s,%s)", (self.run, old))
            self.admin.execute("INSERT INTO analysis.model_requests VALUES(%s,1,%s,'BINARY','PUBLISHED')", (uuid4(), old))
            with self.assertRaises(StaleExecution):
                publish_model(self.admin, self.execution, 'BINARY', root, settings, s3)
            self.assertEqual(s3.objects, {})
            self.assertEqual(self.admin.execute("SELECT count(*) FROM analysis.model_requests WHERE run_id=%s", (self.run,)).fetchone()[0], 0)

    def inference_remote(self, s3):
        import httpx
        from common.worker_transport import Request
        bodies, states = {}, {}
        self.submissions, self.put_bodies = [], []
        def remote(req):
            key = req.url.path.split('/')[-3]
            if req.method == 'PUT':
                bodies[key] = json.loads(req.content)
                self.submissions.append(req.url.path)
                self.put_bodies.append(bodies[key])
            body = bodies[key]
            status, revision, *error = states.get(body['model_kind'], ('RUNNING', 1))
            response = {**body, 'status': status, 'revision': revision}
            if status == 'COMPLETED':
                logical = Request(body['job_id'], body['model_kind'].lower(), body['request_id'],
                                  body['execution_round'], body['model_version'], body['feature_version'], body['run_id'])
                from tests.inference_peer import calculate, classify_alerts
                from common.worker_transport import descriptor
                stream = io.BytesIO()
                targets = pq.read_table(io.BytesIO(s3.objects['dev/test/' + logical.inputs + 'targets.parquet']))
                scores = (classify_alerts(targets) if logical.model_kind == 'type' else calculate(targets, logical.model_kind,
                    model_version=logical.model_version, feature_version=logical.feature_version))
                if logical.model_kind == 'binary' and hasattr(self, 'score_values'):
                    import pyarrow as pa
                    scores = scores.set_column(1, 'p_laundering', pa.array(self.score_values, type=pa.float64()))
                pq.write_table(scores, stream)
                key = 'dev/test/' + logical.output + 'scores.parquet'
                s3.objects[key] = stream.getvalue()
                response['result'] = dict(logical.identity(), **logical.versions(), status='COMPLETED',
                    row_count=len(targets), files=[descriptor('scores', key, stream.getvalue())])
            elif status == 'FAILED':
                response['error_code'] = error[0] if error else 'GPU_OUT_OF_MEMORY'
            return httpx.Response(202 if req.method == 'PUT' else 200, json=response)
        return httpx.MockTransport(remote), states

    def make_observations_due(self):
        self.admin.execute("UPDATE analysis.model_tasks SET next_poll_at=now()-interval '1 second',retry_at=now()-interval '1 second' WHERE run_id=%s", (self.run,))

    def test_dispatch_completes_inference_only_after_the_result_is_validated(self):
        from inference.inference_dispatch import advance
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            remote, states = self.inference_remote(s3)
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 76)
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 76)
            self.assertEqual(self.admin.execute('SELECT sum(consecutive_failures) FROM analysis.model_tasks WHERE run_id=%s', (self.run,)).fetchone()[0], 0)
            states.update(BINARY=('COMPLETED', 2))
            self.make_observations_due()
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 0)
            self.assertEqual(self.admin.execute("SELECT model_kind FROM analysis.model_tasks WHERE run_id=%s AND phase='DONE' AND status='SUCCEEDED'", (self.run,)).fetchall(), [('BINARY',)])
            self.assertIsNotNone(self.admin.execute("SELECT 1 FROM analysis.stage_results WHERE run_id=%s AND stage='INFERENCE'", (self.run,)).fetchone())

    def test_failed_model_fails_the_stage_visibly(self):
        from inference.inference_dispatch import advance
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            remote, states = self.inference_remote(s3)
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 76)
            states['BINARY'] = ('FAILED', 2)
            self.make_observations_due()
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 77)
            self.assertEqual(self.admin.execute("SELECT phase,status,error_code FROM analysis.model_tasks WHERE run_id=%s AND model_kind='BINARY'", (self.run,)).fetchone(), ('WAIT_REMOTE', 'FAILED', 'GPU_OUT_OF_MEMORY'))

    def test_interrupted_round_waits_for_confirmation_then_resumes_as_a_new_round(self):
        from inference.inference_dispatch import advance
        task = "SELECT phase,status,error_code,action_required,execution_round FROM analysis.model_tasks WHERE run_id=%s AND model_kind='BINARY'"
        requests = "SELECT execution_round,status FROM analysis.model_requests WHERE run_id=%s AND model_kind='BINARY' ORDER BY execution_round"
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            remote, states = self.inference_remote(s3)
            advance(self.admin, self.execution, root, settings, s3, transport=remote)
            # A server crash may leave the model process running: keep observing, keep the round open.
            states['BINARY'] = ('FAILED', 2, 'RECOVERY_REQUIRED')
            self.make_observations_due()
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 76)
            self.assertEqual(self.admin.execute(task, (self.run,)).fetchone(), ('WAIT_REMOTE', 'WAITING', 'RECOVERY_REQUIRED', True, 1))
            self.assertEqual(self.admin.execute(requests, (self.run,)).fetchall(), [(1, 'PUBLISHED')])
            # Once the server confirms the process gone, the round ends and is no longer unconfirmed.
            states.update(BINARY=('FAILED', 3, 'WORKER_SHUTDOWN'))
            self.make_observations_due()
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 77)
            self.assertEqual(self.admin.execute(task, (self.run,)).fetchone(), ('WAIT_REMOTE', 'FAILED', 'WORKER_SHUTDOWN', True, 1))
            self.assertEqual(self.admin.execute(requests, (self.run,)).fetchall(), [(1, 'ALREADY_FINISHED')])
            # The state Spring's resume leaves (AnalysisService.resume): round 2 of the same request.
            self.admin.execute("""INSERT INTO analysis.model_requests(request_id,execution_round,run_id,model_kind,status)
                SELECT request_id,execution_round+1,run_id,model_kind,'REGISTERED' FROM analysis.model_tasks
                WHERE run_id=%s AND model_kind='BINARY'""", (self.run,))
            self.admin.execute("""UPDATE analysis.model_tasks SET phase='PUBLISH',status='READY',execution_round=2,
                remote_revision=null,remote_snapshot=null,remote_deadline_at=null,next_poll_at=null,
                error_code=null,action_required=false WHERE run_id=%s AND model_kind='BINARY'""", (self.run,))
            states['BINARY'] = ('RUNNING', 1)
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 76)
            binary = [path for path in self.submissions if path.endswith('/rounds/2')]
            self.assertEqual(len(binary), 1)
            self.assertIn(self.admin.execute("SELECT request_id::text FROM analysis.model_tasks WHERE run_id=%s AND model_kind='BINARY'", (self.run,)).fetchone()[0], binary[0])
            self.assertTrue(any('/rounds/2/' in key for key in s3.objects))
            states['BINARY'] = ('COMPLETED', 2)
            self.make_observations_due()
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 0)
            self.assertEqual(self.admin.execute(requests, (self.run,)).fetchall(), [(1, 'ALREADY_FINISHED'), (2, 'PUBLISHED')])
            self.assertEqual(self.admin.execute("SELECT count(*) FROM analysis.model_tasks WHERE run_id=%s AND phase='DONE' AND status='SUCCEEDED'", (self.run,)).fetchone()[0], 1)

    LEDGER_COLUMNS = ("occurred_at,business_date,from_bank_id,to_bank_id,from_account_id,to_account_id,"
                      "from_owner_id,to_owner_id,amount_received,receiving_currency,amount_paid,"
                      "payment_currency,payment_format,amount_usd,fx_rate_version")

    def ledger_positions(self):
        """Ledger positions a<b<c<d (self.seq): the CONTEXT row opened at a, an earlier run at b,
        one transaction (returned) in the ledger from a until c, and this run with its TARGETs at d."""
        cols = self.LEDGER_COLUMNS
        self.seq = [self.admin.execute("SELECT nextval('analysis.input_seq')").fetchone()[0] for _ in range(4)]
        a, b, c, d = self.seq
        self.admin.execute("UPDATE analysis.runs SET input_seq=%s WHERE run_id=%s", (d, self.run))
        self.admin.execute(f"""INSERT INTO analysis.input_ledger(tx_id,valid_from_seq,valid_to_seq,{cols})
            SELECT tx_id,CASE WHEN input_role='TARGET' THEN %s ELSE %s END,NULL,{cols}
            FROM analysis.input_transactions WHERE run_id=%s""", (d, a, self.run))
        gone = self.admin.execute("""INSERT INTO ledger.transactions(occurred_at,from_account_id,to_account_id,
              amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,
              fx_rate_version,business_date)
            SELECT occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,
              payment_currency,payment_format,amount_usd,fx_rate_version,business_date
            FROM ledger.transactions WHERE tx_id=%s RETURNING tx_id""", (self.ids[0],)).fetchone()[0]
        self.admin.execute(f"""INSERT INTO analysis.input_ledger(tx_id,valid_from_seq,valid_to_seq,{cols})
            SELECT %s,%s,%s,{cols} FROM analysis.input_transactions WHERE run_id=%s AND input_role='CONTEXT'""",
                           (gone, a, c, self.run))
        return gone

    def frozen_rows(self):
        return self.admin.execute("SELECT count(*) FROM analysis.run_inputs WHERE run_id=%s", (self.run,)).fetchone()[0]

    def no_received_runs(self):
        # Runs share one database across tests; earlier tests' runs must not look received.
        self.admin.execute("UPDATE analysis.model_tasks SET remote_revision=NULL WHERE run_id<>%s", (self.run,))

    def received_previous_run(self):
        """An earlier run at position b whose request the inference server received."""
        previous = uuid4()
        self.admin.execute("INSERT INTO analysis.runs(run_id,job_id,status,input_seq) VALUES(%s,%s,'COMPLETED',%s)",
                           (previous, self.job, self.seq[1]))
        self.admin.execute("""INSERT INTO analysis.model_tasks(run_id,model_kind,phase,status,binding,remote_revision)
            VALUES(%s,'BINARY','DONE','SUCCEEDED','{}'::jsonb,2)""", (previous,))

    def test_ledger_copy_gets_only_what_changed_since_the_last_received_run(self):
        gone = self.ledger_positions()
        self.received_previous_run()
        with tempfile.TemporaryDirectory(prefix='aml-replica-input-') as root:
            result = json.loads(prepare_features(self.admin, self.execution, root))
            for model in result['models'].values():
                self.assertEqual((model['protocol_version'], model['replica']), (3, dict(mode='delta', base_seq=self.seq[1], seq=self.seq[3], rows=self.frozen_rows())))
                self.assertEqual([f['name'] for f in model['files']], ['targets', 'transactions', 'accounts', 'removed'])
                changed = pq.read_table(Path(root) / input_path(model, 'transactions'))
                self.assertEqual(changed.column('tx_id').to_pylist(), sorted(self.ids))  # not the unchanged CONTEXT
                self.assertEqual(set(changed.column('input_role').to_pylist()), {'TARGET'})
                self.assertEqual(changed.schema, materials.TRANSACTIONS)
                parties = set(changed.column('from_account_id').to_pylist()) | set(changed.column('to_account_id').to_pylist())
                self.assertEqual(set(pq.read_table(Path(root) / input_path(model, 'accounts')).column('account_id').to_pylist()), parties)
                self.assertEqual(pq.read_table(Path(root) / input_path(model, 'removed')).column('tx_id').to_pylist(), [gone])

    def test_first_run_sends_the_whole_frozen_input_for_the_copy(self):
        self.ledger_positions()
        self.no_received_runs()
        with tempfile.TemporaryDirectory(prefix='aml-replica-input-') as root:
            result = json.loads(prepare_features(self.admin, self.execution, root))
            model = result['models']['BINARY']
            self.assertEqual(model['replica'], dict(mode='full', base_seq=0, seq=self.seq[3], rows=self.frozen_rows()))
            # The whole frozen input (the ledger is shared, so earlier tests' rows count too).
            self.assertEqual(len(pq.read_table(Path(root) / input_path(model, 'transactions'))), self.frozen_rows())
            self.assertEqual(pq.read_table(Path(root) / input_path(model, 'removed')).num_rows, 0)

    def test_server_copy_mismatch_resends_that_model_in_full_as_the_next_round(self):
        from inference.inference_dispatch import advance
        task = "SELECT phase,status,execution_round,error_code,action_required FROM analysis.model_tasks WHERE run_id=%s AND model_kind='BINARY'"
        requests = "SELECT execution_round,status FROM analysis.model_requests WHERE run_id=%s AND model_kind='BINARY' ORDER BY status"
        self.ledger_positions()
        self.received_previous_run()
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            remote, states = self.inference_remote(s3)
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 76)
            self.assertEqual({b['replica']['mode'] for b in self.put_bodies}, {'delta'})
            self.assertEqual({tuple(sorted(b['input_urls'])) for b in self.put_bodies}, {('accounts', 'removed', 'targets', 'transactions')})
            states['BINARY'] = ('FAILED', 2, 'REPLICA_MISMATCH')
            self.make_observations_due()
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 76)
            self.assertEqual(self.admin.execute(task, (self.run,)).fetchone(), ('PREPARE', 'RETRY_WAIT', 1, 'REPLICA_MISMATCH', False))
            self.assertEqual(self.admin.execute(requests, (self.run,)).fetchall(), [(1, 'ALREADY_FINISHED'), (1, 'REGISTERED')])
            states['BINARY'] = ('RUNNING', 1)
            self.make_observations_due()
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 76)
            resent = self.put_bodies[-1]
            first = next(b for b in self.put_bodies if b['model_kind'] == 'BINARY')
            self.assertEqual((resent['model_kind'], resent['execution_round'], resent['replica']),
                             ('BINARY', 1, dict(mode='full', base_seq=0, seq=self.seq[3], rows=self.frozen_rows())))
            self.assertNotEqual(resent['request_id'], first['request_id'])  # new input files, new request
            self.assertEqual(self.admin.execute(task, (self.run,)).fetchone()[:3], ('WAIT_REMOTE', 'WAITING', 1))
            key = next(k for k in s3.objects if resent['request_id'] in k and k.endswith('transactions.parquet'))
            self.assertEqual(len(pq.read_table(io.BytesIO(s3.objects[key]))), self.frozen_rows())
            states.update(BINARY=('COMPLETED', 2))
            self.make_observations_due()
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 0)
            self.assertEqual(self.admin.execute(requests, (self.run,)).fetchall(), [(1, 'ALREADY_FINISHED'), (1, 'PUBLISHED')])

    def test_a_refused_full_input_fails_visibly_instead_of_resending_forever(self):
        from inference.inference_dispatch import advance
        self.ledger_positions()
        self.no_received_runs()
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            remote, states = self.inference_remote(s3)
            advance(self.admin, self.execution, root, settings, s3, transport=remote)
            self.assertEqual({b['replica']['mode'] for b in self.put_bodies}, {'full'})
            states['BINARY'] = ('FAILED', 2, 'REPLICA_MISMATCH')
            self.make_observations_due()
            advance(self.admin, self.execution, root, settings, s3, transport=remote)
            self.assertEqual(self.admin.execute("SELECT phase,status,error_code,action_required FROM analysis.model_tasks WHERE run_id=%s AND model_kind='BINARY'", (self.run,)).fetchone(),
                             ('WAIT_REMOTE', 'FAILED', 'REPLICA_MISMATCH', True))
            self.assertEqual(len(self.put_bodies), 1)

    def test_observation_revision_fences_conflicts_and_deadline_does_not_restart_model(self):
        from inference.inference_dispatch import advance, observe_model
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            remote, states = self.inference_remote(s3)
            advance(self.admin, self.execution, root, settings, s3, transport=remote)
            states['BINARY'] = ('RUNNING', 4)
            observe_model(self.admin, self.execution, 'BINARY', settings, transport=remote)
            states['BINARY'] = ('COMPLETED', 3)
            observe_model(self.admin, self.execution, 'BINARY', settings, transport=remote)
            self.assertEqual(self.admin.execute("SELECT phase FROM analysis.model_tasks WHERE run_id=%s AND model_kind='BINARY'", (self.run,)).fetchone()[0], 'WAIT_REMOTE')
            states['BINARY'] = ('COMPLETED', 4)
            with self.assertRaisesRegex(ProtocolError, 'Conflicting'):
                observe_model(self.admin, self.execution, 'BINARY', settings, transport=remote)
            states['BINARY'] = ('RUNNING', 4)
            self.admin.execute("UPDATE analysis.model_tasks SET remote_deadline_at=now()-interval '1 second' WHERE run_id=%s", (self.run,))
            observe_model(self.admin, self.execution, 'BINARY', settings, transport=remote)
            self.assertEqual(self.admin.execute("SELECT status,error_code,action_required FROM analysis.model_tasks WHERE run_id=%s AND model_kind='BINARY'", (self.run,)).fetchone(), ('WAITING', 'REMOTE_WAIT_EXPIRED', True))
            self.assertEqual(self.admin.execute("SELECT count(*) FROM analysis.model_requests WHERE run_id=%s", (self.run,)).fetchone()[0], 1)

    def test_ambiguous_publication_budget_switches_to_observation_without_new_round(self):
        import httpx
        from inference.inference_dispatch import advance
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            puts = []
            def unreachable(request):
                if request.method == 'PUT':
                    puts.append(json.loads(request.content))
                raise httpx.ReadTimeout('test transport unavailable')
            transport = httpx.MockTransport(unreachable)
            for attempt in range(3):
                self.make_observations_due()
                self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=transport), 76)
            self.assertEqual(len(puts), 3)
            self.assertEqual(len({b['request_id'] for b in puts}), 1)
            self.assertEqual({b['execution_round'] for b in puts}, {1})
            self.assertEqual(self.admin.execute("SELECT count(*) FROM analysis.model_tasks WHERE run_id=%s AND phase='WAIT_REMOTE' AND status='WAITING' AND action_required", (self.run,)).fetchone()[0], 1)
            self.make_observations_due()
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=transport), 76)
            self.assertEqual(len(puts), 3)

    def test_unreceived_request_is_resent_with_same_identity_only_on_server_not_found(self):
        import httpx
        from inference.inference_dispatch import advance
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            puts = []
            def unreachable(request):
                if request.method == 'PUT':
                    puts.append(json.loads(request.content))
                raise httpx.ConnectError('server not listening yet')
            for attempt in range(3):
                self.make_observations_due()
                advance(self.admin, self.execution, root, settings, s3, transport=httpx.MockTransport(unreachable))
            first = {b['model_kind']: (b['request_id'], b['execution_round']) for b in puts}
            # A proxy or wrong route answering 404 is not the server's word: keep waiting, send nothing.
            self.make_observations_due()
            advance(self.admin, self.execution, root, settings, s3,
                    transport=httpx.MockTransport(lambda r: httpx.Response(404, text='not found')))
            self.assertEqual(self.admin.execute("SELECT count(*) FROM analysis.model_tasks WHERE run_id=%s AND phase='WAIT_REMOTE' AND status='WAITING'", (self.run,)).fetchone()[0], 1)
            resent = []
            def listening(request):
                if request.method == 'PUT':
                    body = json.loads(request.content)
                    resent.append(body)
                    return httpx.Response(202, json={**body, 'status': 'ACCEPTED', 'revision': 1})
                return httpx.Response(404, json={'error': 'REQUEST_NOT_FOUND'})
            transport = httpx.MockTransport(listening)
            self.make_observations_due()
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=transport), 76)
            self.assertEqual(resent, [])
            # The exact condition under which Spring (PythonAnalysisExecutor) defers exit 76 instead of failing.
            self.assertTrue(self.admin.execute("select exists(select 1 from analysis.model_tasks where run_id=%s and model_kind='BINARY' and status in ('WAITING','RETRY_WAIT','ACTIVE'))", (self.run,)).fetchone()[0])
            self.assertEqual(self.admin.execute("SELECT count(*) FROM analysis.model_tasks WHERE run_id=%s AND phase='PUBLISH' AND status='RETRY_WAIT' AND retry_at<=now() AND NOT action_required", (self.run,)).fetchone()[0], 1)
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=transport), 76)
            self.assertEqual({b['model_kind']: (b['request_id'], b['execution_round']) for b in resent}, first)
            self.assertEqual(self.admin.execute("SELECT count(*) FROM analysis.model_requests WHERE run_id=%s", (self.run,)).fetchone()[0], 1)
            self.assertEqual(self.admin.execute("SELECT count(*) FROM analysis.model_tasks WHERE run_id=%s AND phase='WAIT_REMOTE' AND status='WAITING' AND NOT action_required AND error_code IS NULL", (self.run,)).fetchone()[0], 1)

    def test_rejected_submission_fails_visibly_instead_of_waiting(self):
        import httpx
        from inference.inference_dispatch import advance
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            task = "SELECT phase,status,error_code,action_required FROM analysis.model_tasks WHERE run_id=%s AND model_kind='BINARY'"
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=httpx.MockTransport(
                lambda request: httpx.Response(422, json={'error': 'INVALID_REQUEST'}))), 77)
            self.assertEqual(self.admin.execute(task, (self.run,)).fetchone(), ('PUBLISH', 'FAILED', 'PUBLICATION_REJECTED_422', True))
            # A conflict means the server already holds that request: keep waiting for it.
            self.admin.execute("UPDATE analysis.model_tasks SET status='READY' WHERE run_id=%s", (self.run,))
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=httpx.MockTransport(
                lambda request: httpx.Response(409, json={'error': 'REQUEST_CONFLICT'}))), 76)
            self.assertEqual(self.admin.execute(task, (self.run,)).fetchone()[:2], ('WAIT_REMOTE', 'WAITING'))

    def test_result_metadata_mismatch_cannot_schedule_collection(self):
        import httpx
        from inference.inference_dispatch import advance, observe_model
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            transport, states = self.inference_remote(s3)
            advance(self.admin, self.execution, root, settings, s3, transport=transport)
            states['BINARY'] = ('COMPLETED', 2)
            def incorrect(request):
                original = transport.handle_request(request)
                body = json.loads(original.content)
                body['result']['files'][0]['key'] = 'another-environment/scores.parquet'
                return httpx.Response(200, json=body)
            with self.assertRaisesRegex(ProtocolError, 'result object'):
                observe_model(self.admin, self.execution, 'BINARY', settings, transport=httpx.MockTransport(incorrect))
            self.assertEqual(self.admin.execute("SELECT phase FROM analysis.model_tasks WHERE run_id=%s AND model_kind='BINARY'", (self.run,)).fetchone()[0], 'WAIT_REMOTE')


    def collected_results(self, root):
        from inference.inference_dispatch import advance
        settings, s3 = self.publication_setup(root)
        remote, states = self.inference_remote(s3)
        advance(self.admin, self.execution, root, settings, s3, transport=remote)
        states.update(BINARY=('COMPLETED', 2))
        self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 0)
        return settings, s3

    def scoring_stage(self):
        self.admin.execute("UPDATE analysis.jobs SET current_stage='SCORES',threshold_value=0.5 WHERE job_id=%s", (self.job,))

    def prepared_alert_plans(self, root):
        """Run the pipeline through Alert 구성 on a connected flow; returns the remote settings."""
        from scores.result_collection import save_scores
        from alerts.alert_pipeline import save_alerts
        self.annotate_demo(self.ids)
        self.score_values = [.9, .2, .8]
        self.admin.execute("UPDATE analysis.input_transactions SET occurred_at='2022-09-01 12:00+09' WHERE run_id=%s", (self.run,))
        # A -> B -> C -> D: a scored seed needs actual connected-flow evidence.
        accounts = [uuid4() for _ in range(4)]
        for index, key in enumerate(self.ids):
            self.admin.execute('''UPDATE analysis.input_transactions
                SET from_account_id=%s,to_account_id=%s,
                    occurred_at='2022-09-01 12:00+09'::timestamptz + %s * interval '10 minutes'
                WHERE run_id=%s AND tx_id=%s''',
                (accounts[index], accounts[index+1], index, self.run, key))
        self.admin.execute("INSERT INTO analysis.input_coverage VALUES(%s,'2022-09-01',1,1,true,'[]')", (self.run,))
        self.admin.execute("INSERT INTO core.users(username,name,role,password_hash) VALUES(%s,'Demo','STAFF','test')", (uuid4().hex,))
        settings, s3 = self.collected_results(root)
        self.scoring_stage()
        save_scores(self.admin, self.execution, root, settings, s3)
        self.admin.execute("UPDATE analysis.jobs SET current_stage='ALERTS',analysis_cutoff_at='2022-09-02 09:00+09' WHERE job_id=%s", (self.job,))
        save_alerts(self.admin, self.execution)
        return settings, s3

    def test_random_pipeline_collects_scores_and_prepares_alerts_without_publication(self):
        from models.demo_random.spec import MODEL_VERSION
        with tempfile.TemporaryDirectory(prefix='aml-label-pipeline-') as root:
            self.prepared_alert_plans(root)
            self.assertEqual(self.admin.execute('SELECT p_laundering FROM analysis.scores WHERE run_id=%s ORDER BY tx_id', (self.run,)).fetchall(), [(value,) for value in self.score_values])
            self.assertEqual(self.admin.execute('SELECT model_version_binary,model_version_type FROM analysis.jobs WHERE job_id=%s', (self.job,)).fetchone(), (MODEL_VERSION, None))
            plans = self.admin.execute('SELECT payload::jsonb FROM analysis.alert_plans WHERE run_id=%s', (self.run,)).fetchall()
            self.assertGreater(len(plans), 0)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM review.alert_versions WHERE run_id=%s', (self.run,)).fetchone()[0], 0)
            for (plan,) in plans:
                members = plan['evidence']['transactions']
                seeds = {seed['txId'] for seed in plan['evidence']['seeds']}
                self.assertEqual({m['txId'] for m in members if m['role'] == 'SEED'}, seeds)
                self.assertTrue(all(m['scores']['p_laundering'] >= .5 for m in members if m['role'] == 'SEED'))

    def alert_types_stage(self):
        self.admin.execute("UPDATE analysis.jobs SET current_stage='ALERT_TYPES' WHERE job_id=%s", (self.job,))

    def core_plan_keys(self):
        return [key for key, payload in self.admin.execute(
            'SELECT plan_key,payload::jsonb FROM analysis.alert_plans WHERE run_id=%s ORDER BY plan_key', (self.run,))
            if payload['evidence'] and any(m['role'] in ('SEED', 'CONNECTION') for m in payload['evidence']['transactions'])]

    def typed_alerts(self, root):
        """Pipeline through Alert 유형 분류; returns settings, s3 and the remote peer."""
        from alert_types.alert_type_inference import classify
        settings, s3 = self.prepared_alert_plans(root)
        self.alert_types_stage()
        remote, states = self.inference_remote(s3)
        self.assertEqual(classify(self.admin, self.execution, root, settings, s3, transport=remote), 76)
        states['TYPE'] = ('COMPLETED', 2)
        self.make_observations_due()
        self.assertEqual(classify(self.admin, self.execution, root, settings, s3, transport=remote), 0)
        return settings, s3, remote

    def test_alert_types_classify_each_core_plan_and_hand_plans_to_publication(self):
        from models.alert_type_tree import spec
        with tempfile.TemporaryDirectory(prefix='aml-alert-types-') as root:
            settings, s3, remote = self.typed_alerts(root)
            keys = self.core_plan_keys()
            self.assertGreater(len(keys), 0)
            # One request: the core plans' Alerts and their transactions; no ledger copy position.
            body = self.put_bodies[-1]
            self.assertEqual((body['model_kind'], body['model_version'], sorted(body['input_urls'])),
                             ('TYPE', spec.MODEL_VERSION, ['alert_transactions', 'targets']))
            self.assertNotIn('replica', body)
            inputs = 'dev/test/requests/{job_id}/TYPE/{request_id}/files/'.format(**body)
            sent = pq.read_table(io.BytesIO(s3.objects[inputs + 'targets.parquet']))
            self.assertEqual(sent.column('alert_key').to_pylist(), [key + 1 for key in keys])
            rows = pq.read_table(io.BytesIO(s3.objects[inputs + 'alert_transactions.parquet']))
            self.assertEqual(set(rows.column('tx_id').to_pylist()), set(self.ids))
            self.assertEqual(self.admin.execute(
                'SELECT plan_key,type_class FROM analysis.alert_plans WHERE run_id=%s AND type_class IS NOT NULL ORDER BY plan_key',
                (self.run,)).fetchall(), [(key, (key + 1) % 9) for key in keys])
            self.assertEqual(self.admin.execute('SELECT DISTINCT execution_id FROM analysis.alert_plans WHERE run_id=%s',
                                                (self.run,)).fetchall(), [(self.token,)])
            artifact = json.loads(self.admin.execute("SELECT artifact FROM analysis.stage_results WHERE run_id=%s AND stage='ALERT_TYPES'",
                                                     (self.run,)).fetchone()[0])
            self.assertEqual(artifact['typedAlertCount'], len(keys))
            self.assertEqual(self.admin.execute('SELECT model_version_type,feature_version_type FROM analysis.jobs WHERE job_id=%s',
                                                (self.job,)).fetchone(), (spec.MODEL_VERSION, spec.FEATURE_VERSION))
            self.assertEqual(self.admin.execute('SELECT count(*) FROM review.alert_versions WHERE run_id=%s', (self.run,)).fetchone()[0], 0)

    def test_alert_types_retry_after_checkpoint_only_restamps_plans(self):
        from alert_types.alert_type_inference import classify
        with tempfile.TemporaryDirectory(prefix='aml-alert-types-') as root:
            settings, s3, remote = self.typed_alerts(root)
            types = self.admin.execute('SELECT plan_key,type_class FROM analysis.alert_plans WHERE run_id=%s ORDER BY plan_key', (self.run,)).fetchall()
            submissions = len(self.submissions)
            self.token = uuid4()
            self.admin.execute('UPDATE analysis.jobs SET execution_id=%s WHERE job_id=%s', (self.token, self.job))
            self.execution = InputExecution(self.job, self.run, self.token)
            self.assertEqual(classify(self.admin, self.execution, root, settings, s3, transport=remote), 0)
            self.assertEqual(len(self.submissions), submissions)
            self.assertEqual(self.admin.execute('SELECT plan_key,type_class FROM analysis.alert_plans WHERE run_id=%s ORDER BY plan_key', (self.run,)).fetchall(), types)
            self.assertEqual(self.admin.execute('SELECT DISTINCT execution_id FROM analysis.alert_plans WHERE run_id=%s',
                                                (self.run,)).fetchall(), [(self.token,)])

    def test_alert_types_of_rebuilt_plans_are_a_new_request(self):
        from alert_types.alert_type_inference import classify
        with tempfile.TemporaryDirectory(prefix='aml-alert-types-') as root:
            settings, s3, remote = self.typed_alerts(root)
            task = "SELECT request_id FROM analysis.model_tasks WHERE run_id=%s AND model_kind='TYPE'"
            first = self.admin.execute(task, (self.run,)).fetchone()[0]
            # What Alert 구성 leaves after it ran again (Spring deletes both checkpoints when the baseline changed).
            self.admin.execute("DELETE FROM analysis.stage_results WHERE run_id=%s AND stage='ALERT_TYPES'", (self.run,))
            self.admin.execute("UPDATE analysis.alert_plans SET build_generation=build_generation+1,type_class=NULL WHERE run_id=%s", (self.run,))
            self.admin.execute("""UPDATE analysis.stage_results SET artifact=jsonb_set(artifact::jsonb,'{buildGeneration}',
                to_jsonb((artifact::jsonb->>'buildGeneration')::int+1))::text WHERE run_id=%s AND stage='ALERTS'""", (self.run,))
            self.assertEqual(classify(self.admin, self.execution, root, settings, s3, transport=remote), 76)
            self.make_observations_due()
            self.assertEqual(classify(self.admin, self.execution, root, settings, s3, transport=remote), 0)
            self.assertNotEqual(self.admin.execute(task, (self.run,)).fetchone()[0], first)
            self.assertEqual(self.admin.execute("SELECT count(*) FROM analysis.alert_plans WHERE run_id=%s AND type_class IS NOT NULL",
                                                (self.run,)).fetchone()[0], len(self.core_plan_keys()))

    def test_plans_without_core_transactions_complete_without_a_request(self):
        from alert_types.alert_type_inference import classify
        with tempfile.TemporaryDirectory(prefix='aml-alert-types-') as root:
            settings, s3 = self.prepared_alert_plans(root)
            self.admin.execute("UPDATE analysis.alert_plans SET payload=jsonb_set(payload::jsonb,'{evidence}','null')::text WHERE run_id=%s", (self.run,))
            self.alert_types_stage()
            remote, states = self.inference_remote(s3)
            self.assertEqual(classify(self.admin, self.execution, root, settings, s3, transport=remote), 0)
            self.assertEqual(self.submissions, [])
            self.assertIsNone(self.admin.execute("SELECT 1 FROM analysis.model_tasks WHERE run_id=%s AND model_kind='TYPE'", (self.run,)).fetchone())
            artifact = json.loads(self.admin.execute("SELECT artifact FROM analysis.stage_results WHERE run_id=%s AND stage='ALERT_TYPES'",
                                                     (self.run,)).fetchone()[0])
            self.assertEqual(artifact['typedAlertCount'], 0)

    def test_type_result_for_other_alerts_fails_visibly(self):
        import pyarrow as pa
        from alert_types.alert_type_inference import classify
        from tests import inference_peer
        with tempfile.TemporaryDirectory(prefix='aml-alert-types-') as root:
            settings, s3 = self.prepared_alert_plans(root)
            self.alert_types_stage()
            remote, states = self.inference_remote(s3)
            self.assertEqual(classify(self.admin, self.execution, root, settings, s3, transport=remote), 76)
            states['TYPE'] = ('COMPLETED', 2)
            self.make_observations_due()
            right = inference_peer.classify_alerts
            wrong = lambda targets: right(targets).set_column(
                0, 'alert_key', pa.array([key + 100 for key in targets.column('alert_key').to_pylist()], pa.int64()))
            with patch('tests.inference_peer.classify_alerts', side_effect=wrong):
                self.assertEqual(classify(self.admin, self.execution, root, settings, s3, transport=remote), 77)
            self.assertEqual(self.admin.execute("SELECT phase,status,error_code FROM analysis.model_tasks WHERE run_id=%s AND model_kind='TYPE'",
                                                (self.run,)).fetchone(), ('COLLECT', 'FAILED', 'RESULT_INVALID'))
            self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis.alert_plans WHERE run_id=%s AND type_class IS NOT NULL',
                                                (self.run,)).fetchone()[0], 0)

    def test_scores_atomic_join_percentile_and_retry_without_duplicates(self):
        from scores.result_collection import save_scores
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.collected_results(root)
            self.scoring_stage()
            save_scores(self.admin, self.execution, root, settings, s3)
            rows = self.admin.execute('''SELECT tx_id,p_laundering,score_pct,run_id FROM analysis.scores JOIN analysis.runs USING(run_id)
                WHERE job_id=%s ORDER BY p_laundering''', (self.job,)).fetchall()
            self.assertEqual({r[0] for r in rows}, set(self.ids))
            self.assertEqual([r[2] for r in rows], [0, 50, 100])
            self.assertEqual({r[3] for r in rows}, {self.run})
            self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis.current_scores WHERE run_id=%s', (self.run,)).fetchone()[0], 0)
            self.assertEqual(self.admin.execute('SELECT row_count,model_version_binary,feature_version_binary FROM analysis.jobs WHERE job_id=%s', (self.job,)).fetchone(), (3, 'demo-random-v1', 'demo-input-v1'))
            self.token = uuid4()
            self.admin.execute('UPDATE analysis.jobs SET execution_id=%s WHERE job_id=%s', (self.token, self.job))
            self.execution = InputExecution(self.job, self.run, self.token)
            save_scores(self.admin, self.execution, root, settings, s3)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis.scores JOIN analysis.runs USING(run_id) WHERE job_id=%s', (self.job,)).fetchone()[0], 3)
            self.assertEqual(self.admin.execute("SELECT execution_id FROM analysis.stage_results WHERE run_id=%s AND stage='SCORES'", (self.run,)).fetchone()[0], self.token)

    def test_score_storage_failure_rolls_back_rows_markers_and_checkpoint(self):
        from scores.result_collection import save_scores
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.collected_results(root)
            self.scoring_stage()
            self.admin.execute('''CREATE FUNCTION reject_test_scores() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF NEW.stage='SCORES' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$''')
            self.admin.execute('''CREATE TRIGGER reject_test_scores BEFORE INSERT ON analysis.stage_results
                FOR EACH ROW EXECUTE FUNCTION reject_test_scores()''')
            try:
                with self.assertRaises(self.psycopg.Error):
                    save_scores(self.admin, self.execution, root, settings, s3)
                self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis.scores JOIN analysis.runs USING(run_id) WHERE job_id=%s', (self.job,)).fetchone()[0], 0)
                self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis.current_scores WHERE run_id=%s', (self.run,)).fetchone()[0], 0)
                self.assertIsNone(self.admin.execute("SELECT 1 FROM analysis.stage_results WHERE run_id=%s AND stage='SCORES'", (self.run,)).fetchone())
            finally:
                self.admin.execute('DROP TRIGGER reject_test_scores ON analysis.stage_results')
                self.admin.execute('DROP FUNCTION reject_test_scores()')
            save_scores(self.admin, self.execution, root, settings, s3)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis.scores JOIN analysis.runs USING(run_id) WHERE job_id=%s', (self.job,)).fetchone()[0], 3)

    def test_missing_local_result_is_restored_without_resubmitting_model(self):
        from scores.result_collection import save_scores
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.collected_results(root)
            for (artifact,) in self.admin.execute('SELECT result_artifact FROM analysis.model_tasks WHERE run_id=%s', (self.run,)):
                (Path(root) / artifact['path']).unlink()
            self.scoring_stage()
            save_scores(self.admin, self.execution, root, settings, s3)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis.scores JOIN analysis.runs USING(run_id) WHERE job_id=%s', (self.job,)).fetchone()[0], 3)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis.model_requests WHERE run_id=%s', (self.run,)).fetchone()[0], 1)

    def test_cancel_after_score_staging_blocks_every_persistent_write(self):
        from scores import result_collection
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.collected_results(root)
            self.scoring_stage()
            stage = result_collection._stage
            def cancel(*args):
                stage(*args)
                if args[2] == 'BINARY':
                    self.admin.execute("UPDATE analysis.runs SET status='CANCEL_REQUESTED' WHERE run_id=%s", (self.run,))
            with patch('scores.result_collection._stage', side_effect=cancel), self.assertRaises(StaleExecution):
                result_collection.save_scores(self.admin, self.execution, root, settings, s3)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis.scores JOIN analysis.runs USING(run_id) WHERE job_id=%s', (self.job,)).fetchone()[0], 0)

    def test_collection_rejects_corrupt_file_but_preserves_request(self):
        from inference.inference_dispatch import advance
        from scores.result_collection import _download
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            remote, states = self.inference_remote(s3)
            advance(self.admin, self.execution, root, settings, s3, transport=remote)
            states.update(BINARY=('COMPLETED', 2))
            def corrupt(client, bucket, descriptor, path):
                client.objects[descriptor['key']] = b'corrupt'
                _download(client, bucket, descriptor, path)
            with patch('scores.result_collection._download', side_effect=corrupt):
                self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 77)
            self.assertEqual(self.admin.execute("SELECT phase,status,error_code FROM analysis.model_tasks WHERE run_id=%s AND model_kind='BINARY'", (self.run,)).fetchone(), ('COLLECT', 'FAILED', 'RESULT_INVALID'))
            self.assertIsNone(self.admin.execute("SELECT 1 FROM analysis.stage_results WHERE run_id=%s AND stage='INFERENCE'", (self.run,)).fetchone())
            self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis.model_requests WHERE run_id=%s', (self.run,)).fetchone()[0], 1)

    def test_result_validation_rejects_invalid_probabilities_ids_and_schema(self):
        import pyarrow as pa
        from models.demo_random.build_input import build_targets
        from tests.inference_peer import calculate
        from models.demo_random.spec import MODEL_VERSION, FEATURE_VERSION
        from scores.result_collection import _stage
        self.admin.execute("UPDATE analysis.jobs SET current_stage='INFERENCE' WHERE job_id=%s", (self.job,))
        good = calculate(build_targets(self.ids), 'binary', model_version=MODEL_VERSION, feature_version=FEATURE_VERSION)
        cases = [good.set_column(1, 'p_laundering', pa.array(values, type=pa.float64()))
                 for values in ([float('nan'), 0.5, 0.6], [None, 0.5, 0.6], [1.1, 0.5, 0.6])]
        cases += [good.set_column(0, 'tx_id', pa.array(values, type=pa.int64()))
                  for values in ([self.ids[0]]*3, [*self.ids[:2], 2**62])]
        cases += [good.rename_columns(['tx_id','wrong']), good.slice(0,2)]
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            path = Path(root)/'invalid.parquet'
            for table in cases:
                with self.subTest(table=table.to_pydict()):
                    pq.write_table(table, path)
                    with self.assertRaises(ProtocolError):
                        _stage(self.admin, self.execution, 'BINARY', path, 3, {}, 'INFERENCE')
            # Type rows must sum to one (here 1 + 1/9 * 8).
            types = pa.table({'alert_key': pa.array([1, 2, 3], pa.int64()),
                              **{f'p_{i}': pa.array([1.0 if i == 0 else 1 / 9] * 3) for i in range(9)}})
            pq.write_table(types, path)
            with self.assertRaises(ProtocolError):
                _stage(self.admin, self.execution, 'TYPE', path, 3, {'build_generation': 1}, 'INFERENCE')

    def test_collection_transient_retry_does_not_rerun_the_model(self):
        from inference.inference_dispatch import advance
        from botocore.exceptions import EndpointConnectionError
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            remote, states = self.inference_remote(s3)
            advance(self.admin, self.execution, root, settings, s3, transport=remote)
            states.update(BINARY=('COMPLETED', 2))
            def unavailable(client, bucket, descriptor, path):
                raise EndpointConnectionError(endpoint_url='https://objects.example')
            with patch('scores.result_collection._download', side_effect=unavailable):
                self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 76)
            self.assertEqual(self.admin.execute("SELECT phase,status,error_code FROM analysis.model_tasks WHERE run_id=%s", (self.run,)).fetchone(), ('COLLECT', 'RETRY_WAIT', 'RESULT_TRANSFER_FAILED'))
            self.make_observations_due()
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 0)
            self.assertEqual(len(self.submissions), 1)

    def test_percentile_ties_have_equal_rank_and_threshold_count_uses_raw_score(self):
        from scores.result_collection import save_scores
        self.score_values = [0.5, 0.5, 0.9]
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.collected_results(root)
            self.scoring_stage()
            save_scores(self.admin, self.execution, root, settings, s3)
            self.assertEqual(self.admin.execute('SELECT p_laundering,score_pct FROM analysis.scores JOIN analysis.runs USING(run_id) WHERE job_id=%s ORDER BY tx_id', (self.job,)).fetchall(), [(0.5, 0.0), (0.5, 0.0), (0.9, 100.0)])
            self.assertEqual(self.admin.execute('SELECT suspicious_tx_count FROM analysis.jobs WHERE job_id=%s', (self.job,)).fetchone()[0], 3)

    def test_collection_cancel_after_download_does_not_publish_artifact(self):
        from inference.inference_dispatch import advance
        from scores.result_collection import _download
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            remote, states = self.inference_remote(s3)
            advance(self.admin, self.execution, root, settings, s3, transport=remote)
            states.update(BINARY=('COMPLETED', 2))
            def cancel(*args):
                _download(*args)
                self.admin.execute("UPDATE analysis.runs SET status='CANCEL_REQUESTED' WHERE run_id=%s", (self.run,))
            with patch('scores.result_collection._download', side_effect=cancel), self.assertRaises(StaleExecution):
                advance(self.admin, self.execution, root, settings, s3, transport=remote)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis.model_tasks WHERE run_id=%s AND result_artifact IS NOT NULL', (self.run,)).fetchone()[0], 0)

    def test_abandoned_collection_is_fenced_and_new_parent_recovers_same_request(self):
        from inference.inference_dispatch import advance
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            remote, states = self.inference_remote(s3)
            advance(self.admin, self.execution, root, settings, s3, transport=remote)
            states.update(BINARY=('COMPLETED', 2))
            with patch('scores.result_collection._stage', side_effect=SystemExit(74)), self.assertRaises(SystemExit):
                advance(self.admin, self.execution, root, settings, s3, transport=remote)
            with self.assertRaises(StaleExecution):
                advance(self.admin, self.execution, root, settings, s3, transport=remote)
            token = uuid4()
            self.admin.execute('UPDATE analysis.jobs SET execution_id=%s WHERE job_id=%s', (token, self.job))
            self.execution = InputExecution(self.job, self.run, token)
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 0)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis.model_requests WHERE run_id=%s', (self.run,)).fetchone()[0], 1)

    def test_unrelated_scored_transaction_cannot_be_overwritten(self):
        from scores.result_collection import save_scores
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.collected_results(root)
            self.scoring_stage()
            other = self.admin.execute("INSERT INTO analysis.jobs(analysis_date,business_at,analysis_cutoff_at,threshold_value,current_stage,status) VALUES(date '2100-01-01'+nextval('core.work_id')::int,now(),now(),.7,'FEATURES','FAILED') RETURNING job_id").fetchone()[0]
            previous = uuid4()
            self.admin.execute("INSERT INTO analysis.runs(run_id,job_id,status) VALUES(%s,%s,'COMPLETED') ON CONFLICT DO NOTHING",(previous,other))
            self.admin.execute("INSERT INTO analysis.input_transactions SELECT %s,tx_id,input_role,occurred_at,business_date,from_bank_id,to_bank_id,from_account_id,to_account_id,from_owner_id,to_owner_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version FROM analysis.input_transactions WHERE run_id=%s AND tx_id=%s",(previous,self.run,self.ids[0]))
            with self.assertRaisesRegex(ProtocolError, 'eligible'):
                save_scores(self.admin, self.execution, root, settings, s3)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis.scores JOIN analysis.runs USING(run_id) WHERE job_id=%s', (self.job,)).fetchone()[0], 0)

    def test_explicit_replacement_preserves_cancelled_run_scores(self):
        from scores.result_collection import save_scores
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.collected_results(root)
            self.scoring_stage()
            previous = uuid4()
            other = self.admin.execute("INSERT INTO analysis.jobs(analysis_date,business_at,analysis_cutoff_at,threshold_value,current_stage,status) VALUES(date '2100-01-01'+nextval('core.work_id')::int,now(),now(),.7,'FEATURES','FAILED') RETURNING job_id").fetchone()[0]
            self.admin.execute("INSERT INTO analysis.runs(run_id,job_id,status) VALUES(%s,%s,'CANCELLED')", (previous, other))
            self.admin.execute('UPDATE analysis.jobs SET current_run_id=%s WHERE job_id=%s', (previous, other))
            self.admin.execute('INSERT INTO analysis.run_replacements(run_id,replaces_run_id) VALUES(%s,%s)', (self.run, previous))
            self.admin.execute("INSERT INTO analysis.input_transactions SELECT %s,tx_id,input_role,occurred_at,business_date,from_bank_id,to_bank_id,from_account_id,to_account_id,from_owner_id,to_owner_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version FROM analysis.input_transactions WHERE run_id=%s AND tx_id=%s",(previous,self.run,self.ids[0]))
            self.admin.execute('INSERT INTO analysis.scores(tx_id,run_id,p_laundering) VALUES(%s,%s,0.8)', (self.ids[0], previous))
            save_scores(self.admin, self.execution, root, settings, s3)
            self.assertEqual(self.admin.execute('SELECT p_laundering FROM analysis.scores JOIN analysis.runs USING(run_id) WHERE job_id=%s', (other,)).fetchone()[0], 0.8)
            self.assertIsNone(self.admin.execute('SELECT run_id FROM analysis.current_scores WHERE tx_id=%s', (self.ids[0],)).fetchone())
            self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis.scores JOIN analysis.runs USING(run_id) WHERE job_id=%s', (self.job,)).fetchone()[0], 3)


    def placeholder_setup(self, root):
        from dataclasses import replace
        import httpx
        from inference.inference_dispatch import advance as advance_inference
        settings, s3 = self.publication_setup(root)
        settings = replace(settings, api_url='https://example.com')
        advance_inference(self.admin, self.execution, root, settings, s3,
                          transport=httpx.MockTransport(lambda r: httpx.Response(404)))
        return settings, s3

    def recover_placeholder(self):
        sql = (Path(__file__).resolve().parents[1] / 'recover_dev_placeholder.sql').read_text(encoding='utf-8')
        self.admin.execute(sql.replace(":'job_id'", "'" + str(self.job) + "'"))

    def test_placeholder_recovery_preserves_inputs_and_republishes_same_requests(self):
        from dataclasses import replace
        import httpx
        from inference.inference_dispatch import advance as advance_inference
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.placeholder_setup(root)
            before = self.admin.execute('SELECT model_kind,request_id,execution_round,input_artifact '
                                        'FROM analysis.model_tasks WHERE run_id=%s ORDER BY model_kind',
                                        (self.run,)).fetchall()
            self.recover_placeholder()
            self.assertEqual(before, self.admin.execute('SELECT model_kind,request_id,execution_round,input_artifact '
                             'FROM analysis.model_tasks WHERE run_id=%s ORDER BY model_kind', (self.run,)).fetchall())
            calls = []
            def remote(request):
                calls.append(json.loads(request.content))
                return httpx.Response(202, json={**calls[-1], 'status': 'ACCEPTED', 'revision': 1})
            settings = replace(settings, api_url='http://127.0.0.1:8090', allow_loopback=True)
            advance_inference(self.admin, self.execution, root, settings, s3, transport=httpx.MockTransport(remote))
            self.assertEqual(len(calls), 1)
            self.assertEqual({x['request_id'] for x in calls}, {str(x[1]) for x in before})
            self.assertEqual(self.admin.execute("SELECT count(*) FROM analysis.model_tasks WHERE run_id=%s "
                             "AND phase='WAIT_REMOTE' AND status='WAITING' AND remote_deadline_at IS NOT NULL "
                             "AND binding ? 'placeholder_recovery'", (self.run,)).fetchone()[0], 1)
            with self.assertRaises(self.psycopg.errors.RaiseException):
                self.recover_placeholder()
            self.admin.execute('ROLLBACK')

    def test_placeholder_recovery_refuses_other_endpoints_or_accepted_work_atomically(self):
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            self.placeholder_setup(root)
            for change in ("binding=jsonb_set(binding,'{publication,api_url}','\"https://real.example\"')",
                           "remote_revision=1", "remote_deadline_at=now()"):
                self.admin.execute('BEGIN')
                self.admin.execute("UPDATE analysis.model_tasks SET " + change +
                                   " WHERE run_id=%s AND model_kind='BINARY'", (self.run,))
                with self.assertRaises(self.psycopg.errors.RaiseException):
                    self.recover_placeholder()
                self.admin.execute('ROLLBACK')
                self.assertEqual(self.admin.execute("SELECT count(*) FROM analysis.model_tasks WHERE run_id=%s "
                                 "AND phase='WAIT_REMOTE' AND NOT binding ? 'placeholder_recovery'",
                                 (self.run,)).fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
