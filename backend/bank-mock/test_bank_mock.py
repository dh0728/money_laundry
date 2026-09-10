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
from unittest.mock import patch
import io
import bank_mock
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
                body = owner.target if self.path == "/api/v1/bank/uploads" else owner.result
                self.respond(owner.issue_status if self.path == "/api/v1/bank/uploads" else 202, body)

            def do_GET(self):
                owner.events.append((self.path, dict(self.headers), b""))
                self.respond(200, owner.result)

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
        self.result = {"uploadId": 9, "bankId": 70, "fileName": self.source.name,
                       "businessDate": "2026-09-08", "sizeBytes": self.source.stat().st_size,
                       "status": "COMPLETED", "rowCount": 1, "insertedCount": 1,
                       "receivedAt": "2026-09-09T15:00:00+09:00", "finishedAt": "2026-09-09T15:00:01+09:00",
                       "errors": []}
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

    def run_cli(self, source=None, bank_id="70", business_date="2026-09-08", extra=(), cf=("", ""), lookup=False):
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env.pop("BANK_API_KEY", None)
        env["CF_ACCESS_CLIENT_ID"], env["CF_ACCESS_CLIENT_SECRET"] = cf
        mode = ["--upload-id", "9"] if lookup else ["--file", str(source or self.source), "--business-date", business_date]
        return subprocess.run(
            [sys.executable, "-B", str(SCRIPT), *mode,
             "--api-url", self.api_url,
             *(["--bank-id", bank_id] if bank_id is not None else []), *extra],
            env=env, capture_output=True, text=True, encoding="utf-8", timeout=10,
        )

    def test_upload_request_bytes_complete_and_result(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([e[0] for e in self.events],
                         ["/api/v1/bank/uploads", "/object?signature=secret", "/api/v1/bank/uploads/9/complete"])
        self.assertEqual(json.loads(self.events[0][2]), {
            "fileName": self.source.name, "businessDate": "2026-09-08",
            "sizeBytes": self.source.stat().st_size, "checksumSha256": self.checksum(),
        })
        self.assertEqual(self.events[0][1].get("X-Bank-Id"), "70")
        headers = {k.lower(): v for k, v in self.events[1][1].items()}
        self.assertEqual(self.events[1][2], self.source.read_bytes())
        self.assertEqual(headers["content-type"], "text/csv")
        self.assertEqual(headers["x-upload-test"], "signed")
        self.assertEqual(headers["x-amz-checksum-sha256"], self.checksum())
        self.assertNotIn("x-api-key", headers)
        self.assertNotIn("x-bank-id", headers)
        self.assertEqual(self.events[2][1].get("X-Bank-Id"), "70")
        self.assertIn("원장 적재 완료", result.stdout)
        self.assertIn("적재 행 수: 1", result.stdout)
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

    def test_missing_bank_invalid_bank_and_date_are_input_errors(self):
        for bank_id in (None, "", "-1", "abc", "2147483648", "1.5"):
            self.assertEqual(self.run_cli(bank_id=bank_id).returncode, 2)
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
                             ("headers", {}), ("bankId", None), ("bankId", 12), ("uploadId", None),
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
        self.target["headers"]["X-Bank-Id"] = "70"
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

    def test_result_lookup_without_upload(self):
        env = os.environ.copy()
        env.pop("BANK_API_KEY", None)
        env["PYTHONIOENCODING"] = "utf-8"
        env["CF_ACCESS_CLIENT_ID"] = env["CF_ACCESS_CLIENT_SECRET"] = ""
        result = subprocess.run([sys.executable, "-B", str(SCRIPT), "--api-url", self.api_url,
                                 "--bank-id", "70", "--upload-id", "9"], env=env, capture_output=True,
                                text=True, encoding="utf-8", timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([event[0] for event in self.events], ["/api/v1/bank/uploads/9"])
        self.assertEqual(self.events[0][1].get("X-Bank-Id"), "70")

    def test_result_bank_mismatch_is_rejected(self):
        self.result["bankId"] = 12
        result = self.run_cli()
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("원장 적재 완료", result.stdout)

    def test_validation_failure_explains_reupload(self):
        self.result.update(status="VALIDATION_FAILED", insertedCount=0,
                           errors=[{"row": 2, "column": "Account", "reason": "필수값 없음"}])
        result = self.run_cli()
        self.assertEqual(result.returncode, 1)
        self.assertIn("재업로드", result.stdout)
        self.assertIn("Account", result.stdout)

    def test_server_failure_does_not_claim_no_inserts(self):
        self.result.update(status="FAILED", insertedCount=1, errorMessage="secret internal data")
        result = self.run_cli()
        self.assertEqual(result.returncode, 1)
        self.assertIn("관리자", result.stdout)
        self.assertNotIn("secret internal data", result.stdout + result.stderr)

    def test_polling_and_timeout_use_clock_without_waiting(self):
        opener = object()
        args = type("Args", (), {"api_url": self.api_url, "bank_id": 70})()
        with patch.object(bank_mock, "request_status", return_value=self.result), patch.object(bank_mock.time, "sleep") as sleep:
            result = bank_mock.wait_result(opener, args, 9, {"status": "RECEIVED"})
            self.assertEqual(result["status"], "COMPLETED")
            sleep.assert_called_once_with(2)
        with patch.object(bank_mock.time, "monotonic", side_effect=[0, 1801]), patch.object(bank_mock.time, "sleep"):
            with self.assertRaises(TimeoutError):
                bank_mock.wait_result(opener, args, 9, {"status": "RUNNING"})

    def test_cf_headers_only_reach_api_requests(self):
        cf = ("FAKE-CF-CLIENT-ID", "FAKE-CF-CLIENT-SECRET")
        self.assertEqual(self.run_cli(cf=cf).returncode, 0)
        self.assertEqual(self.run_cli(cf=cf, lookup=True).returncode, 0)
        for path, raw_headers, _ in self.events:
            headers = {k.lower(): v for k, v in raw_headers.items()}
            if path.startswith("/api/"):
                self.assertTrue(headers.get("user-agent") == "AML-Bank-Upload-Mock/1.0", "API User-Agent mismatch")
                self.assertTrue(headers.get("cf-access-client-id") == cf[0], "CF client ID header mismatch")
                self.assertTrue(headers.get("cf-access-client-secret") == cf[1], "CF client secret header mismatch")
                self.assertTrue(headers.get("x-bank-id") == "70", "Bank header mismatch")
            else:
                self.assertTrue(headers.get("user-agent") != "AML-Bank-Upload-Mock/1.0", "API User-Agent reached S3")
                for name in ("cf-access-client-id", "cf-access-client-secret", "x-bank-id", "authorization", "cookie"):
                    self.assertTrue(name not in headers, "Forbidden header reached S3")

    def test_partial_cf_configuration_stops_before_network(self):
        for cf in (("FAKE-ID", ""), ("", "FAKE-SECRET")):
            for lookup in (False, True):
                with self.subTest(lookup=lookup):
                    result = self.run_cli(cf=cf, lookup=lookup)
                    self.assertEqual(result.returncode, 2)
                    self.assertFalse(bool(self.events), "Unexpected network request")
                    self.assertFalse("FAKE-" in result.stdout + result.stderr, "Sensitive value appeared in output")

    def test_cf_invalid_header_values_are_safe_input_errors(self):
        for invalid in ("FAKE-ID\r\nInjected: yes", "FAKE-SECRET\n", "FAKE-한글"):
            result = self.run_cli(cf=(invalid, "FAKE-SECRET"))
            self.assertEqual(result.returncode, 2)
            self.assertFalse(bool(self.events), "Unexpected network request")
            self.assertFalse("FAKE-" in result.stdout + result.stderr, "Sensitive value appeared in output")
            self.assertFalse("Traceback" in result.stderr, "Unexpected traceback")

    def test_cf_redirect_is_not_followed(self):
        self.issue_status = 302
        result = self.run_cli(cf=("FAKE-ID", "FAKE-SECRET"))
        self.assertEqual(result.returncode, 1)
        self.assertTrue([e[0] for e in self.events] == ["/api/v1/bank/uploads"], "Redirect generated an unexpected request")
        self.assertFalse("FAKE-" in result.stdout + result.stderr, "Sensitive value appeared in output")

    def test_forbidden_signed_headers_never_reach_s3(self):
        for name in ("CF-Access-Client-Id", "cF-aCcEsS-cLiEnT-sEcReT", "Cookie", "Authorization", "X-Bank-Id", "X-Api-Key"):
            self.target["headers"][name] = "FAKE-INJECTED"
            self.events.clear()
            result = self.run_cli(cf=("FAKE-ID", "FAKE-SECRET"))
            del self.target["headers"][name]
            self.assertEqual(result.returncode, 1)
            self.assertEqual(len(self.events), 1)
            self.assertFalse("FAKE-" in result.stdout + result.stderr, "Sensitive value appeared in output")

    def test_reflected_cf_values_are_redacted(self):
        cf = ("FAKE-ID", "FAKE-SECRET")
        self.result.update(fileName="FAKE-ID.csv", status="VALIDATION_FAILED",
                           errors=[{"row": 2, "column": "FAKE-ID", "reason": "FAKE-SECRET"}])
        result = self.run_cli(cf=cf)
        self.assertEqual(result.returncode, 1)
        self.assertFalse("FAKE-" in result.stdout + result.stderr, "Sensitive value appeared in output")
        self.issue_status = 409
        self.target = {"code": "DUPLICATE_FILE", "fileName": "FAKE-ID", "uploadedAt": "FAKE-SECRET"}
        result = self.run_cli(cf=cf)
        self.assertEqual(result.returncode, 1)
        self.assertFalse("FAKE-" in result.stdout + result.stderr, "Sensitive value appeared in output")

    def test_malformed_json_is_protocol_failure(self):
        self.raw_response = b"not JSON"
        result = self.run_cli()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(len(self.events), 1)
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
