"""Outbound-only smoke worker. No listening sockets, GPU, DB or extra packages.

In Jupyter: from kubesphere_control_smoke import run; run()
The external test controller must be reachable from this environment.
"""

import getpass
import json
import math
import os
from pathlib import Path
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

from kubesphere_download_smoke import NoRedirect, download, validate_url


def validate_result(value, job_id):
    """Smoke-only contract: one synthetic target, binary + nine class probabilities."""
    if (not isinstance(value, dict) or value.get("job_id") != job_id
            or value.get("schema_version") != "smoke-v1"
            or value.get("target_id") != "smoke-1"):
        raise ValueError("Result identity mismatch")
    binary, patterns = value.get("p_laundering"), value.get("pattern_probabilities")
    if not isinstance(patterns, list) or len(patterns) != 9:
        raise ValueError("Expected nine pattern probabilities")
    for probability in [binary, *patterns]:
        if type(probability) not in (int, float) or not math.isfinite(probability) or not 0 <= probability <= 1:
            raise ValueError("Invalid probability")
    if abs(sum(patterns) - 1) > 1e-9:
        raise ValueError("Pattern probabilities do not sum to one")
    return {key: value[key] for key in (
        "schema_version", "job_id", "target_id", "p_laundering", "pattern_probabilities")}


def write_message(path, payload):
    """Publish a complete local control file by renaming within the same directory."""
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload), encoding="utf-8")
    temporary.replace(path)


def read_message(path):
    with path.open("rb") as stream:
        data = stream.read(65537)
    if len(data) > 65536:
        raise ValueError("Local result too large")
    return json.loads(data)


def api(base: str, token: str, path: str, payload=None, allow_loopback=False):
    validate_url(base, allow_loopback)
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
    # Cloudflare headers are sent ONLY to the control API, never to S3.
    cf_id = os.environ.get("CF_ACCESS_CLIENT_ID", "")
    cf_secret = os.environ.get("CF_ACCESS_CLIENT_SECRET", "")
    if bool(cf_id) != bool(cf_secret):
        raise ValueError("Both Cloudflare environment variables are required")
    if cf_id:
        headers.update({"CF-Access-Client-Id": cf_id, "CF-Access-Client-Secret": cf_secret})
    data = None if payload is None else json.dumps(payload).encode()
    for attempt in range(3):
        try:
            request = Request(base.rstrip("/") + path, data=data, headers=headers)
            with build_opener(NoRedirect()).open(request, timeout=5) as response:
                body = response.read(65537)
            if len(body) > 65536:
                raise ValueError("Control response too large")
            return json.loads(body)
        except HTTPError as error:
            if error.code not in (429, 502, 503, 504) or attempt == 2:
                raise RuntimeError(f"Control API HTTP {error.code}") from None
        except (URLError, OSError):
            if attempt == 2:
                raise RuntimeError("Control API connection failed") from None
        time.sleep(0.2 * (attempt + 1))


def work_once(base, token, *, idle_timeout=120, poll_seconds=1, allow_loopback=False,
              model_dir=None, cancel_timeout=30):
    """Process one test job; its simulated work remains interruptible by polling."""
    if idle_timeout <= 0 or not 0.05 <= poll_seconds <= 10:
        raise ValueError("Invalid polling limits")

    def call(path, payload=None):
        return api(base, token, path, payload, allow_loopback)

    deadline = time.monotonic() + idle_timeout
    while True:
        command = call("/smoke/commands")
        if command.get("job"):
            job = command["job"]
            break
        if time.monotonic() >= deadline:
            raise TimeoutError("No test job arrived")
        time.sleep(poll_seconds)

    job_id = str(uuid.UUID(job["job_id"]))
    folder = Path(model_dir).resolve() / job_id if model_dir is not None else None
    model_started = False

    def event(name, **details):
        # Stable event names per job make retries after response loss idempotent.
        return call(f"/smoke/jobs/{job_id}/events", {"event": name, **details})

    def cancelled(state):
        if state["status"] == "CANCEL_REQUESTED":
            if model_started:
                write_message(folder / "cancel.json", {"job_id": job_id, "reason": "SMOKE_CANCEL"})
                limit = time.monotonic() + cancel_timeout
                while time.monotonic() < limit:
                    ack = folder / "cancel_ack.json"
                    if ack.exists():
                        message = read_message(ack)
                        if (message.get("job_id") == job_id
                                and message.get("status") in ("STOPPED", "ALREADY_FINISHED")):
                            return event("CANCELLED")
                    time.sleep(poll_seconds)
                # Do not pretend the external process stopped just because we sent a file.
                return state
            return event("CANCELLED")
        return None

    stopped = cancelled(job)
    if stopped:
        return stopped
    started = event("STARTED")
    stopped = cancelled(started)
    if stopped:
        return stopped
    try:
        if folder:
            folder.mkdir(parents=True, exist_ok=False)
        result = download(job["input_url"], allow_loopback=allow_loopback,
                          save_to=folder / "input.csv" if folder else None)
    except (ValueError, OSError, URLError):
        failed = event("FAILED", error_code="DOWNLOAD_FAILED")
        return cancelled(failed) or failed
    ready = event("DOWNLOADED", sha256=result["sha256"], rows=result["rows"])
    stopped = cancelled(ready)
    if stopped:
        return stopped
    if folder:
        write_message(folder / "request.json", {"job_id": job_id, "schema_version": "smoke-v1",
                      "input_file": "input.csv", "result_file": "result.json", "target_id": "smoke-1"})
        model_started = True
    print("DOWNLOAD_OK: hash and one data row verified", flush=True)
    # This is simulated processing, not a real inference or GPU cancellation test.
    finish = time.monotonic() + job["work_seconds"]
    while time.monotonic() < finish:
        state = call(f"/smoke/jobs/{job_id}")
        stopped = cancelled(state)
        if stopped:
            return stopped
        if state["status"] in ("COMPLETED", "CANCELLED", "FAILED"):
            return state
        if folder and (folder / "result.json").exists():
            break
        time.sleep(poll_seconds)
    try:
        if folder:
            if not (folder / "result.json").exists():
                failed = event("FAILED", error_code="MODEL_RESULT_TIMEOUT")
                return cancelled(failed) or failed
            output = read_message(folder / "result.json")
        else:
            output = {"schema_version": "smoke-v1", "job_id": job_id, "target_id": "smoke-1",
                      "p_laundering": 0.75, "pattern_probabilities": [0.2] + [0.1] * 8}
        output = validate_result(output, job_id)
    except (ValueError, OSError):
        failed = event("FAILED", error_code="INVALID_MODEL_RESULT")
        return cancelled(failed) or failed
    result = call(f"/smoke/jobs/{job_id}/result", output)
    return cancelled(result) or result


def run(base=None, token=None, model_dir=None):
    base = base or os.environ.get("AML_SMOKE_API_URL") or input("Control API HTTPS base URL: ")
    token = token or os.environ.get("AML_SMOKE_TOKEN") or getpass.getpass("Smoke token (hidden): ")
    try:
        result = work_once(base.strip(), token, model_dir=model_dir)
    except (RuntimeError, ValueError, OSError):
        print("FAILED: control connection/protocol; check controller and credentials (secrets hidden)")
        return False
    print(f"{result['status']}: job={result['job_id']}")
    return result["status"] in ("COMPLETED", "CANCELLED")


if __name__ == "__main__":
    raise SystemExit(0 if run() else 1)
