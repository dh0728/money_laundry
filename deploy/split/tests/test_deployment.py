import importlib.util
from http.server import BaseHTTPRequestHandler, HTTPServer
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

SPLIT = Path(__file__).resolve().parents[1]
ROOT = SPLIT.parents[1]


def module(name):
    spec = importlib.util.spec_from_file_location(name, SPLIT / f"{name}.py")
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


deploy = module("deploy")
bundle = module("build_bundle")
receive = module("receive")
ssm = module("run_ssm")
rds = module("check_rds")
ACCOUNT = "123456789012"
OLD, NEW = "a" * 40, "b" * 40


class FakeRunner:
    def __init__(self):
        self.calls = []
        self.account = ACCOUNT

    def run(self, command, *, env=None, data=None):
        self.calls.append((command, env, data))
        if command[:3] == ["aws", "sts", "get-caller-identity"]:
            return self.account
        if command[:3] == ["aws", "ssm", "get-parameter"]:
            name = command[command.index("--name") + 1]
            value = "false" if name.endswith("presentation/enabled") else "secret-test-only"
            return json.dumps(value) if command[-1] == "json" else value
        return "test-only"


class Harness(deploy.Deployment):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.operations = []
        self.fail_proxy = False
        self.fail_start = False

    def compose(self, meta, *arguments, data=None):
        self.operations.append((meta["sha"], arguments[0]))
        self.runtime(meta["sha"])
        if self.fail_start and meta["sha"] == NEW and arguments[0] == "up":
            self.fail_start = False
            raise deploy.DeploymentError("Simulated startup failure")
        return ""

    def check_rds(self, meta):
        self.operations.append((meta["sha"], "rds"))

    def health(self, meta, *, proxy=False, include_backend=True):
        if proxy and self.fail_proxy and meta["sha"] == NEW:
            self.fail_proxy = False
            raise deploy.DeploymentError("Simulated proxy failure")

    def configure_nginx(self, meta):
        deploy.atomic_file(self.nginx / f"conf.d/aml-{self.environment}.conf", b"new")

    @staticmethod
    def link(path, target):
        # The transaction/file tests run on Windows as well as Linux.
        deploy.atomic_file(path, str(target).encode())


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="aml-deploy-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def engine(self, role="backend", environment="prod"):
        config = {"layout": "split", "role": role, "account_id": ACCOUNT,
                  "prod_worker_mode": "unconfigured", "drain_seconds": 0}
        deploy.atomic_json(self.root / "shared/split.json", config)
        return Harness(role, environment, ACCOUNT, root=self.root,
                       nginx=self.root / "nginx", runner=FakeRunner())

    def prior(self, engine):
        old = {"sha": OLD, "color": "blue" if engine.environment == "prod" else "dev",
               "transaction": "old"}
        deploy.atomic_json(engine.state_file, {"current": old, "previous": None})
        deploy.atomic_file(engine.nginx / f"conf.d/aml-{engine.environment}.conf", b"old")
        return old

    def test_success_keeps_previous_until_finalize(self):
        engine = self.engine()
        old = self.prior(engine)
        engine.deploy(NEW, "run1")
        self.assertEqual(engine.state()["previous"], old)
        self.assertEqual(engine.state()["current"]["color"], "green")
        self.assertNotIn((OLD, "stop"), engine.operations)
        engine.finalize("run1")
        self.assertIn((OLD, "stop"), engine.operations)
        self.assertFalse(engine.pending_file.exists())

    def test_first_deploy_uses_blue(self):
        engine = self.engine()
        engine.deploy(NEW, "run1")
        self.assertEqual(engine.state()["current"]["color"], "blue")
        engine.finalize("run1")
        self.assertIsNone(engine.state()["previous"])

    def test_proxy_failure_restores_previous_state_and_files(self):
        engine = self.engine()
        old = self.prior(engine)
        engine.fail_proxy = True
        with self.assertRaises(deploy.DeploymentError):
            engine.deploy(NEW, "run1")
        self.assertEqual(engine.state()["current"], old)
        self.assertEqual((engine.nginx / "conf.d/aml-prod.conf").read_bytes(), b"old")
        self.assertIn((NEW, "stop"), engine.operations)
        self.assertFalse(engine.pending_file.exists())

    def test_dev_failure_recreates_previous_without_stopping_restored_project(self):
        engine = self.engine(environment="dev")
        old = self.prior(engine)
        engine.fail_start = True
        with self.assertRaises(deploy.DeploymentError):
            engine.deploy(NEW, "run1")
        self.assertEqual(engine.state()["current"], old)
        self.assertIn((OLD, "up"), engine.operations)
        self.assertNotIn((NEW, "stop"), engine.operations)

    def test_first_deploy_failure_returns_to_empty_state(self):
        engine = self.engine()
        engine.fail_proxy = True
        with self.assertRaises(deploy.DeploymentError):
            engine.deploy(NEW, "run1")
        self.assertIsNone(engine.state()["current"])
        self.assertFalse((engine.nginx / "conf.d/aml-prod.conf").exists())

    def test_post_finalize_manual_rollback_restarts_previous(self):
        engine = self.engine()
        old = self.prior(engine)
        engine.deploy(NEW, "run1")
        engine.finalize("run1")
        engine.rollback("run1")
        self.assertEqual(engine.state()["current"], old)
        self.assertIn((OLD, "up"), engine.operations)
        engine.rollback("run1")  # idempotent

    def test_stale_rollback_cannot_replace_newer_deployment(self):
        engine = self.engine()
        self.prior(engine)
        engine.deploy(NEW, "run1")
        engine.finalize("run1")
        engine.deploy("c" * 40, "run2")
        with self.assertRaises(deploy.DeploymentError):
            engine.rollback("run1")
        self.assertEqual(engine.state()["current"]["transaction"], "run2")

    def test_pending_deployment_blocks_a_new_transaction(self):
        engine = self.engine()
        deploy.atomic_json(engine.pending_file, {"id": "interrupted"})
        with self.assertRaises(deploy.DeploymentError):
            engine.deploy(NEW, "run2")
        self.assertEqual(engine.operations, [])

    def test_older_rollback_cannot_interrupt_a_new_pending_transaction(self):
        engine = self.engine()
        self.prior(engine)
        engine.deploy(NEW, "run1")
        engine.finalize("run1")
        deploy.atomic_json(engine.pending_file, {"id": "run2"})
        with self.assertRaises(deploy.DeploymentError):
            engine.rollback("run1")
        self.assertEqual(deploy.read_json(engine.pending_file), {"id": "run2"})

    def test_front_does_not_fetch_application_secrets(self):
        engine = self.engine(role="front")
        self.prior(engine)
        engine.deploy(NEW, "run1")
        self.assertFalse(any(call[0][:2] == ["aws", "ssm"] for call in engine.runner.calls))
        for path in engine.state_dir.rglob("*.json"):
            self.assertNotIn("secret-test-only", path.read_text())

    def test_backend_skips_jwt_sqs_and_cloudflare(self):
        engine = self.engine()
        engine.deploy(NEW, "run1")
        names = [cmd[cmd.index("--name") + 1] for cmd, _, _ in engine.runner.calls if "--name" in cmd]
        self.assertTrue(any("analysis-db/password" in name for name in names))
        self.assertFalse(any(any(word in name for word in ("jwt", "sqs", "cloudflare")) for name in names))
        for path in engine.state_dir.rglob("*.json"):
            self.assertNotIn("secret-test-only", path.read_text())

    def test_account_and_role_mismatch_fail_before_mutations(self):
        engine = self.engine()
        with self.assertRaises(deploy.DeploymentError):
            deploy.Deployment("front", "prod", ACCOUNT, root=self.root)
        engine.runner.account = "999999999999"
        with self.assertRaises(deploy.DeploymentError):
            engine.deploy(NEW, "run1")
        self.assertFalse(engine.pending_file.exists())

    def test_snapshot_rejects_unmanaged_path(self):
        engine = self.engine()
        with self.assertRaises(deploy.DeploymentError):
            engine.restore_files([{"path": str(self.root / "outside"), "kind": "absent"}])

    def test_other_environment_pending_blocks_shared_nginx_changes(self):
        engine = self.engine()
        deploy.atomic_json(engine.state_dir / "dev-pending.json", {"id": "dev-run"})
        with self.assertRaises(deploy.DeploymentError):
            engine.deploy(NEW, "prod-run")
        self.assertEqual(engine.operations, [])

    def test_rollback_keeps_default_host_used_by_other_environment(self):
        engine = self.engine(environment="dev")
        snapshot = engine.snapshot()
        shared = engine.nginx / "conf.d/aml-default.conf"
        deploy.atomic_file(shared, b"shared-default")
        deploy.atomic_json(engine.state_dir / "prod.json", {"current": {"sha": NEW}})
        engine.restore_files(snapshot)
        self.assertEqual(shared.read_bytes(), b"shared-default")

    def test_parameter_preserves_secret_whitespace_and_special_characters(self):
        engine = self.engine()
        secret = "  pass$word\twith spaces\n"
        def parameter_result(command, **kwargs):
            if command[-1] == "json":
                return json.dumps(secret)
            return secret.strip()
        engine.runner.run = parameter_result
        self.assertEqual(engine.parameter("db/password"), secret)

    def test_front_rollback_does_not_require_backend_to_be_recovered_first(self):
        engine = self.engine(role="front")
        old = self.prior(engine)
        engine.deploy(NEW, "run1")
        checks = []
        def health(meta, *, proxy=False, include_backend=True):
            checks.append((proxy, include_backend))
            if proxy and include_backend:
                raise deploy.DeploymentError("Backend still unavailable")
        engine.health = health
        engine.rollback("run1")
        self.assertEqual(engine.state()["current"], old)
        self.assertIn((True, False), checks)

    def test_health_rejects_redirect_html_or_down_response(self):
        engine = self.engine()
        for response in ('\n302', '<html>login</html>\n200', '{"status":"DOWN"}\n200'):
            with self.subTest(response=response):
                engine.runner.run = lambda *args, **kwargs: response
                with self.assertRaises(deploy.DeploymentError):
                    deploy.Deployment.health(engine, {"color": "blue"}, proxy=True)

    def test_health_accepts_only_expected_app_responses(self):
        engine = self.engine(role="front")
        calls = []
        def response(command, **kwargs):
            calls.append(command)
            return '{"status":"UP"}\n200' if "actuator" in command[-1] else 'ok\n\n200'
        engine.runner.run = response
        deploy.Deployment.health(engine, {"color": "blue"}, proxy=True)
        self.assertEqual(len(calls), 2)
        self.assertTrue(all("--write-out" in command for command in calls))

    @unittest.skipUnless(shutil.which("curl"), "curl is required for HTTP retry coverage")
    def test_proxy_health_waits_for_new_nginx_worker(self):
        # Model reload: the old virtual host returns 404, then the new one serves health.
        requests = []
        counts = {}

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append((self.path, self.headers.get("Host")))
                counts[self.path] = counts.get(self.path, 0) + 1
                ready = counts[self.path] > 1
                body = (b'{"status":"UP"}' if "actuator" in self.path else b"ok\n") if ready else b"old host"
                self.send_response(200 if ready else 404)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            engine = self.engine(role="front", environment="dev")
            runner = deploy.Runner()

            def local_request(command, **kwargs):
                command = list(command)
                command[0] = shutil.which("curl")
                command[-1] = command[-1].replace("http://127.0.0.1", f"http://127.0.0.1:{server.server_port}", 1)
                return runner.run(command, **kwargs)

            engine.runner.run = local_request
            deploy.Deployment.health(engine, {"color": "dev"}, proxy=True)
            self.assertEqual(counts, {"/health": 2, "/api/actuator/health": 2})
            self.assertTrue(all(host == "dev.aiaml.co.kr" for _, host in requests))
        finally:
            server.shutdown()
            worker.join(timeout=5)
            server.server_close()

    def test_front_nginx_renders_private_ip_and_preserves_api_path(self):
        engine = self.engine(role="front", environment="dev")
        engine.config["backend_private_ip"] = "10.0.10.5"
        meta = {"sha": NEW, "color": "dev"}
        source = engine.release(meta) / "deploy/split/front/nginx"
        shutil.copytree(SPLIT / "front/nginx", source)
        deploy.Deployment.configure_nginx(engine, meta)
        result = (engine.nginx / "conf.d/aml-dev.conf").read_text()
        self.assertIn("server 10.0.10.5:80;", result)
        self.assertNotIn("<BACKEND_PRIVATE_IP>", result)
        self.assertIn("proxy_pass http://aml_dev_backend;", result)
        self.assertIn((["nginx", "-t"], None, None), engine.runner.calls)

    def test_backend_nginx_installs_default_and_preserves_external_scheme(self):
        engine = self.engine(environment="dev")
        meta = {"sha": NEW, "color": "dev"}
        source = engine.release(meta) / "deploy/split/backend/nginx"
        shutil.copytree(SPLIT / "backend/nginx", source)
        deploy.atomic_file(engine.nginx / "sites-enabled/default", b"old default")
        deploy.Deployment.configure_nginx(engine, meta)
        result = (engine.nginx / "conf.d/aml-dev.conf").read_text(encoding="utf-8")
        self.assertIn("X-Forwarded-Proto $http_x_forwarded_proto;", result)
        self.assertIn("proxy_pass http://aml_dev_api/actuator/health;", result)
        self.assertTrue((engine.nginx / "conf.d/aml-default.conf").exists())
        self.assertFalse((engine.nginx / "sites-enabled/default").exists())


class OrchestrationTests(unittest.TestCase):
    def test_front_failure_rolls_back_front_then_backend(self):
        calls = []
        def command(role, action):
            calls.append((role, action))
            if (role, action) == ("front", "deploy"):
                raise ssm.FailedCommand("failure")
        fake = type("FakeSSM", (), {"command": staticmethod(command)})()
        with self.assertRaises(ssm.FailedCommand):
            ssm.orchestrate(fake)
        self.assertEqual(calls, [("backend", "deploy"), ("front", "deploy"),
                                 ("front", "rollback"), ("backend", "rollback")])

    def test_unknown_ssm_status_does_not_race_remote_command(self):
        calls = []
        def command(role, action):
            calls.append((role, action))
            raise ssm.IndeterminateCommand("unknown")
        fake = type("FakeSSM", (), {"command": staticmethod(command)})()
        with self.assertRaises(ssm.IndeterminateCommand):
            ssm.orchestrate(fake)
        self.assertEqual(calls, [("backend", "deploy")])

    def test_verify_both_before_finalize(self):
        calls = []
        fake = type("FakeSSM", (), {"command": staticmethod(lambda *args: calls.append(args))})()
        ssm.orchestrate(fake)
        self.assertEqual(calls, [("backend", "deploy"), ("front", "deploy"),
                                 ("backend", "verify"), ("front", "verify"),
                                 ("front", "finalize"), ("backend", "finalize")])


class BundleTests(unittest.TestCase):
    def test_deterministic_bundle_and_no_secrets(self):
        with tempfile.TemporaryDirectory(prefix="aml-bundle-test-") as directory:
            for environment in ("dev", "prod"):
                with self.subTest(environment=environment):
                    first, second = Path(directory) / "a.tar.gz", Path(directory) / "b.tar.gz"
                    self.assertEqual(bundle.build(ROOT, environment, first), bundle.build(ROOT, environment, second))
                    with tarfile.open(first) as archive:
                        names = archive.getnames()
                        self.assertTrue(all(name.startswith("deploy/split/") for name in names))
                        self.assertFalse(any(".env" in name or "example.json" in name for name in names))
                        self.assertIn("deploy/split/check_rds.py", names)
                        for role in ("front", "backend"):
                            self.assertIn(f"deploy/split/{role}/deploy-{environment}.sh", names)
                        if environment == "prod":
                            self.assertIn("deploy/split/backend/rollback-prod.sh", names)
                    receive.extract(first, Path(directory) / environment)

    def test_path_traversal_and_symlinks_rejected(self):
        with tempfile.TemporaryDirectory(prefix="aml-archive-test-") as directory:
            archive_path = Path(directory) / "bad.tar.gz"
            for name, kind in (("../escape", tarfile.REGTYPE),
                               ("deploy/split/link", tarfile.SYMTYPE)):
                with tarfile.open(archive_path, "w:gz") as archive:
                    info = tarfile.TarInfo(name)
                    info.type = kind
                    info.linkname = "/etc/passwd" if kind == tarfile.SYMTYPE else ""
                    archive.addfile(info, io.BytesIO(b""))
                with self.assertRaises(ValueError):
                    receive.extract(archive_path, Path(directory) / "output")


class SSMCommandTests(unittest.TestCase):
    command_id = "12345678-1234-1234-1234-123456789012"

    def invoke(self, results):
        runner = ssm.SSM("dev", NEW, "run1", ACCOUNT, f"aml-deploy-artifacts-{ACCOUNT}",
                         "c" * 64, {"backend": "i-12345678901234567"})
        with patch.object(ssm.subprocess, "run", side_effect=results), patch.object(ssm.time, "sleep"), patch("builtins.print"):
            runner.command("backend", "deploy")

    def submission(self):
        return SimpleNamespace(returncode=0, stdout=self.command_id, stderr="")

    def test_waits_for_individual_success_and_zero_exit_code(self):
        self.invoke([self.submission()] + [
            SimpleNamespace(returncode=0, stdout=json.dumps({"Status": state, "ResponseCode": code}))
            for state, code in (("Pending", -1), ("InProgress", -1), ("Success", 0))])

    def test_nonzero_success_is_failure(self):
        with self.assertRaises(ssm.FailedCommand):
            self.invoke([self.submission(), SimpleNamespace(returncode=0,
                         stdout=json.dumps({"Status": "Success", "ResponseCode": 1}))])

    def test_result_access_error_leaves_status_indeterminate(self):
        with self.assertRaises(ssm.IndeterminateCommand):
            self.invoke([self.submission(), SimpleNamespace(returncode=1, stderr="AccessDenied", stdout="")])


class RDSPreflightTests(unittest.TestCase):
    def setUp(self):
        self.environment = {
            "SPRING_DATASOURCE_URL": "jdbc:postgresql://test.ap-northeast-2.rds.amazonaws.com:5432/aml_dev_v3"
            "?sslmode=verify-full&sslrootcert=/app/certs/rds-ca.pem",
            "SPRING_DATASOURCE_USERNAME": "app", "SPRING_DATASOURCE_PASSWORD": "test-app",
            "ANALYSIS_DB_USERNAME": "analysis", "ANALYSIS_DB_PASSWORD": "test-analysis",
        }
        self.connect = MagicMock()
        self.connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value.fetchone.return_value = (True,)
        self.driver = patch.dict(sys.modules, {"psycopg": SimpleNamespace(connect=self.connect)})
        self.driver.start()
        self.addCleanup(self.driver.stop)

    def test_both_roles_use_verified_tls_url_and_own_credentials(self):
        with patch.dict(os.environ, self.environment, clear=True), patch("builtins.print"):
            rds.main()
        calls = self.connect.call_args_list
        self.assertEqual([call.kwargs["user"] for call in calls], ["app", "analysis"])
        self.assertEqual([call.kwargs["password"] for call in calls], ["test-app", "test-analysis"])
        self.assertTrue(all("sslmode=verify-full" in call.args[0] for call in calls))

    def test_insecure_mode_fails_before_connection(self):
        self.environment["SPRING_DATASOURCE_URL"] = self.environment["SPRING_DATASOURCE_URL"].replace("verify-full", "require")
        with patch.dict(os.environ, self.environment, clear=True), self.assertRaises(ValueError):
            rds.main()
        self.connect.assert_not_called()

    def test_unencrypted_connection_is_rejected(self):
        self.connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value.fetchone.return_value = (False,)
        with patch.dict(os.environ, self.environment, clear=True), self.assertRaises(ValueError):
            rds.main()


if __name__ == "__main__":
    unittest.main()
