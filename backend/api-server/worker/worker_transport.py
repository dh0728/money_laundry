"""File-bundle protocol, independent of Java/DB and actual model feature shapes.

Descriptor keys include the environment prefix and are actual object keys.
Adapters accept relative keys internally; object_key/relative_key convert once.
input-bundle.json is a publisher-only immutability marker; external inference
peers need only the manifest published last.
"""
import hashlib
import io
import json
import math
import os
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path, PurePosixPath

import pyarrow as pa
import pyarrow.parquet as pq


class ProtocolError(ValueError):
    pass


class StoreUnavailable(OSError):
    pass


def relative(value):
    if (not isinstance(value, str) or not value or "\\" in value or ":" in value
            or any(part in ("", ".", "..") for part in value.split("/"))
            or PurePosixPath(value).is_absolute()):
        raise ProtocolError("Invalid relative object path")
    return value


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def decode(value):
    try:
        result = json.loads(value)
        if not isinstance(result, dict):
            raise ValueError()
        return result
    except (ValueError, UnicodeError, TypeError) as error:
        raise ProtocolError("Invalid JSON object") from error


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            raise ValueError()
        return parsed
    except (ValueError, TypeError) as error:
        raise ProtocolError("Timezone-aware timestamp required") from error


class LocalStore:
    """Atomic local objects. Prefix belongs to the adapter, not protocol identities."""
    def __init__(self, root, prefix=""):
        self.root = Path(root).resolve()
        self.prefix = relative(prefix.strip("/")) + "/" if prefix.strip("/") else ""

    def _path(self, key):
        path = (self.root / (self.prefix + relative(key))).resolve()
        if not path.is_relative_to(self.root):
            raise ProtocolError("Object path escapes store")
        return path

    def object_key(self, key):
        return self.prefix + relative(key)

    def relative_key(self, key):
        key = relative(key)
        if not key.startswith(self.prefix):
            raise ProtocolError("Object key belongs to another environment")
        return relative(key[len(self.prefix):])

    def get(self, key):
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError:
            return None
        except OSError as error:
            raise StoreUnavailable("Object read unavailable") from error

    def put(self, key, data, *, absent=False):
        path = self._path(key)
        temporary = None
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(data)
            if absent:
                try:
                    os.link(temporary, path)
                except FileExistsError:
                    return False
            else:
                os.replace(temporary, path)
            return True
        except OSError as error:
            raise StoreUnavailable("Object write unavailable") from error
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)


class S3Store:
    """Injected S3-compatible client; no boto3 import or credential lookup here."""
    def __init__(self, client, bucket, prefix=""):
        self.client, self.bucket = client, bucket
        self.prefix = relative(prefix.strip("/")) + "/" if prefix.strip("/") else ""

    def object_key(self, key):
        return self.prefix + relative(key)

    def relative_key(self, key):
        key = relative(key)
        if not key.startswith(self.prefix):
            raise ProtocolError("Object key belongs to another environment")
        return relative(key[len(self.prefix):])

    def get(self, key):
        try:
            body = self.client.get_object(Bucket=self.bucket, Key=self.prefix + relative(key))["Body"]
            try:
                return body.read()
            finally:
                body.close()
        except ProtocolError:
            raise
        except Exception as error:
            if getattr(error, "response", {}).get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                return None
            raise StoreUnavailable("S3 read unavailable") from error

    def put(self, key, data, *, absent=False):
        args = dict(Bucket=self.bucket, Key=self.prefix + relative(key), Body=data)
        if absent:
            args["IfNoneMatch"] = "*"
        try:
            self.client.put_object(**args)
            return True
        except Exception as error:
            if absent and getattr(error, "response", {}).get("Error", {}).get("Code") in ("PreconditionFailed", "412"):
                return False
            raise StoreUnavailable("S3 write unavailable") from error


def immutable(store, key, data):
    if not store.put(key, data, absent=True) and store.get(key) != data:
        raise ProtocolError("Immutable object differs")


@dataclass(frozen=True)
class Request:
    job_id: int
    model_kind: str
    request_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    execution_round: int = 1
    model_version: str = "dummy-v1"
    feature_version: str = "dummy-input-v1"

    def __post_init__(self):
        if type(self.job_id) is not int or self.job_id < 1 or self.model_kind not in ("binary", "type"):
            raise ProtocolError("Invalid job/model identity")
        if type(self.execution_round) is not int or self.execution_round < 1:
            raise ProtocolError("Invalid execution round")
        try:
            if str(uuid.UUID(self.request_id)) != self.request_id:
                raise ValueError()
        except (ValueError, TypeError, AttributeError) as error:
            raise ProtocolError("Invalid request UUID") from error
        if any(not isinstance(value, str) or not value.strip() for value in (self.model_version, self.feature_version)):
            raise ProtocolError("Versions are required")

    def identity(self):
        return dict(contract_version=1, job_id=self.job_id, model_kind=self.model_kind,
                    request_id=self.request_id, execution_round=self.execution_round)

    @property
    def base(self):
        return f"{self.job_id}/{self.model_kind}/{self.request_id}"

    @property
    def inputs(self):
        return f"requests/{self.base}/files/"

    @property
    def manifest(self):
        return f"requests/{self.base}/rounds/{self.execution_round}/manifest.json"

    @property
    def output(self):
        return f"results/{self.base}/rounds/{self.execution_round}/"

    def versions(self):
        return dict(model_version=self.model_version, feature_version=self.feature_version)

    def check(self, document, *, versions=True):
        expected = dict(self.identity(), **self.versions()) if versions else self.identity()
        if any(type(document.get(k)) is not type(v) or document.get(k) != v for k, v in expected.items()):
            raise ProtocolError("Request, round or version mismatch")


def descriptor(name, key, data):
    return dict(name=name, key=key, size_bytes=len(data), sha256=hashlib.sha256(data).hexdigest())


def read_files(store, entries, prefix):
    if not isinstance(entries, list) or not entries:
        raise ProtocolError("Nonempty file list required")
    files, keys = {}, set()
    for item in entries:
        if not isinstance(item, dict):
            raise ProtocolError("Invalid file descriptor")
        name, key = item.get("name"), store.relative_key(item.get("key"))
        if not isinstance(name, str) or not name or name in files or key in keys or not key.startswith(prefix):
            raise ProtocolError("Duplicate file or unexpected object key")
        data = store.get(key)
        if data is None or type(item.get("size_bytes")) is not int or item["size_bytes"] != len(data):
            raise ProtocolError("File missing or size mismatch")
        if item.get("sha256") != hashlib.sha256(data).hexdigest():
            raise ProtocolError("File checksum mismatch")
        files[name] = data
        keys.add(key)
    return files


def publish(store, request, output_dir, files, target_row_count):
    if type(target_row_count) is not int or target_row_count < 0 or not files:
        raise ProtocolError("Invalid target row count or empty file bundle")
    entries, names, paths = [], set(), set()
    root = Path(output_dir).resolve()
    for item in files:
        name, path = item.get("name"), relative(item.get("relative_path"))
        if not isinstance(name, str) or not name or name in names or path in paths:
            raise ProtocolError("Duplicate logical name or path")
        source = (root / path).resolve()
        if not source.is_relative_to(root):
            raise ProtocolError("Source escapes bundle output directory")
        names.add(name)
        paths.add(path)
        data = source.read_bytes()
        key = request.inputs + path
        immutable(store, key, data)
        entries.append(descriptor(name, store.object_key(key), data))
    entries.sort(key=lambda item: item["name"])
    # Shared across rounds: adding/removing files must not silently alter request inputs.
    immutable(store, f"requests/{request.base}/input-bundle.json", encode(dict(
        files=entries, target_row_count=target_row_count,
        model_version=request.model_version, feature_version=request.feature_version)))
    document = dict(request.identity(), **request.versions(), target_row_count=target_row_count, files=entries)
    immutable(store, request.manifest, encode(document))
    return document


def table(data):
    try:
        return pq.read_table(io.BytesIO(data))
    except Exception as error:
        raise ProtocolError("Invalid Parquet") from error


def tx_ids(data):
    if "tx_id" not in data.column_names or data.schema.field("tx_id").type != pa.int64():
        raise ProtocolError("tx_id must be int64")
    ids = data.column("tx_id").to_pylist()
    if None in ids or len(set(ids)) != len(ids):
        raise ProtocolError("Null or duplicate tx_id")
    return set(ids)


def validate_result(store, request, document, expected_ids):
    request.check(document)
    if document.get("status") != "COMPLETED" or type(document.get("row_count")) is not int:
        raise ProtocolError("Invalid completion record")
    if timestamp(document.get("finished_at")) < timestamp(document.get("started_at")):
        raise ProtocolError("Completion precedes start")
    files = read_files(store, document.get("files"), request.output)
    if set(files) != {"scores"}:
        raise ProtocolError("Expected scores.parquet result")
    scores = table(files["scores"])
    if tx_ids(scores) != set(expected_ids) or scores.num_rows != document["row_count"]:
        raise ProtocolError("Result target set mismatch")
    columns = ["p_laundering"] if request.model_kind == "binary" else [f"p_{i}" for i in range(9)]
    for column in columns:
        if column not in scores.column_names or scores.schema.field(column).type != pa.float64():
            raise ProtocolError("Probability must be float64")
        if any(value is None or not math.isfinite(value) or not 0 <= value <= 1
               for value in scores.column(column).to_pylist()):
            raise ProtocolError("Invalid probability")
    return document


@dataclass(frozen=True)
class Timing:
    poll: float = 5
    start_timeout: float = 300
    heartbeat_timeout: float = 120
    heartbeat: float = 30
    retry_first: float = 30
    retry_second: float = 120

    def __post_init__(self):
        if any(not math.isfinite(value) or value <= 0 for value in vars(self).values()):
            raise ValueError("Timing values must be positive")


class Observer:
    """poll() never sleeps or issues inference; create after publishing the manifest."""
    def __init__(self, store, request, expected_ids, *, monotonic=time.monotonic, timing=Timing()):
        self.store, self.request, self.expected_ids = store, request, set(expected_ids)
        self.clock, self.timing = monotonic, timing
        self.published = self.clock()
        self.last_progress = self.published
        self.revision = 0
        self.started = False
        self.remote_state = dict(status="WAITING", revision=0)
        self.failure_code = None
        self.failure_count = 0
        self.next_check = None
        self.terminal = None

    def _healthy(self):
        self.failure_code, self.failure_count, self.next_check = None, 0, None

    def _failure(self, code, now):
        if self.failure_code != code:
            self.failure_code, self.failure_count, self.next_check = code, 0, None
        if self.next_check is None or now >= self.next_check:
            self.failure_count += 1
            self.next_check = now + (self.timing.retry_first if self.failure_count == 1 else self.timing.retry_second)
        result = dict(status="RETRY_WAIT", code=code, consecutive_failures=self.failure_count,
                      next_check=self.next_check, action_required=False)
        if self.failure_count >= 3:
            result.update(status="ACTION_REQUIRED", next_check=None, action_required=True)
            self.terminal = result
        return result

    def poll(self):
        if self.terminal is not None:
            return self.terminal
        now = self.clock()
        try:
            raw = self.store.get(self.request.output + "result.json")
            if raw is not None:
                self.terminal = validate_result(self.store, self.request, decode(raw), self.expected_ids)
                return self.terminal
            raw = self.store.get(self.request.output + "status.json")
            if raw is not None:
                status = decode(raw)
                self.request.check(status, versions=False)
                revision = status.get("revision")
                if type(revision) is not int or revision < 1 or status.get("status") not in ("RUNNING", "RETRY_WAIT", "FAILED"):
                    raise ProtocolError("Invalid status or revision")
                timestamp(status.get("updated_at"))
                if status["status"] == "RUNNING":
                    timestamp(status.get("started_at"))
                if status["status"] == "RETRY_WAIT":
                    timestamp(status.get("next_retry_at"))
                if status["status"] == "FAILED":
                    error = status.get("error")
                    if (not isinstance(error, dict) or not isinstance(error.get("code"), str)
                            or not error["code"] or type(error.get("retryable")) is not bool
                            or not isinstance(error.get("message"), str)):
                        raise ProtocolError("Invalid failure record")
                if revision > self.revision:
                    self.revision, self.last_progress = revision, now
                    self.started = True
                    self._healthy()
                    self.remote_state = dict(status=status["status"], revision=revision)
                    if status["status"] == "RETRY_WAIT":
                        self.remote_state["next_retry_at"] = status["next_retry_at"]
                    if status["status"] == "FAILED":
                        error = status.get("error")
                        self.terminal = dict(status="FAILED", code=error["code"], retryable=error["retryable"], action_required=True)
                        return self.terminal
            if self.failure_code == "S3_UNAVAILABLE":
                self._healthy()
            timeout = self.timing.heartbeat_timeout if self.started else self.timing.start_timeout
            if now - self.last_progress >= timeout:
                return self._failure("INFERENCE_UNRESPONSIVE", now)
            return dict(self.remote_state)
        except StoreUnavailable:
            return self._failure("S3_UNAVAILABLE", now)

    def wait(self, *, sleep=time.sleep):
        while True:
            result = self.poll()
            if self.terminal is not None:
                return result
            sleep(self.timing.poll)
