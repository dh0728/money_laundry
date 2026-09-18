"""External smoke controller, NOT a server to run in KubeSphere.

Memory-only, single worker, max 100 jobs. Restart discards test state.
Bind to loopback behind an existing HTTPS proxy for remote use.
No production model, Spring API, report DB or cloud resource is modified.
"""

import argparse
import getpass
import hmac
import json
import os
from pathlib import Path
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
import uuid

from kubesphere_control_smoke import api, validate_result
from kubesphere_download_smoke import EXPECTED_SHA256, validate_url, verify


TERMINAL = {"COMPLETED", "CANCELLED", "FAILED"}


class Controller(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, token, fixture, public_url=None, input_url=None):
        if len(token) < 16:
            raise ValueError("Smoke token must have at least 16 characters")
        self.token = token
        self.fixture = fixture
        verify(fixture)
        self.input_url = input_url
        self.jobs = {}
        self.lock = threading.Lock()
        super().__init__(address, Handler)
        self.public_url = public_url or f"http://127.0.0.1:{self.server_port}"
        validate_url(self.public_url, allow_loopback=True)
        if input_url:
            validate_url(input_url)

    @staticmethod
    def view(job):
        return {key: value for key, value in job.items() if key != "input_url"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Never log authorization, signed URLs or request bodies.

    def reply(self, code, value):
        body = json.dumps(value).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def handle_request(self):
        self.connection.settimeout(10)
        path = urlsplit(self.path).path
        # Only this synthetic fixture is public, for self-contained smoke tests.
        if self.command == "GET" and path == "/smoke/input":
            self.send_response(200)
            self.send_header("Content-Length", str(len(self.server.fixture)))
            self.end_headers()
            self.wfile.write(self.server.fixture)
            return
        received = self.headers.get("Authorization", "").encode()
        expected = ("Bearer " + self.server.token).encode()
        if not hmac.compare_digest(received, expected):
            self.reply(401, {"error": "UNAUTHORIZED"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 <= size <= 16384:
                raise ValueError()
            payload = json.loads(self.rfile.read(size)) if size else {}
            if not isinstance(payload, dict):
                raise ValueError()
            with self.server.lock:
                code, result = self.route(path, payload)
        except (ValueError, KeyError, TypeError):
            code, result = 400, {"error": "INVALID_REQUEST"}
        self.reply(code, result)

    def route(self, path, payload):
        server = self.server
        if self.command == "POST" and path == "/smoke/jobs":
            job_id = str(uuid.UUID(payload["job_id"]))
            seconds = payload.get("work_seconds", 30)
            if type(seconds) not in (int, float) or not 0 <= seconds <= 300:
                raise ValueError()
            if job_id in server.jobs:
                job = server.jobs[job_id]
                if job["work_seconds"] != seconds:
                    return 409, {"error": "JOB_CONFLICT"}
                return 200, server.view(job)
            if len(server.jobs) >= 100:
                return 409, {"error": "TEST_CAPACITY_REACHED"}
            job = {"job_id": job_id, "status": "QUEUED", "work_seconds": seconds,
                   "input_url": server.input_url or server.public_url + "/smoke/input",
                   "events": []}
            server.jobs[job_id] = job
            return 201, server.view(job)
        if self.command == "GET" and path == "/smoke/commands":
            job = next((j for j in server.jobs.values() if j["status"] not in TERMINAL), None)
            return 200, {"job": job}
        parts = path.strip("/").split("/")
        if len(parts) not in (3, 4) or parts[:2] != ["smoke", "jobs"]:
            return 404, {"error": "NOT_FOUND"}
        job = server.jobs.get(parts[2])
        if job is None:
            return 404, {"error": "NOT_FOUND"}
        if self.command == "GET" and len(parts) == 3:
            return 200, server.view(job)
        if self.command != "POST" or len(parts) != 4:
            return 404, {"error": "NOT_FOUND"}
        if parts[3] == "cancel":
            if job["status"] not in TERMINAL:
                job["status"] = "CANCEL_REQUESTED"
            return 200, server.view(job)
        if parts[3] == "result":
            result = validate_result(payload, job["job_id"])
            if job["status"] == "COMPLETED":
                if result != job["result"]:
                    return 409, {"error": "RESULT_CONFLICT"}
                return 200, server.view(job)
            if job["status"] in ("CANCEL_REQUESTED", "CANCELLED", "FAILED"):
                return 200, server.view(job)
            if job["status"] != "DOWNLOADED":
                return 409, {"error": "INVALID_TRANSITION"}
            job["result"] = result
            job["events"].append("COMPLETED")
            job["status"] = "COMPLETED"
            return 200, server.view(job)
        if parts[3] != "events":
            return 404, {"error": "NOT_FOUND"}
        event = payload["event"]
        if event not in {"STARTED", "DOWNLOADED", "CANCELLED", "FAILED"}:
            raise ValueError()
        if event in job["events"] or job["status"] in TERMINAL:
            return 200, server.view(job)
        if job["status"] == "CANCEL_REQUESTED":
            if event == "CANCELLED":
                job["status"] = "CANCELLED"
                job["events"].append(event)
            return 200, server.view(job)
        allowed = {"STARTED": "QUEUED", "DOWNLOADED": "RUNNING"}
        if event == "CANCELLED" or (event in allowed and job["status"] != allowed[event]):
            return 409, {"error": "INVALID_TRANSITION"}
        if event == "DOWNLOADED":
            if payload.get("sha256") != EXPECTED_SHA256 or payload.get("rows") != 1:
                return 409, {"error": "BAD_INPUT"}
        job["events"].append(event)
        job["status"] = "RUNNING" if event == "STARTED" else event
        if event == "FAILED":
            code = payload.get("error_code")
            job["error_code"] = code if code in {"DOWNLOAD_FAILED", "MODEL_RESULT_TIMEOUT", "INVALID_MODEL_RESULT"} else "WORKER_FAILED"
        return 200, server.view(job)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("serve", "start", "cancel", "status"))
    parser.add_argument("--api-url", default="http://127.0.0.1:8765")
    parser.add_argument("--public-url", help="Externally reachable HTTPS base, required for remote fixture downloads")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--job-id")
    parser.add_argument("--seconds", type=float, default=30)
    args = parser.parse_args()
    token = os.environ.get("AML_SMOKE_TOKEN") or getpass.getpass("Smoke token (16+ chars, hidden): ")
    try:
        if args.action == "serve":
            fixture = Path(__file__).resolve().parents[2] / "bank-mock/fixtures/kubesphere_smoke.csv"
            with Controller(("127.0.0.1", args.port), token, fixture.read_bytes(),
                            args.public_url, os.environ.get("AML_SMOKE_DOWNLOAD_URL")) as server:
                print(f"Smoke controller listening on loopback port {server.server_port}; Ctrl+C stops it", flush=True)
                server.serve_forever()
            return
        job_id = str(uuid.UUID(args.job_id)) if args.job_id else str(uuid.uuid4())
        if args.action != "start" and not args.job_id:
            parser.error("--job-id required for cancel/status")
        path = "/smoke/jobs" if args.action == "start" else f"/smoke/jobs/{job_id}"
        body = {"job_id": job_id, "work_seconds": args.seconds} if args.action == "start" else None
        if args.action == "cancel":
            path += "/cancel"
            body = {}
        print(json.dumps(api(args.api_url, token, path, body, allow_loopback=True), indent=2))
    except KeyboardInterrupt:
        pass
    except (OSError, ValueError, RuntimeError):
        print("FAILED: check address, credentials and input configuration (details hidden)")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
