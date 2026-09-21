import unittest
import json
from pathlib import Path
import tempfile
from unittest.mock import patch

from demo_calculator import build_targets, MODEL_VERSION, FEATURE_VERSION
from model_adapter import run_model
from model_contract import MODEL_ERRORS, ModelExecutionError, model_failure, retry_decision


class ModelContractTests(unittest.TestCase):
    def test_all_codes_and_stages_roundtrip(self):
        for code, rule in MODEL_ERRORS.items():
            for stage in rule.stages:
                error = ModelExecutionError(code, stage)
                self.assertEqual(ModelExecutionError.from_document(error.document()).document(), error.document())

    def test_rejects_unknown_contract_and_does_not_persist_raw_message(self):
        document = ModelExecutionError("GPU_OUT_OF_MEMORY", "INFERENCE").document()
        document["message"] = "secret URL and raw account must not leave model"
        self.assertNotIn("secret", str(ModelExecutionError.from_document(document).document()))
        for change in ({"code": "UNKNOWN"}, {"stage": "UPLOAD"}, {"retryable": True},
                       {"error_contract_version": True}, {"error_contract_version": 2}):
            with self.assertRaises(ValueError):
                ModelExecutionError.from_document(dict(document, **change))

    def test_only_transient_model_errors_retry_at_60_and_300_then_stop(self):
        for code, rule in MODEL_ERRORS.items():
            outcome = model_failure(ModelExecutionError(code, rule.stages[0]))
            delays = [retry_decision(outcome, count, 0)[1] for count in (1, 2, 3)]
            self.assertEqual(delays, [60, 300, None] if rule.retry else [None] * 3)
            self.assertEqual(retry_decision(outcome, 3, 0)[2], rule.action)

    def test_model_cannot_override_policy_and_transfer_budget_is_independent(self):
        outcome = dict(model_failure(ModelExecutionError("GPU_OUT_OF_MEMORY", "INFERENCE")), retryable=True)
        self.assertIsNone(retry_decision(outcome, 1, 0)[1])
        self.assertEqual(retry_decision({"error_code": "TRANSFER_UNAVAILABLE"}, 3, 1)[1], 30)
        self.assertIsNone(retry_decision({"error_code": "TRANSFER_ACCESS_DENIED"}, 0, 1)[1])
        bad = dict(outcome, error_code="MODEL_TEMPORARILY_UNAVAILABLE")
        with self.assertRaises(ValueError):
            retry_decision(bad, 1, 0)

    def test_adapter_returns_demo_or_safe_structured_error(self):
        targets = build_targets([1, 2])
        versions = dict(model_version=MODEL_VERSION, feature_version=FEATURE_VERSION)
        self.assertEqual(run_model(targets, "binary", **versions).num_rows, 2)
        for exception, expected in ((MemoryError("secret"), "HOST_OUT_OF_MEMORY"),
                                    (RuntimeError("secret"), "MODEL_EXECUTION_FAILED"),
                                    (ModelExecutionError("GPU_OUT_OF_MEMORY", "INFERENCE"), "GPU_OUT_OF_MEMORY")):
            with patch("model_adapter.calculate", side_effect=exception):
                with self.assertRaises(ModelExecutionError) as caught:
                    run_model(targets, "binary", **versions)
                self.assertEqual(caught.exception.code, expected)
                self.assertNotIn("secret", str(caught.exception))

    def test_child_serializes_model_error_not_raw_exception(self):
        from inference_compute import main
        error = ModelExecutionError("GPU_OUT_OF_MEMORY", "INFERENCE")
        with tempfile.TemporaryDirectory(prefix="aml-model-contract-") as directory:
            with patch("inference_compute.execute", side_effect=error):
                main(directory)
            outcome = json.loads((Path(directory) / "outcome.json").read_text())
            self.assertEqual(outcome, model_failure(error))

    def test_http_access_failure_is_not_misclassified_as_model_failure(self):
        import httpx
        from inference_compute import main
        with tempfile.TemporaryDirectory(prefix="aml-model-contract-") as directory:
            for code, expected in ((403, "TRANSFER_ACCESS_DENIED"), (503, "TRANSFER_UNAVAILABLE")):
                response = httpx.Response(code, request=httpx.Request("GET", "https://example.test/?secret=value"))
                error = httpx.HTTPStatusError("secret", request=response.request, response=response)
                with patch("inference_compute.execute", side_effect=error):
                    main(directory)
                outcome = json.loads((Path(directory) / "outcome.json").read_text())
                self.assertEqual(outcome["error_code"], expected)
                self.assertNotIn("secret", json.dumps(outcome))

    def test_existing_sqlite_state_upgrade_preserves_transfer_budget(self):
        from contextlib import closing
        import sqlite3
        import time
        from inference_service import InferenceService, Settings
        with tempfile.TemporaryDirectory(prefix="aml-model-contract-") as directory:
            with closing(sqlite3.connect(Path(directory) / "state.sqlite3")) as db:
                db.execute("""CREATE TABLE requests (
                    request_id TEXT, round INTEGER, identity TEXT, fingerprint TEXT,
                    payload TEXT, status TEXT, revision INTEGER, cancel TEXT, result TEXT,
                    error TEXT, attempts INTEGER DEFAULT 0, retry_at REAL DEFAULT 0,
                    event TEXT, notified INTEGER DEFAULT 0, notify_attempts INTEGER DEFAULT 0,
                    notify_at REAL DEFAULT 0, PRIMARY KEY(request_id,round))""")
                db.execute("""INSERT INTO requests(request_id,round,identity,status,revision,error,attempts,retry_at)
                    VALUES('legacy',1,'{}','RETRY_WAIT',3,'TRANSFER_UNAVAILABLE',2,?)""", (time.time() + 3600,))
                db.commit()
            service = InferenceService(Settings(Path(directory), "unused", "https://example.test/"))
            service.start()
            try:
                state = service.get(("legacy", 1))
                self.assertEqual(state["transfer_failures"], 2)
                self.assertEqual(state["model_failures"], 0)
                self.assertEqual(state["status"], "RETRY_WAIT")
            finally:
                service.close()


if __name__ == "__main__":
    unittest.main()
