import hashlib
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from test_deployment import ACCOUNT, NEW, OLD, FakeRunner, Harness, deploy, bundle, ROOT


class InferenceConfigurationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="aml-inference-config-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        deploy.atomic_json(self.root / "shared/split.json", dict(
            layout="split", role="backend", account_id=ACCOUNT, prod_worker_mode="unconfigured"))
        self.engine = deploy.Deployment("backend", "dev", ACCOUNT, root=self.root, runner=FakeRunner())
        self.values = {"inference/token": "local-" + "a" * 32,
                       "inference/kubesphere/url": "https://gpu.example:31575",
                       "inference/naver/url": "https://naver.example:8443"}
        original = self.engine.parameter
        self.engine.parameter = lambda name: self.values[name] if name in self.values else original(name)
        self.addCleanup(patch.stopall)
        patch.object(deploy.ssl, "create_default_context").start()

    def external(self, target="kubesphere"):
        self.engine.config["dev_inference_target"] = target
        ca = self.root / "certs/inference" / target / "ca.crt"
        ca.parent.mkdir(parents=True, exist_ok=True)
        ca.write_bytes(b"synthetic-public-ca")
        return self.engine.dev_inference()

    def secret_runner(self, kind="SecureString", token="remote-" + "b" * 32):
        original = self.engine.runner.run

        def run(command, **kwargs):
            if "Parameter" in command:
                self.engine.runner.calls.append((command, kwargs.get("env"), kwargs.get("data")))
                return json.dumps(dict(Type=kind, Value=token))
            return original(command, **kwargs)
        self.engine.runner.run = run

    def test_default_is_local_and_ignores_unselected_url(self):
        values = self.engine.runtime(NEW)
        self.assertEqual(values["DEV_INFERENCE_API_URL"], "http://127.0.0.1:8090")
        self.assertEqual(values["DEV_INFERENCE_API_TOKEN"], values["DEV_LOCAL_INFERENCE_TOKEN"])
        self.assertEqual(values["DEV_INFERENCE_ALLOW_LOOPBACK"], "true")
        self.assertEqual(values["DEV_INFERENCE_CA_FILE"], "")

    def test_external_target_reuses_dev_token_for_kubesphere_only(self):
        for target in ("kubesphere", "naver"):
            selection = self.external(target)
            self.secret_runner(token=target + "-" + "b" * 32)
            values = self.engine.runtime(NEW, inference=selection)
            self.assertEqual(values["DEV_INFERENCE_API_URL"], self.values[f"inference/{target}/url"])
            self.assertEqual(values["DEV_INFERENCE_ALLOW_LOOPBACK"], "false")
            self.assertEqual(values["DEV_INFERENCE_CA_FILE"], "/app/certs/inference-ca.crt")
            expected_path = "/aml/dev/inference/token" if target == "kubesphere" else "/aml/dev/inference/naver/token"
            if target == "kubesphere":
                self.assertEqual(values["DEV_INFERENCE_API_TOKEN"], values["DEV_LOCAL_INFERENCE_TOKEN"])
                self.assertEqual(self.engine.runtime(OLD, inference={"target": "local"})["DEV_INFERENCE_API_TOKEN"],
                                 values["DEV_INFERENCE_API_TOKEN"])
            else:
                self.assertNotEqual(values["DEV_INFERENCE_API_TOKEN"], values["DEV_LOCAL_INFERENCE_TOKEN"])
            self.assertNotIn("token", json.dumps(selection))
            self.assertTrue(any(expected_path in c[0] and "Parameter" in c[0] for c in self.engine.runner.calls))
            self.assertFalse(any("/aml/dev/inference/kubesphere/token" in c[0] for c in self.engine.runner.calls))

    def test_bad_url_ca_or_target_fails_closed(self):
        selection = self.external()
        for url in ("http://gpu.example", "https://user:pass@gpu.example", "https://gpu.example/?token=x",
                    "https://127.0.0.1:8443", "https://gpu.example/path", "https://gpu.example:bad"):
            with self.subTest(url=url), self.assertRaises(deploy.DeploymentError):
                self.engine.validate_inference(dict(selection, url=url))
        Path(selection["ca_file"]).write_bytes(b"changed")
        with self.assertRaises(deploy.DeploymentError):
            self.engine.validate_inference(selection)
        self.engine.config["dev_inference_target"] = "unknown"
        with self.assertRaises(deploy.DeploymentError):
            self.engine.dev_inference()

    def test_external_requires_secure_strong_token(self):
        selection = self.external()
        for kind, token in (("String", "x" * 32), ("SecureString", "short"),
                            ("SecureString", "x" * 32 + "\n")):
            self.secret_runner(kind, token)
            with self.assertRaises(deploy.DeploymentError):
                self.engine.runtime(NEW, inference=selection)

    def test_compose_snapshot_wins_over_current_host_selection(self):
        selection = self.external()
        self.secret_runner()
        self.engine.config["dev_inference_target"] = "naver"
        path = self.engine.release({"sha": NEW}) / "deploy/split/backend"
        path.mkdir(parents=True)
        (path / "compose.dev.yaml").write_text("services: {}")
        (path / "inference.external.yaml").write_text("services: {}")
        self.engine.compose(dict(sha=NEW, color="dev", inference=selection), "config", "--quiet")
        command, env, _ = self.engine.runner.calls[-1]
        self.assertIn(str(path / "inference.external.yaml"), command)
        self.assertEqual(env["DEV_INFERENCE_API_URL"], self.values["inference/kubesphere/url"])
        # Legacy release metadata must restore local even when the host now selects an external target.
        self.engine.compose(dict(sha=NEW, color="dev"), "up", "-d")
        command, env, _ = self.engine.runner.calls[-1]
        self.assertNotIn(str(path / "inference.external.yaml"), command)
        self.assertEqual(env["DEV_INFERENCE_API_URL"], "http://127.0.0.1:8090")

    def test_switch_checks_idle_queues_before_starting(self):
        selection = self.external()
        checker = self.engine.release({"sha": NEW}) / "deploy/split/check_rds.py"
        checker.parent.mkdir(parents=True)
        checker.write_text("# synthetic")
        with patch.object(self.engine, "compose") as compose:
            self.engine.check_rds(dict(sha=NEW, color="dev", inference=selection))
            self.assertIn("AML_REQUIRE_INFERENCE_IDLE=true", compose.call_args.args)
        with patch.object(self.engine, "compose") as compose:
            self.engine.check_rds(dict(sha=NEW, color="dev"))
            self.assertNotIn("AML_REQUIRE_INFERENCE_IDLE=true", compose.call_args.args)

    def test_production_does_not_use_dev_selection_and_bundle_limits_overlay(self):
        self.engine.environment = "prod"
        self.engine.config["dev_inference_target"] = "invalid-unused"
        values = self.engine.runtime(NEW)
        self.assertNotIn("DEV_INFERENCE_API_TOKEN", values)
        self.assertEqual(values["PROD_INFERENCE_API_URL"], "")
        self.assertTrue(any(p.name == "inference.external.yaml" for p in bundle.files(ROOT, "dev")))
        self.assertFalse(any(p.name == "inference.external.yaml" for p in bundle.files(ROOT, "prod")))
