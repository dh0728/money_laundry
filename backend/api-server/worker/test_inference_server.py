import dataclasses
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import socket
import tempfile
import threading
import time
import unittest
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi.testclient import TestClient
import httpx
import pyarrow.parquet as pq
import uvicorn

from demo_calculator import build_targets, FEATURE_VERSION, MODEL_VERSION
from inference_server import create_app
from inference_service import InferenceService, Settings
from worker_transport import Request, descriptor, encode


class InferenceServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="aml-inference-test-")
        self.addCleanup(self.temp.cleanup)
        self.objects, self.events = {}, []
        self.entered, self.release = threading.Event(), threading.Event()
        self.block_download = False
        self.reject_upload = False
        self.reject_callback = False
        owner = self

        class Objects(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if owner.block_download:
                    owner.entered.set()
                    owner.release.wait(10)
                data = owner.objects.get(urlsplit(self.path).path)
                try:
                    self.send_response(200 if data is not None else 404)
                    self.end_headers()
                    self.wfile.write(data or b"")
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass

            def do_PUT(self):
                data = self.rfile.read(int(self.headers["Content-Length"]))
                if not owner.reject_upload:
                    owner.objects[urlsplit(self.path).path] = data
                self.send_response(403 if owner.reject_upload else 200)
                self.end_headers()

            def do_POST(self):
                owner.events.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                owner.assertEqual(self.headers.get("Authorization"), "Bearer " + owner.callback_token)
                self.send_response(503 if owner.reject_callback else 202)
                self.end_headers()

        self.http = ThreadingHTTPServer(("127.0.0.1", 0), Objects)
        self.http.daemon_threads = True
        self.thread = threading.Thread(target=self.http.serve_forever)
        self.thread.start()
        self.addCleanup(self.stop_objects)
        self.base = f"http://127.0.0.1:{self.http.server_port}/"
        self.token, self.callback_token = "test-access-" + uuid4().hex, "test-callback-" + uuid4().hex
        self.settings = Settings(Path(self.temp.name), self.token, self.base + "dev/",
                                 self.base + "events", self.callback_token, allow_loopback=True)
        self.app = create_app(self.settings)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(lambda: self.client.__exit__(None, None, None))
        self.headers = {"Authorization": "Bearer " + self.token}

    def stop_objects(self):
        self.release.set()
        self.http.shutdown()
        self.http.server_close()
        self.thread.join(5)

    def payload(self, kind="binary"):
        request = Request(7, kind, model_version=MODEL_VERSION,
                          feature_version=FEATURE_VERSION, run_id=str(uuid4()))
        stream = io.BytesIO()
        pq.write_table(build_targets([1, 99, 100]), stream)
        data = stream.getvalue()
        key = "dev/" + request.inputs + "targets.parquet"
        self.objects["/" + key] = data
        manifest = encode(dict(request.identity(), **request.versions(), target_row_count=3,
                               files=[descriptor("targets", key, data)]))
        self.objects["/dev/" + request.manifest] = manifest
        return dict(request.identity(), **request.versions(),
                    manifest_sha256=hashlib.sha256(manifest).hexdigest(),
                    manifest_url=self.base + "dev/" + request.manifest,
                    input_url=self.base + key,
                    result_urls={name: self.base + "dev/" + request.output + name
                                 for name in ("scores.parquet", "result.json")})

    def path(self, payload):
        return f"/api/v1/inference-requests/{payload['request_id']}/rounds/{payload['execution_round']}"

    def cancel(self, payload):
        return {**{k: payload[k] for k in ("contract_version", "job_id", "run_id", "model_kind", "request_id", "execution_round")},
                "cancel_id": str(uuid4()), "reason_code": "REPORT_CORRECTED",
                "requested_at": "2026-09-21T00:00:00+00:00"}

    def wait_for(self, check, timeout=15):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = check()
            if value:
                return value
            time.sleep(0.05)
        self.fail("Timed out waiting for inference state")

    def state(self, payload):
        return self.client.get(self.path(payload), headers=self.headers).json()

    def test_end_to_end_models_and_callback(self):
        for kind in ("binary", "type"):
            payload = self.payload(kind)
            self.assertEqual(self.client.put(self.path(payload), json=payload, headers=self.headers).status_code, 202)
            self.wait_for(lambda: self.state(payload)["status"] == "COMPLETED")
            self.wait_for(lambda: self.state(payload)["notification_delivered"])
            result = self.state(payload)["result"]
            scores = pq.read_table(io.BytesIO(self.objects["/" + result["files"][0]["key"]]))
            self.assertEqual(scores.column("tx_id").to_pylist(), [1, 99, 100])
            if kind == "binary":
                self.assertEqual(scores.column("p_laundering").to_pylist(), [0.015, 0.995, 0.005])
            self.assertNotIn("manifest_url", self.state(payload))
        self.assertEqual(len(self.events), 2)

    def test_auth_scope_and_changed_request_are_rejected(self):
        payload = self.payload()
        self.assertEqual(self.client.put(self.path(payload), json=payload).status_code, 401)
        malicious = dict(payload, input_url="http://169.254.169.254/latest/meta-data/")
        response = self.client.put(self.path(payload), json=malicious, headers=self.headers)
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("169.254", response.text)
        self.assertEqual(self.client.put(self.path(payload), json=payload, headers=self.headers).status_code, 202)
        self.assertEqual(self.client.put(self.path(payload), json=payload, headers=self.headers).status_code, 200)
        changed = dict(payload, run_id=str(uuid4()))
        self.assertEqual(self.client.put(self.path(payload), json=changed, headers=self.headers).status_code, 409)

    def test_prearrival_cancel_survives_restart_and_prevents_execution(self):
        payload = self.payload()
        cancellation = self.cancel(payload)
        self.assertEqual(self.client.put(self.path(payload) + "/cancellation", json=cancellation, headers=self.headers).status_code, 200)
        self.client.__exit__(None, None, None)
        self.app = create_app(self.settings)
        self.client = TestClient(self.app)
        self.client.__enter__()
        result = self.client.put(self.path(payload), json=payload, headers=self.headers)
        self.assertEqual(result.json()["status"], "STOPPED")
        self.assertEqual(result.json()["cancellation_status"], "STOPPED")
        self.assertIsNone(self.app.state.service.process)
        altered = dict(cancellation, cancel_id=str(uuid4()))
        self.assertEqual(self.client.put(self.path(payload) + "/cancellation", json=altered, headers=self.headers).status_code, 409)

    def test_running_cancel_remains_responsive_during_download(self):
        self.block_download = True
        payload = self.payload()
        self.client.put(self.path(payload), json=payload, headers=self.headers)
        self.assertTrue(self.entered.wait(10))
        started = time.monotonic()
        response = self.client.put(self.path(payload) + "/cancellation", json=self.cancel(payload), headers=self.headers)
        self.assertEqual(response.status_code, 202)
        self.assertLess(time.monotonic() - started, 2)
        self.wait_for(lambda: self.state(payload)["status"] == "STOPPED")
        self.assertNotIn("result", self.state(payload))
        self.release.set()

    def test_upload_retry_reuses_computed_artifact_and_same_identity(self):
        self.reject_upload = True
        payload = self.payload()
        self.client.put(self.path(payload), json=payload, headers=self.headers)
        self.wait_for(lambda: self.state(payload)["status"] == "RETRY_WAIT")
        output = Path(self.temp.name) / payload["request_id"] / "1" / "scores.parquet"
        before = (output.stat().st_mtime_ns, output.read_bytes())
        refreshed = dict(payload, input_url=payload["input_url"] + "?fresh-signature")
        self.assertEqual(self.client.put(self.path(payload), json=refreshed, headers=self.headers).status_code, 200)
        self.reject_upload = False
        service = self.app.state.service
        with service.mutex, service.db:
            service.db.execute("UPDATE requests SET retry_at=0")
        self.wait_for(lambda: self.state(payload)["status"] == "COMPLETED")
        self.assertEqual(before, (output.stat().st_mtime_ns, output.read_bytes()))

    def test_callback_retry_uses_same_event_id(self):
        self.reject_callback = True
        payload = self.payload()
        self.client.put(self.path(payload), json=payload, headers=self.headers)
        self.wait_for(lambda: len(self.events) == 1)
        service = self.app.state.service
        def attempt_recorded():
            with service.mutex:
                return service.db.execute("SELECT notify_attempts FROM requests").fetchone()[0] == 1
        self.wait_for(attempt_recorded)
        self.reject_callback = False
        with service.mutex, service.db:
            service.db.execute("UPDATE requests SET notify_at=0")
        self.wait_for(lambda: self.state(payload)["notification_delivered"])
        self.assertEqual(len(self.events), 2)
        self.assertEqual(self.events[0]["event_id"], self.events[1]["event_id"])

    def test_second_server_cannot_own_same_state_directory(self):
        other = InferenceService(self.settings)
        with self.assertRaises(OSError):
            other.start()
        self.assertTrue(self.app.state.service.engine.is_alive())

    def test_completed_cancel_acknowledges_finished_without_reexecuting(self):
        payload = self.payload()
        self.client.put(self.path(payload), json=payload, headers=self.headers)
        self.wait_for(lambda: self.state(payload)["status"] == "COMPLETED")
        result = self.state(payload)["result"]
        cancellation = self.cancel(payload)
        response = self.client.put(self.path(payload) + "/cancellation", json=cancellation, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["cancellation_status"], "ALREADY_FINISHED")
        self.assertEqual(response.json()["result"], result)

    def test_uncertain_restart_never_acknowledges_model_stopped(self):
        payload = self.payload()
        service = self.app.state.service
        with service.mutex:
            service.submit(payload)
            with service.db:
                service.db.execute("UPDATE requests SET status='RUNNING'")
        self.client.__exit__(None, None, None)
        self.app = create_app(self.settings)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.assertEqual(self.state(payload)["error_code"], "RECOVERY_REQUIRED")
        response = self.client.put(self.path(payload) + "/cancellation", json=self.cancel(payload), headers=self.headers)
        self.assertEqual(response.status_code, 202)
        self.assertNotIn("cancellation_status", response.json())
        self.assertIsNone(self.app.state.service.process)

    def test_tampered_manifest_fails_without_output_upload(self):
        payload = self.payload()
        self.objects[urlsplit(payload["manifest_url"]).path] = b"tampered"
        self.client.put(self.path(payload), json=payload, headers=self.headers)
        self.wait_for(lambda: self.state(payload)["status"] == "FAILED")
        self.assertEqual(self.state(payload)["error_code"], "INPUT_OR_MODEL_INVALID")
        self.assertNotIn(urlsplit(payload["result_urls"]["scores.parquet"]).path, self.objects)

    def test_request_id_cannot_be_reused_for_another_run_across_rounds(self):
        payload = self.payload()
        self.client.put(self.path(payload) + "/cancellation", json=self.cancel(payload), headers=self.headers)
        later = dict(payload, execution_round=2, run_id=str(uuid4()))
        later["manifest_url"] = payload["manifest_url"].replace("rounds/1/", "rounds/2/")
        later["result_urls"] = {key: value.replace("rounds/1/", "rounds/2/") for key, value in payload["result_urls"].items()}
        self.assertEqual(self.client.put(self.path(later), json=later, headers=self.headers).status_code, 409)

    def test_actual_http_server_roundtrip(self):
        settings = dataclasses.replace(self.settings, directory=Path(self.temp.name) / "http-server")
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        url = f"http://127.0.0.1:{sock.getsockname()[1]}"
        server = uvicorn.Server(uvicorn.Config(create_app(settings), log_level="error", access_log=False))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]})
        thread.start()
        try:
            self.wait_for(lambda: server.started)
            payload = self.payload()
            with httpx.Client(base_url=url, headers=self.headers, trust_env=False) as client:
                self.assertEqual(client.put(self.path(payload), json=payload).status_code, 202)
                self.wait_for(lambda: client.get(self.path(payload)).json()["status"] == "COMPLETED")
        finally:
            server.should_exit = True
            thread.join(10)
            sock.close()
        self.assertFalse(thread.is_alive())


if __name__ == "__main__":
    unittest.main()
