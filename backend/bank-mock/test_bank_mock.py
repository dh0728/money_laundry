import base64
import hashlib
import json
import os
from pathlib import Path
import socket
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
        self.events = []
        self.issue_status = 201
        self.put_status = 200
        self.drop_put_response = False
        self.raw_response = None
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                owner.events.append((self.path, dict(self.headers), data))
                body = owner.target if self.path == "/api/v1/bank/uploads" else {}
                self.respond(owner.issue_status, body)

            def do_PUT(self):
                data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                owner.events.append((self.path, dict(self.headers), data))
                if owner.drop_put_response:
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                self.respond(owner.put_status, {})

            def respond(self, status, body):
                encoded = owner.raw_response or json.dumps(body).encode()
                self.send_response(status)
                if 300 <= status < 400:
                    self.send_header("Location", owner.api_url + "/redirected")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.api_url = f"http://127.0.0.1:{self.server.server_port}"
        self.target = {
            "uploadId": 9, "bankId": 70, "url": self.api_url + "/object?signature=secret",
            "method": "PUT", "expiresAt": "2099-01-01T00:00:00+09:00",
            "headers": {"Content-Type": "text/csv", "X-Upload-Test": "signed",
                        "x-amz-checksum-sha256": self.checksum()},
        }

    def checksum(self):
        return base64.b64encode(hashlib.sha256(self.source.read_bytes()).digest()).decode()

    def stop_server(self):
        address = self.server.server_address
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.assertFalse(self.thread.is_alive())
        with socket.socket() as probe:
            self.assertNotEqual(probe.connect_ex(address), 0, "테스트 포트가 열려 있습니다")

    def run_cli(self, source=None, key="test-only-key", business_date="2026-09-08", extra=()):
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env.pop("BANK_API_KEY", None)
        if key is not None:
            env["BANK_API_KEY"] = key
        return subprocess.run(
            [sys.executable, "-B", str(SCRIPT), "--file", str(source or self.source),
             "--api-url", self.api_url, "--business-date", business_date, *extra],
            env=env, capture_output=True, text=True, encoding="utf-8", timeout=10,
        )

    def test_upload_request_and_bytes_without_complete(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([e[0] for e in self.events],
                         ["/api/v1/bank/uploads", "/object?signature=secret"])
        self.assertEqual(json.loads(self.events[0][2]), {
            "fileName": self.source.name, "businessDate": "2026-09-08",
            "sizeBytes": self.source.stat().st_size, "checksumSha256": self.checksum(),
        })
        self.assertEqual(self.events[0][1].get("X-Api-Key"), "test-only-key")
        headers = {k.lower(): v for k, v in self.events[1][1].items()}
        self.assertEqual(self.events[1][2], self.source.read_bytes())
        self.assertEqual(headers["content-type"], "text/csv")
        self.assertEqual(headers["x-upload-test"], "signed")
        self.assertEqual(headers["x-amz-checksum-sha256"], self.checksum())
        self.assertNotIn("x-api-key", headers)
        self.assertIn("S3 업로드 성공", result.stdout)
        self.assertIn("은행 70", result.stdout)
        self.assertNotIn("test-only-key", result.stdout + result.stderr)
        self.assertNotIn("signature=secret", result.stdout + result.stderr)

    def test_issue_rejections_do_not_put(self):
        for status in (401, 409, 413, 500, 302):
            with self.subTest(status=status):
                self.events.clear()
                self.issue_status = status
                result = self.run_cli()
                self.assertEqual(result.returncode, 1)
                self.assertIn(str(status), result.stderr)
                self.assertEqual(len(self.events), 1)

    def test_s3_rejections_and_expired_signature_do_not_retry(self):
        for status in (400, 403, 500, 307):
            with self.subTest(status=status):
                self.events.clear()
                self.put_status = status
                result = self.run_cli()
                self.assertEqual(result.returncode, 1)
                self.assertIn(str(status), result.stderr)
                self.assertEqual(len(self.events), 2)
                self.assertNotIn("S3 업로드 성공", result.stdout)

    def test_response_loss_is_uncertain_even_after_file_received(self):
        self.drop_put_response = True
        result = self.run_cli()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.events[1][2], self.source.read_bytes())
        self.assertIn("결과 불명", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_missing_empty_file_and_directory_are_input_errors(self):
        empty = self.root / "empty.csv"
        empty.touch()
        for source in (self.root / "missing.csv", empty, self.root):
            with self.subTest(source=source.name):
                result = self.run_cli(source=source)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(self.events, [])

    def test_missing_key_and_invalid_date_are_input_errors(self):
        self.assertEqual(self.run_cli(key=None).returncode, 2)
        for business_date in ("2026-02-30", "20260908", "2026-9-8"):
            self.assertEqual(self.run_cli(business_date=business_date).returncode, 2)
        self.assertEqual(self.events, [])

    def test_old_bank_and_key_arguments_are_not_supported(self):
        for extra in (("--bank", "70"), ("--api-key", "secret-cli-key")):
            with self.subTest(option=extra[0]):
                result = self.run_cli(extra=extra)
                self.assertEqual(result.returncode, 2)
                self.assertNotIn("secret-cli-key", result.stdout + result.stderr)
        self.assertEqual(self.events, [])

    def test_invalid_issue_response_does_not_put(self):
        for field, value in (("url", "file:///object"), ("url", 123), ("url", {}),
                             ("method", "POST"),
                             ("headers", {}), ("bankId", None), ("uploadId", None),
                             ("expiresAt", "invalid")):
            with self.subTest(field=field):
                old = self.target[field]
                self.target[field] = value
                self.addCleanup(self.target.__setitem__, field, old)
                self.events.clear()
                result = self.run_cli()
                self.target[field] = old
                self.assertEqual(result.returncode, 1)
                self.assertNotIn("Traceback", result.stderr)
                self.assertEqual(len(self.events), 1)

    def test_checksum_mismatch_and_bank_header_in_response_are_rejected(self):
        self.target["headers"]["x-amz-checksum-sha256"] = "wrong"
        self.assertEqual(self.run_cli().returncode, 1)
        self.assertEqual(len(self.events), 1)
        self.target["headers"]["x-amz-checksum-sha256"] = self.checksum()
        self.target["headers"]["X-Api-Key"] = "test-only-key"
        self.events.clear()
        self.assertEqual(self.run_cli().returncode, 1)
        self.assertEqual(len(self.events), 1)

    def test_error_body_secrets_are_not_printed(self):
        self.issue_status = 401
        self.raw_response = b'test-only-key https://storage.example/object?signature=secret'
        result = self.run_cli()
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("test-only-key", result.stdout + result.stderr)
        self.assertNotIn("signature=secret", result.stdout + result.stderr)

    def test_malformed_json_is_protocol_failure(self):
        self.raw_response = b"not JSON"
        result = self.run_cli()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(len(self.events), 1)
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
