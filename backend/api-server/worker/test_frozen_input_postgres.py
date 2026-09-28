"""Opt-in PostgreSQL 17 integration tests using an isolated disposable container.

Set AML_TEST_DOCKER to the existing Docker executable. No external DB is accepted.
The repository's V1-V5 SQL is applied directly; this is not a Flyway runner test.
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
        migrations = Path(__file__).resolve().parents[1] / "src/main/resources/db/migration"
        for version in range(1, 6):
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
            self.assertEqual(artifact["protocol_version"], 2)
            self.assertEqual(set(artifact["models"]), {"BINARY", "TYPE"})
            for kind, model in artifact["models"].items():
                self.assertEqual(model["model_kind"], kind)
                self.assertEqual(model["row_count"], 3)
                self.assertEqual(pq.read_table(Path(root) / model["path"]).column("tx_id").to_pylist(), self.ids)
            self.assertEqual(self.admin.execute(
                "SELECT count(*) FROM transaction_features WHERE run_id=%s", (self.run,)).fetchone()[0], 6)
            new_token = uuid4()
            self.admin.execute("UPDATE batch_jobs SET execution_id=%s WHERE job_id=%s", (new_token, self.job))
            retry = prepare_features(self.admin, InputExecution(self.job, self.run, new_token), root)
            self.assertEqual(retry, saved)
            self.assertEqual(len(list(Path(root).rglob("*.parquet"))), 2)
            self.assertEqual(list(Path(root).rglob("*.partial")), [])

    def test_cancel_before_checkpoint_does_not_complete_stage(self):
        import pipeline
        original_save = pipeline._save_prepared
        def cancel_then_save(connection, execution, kind, token, document):
            # Commit on another connection after the file and staging rows exist.
            # Cancelling inside the writer's own transaction would roll back the
            # cancellation itself and would not exercise a real correction race.
            with self.psycopg.connect(**self.connect_args) as other:
                other.execute("UPDATE analysis_runs SET status='CANCELLED' WHERE run_id=%s",
                              (self.run,))
            original_save(connection, execution, kind, token, document)
        with tempfile.TemporaryDirectory(prefix="aml-worker-test-") as root:
            with patch.object(pipeline, "_save_prepared", side_effect=cancel_then_save):
                with self.assertRaises(StaleExecution):
                    prepare_features(self.admin, self.execution, root)
            self.assertIsNone(self.admin.execute(
                "SELECT 1 FROM analysis_run_stage_results WHERE run_id=%s", (self.run,)).fetchone())
            self.assertEqual(self.admin.execute(
                "SELECT status FROM analysis_runs WHERE run_id=%s", (self.run,)).fetchone()[0], "CANCELLED")
            self.assertEqual(self.admin.execute(
                "SELECT count(*) FROM transaction_features WHERE run_id=%s", (self.run,)).fetchone()[0], 0)
            self.assertEqual(self.admin.execute(
                "SELECT count(*) FROM analysis_model_tasks WHERE run_id=%s AND input_artifact IS NOT NULL",
                (self.run,)).fetchone()[0], 0)
            self.assertEqual(len(list(Path(root).rglob("*.parquet"))), 1)
            self.assertEqual(list(Path(root).rglob("*.partial")), [])

    def test_replaced_parent_token_cannot_save_an_already_prepared_file(self):
        import pipeline
        original_save = pipeline._save_prepared
        new_token = uuid4()
        def replace_then_save(connection, execution, kind, token, document):
            with self.psycopg.connect(**self.connect_args) as other:
                other.execute("UPDATE batch_jobs SET execution_id=%s WHERE job_id=%s",
                              (new_token, self.job))
            original_save(connection, execution, kind, token, document)
        with tempfile.TemporaryDirectory(prefix="aml-worker-test-") as root:
            with patch.object(pipeline, "_save_prepared", side_effect=replace_then_save):
                with self.assertRaises(StaleExecution):
                    prepare_features(self.admin, self.execution, root)
            self.assertEqual(self.admin.execute(
                "SELECT count(*) FROM transaction_features WHERE run_id=%s", (self.run,)).fetchone()[0], 0)
            self.assertIsNone(self.admin.execute(
                "SELECT 1 FROM analysis_run_stage_results WHERE run_id=%s", (self.run,)).fetchone())
            prepare_features(self.admin, InputExecution(self.job, self.run, new_token), root)
            self.assertEqual(self.admin.execute(
                "SELECT count(*) FROM analysis_model_tasks WHERE run_id=%s AND phase='PUBLISH' AND status='READY'",
                (self.run,)).fetchone()[0], 2)

    def test_checkpoint_with_changed_file_cannot_be_reused(self):
        with tempfile.TemporaryDirectory(prefix="aml-worker-test-") as root:
            artifact = json.loads(prepare_features(self.admin, self.execution, root))
            (Path(root) / artifact["models"]["BINARY"]["path"]).write_bytes(b"changed")
            with self.assertRaisesRegex(ProtocolError, "changed"):
                prepare_features(self.admin, self.execution, root)

    def publication_setup(self, root):
        from model_publication import Settings
        prepare_features(self.admin, self.execution, root)
        self.admin.execute("UPDATE batch_jobs SET current_stage='INFERENCE' WHERE job_id=%s", (self.job,))
        return Settings('https://inference.example', 'x' * 32, 'test-bucket', 'dev/test/', 'ap-northeast-2'), MemoryS3()

    def test_publication_lost_response_reuses_request_and_enters_durable_wait(self):
        import httpx
        from model_publication import publish_model
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            bodies = []
            def remote(request):
                body = json.loads(request.content)
                bodies.append(body)
                self.assertEqual(self.admin.execute('''SELECT status FROM analysis_model_requests
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
            task = self.admin.execute('''SELECT phase,status,execution_id,binding::text FROM analysis_model_tasks
                WHERE run_id=%s AND model_kind='BINARY' ''', (self.run,)).fetchone()
            self.assertEqual(task[:3], ('WAIT_REMOTE', 'WAITING', None))
            self.assertNotIn('signature=', task[3])
            self.assertNotIn(settings.token, task[3])
            self.assertIsNone(self.admin.execute("SELECT 1 FROM analysis_run_stage_results WHERE run_id=%s AND stage='INFERENCE'", (self.run,)).fetchone())
            self.assertEqual(self.admin.execute("SELECT phase FROM analysis_model_tasks WHERE run_id=%s AND model_kind='TYPE'", (self.run,)).fetchone()[0], 'PUBLISH')
            self.assertEqual(len(s3.objects), 3)

    def test_publication_rejects_wrong_receipt_and_changed_destination(self):
        import httpx
        from dataclasses import replace
        from model_publication import publish_model
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            def wrong(request):
                return httpx.Response(202, json={**json.loads(request.content), 'run_id': str(uuid4()), 'status': 'QUEUED'})
            with self.assertRaises(ProtocolError):
                publish_model(self.admin, self.execution, 'BINARY', root, settings, s3, transport=httpx.MockTransport(wrong))
            with self.assertRaisesRegex(ProtocolError, 'destination changed'):
                publish_model(self.admin, self.execution, 'BINARY', root, replace(settings, prefix='another/'), s3)
            self.assertEqual(self.admin.execute("SELECT phase,status FROM analysis_model_tasks WHERE run_id=%s AND model_kind='BINARY'", (self.run,)).fetchone(), ('PUBLISH', 'FAILED'))

    def test_cancellation_after_s3_upload_prevents_remote_submission(self):
        import httpx
        from model_publication import publish_model
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            def cancel_before_http(*args, **kwargs):
                with self.psycopg.connect(**self.connect_args) as other:
                    other.execute("UPDATE analysis_runs SET status='CANCELLED' WHERE run_id=%s", (self.run,))
                return 'https://objects.example/test'
            s3.generate_presigned_url = cancel_before_http
            calls = []
            with self.assertRaises(StaleExecution):
                publish_model(self.admin, self.execution, 'BINARY', root, settings, s3,
                              transport=httpx.MockTransport(lambda request: calls.append(request)))
            self.assertEqual(calls, [])
            self.assertEqual(self.admin.execute("SELECT status FROM analysis_model_requests WHERE run_id=%s", (self.run,)).fetchone()[0], 'REGISTERED')

    def test_cancellation_after_remote_acceptance_blocks_local_wait_commit(self):
        import httpx
        from model_publication import publish_model
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            def cancelled(request):
                with self.psycopg.connect(**self.connect_args) as other:
                    other.execute("UPDATE analysis_runs SET status='CANCEL_REQUESTED' WHERE run_id=%s", (self.run,))
                return httpx.Response(202, json={**json.loads(request.content), 'status': 'QUEUED'})
            with self.assertRaises(StaleExecution):
                publish_model(self.admin, self.execution, 'BINARY', root, settings, s3, transport=httpx.MockTransport(cancelled))
            self.assertEqual(self.admin.execute("SELECT status FROM analysis_model_requests WHERE run_id=%s", (self.run,)).fetchone()[0], 'PUBLISHED')
            self.assertEqual(self.admin.execute("SELECT phase FROM analysis_model_tasks WHERE run_id=%s AND model_kind='BINARY'", (self.run,)).fetchone()[0], 'PUBLISH')

    def test_single_entry_dispatches_publication_without_completing_inference(self):
        import httpx
        from analysis_entry import main
        from model_publication import publish_model
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            transport = httpx.MockTransport(lambda request: httpx.Response(
                202, json={**json.loads(request.content), 'status': 'QUEUED'}))
            env = dict(WORKER_MODE='demo', WORKER_STORAGE_DIR=root,
                       WORKER_DB_URL=f"postgresql://127.0.0.1:{self.connect_args['port']}/postgres",
                       WORKER_DB_USER='postgres', WORKER_DB_PASSWORD=self.connect_args['password'])
            def dispatch(*args, **kwargs):
                return publish_model(*args, **kwargs, transport=transport)
            with patch.dict(os.environ, env), patch('model_publication.configured', return_value=(settings, s3)), patch(
                    'model_publication.publish_model', side_effect=dispatch):
                code = main(['--job-id', str(self.job), '--run-id', str(self.run),
                             '--execution-id', str(self.token), '--stage', 'INFERENCE',
                             '--operation', 'PUBLISH', '--model-kind', 'TYPE'])
            self.assertEqual(code, 0)
            self.assertEqual(self.admin.execute("SELECT phase,status FROM analysis_model_tasks WHERE run_id=%s AND model_kind='TYPE'", (self.run,)).fetchone(), ('WAIT_REMOTE', 'WAITING'))
            self.assertIsNone(self.admin.execute("SELECT 1 FROM analysis_run_stage_results WHERE run_id=%s AND stage='INFERENCE'", (self.run,)).fetchone())

    def test_unstopped_predecessor_blocks_publication_without_side_effects(self):
        from model_publication import publish_model
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            old = uuid4()
            self.admin.execute("INSERT INTO analysis_runs(run_id,job_id,status) VALUES(%s,%s,'CANCEL_REQUESTED')", (old, self.job))
            self.admin.execute("INSERT INTO analysis_run_replacements VALUES(%s,%s)", (self.run, old))
            self.admin.execute("INSERT INTO analysis_model_requests VALUES(%s,1,%s,'BINARY','PUBLISHED')", (uuid4(), old))
            with self.assertRaises(StaleExecution):
                publish_model(self.admin, self.execution, 'BINARY', root, settings, s3)
            self.assertEqual(s3.objects, {})
            self.assertEqual(self.admin.execute("SELECT count(*) FROM analysis_model_requests WHERE run_id=%s", (self.run,)).fetchone()[0], 0)

    def inference_remote(self, s3):
        import httpx
        from worker_transport import Request
        bodies, states = {}, {}
        def remote(req):
            key = req.url.path.split('/')[-3]
            if req.method == 'PUT':
                bodies[key] = json.loads(req.content)
            body = bodies[key]
            status, revision = states.get(body['model_kind'], ('RUNNING', 1))
            response = {**body, 'status': status, 'revision': revision}
            if status == 'COMPLETED':
                logical = Request(body['job_id'], body['model_kind'].lower(), body['request_id'],
                                  body['execution_round'], body['model_version'], body['feature_version'], body['run_id'])
                from demo_calculator import build_targets, calculate
                from worker_transport import descriptor
                stream = io.BytesIO()
                scores = calculate(build_targets(self.ids), logical.model_kind,
                    model_version=logical.model_version, feature_version=logical.feature_version)
                if logical.model_kind == 'binary' and hasattr(self, 'score_values'):
                    import pyarrow as pa
                    scores = scores.set_column(1, 'p_laundering', pa.array(self.score_values, type=pa.float64()))
                pq.write_table(scores, stream)
                key = 'dev/test/' + logical.output + 'scores.parquet'
                s3.objects[key] = stream.getvalue()
                response['result'] = dict(logical.identity(), **logical.versions(), status='COMPLETED',
                    row_count=len(self.ids), files=[descriptor('scores', key, stream.getvalue())])
            elif status == 'FAILED':
                response['error_code'] = 'GPU_OUT_OF_MEMORY'
            return httpx.Response(202 if req.method == 'PUT' else 200, json=response)
        return httpx.MockTransport(remote), states

    def make_observations_due(self):
        self.admin.execute("UPDATE analysis_model_tasks SET next_poll_at=now()-interval '1 second',retry_at=now()-interval '1 second' WHERE run_id=%s", (self.run,))

    def test_dispatch_completes_inference_only_after_both_results_are_validated(self):
        from inference_dispatch import advance
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            remote, states = self.inference_remote(s3)
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 76)
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 76)
            self.assertEqual(self.admin.execute('SELECT sum(consecutive_failures) FROM analysis_model_tasks WHERE run_id=%s', (self.run,)).fetchone()[0], 0)
            states.update(BINARY=('COMPLETED', 2), TYPE=('COMPLETED', 2))
            self.make_observations_due()
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 0)
            self.assertEqual(self.admin.execute("SELECT count(*) FROM analysis_model_tasks WHERE run_id=%s AND phase='DONE' AND status='SUCCEEDED'", (self.run,)).fetchone()[0], 2)
            self.assertIsNotNone(self.admin.execute("SELECT 1 FROM analysis_run_stage_results WHERE run_id=%s AND stage='INFERENCE'", (self.run,)).fetchone())

    def test_failed_model_does_not_stop_other_model_observation(self):
        from inference_dispatch import advance
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            remote, states = self.inference_remote(s3)
            advance(self.admin, self.execution, root, settings, s3, transport=remote)
            states['BINARY'] = ('FAILED', 2)
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 76)
            self.assertEqual(self.admin.execute("SELECT error_code FROM analysis_model_tasks WHERE run_id=%s AND model_kind='BINARY'", (self.run,)).fetchone()[0], 'GPU_OUT_OF_MEMORY')
            states['TYPE'] = ('COMPLETED', 2)
            self.make_observations_due()
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 77)
            self.assertEqual(self.admin.execute("SELECT phase FROM analysis_model_tasks WHERE run_id=%s AND model_kind='TYPE'", (self.run,)).fetchone()[0], 'DONE')

    def test_observation_revision_fences_conflicts_and_deadline_does_not_restart_model(self):
        from inference_dispatch import advance, observe_model
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            remote, states = self.inference_remote(s3)
            advance(self.admin, self.execution, root, settings, s3, transport=remote)
            states['BINARY'] = ('RUNNING', 4)
            observe_model(self.admin, self.execution, 'BINARY', settings, transport=remote)
            states['BINARY'] = ('COMPLETED', 3)
            observe_model(self.admin, self.execution, 'BINARY', settings, transport=remote)
            self.assertEqual(self.admin.execute("SELECT phase FROM analysis_model_tasks WHERE run_id=%s AND model_kind='BINARY'", (self.run,)).fetchone()[0], 'WAIT_REMOTE')
            states['BINARY'] = ('COMPLETED', 4)
            with self.assertRaisesRegex(ProtocolError, 'Conflicting'):
                observe_model(self.admin, self.execution, 'BINARY', settings, transport=remote)
            states['BINARY'] = ('RUNNING', 4)
            self.admin.execute("UPDATE analysis_model_tasks SET remote_deadline_at=now()-interval '1 second' WHERE run_id=%s", (self.run,))
            observe_model(self.admin, self.execution, 'BINARY', settings, transport=remote)
            self.assertEqual(self.admin.execute("SELECT status,error_code,action_required FROM analysis_model_tasks WHERE run_id=%s AND model_kind='BINARY'", (self.run,)).fetchone(), ('WAITING', 'REMOTE_WAIT_EXPIRED', True))
            self.assertEqual(self.admin.execute("SELECT count(*) FROM analysis_model_requests WHERE run_id=%s", (self.run,)).fetchone()[0], 2)

    def test_ambiguous_publication_budget_switches_to_observation_without_new_round(self):
        import httpx
        from inference_dispatch import advance
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
            self.assertEqual(len(puts), 6)
            self.assertEqual(len({b['request_id'] for b in puts}), 2)
            self.assertEqual({b['execution_round'] for b in puts}, {1})
            self.assertEqual(self.admin.execute("SELECT count(*) FROM analysis_model_tasks WHERE run_id=%s AND phase='WAIT_REMOTE' AND status='WAITING' AND action_required", (self.run,)).fetchone()[0], 2)
            self.make_observations_due()
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=transport), 76)
            self.assertEqual(len(puts), 6)

    def test_result_metadata_mismatch_cannot_schedule_collection(self):
        import httpx
        from inference_dispatch import advance, observe_model
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
            self.assertEqual(self.admin.execute("SELECT phase FROM analysis_model_tasks WHERE run_id=%s AND model_kind='BINARY'", (self.run,)).fetchone()[0], 'WAIT_REMOTE')


    def collected_results(self, root):
        from inference_dispatch import advance
        settings, s3 = self.publication_setup(root)
        remote, states = self.inference_remote(s3)
        advance(self.admin, self.execution, root, settings, s3, transport=remote)
        states.update(BINARY=('COMPLETED', 2), TYPE=('COMPLETED', 2))
        self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 0)
        return settings, s3

    def scoring_stage(self):
        self.admin.execute("UPDATE batch_jobs SET current_stage='SCORES',threshold_value=0.5 WHERE job_id=%s", (self.job,))

    def test_scores_atomic_join_percentile_and_retry_without_duplicates(self):
        from result_collection import save_scores
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.collected_results(root)
            self.scoring_stage()
            save_scores(self.admin, self.execution, root, settings, s3)
            rows = self.admin.execute('''SELECT tx_id,p_laundering,score_pct,run_id FROM inference_results
                WHERE job_id=%s ORDER BY p_laundering''', (self.job,)).fetchall()
            self.assertEqual({r[0] for r in rows}, set(self.ids))
            self.assertEqual([r[2] for r in rows], [0, 50, 100])
            self.assertEqual({r[3] for r in rows}, {self.run})
            self.assertEqual(self.admin.execute('SELECT count(*) FROM transactions WHERE scored_job_id=%s', (self.job,)).fetchone()[0], 3)
            self.assertEqual(self.admin.execute('SELECT row_count,model_version_binary,feature_version_type FROM batch_jobs WHERE job_id=%s', (self.job,)).fetchone(), (3, 'demo-calculator-v1', 'demo-input-v1'))
            self.token = uuid4()
            self.admin.execute('UPDATE batch_jobs SET execution_id=%s WHERE job_id=%s', (self.token, self.job))
            self.execution = InputExecution(self.job, self.run, self.token)
            save_scores(self.admin, self.execution, root, settings, s3)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM inference_results WHERE job_id=%s', (self.job,)).fetchone()[0], 3)
            self.assertEqual(self.admin.execute("SELECT execution_id FROM analysis_run_stage_results WHERE run_id=%s AND stage='SCORES'", (self.run,)).fetchone()[0], self.token)

    def test_score_storage_failure_rolls_back_rows_markers_and_checkpoint(self):
        from result_collection import save_scores
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.collected_results(root)
            self.scoring_stage()
            self.admin.execute('''CREATE FUNCTION reject_test_scores() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF NEW.stage='SCORES' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$''')
            self.admin.execute('''CREATE TRIGGER reject_test_scores BEFORE INSERT ON analysis_run_stage_results
                FOR EACH ROW EXECUTE FUNCTION reject_test_scores()''')
            try:
                with self.assertRaises(self.psycopg.Error):
                    save_scores(self.admin, self.execution, root, settings, s3)
                self.assertEqual(self.admin.execute('SELECT count(*) FROM inference_results WHERE job_id=%s', (self.job,)).fetchone()[0], 0)
                self.assertEqual(self.admin.execute('SELECT count(*) FROM transactions WHERE scored_job_id=%s', (self.job,)).fetchone()[0], 0)
                self.assertIsNone(self.admin.execute("SELECT 1 FROM analysis_run_stage_results WHERE run_id=%s AND stage='SCORES'", (self.run,)).fetchone())
            finally:
                self.admin.execute('DROP TRIGGER reject_test_scores ON analysis_run_stage_results')
                self.admin.execute('DROP FUNCTION reject_test_scores()')
            save_scores(self.admin, self.execution, root, settings, s3)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM inference_results WHERE job_id=%s', (self.job,)).fetchone()[0], 3)

    def test_missing_local_result_is_restored_without_resubmitting_model(self):
        from result_collection import save_scores
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.collected_results(root)
            for (artifact,) in self.admin.execute('SELECT result_artifact FROM analysis_model_tasks WHERE run_id=%s', (self.run,)):
                (Path(root) / artifact['path']).unlink()
            self.scoring_stage()
            save_scores(self.admin, self.execution, root, settings, s3)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM inference_results WHERE job_id=%s', (self.job,)).fetchone()[0], 3)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis_model_requests WHERE run_id=%s', (self.run,)).fetchone()[0], 2)

    def test_cancel_after_score_staging_blocks_every_persistent_write(self):
        import result_collection
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.collected_results(root)
            self.scoring_stage()
            stage = result_collection._stage
            def cancel(*args):
                stage(*args)
                if args[2] == 'TYPE':
                    self.admin.execute("UPDATE analysis_runs SET status='CANCEL_REQUESTED' WHERE run_id=%s", (self.run,))
            with patch('result_collection._stage', side_effect=cancel), self.assertRaises(StaleExecution):
                result_collection.save_scores(self.admin, self.execution, root, settings, s3)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM inference_results WHERE job_id=%s', (self.job,)).fetchone()[0], 0)

    def test_collection_rejects_corrupt_file_but_preserves_peer_and_request(self):
        from inference_dispatch import advance
        from result_collection import _download
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            remote, states = self.inference_remote(s3)
            advance(self.admin, self.execution, root, settings, s3, transport=remote)
            states.update(BINARY=('COMPLETED', 2), TYPE=('COMPLETED', 2))
            def corrupt(client, bucket, descriptor, path):
                if '/BINARY/' in descriptor['key']:
                    client.objects[descriptor['key']] = b'corrupt'
                _download(client, bucket, descriptor, path)
            with patch('result_collection._download', side_effect=corrupt):
                self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 77)
            self.assertEqual(self.admin.execute("SELECT phase,status,error_code FROM analysis_model_tasks WHERE run_id=%s AND model_kind='BINARY'", (self.run,)).fetchone(), ('COLLECT', 'FAILED', 'RESULT_INVALID'))
            self.assertEqual(self.admin.execute("SELECT status FROM analysis_model_tasks WHERE run_id=%s AND model_kind='TYPE'", (self.run,)).fetchone()[0], 'SUCCEEDED')
            self.assertIsNone(self.admin.execute("SELECT 1 FROM analysis_run_stage_results WHERE run_id=%s AND stage='INFERENCE'", (self.run,)).fetchone())
            self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis_model_requests WHERE run_id=%s', (self.run,)).fetchone()[0], 2)

    def test_result_validation_rejects_invalid_probabilities_ids_and_schema(self):
        import pyarrow as pa
        from demo_calculator import build_targets, calculate, MODEL_VERSION, FEATURE_VERSION
        from result_collection import _stage
        self.admin.execute("UPDATE batch_jobs SET current_stage='INFERENCE' WHERE job_id=%s", (self.job,))
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
                        _stage(self.admin, self.execution, 'BINARY', path, 3, 'INFERENCE')
            types = calculate(build_targets(self.ids), 'type', model_version=MODEL_VERSION, feature_version=FEATURE_VERSION)
            types = types.set_column(1, 'p_0', pa.array([1.0]*3))
            pq.write_table(types, path)
            with self.assertRaises(ProtocolError):
                _stage(self.admin, self.execution, 'TYPE', path, 3, 'INFERENCE')

    def test_collection_transient_retry_does_not_rerun_successful_model(self):
        from inference_dispatch import advance
        from botocore.exceptions import EndpointConnectionError
        from result_collection import _download
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            remote, states = self.inference_remote(s3)
            advance(self.admin, self.execution, root, settings, s3, transport=remote)
            states.update(BINARY=('COMPLETED', 2), TYPE=('COMPLETED', 2))
            def unavailable(client, bucket, descriptor, path):
                if '/BINARY/' in descriptor['key']:
                    raise EndpointConnectionError(endpoint_url='https://objects.example')
                _download(client, bucket, descriptor, path)
            with patch('result_collection._download', side_effect=unavailable):
                self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 76)
            peer = self.admin.execute("SELECT result_artifact FROM analysis_model_tasks WHERE run_id=%s AND model_kind='TYPE'", (self.run,)).fetchone()[0]
            self.make_observations_due()
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 0)
            self.assertEqual(self.admin.execute("SELECT result_artifact FROM analysis_model_tasks WHERE run_id=%s AND model_kind='TYPE'", (self.run,)).fetchone()[0], peer)

    def test_percentile_ties_have_equal_rank_and_threshold_count_uses_raw_score(self):
        from result_collection import save_scores
        self.score_values = [0.5, 0.5, 0.9]
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.collected_results(root)
            self.scoring_stage()
            save_scores(self.admin, self.execution, root, settings, s3)
            self.assertEqual(self.admin.execute('SELECT p_laundering,score_pct FROM inference_results WHERE job_id=%s ORDER BY tx_id', (self.job,)).fetchall(), [(0.5, 0.0), (0.5, 0.0), (0.9, 100.0)])
            self.assertEqual(self.admin.execute('SELECT suspicious_tx_count FROM batch_jobs WHERE job_id=%s', (self.job,)).fetchone()[0], 3)

    def test_collection_cancel_after_download_does_not_publish_artifact(self):
        from inference_dispatch import advance
        from result_collection import _download
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            remote, states = self.inference_remote(s3)
            advance(self.admin, self.execution, root, settings, s3, transport=remote)
            states.update(BINARY=('COMPLETED', 2), TYPE=('COMPLETED', 2))
            def cancel(*args):
                _download(*args)
                self.admin.execute("UPDATE analysis_runs SET status='CANCEL_REQUESTED' WHERE run_id=%s", (self.run,))
            with patch('result_collection._download', side_effect=cancel), self.assertRaises(StaleExecution):
                advance(self.admin, self.execution, root, settings, s3, transport=remote)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis_model_tasks WHERE run_id=%s AND result_artifact IS NOT NULL', (self.run,)).fetchone()[0], 0)

    def test_abandoned_collection_is_fenced_and_new_parent_recovers_same_request(self):
        from inference_dispatch import advance
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.publication_setup(root)
            remote, states = self.inference_remote(s3)
            advance(self.admin, self.execution, root, settings, s3, transport=remote)
            states.update(BINARY=('COMPLETED', 2), TYPE=('COMPLETED', 2))
            with patch('result_collection._stage', side_effect=SystemExit(74)), self.assertRaises(SystemExit):
                advance(self.admin, self.execution, root, settings, s3, transport=remote)
            with self.assertRaises(StaleExecution):
                advance(self.admin, self.execution, root, settings, s3, transport=remote)
            token = uuid4()
            self.admin.execute('UPDATE batch_jobs SET execution_id=%s WHERE job_id=%s', (token, self.job))
            self.execution = InputExecution(self.job, self.run, token)
            self.assertEqual(advance(self.admin, self.execution, root, settings, s3, transport=remote), 0)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM analysis_model_requests WHERE run_id=%s', (self.run,)).fetchone()[0], 2)

    def test_unrelated_scored_transaction_cannot_be_overwritten(self):
        from result_collection import save_scores
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.collected_results(root)
            self.scoring_stage()
            other = self.admin.execute("INSERT INTO batch_jobs(job_type,status) VALUES('ANALYSIS','FAILED') RETURNING job_id").fetchone()[0]
            self.admin.execute('UPDATE transactions SET scored_job_id=%s WHERE tx_id=%s', (other, self.ids[0]))
            with self.assertRaisesRegex(ProtocolError, 'eligible'):
                save_scores(self.admin, self.execution, root, settings, s3)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM inference_results WHERE job_id=%s', (self.job,)).fetchone()[0], 0)

    def test_explicit_replacement_preserves_cancelled_run_scores(self):
        from result_collection import save_scores
        with tempfile.TemporaryDirectory(prefix='aml-worker-test-') as root:
            settings, s3 = self.collected_results(root)
            self.scoring_stage()
            previous = uuid4()
            other = self.admin.execute("INSERT INTO batch_jobs(job_type,status) VALUES('ANALYSIS','FAILED') RETURNING job_id").fetchone()[0]
            self.admin.execute("INSERT INTO analysis_runs(run_id,job_id,status) VALUES(%s,%s,'CANCELLED')", (previous, other))
            self.admin.execute('UPDATE batch_jobs SET current_run_id=%s WHERE job_id=%s', (previous, other))
            self.admin.execute('INSERT INTO analysis_run_replacements(run_id,replaces_run_id) VALUES(%s,%s)', (self.run, previous))
            self.admin.execute('UPDATE transactions SET scored_job_id=%s WHERE tx_id=%s', (other, self.ids[0]))
            self.admin.execute('''INSERT INTO inference_results(job_id,tx_id,run_id,p_laundering,p_0,p_1,p_2,p_3,p_4,p_5,p_6,p_7,p_8)
                VALUES(%s,%s,%s,0.8,1,0,0,0,0,0,0,0,0)''', (other, self.ids[0], previous))
            save_scores(self.admin, self.execution, root, settings, s3)
            self.assertEqual(self.admin.execute('SELECT p_laundering FROM inference_results WHERE job_id=%s', (other,)).fetchone()[0], 0.8)
            self.assertEqual(self.admin.execute('SELECT scored_job_id FROM transactions WHERE tx_id=%s', (self.ids[0],)).fetchone()[0], self.job)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM inference_results WHERE job_id=%s', (self.job,)).fetchone()[0], 3)


if __name__ == "__main__":
    unittest.main()
