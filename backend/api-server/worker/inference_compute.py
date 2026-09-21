"""Isolated model process: verified input -> model adapter -> S3 output.

Invoked only by inference_server, not a second public worker entry point.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
from datetime import datetime, timezone
from urllib.parse import unquote, urlsplit

import httpx
import pyarrow.parquet as pq

from demo_calculator import calculate, validate_scores
from worker_transport import Request, ProtocolError, decode, encode, descriptor, tx_ids


def atomic_json(path, document):
    temporary = path.with_suffix(".partial")
    with temporary.open("wb") as stream:
        stream.write(encode(document))
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def request_from(document):
    return Request(document["job_id"], document["model_kind"].lower(),
                   document["request_id"], document["execution_round"],
                   document["model_version"], document["feature_version"], document["run_id"])


def check_url(url, base, key):
    actual, expected = urlsplit(url), urlsplit(base + key)
    if (actual.scheme != expected.scheme or actual.netloc != expected.netloc
            or unquote(actual.path) != unquote(expected.path)
            or actual.username or actual.password or actual.fragment):
        raise ProtocolError("Object URL is outside the configured request scope")


def download(client, url, maximum):
    with client.stream("GET", url) as response:
        response.raise_for_status()
        data = bytearray()
        for chunk in response.iter_bytes():
            data.extend(chunk)
            if len(data) > maximum:
                raise ProtocolError("Input exceeds configured size limit")
        return bytes(data)


def execute(directory):
    payload = json.loads((directory / "request.json").read_text(encoding="utf-8"))
    request = request_from(payload)
    base = payload["object_base_url"]
    with httpx.Client(timeout=15, follow_redirects=False, trust_env=False) as client:
        cached = directory / "computed.json"
        scores_path = directory / "scores.parquet"
        if cached.exists():
            result = decode(cached.read_bytes())
            request.check(result)
            data = scores_path.read_bytes()
            if hashlib.sha256(data).hexdigest() != result["files"][0]["sha256"]:
                raise ProtocolError("Cached result changed")
        else:
            started = datetime.now(timezone.utc).isoformat()
            check_url(payload["manifest_url"], base, request.manifest)
            manifest_bytes = download(client, payload["manifest_url"], 65536)
            if hashlib.sha256(manifest_bytes).hexdigest() != payload["manifest_sha256"]:
                raise ProtocolError("Manifest checksum mismatch")
            manifest = decode(manifest_bytes)
            request.check(manifest)
            files = manifest.get("files")
            if not isinstance(files, list) or len(files) != 1 or files[0].get("name") != "targets":
                raise ProtocolError("Demo input requires one targets file")
            entry = files[0]
            # Manifest keys include the environment prefix; URL scope is independently fixed.
            expected_key = unquote(urlsplit(base).path).lstrip("/") + request.inputs + "targets.parquet"
            if entry.get("key") != expected_key:
                raise ProtocolError("Unexpected targets object key")
            check_url(payload["input_url"], base, request.inputs + "targets.parquet")
            data = download(client, payload["input_url"], payload["max_input_bytes"])
            if len(data) != entry.get("size_bytes") or hashlib.sha256(data).hexdigest() != entry.get("sha256"):
                raise ProtocolError("Input checksum mismatch")
            targets = pq.read_table(io.BytesIO(data))
            ids = tx_ids(targets)
            if type(manifest.get("target_row_count")) is not int or len(ids) != manifest["target_row_count"]:
                raise ProtocolError("TARGET count mismatch")
            scores = calculate(targets, request.model_kind, **request.versions())
            validate_scores(scores, ids, request.model_kind, **request.versions())
            temporary = directory / "scores.partial"
            pq.write_table(scores, temporary)
            temporary.replace(scores_path)
            data = scores_path.read_bytes()
            result_key = unquote(urlsplit(base).path).lstrip("/") + request.output + "scores.parquet"
            result = dict(request.identity(), **request.versions(), status="COMPLETED",
                          row_count=len(ids), started_at=started,
                          finished_at=datetime.now(timezone.utc).isoformat(),
                          files=[descriptor("scores", result_key, data)])
            atomic_json(cached, result)
        for name, body in (("scores.parquet", data), ("result.json", encode(result))):
            url = payload["result_urls"][name]
            check_url(url, base, request.output + name)
            response = client.put(url, content=body)
            response.raise_for_status()
        return result


def main(directory):
    directory = Path(directory)
    try:
        result = execute(directory)
        outcome = dict(status="COMPLETED", result=result)
    except httpx.HTTPStatusError as error:
        code = error.response.status_code
        outcome = dict(status="FAILED", error_code="TRANSFER_UNAVAILABLE",
                       retryable=code in (401, 403, 408, 429) or code >= 500)
    except httpx.HTTPError:
        outcome = dict(status="FAILED", error_code="TRANSFER_UNAVAILABLE", retryable=True)
    except Exception:
        # Never persist model exceptions or signed URLs in publicly returned state.
        outcome = dict(status="FAILED", error_code="INPUT_OR_MODEL_INVALID", retryable=False)
    atomic_json(directory / "outcome.json", outcome)


if __name__ == "__main__":
    main(sys.argv[1])
