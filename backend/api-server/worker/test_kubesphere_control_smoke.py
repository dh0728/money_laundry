"""Real loopback HTTP tests. No AWS credentials, GPU or inbound worker port required."""

from concurrent.futures import ThreadPoolExecutor
import contextlib
import io
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import uuid

import kubesphere_control_smoke as worker
from kubesphere_download_smoke import EXPECTED_SHA256
from smoke_control_server import Controller, Handler


FIXTURE = Path(__file__).resolve().parents[2] / "bank-mock/fixtures/kubesphere_smoke.csv"


def output(job_id):
    return {"schema_version": "smoke-v1", "job_id": job_id, "target_id": "smoke-1",
            "p_laundering": 0.75, "pattern_probabilities": [0.2] + [0.1] * 8}


class OutboundSmokeTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"CF_ACCESS_CLIENT_ID": "", "CF_ACCESS_CLIENT_SECRET": ""})
        self.environment.start()
        self.token = "test-only-" + uuid.uuid4().hex
        self.server = Controller(("127.0.0.1", 0), self.token, FIXTURE.read_bytes())
        self.base = self.server.public_url
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        port = self.server.server_port
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.environment.stop()
        self.assertFalse(self.thread.is_alive())
        with socket.socket() as probe:
            probe.settimeout(0.2)
            self.assertNotEqual(probe.connect_ex(("127.0.0.1", port)), 0)

    def call(self, path, body=None):
        return worker.api(self.base, self.token, path, body, allow_loopback=True)

    def start(self, seconds=0):
        return self.call("/smoke/jobs", {"job_id": str(uuid.uuid4()), "work_seconds": seconds})["job_id"]

    def work(self, **kwargs):
        return worker.work_once(self.base, self.token, poll_seconds=0.05,
                                idle_timeout=2, allow_loopback=True, **kwargs)

    def wait_for(self, predicate):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.01)
        self.fail("Timed out waiting for test event")

    def test_download_and_probabilities_return_over_outbound_http(self):
        job = self.start()
        with contextlib.redirect_stdout(io.StringIO()):
            result = self.work()
        self.assertEqual(result["status"], "COMPLETED")
        saved = self.call(f"/smoke/jobs/{job}")
        self.assertEqual(saved["result"], output(job))
        self.assertEqual(saved["events"], ["STARTED", "DOWNLOADED", "COMPLETED"])

    def test_cancel_before_download(self):
        job = self.start()
        self.call(f"/smoke/jobs/{job}/cancel", {})
        with patch.object(worker, "download") as download:
            self.assertEqual(self.work()["status"], "CANCELLED")
            download.assert_not_called()

    def test_cancel_during_processing_and_reject_late_result(self):
        job = self.start(10)
        with ThreadPoolExecutor(max_workers=1) as pool:
            running = pool.submit(self.work)
            self.wait_for(lambda: self.call(f"/smoke/jobs/{job}")["status"] == "DOWNLOADED")
            self.call(f"/smoke/jobs/{job}/cancel", {})
            self.assertEqual(running.result(timeout=3)["status"], "CANCELLED")
        late = self.call(f"/smoke/jobs/{job}/result", output(job))
        self.assertEqual(late["status"], "CANCELLED")
        self.assertNotIn("result", late)

    def test_duplicate_start_events_results_and_cancel_do_not_regress(self):
        job = self.start()
        for _ in range(2):
            self.call("/smoke/jobs", {"job_id": job, "work_seconds": 0})
            self.call(f"/smoke/jobs/{job}/events", {"event": "STARTED"})
        self.call(f"/smoke/jobs/{job}/events", {"event": "DOWNLOADED", "rows": 1, "sha256": EXPECTED_SHA256})
        for _ in range(2):
            self.call(f"/smoke/jobs/{job}/result", output(job))
        result = self.call(f"/smoke/jobs/{job}/cancel", {})
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(result["events"].count("COMPLETED"), 1)
        changed = output(job)
        changed["p_laundering"] = 0.5
        with self.assertRaisesRegex(RuntimeError, "409"):
            self.call(f"/smoke/jobs/{job}/result", changed)

    def test_bad_authentication_cannot_receive_jobs(self):
        self.start()
        with self.assertRaisesRegex(RuntimeError, "401"):
            worker.api(self.base, "wrong", "/smoke/commands", allow_loopback=True)

    def test_bad_download_reports_failure_without_result(self):
        job = self.start()
        self.server.fixture = b"corrupt input"
        result = self.work()
        self.assertEqual(result["error_code"], "DOWNLOAD_FAILED")
        self.assertNotIn("result", self.call(f"/smoke/jobs/{job}"))

    def test_model_file_result_is_validated_and_sent_to_controller(self):
        job = self.start(5)
        with tempfile.TemporaryDirectory() as directory, ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.work, model_dir=directory)
            folder = Path(directory) / job
            self.wait_for(lambda: (folder / "request.json").exists())
            self.assertEqual((folder / "input.csv").read_bytes(), FIXTURE.read_bytes())
            worker.write_message(folder / "result.json", output(job))
            self.assertEqual(future.result(timeout=3)["result"], output(job))

    def test_model_cancel_waits_for_ack_and_ignores_output(self):
        job = self.start(5)
        with tempfile.TemporaryDirectory() as directory, ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.work, model_dir=directory)
            folder = Path(directory) / job
            self.wait_for(lambda: (folder / "request.json").exists())
            self.call(f"/smoke/jobs/{job}/cancel", {})
            self.wait_for(lambda: (folder / "cancel.json").exists())
            worker.write_message(folder / "result.json", output(job))
            self.assertEqual(self.call(f"/smoke/jobs/{job}")["status"], "CANCEL_REQUESTED")
            worker.write_message(folder / "cancel_ack.json", {"job_id": job, "status": "STOPPED"})
            state = future.result(timeout=3)
            self.assertEqual(state["status"], "CANCELLED")
            self.assertNotIn("result", state)

    def test_missing_cancel_ack_does_not_claim_model_stopped(self):
        job = self.start(5)
        with tempfile.TemporaryDirectory() as directory, ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.work, model_dir=directory, cancel_timeout=0.2)
            self.wait_for(lambda: (Path(directory) / job / "request.json").exists())
            self.call(f"/smoke/jobs/{job}/cancel", {})
            self.assertEqual(future.result(timeout=3)["status"], "CANCEL_REQUESTED")

    def test_wrong_job_or_invalid_probability_is_not_saved(self):
        job = self.start(5)
        with tempfile.TemporaryDirectory() as directory, ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.work, model_dir=directory)
            folder = Path(directory) / job
            self.wait_for(lambda: (folder / "request.json").exists())
            worker.write_message(folder / "result.json", output(str(uuid.uuid4())))
            self.assertEqual(future.result(timeout=3)["error_code"], "INVALID_MODEL_RESULT")
        for value in (float("nan"), 1.1, True):
            result = output(job)
            result["p_laundering"] = value
            with self.assertRaises(ValueError):
                worker.validate_result(result, job)

    def test_lost_result_response_retries_without_duplicate_completion(self):
        self.start()
        original = Handler.reply
        dropped = []

        def lose_once(handler, code, value):
            if value.get("status") == "COMPLETED" and not dropped:
                dropped.append(True)
                handler.close_connection = True
                return
            original(handler, code, value)

        with patch.object(Handler, "reply", lose_once):
            result = self.work()
        self.assertEqual(len(dropped), 1)
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(result["events"].count("COMPLETED"), 1)

    def test_control_credentials_are_not_sent_to_input_download(self):
        self.start()
        original = Handler.handle_request
        seen = []

        def observe(handler):
            if handler.path == "/smoke/input":
                seen.append(dict(handler.headers))
            original(handler)

        with patch.dict(os.environ, {"CF_ACCESS_CLIENT_ID": "fake-id", "CF_ACCESS_CLIENT_SECRET": "fake-secret"}), \
                patch.object(Handler, "handle_request", observe):
            self.assertEqual(self.work()["status"], "COMPLETED")
        self.assertEqual(len(seen), 1)
        for key in seen[0]:
            self.assertNotIn(key.lower(), {"authorization", "cf-access-client-id", "cf-access-client-secret"})

    def test_missing_model_result_reports_timeout_not_success(self):
        self.start(0.1)
        with tempfile.TemporaryDirectory() as directory:
            state = self.work(model_dir=directory)
        self.assertEqual(state["status"], "FAILED")
        self.assertEqual(state["error_code"], "MODEL_RESULT_TIMEOUT")

    def test_cancel_racing_failed_download_is_acknowledged(self):
        job = self.start()
        entered, release = threading.Event(), threading.Event()

        def fail_download(*args, **kwargs):
            entered.set()
            if not release.wait(3):
                raise AssertionError("test release timed out")
            raise ValueError("bad file")

        with patch.object(worker, "download", fail_download), ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.work)
            try:
                self.assertTrue(entered.wait(3))
                self.call(f"/smoke/jobs/{job}/cancel", {})
            finally:
                release.set()
            self.assertEqual(future.result(timeout=3)["status"], "CANCELLED")


if __name__ == "__main__":
    unittest.main()
