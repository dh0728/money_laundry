import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


SCRIPT = Path(__file__).with_name("bank_mock.py")


class BankMockTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bank-mock-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "은행 거래.csv"
        self.source.write_bytes(b"sample,csv\n1,2\n")
        self.target = self.root / "upload space" / self.source.name
        self.target.parent.mkdir()
        self.events = []
        self.issue_status = 201
        self.put_status = 200
        self.complete_status = 202
        self.target_url = self.target.as_uri()
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                owner.events.append((self.path, dict(self.headers), data))
                if self.path == "/api/bank/uploads":
                    status = owner.issue_status
                    body = {"uploadId": 9, "url": owner.target_url, "method": "PUT",
                            "headers": {"Content-Type": "text/csv", "X-Upload-Test": "signed"}}
                elif self.path == "/api/bank/uploads/9/complete":
                    status = owner.complete_status
                    body = {"uploadId": 9, "bankId": 70, "status": "RECEIVED"}
                else:
                    status, body = 404, {}
                if status >= 400:
                    body = {"code": "TEST_ERROR", "detail": "request rejected"}
                self.respond(status, body)

            def do_PUT(self):
                data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                owner.events.append((self.path, dict(self.headers), data))
                self.respond(owner.put_status, {})

            def respond(self, status, body):
                encoded = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.api_url = f"http://127.0.0.1:{self.server.server_port}"

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def run_cli(self, source=None, key="test-only-key"):
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env.pop("BANK_API_KEY", None)
        if key is not None:
            env["BANK_API_KEY"] = key
        return subprocess.run(
            [sys.executable, "-B", str(SCRIPT), "--bank", "00070", "--file",
             str(source or self.source), "--api-url", self.api_url],
            env=env, capture_output=True, text=True, encoding="utf-8", timeout=10,
        )

    def test_file_upload_hash_size_auth_and_complete(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.target.read_bytes(), self.source.read_bytes())
        self.assertEqual([e[0] for e in self.events],
                         ["/api/bank/uploads", "/api/bank/uploads/9/complete"])
        request = json.loads(self.events[0][2])
        self.assertEqual(request, {
            "fileName": self.source.name,
            "sizeBytes": self.source.stat().st_size,
            "sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
        })
        for _, headers, _ in self.events:
            self.assertEqual(headers.get("X-Api-Key"), "test-only-key")
        output = json.loads(result.stdout)
        self.assertEqual(output["bank"], 70)
        self.assertEqual(output["response"]["status"], "RECEIVED")
        self.assertNotIn("test-only-key", result.stdout + result.stderr)

    def test_http_put_uses_signed_headers_without_bank_key(self):
        self.target_url = self.api_url + "/object?signature=test"
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.events), 3)
        path, headers, data = self.events[1]
        self.assertEqual(path, "/object?signature=test")
        self.assertEqual(data, self.source.read_bytes())
        self.assertEqual(headers.get("Content-Type"), "text/csv")
        self.assertEqual(headers.get("X-Upload-Test"), "signed")
        self.assertNotIn("X-Api-Key", headers)

    def test_rejected_issue_does_not_copy_or_complete(self):
        self.issue_status = 401
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("401", result.stderr)
        self.assertEqual(len(self.events), 1)
        self.assertFalse(self.target.exists())

    def test_failed_put_does_not_complete(self):
        self.target_url = self.api_url + "/object"
        self.put_status = 500
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([e[0] for e in self.events], ["/api/bank/uploads", "/object"])

    def test_rejected_complete_returns_failure(self):
        self.complete_status = 409
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("409", result.stderr)

    def test_missing_file_does_not_request_upload(self):
        result = self.run_cli(source=self.root / "missing.csv")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("파일 확인 실패", result.stderr)
        self.assertEqual(self.events, [])

    def test_missing_key_does_not_request_upload(self):
        result = self.run_cli(key=None)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("BANK_API_KEY", result.stderr)
        self.assertEqual(self.events, [])

    def test_unsupported_target_does_not_complete(self):
        self.target_url = "ftp://localhost/object"
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(self.events), 1)


if __name__ == "__main__":
    unittest.main()
