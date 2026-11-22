"""File-bundle protocol, independent of Java/DB and actual model feature shapes.

Descriptor keys include the environment prefix and are actual object keys.
Adapters accept relative keys internally; object_key/relative_key convert once.
input-bundle.json is a publisher-only immutability marker; external inference
peers need only the manifest published last.
"""
import hashlib
import json
import uuid
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

import pyarrow as pa


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
    run_id: str | None = None

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
        if self.run_id is not None:
            try:
                if str(uuid.UUID(self.run_id)) != self.run_id:
                    raise ValueError()
            except (ValueError, TypeError, AttributeError) as error:
                raise ProtocolError("Invalid run UUID") from error
        if any(not isinstance(value, str) or not value.strip() for value in (self.model_version, self.feature_version)):
            raise ProtocolError("Versions are required")

    def identity(self):
        identity = dict(contract_version=1 if self.run_id is None else 2,
                        job_id=self.job_id, model_kind=self.wire_kind,
                        request_id=self.request_id, execution_round=self.execution_round)
        if self.run_id is not None:
            identity["run_id"] = self.run_id
        return identity

    @property
    def wire_kind(self):
        # V2 matches Spring analysis.model_requests and cancellation object keys.
        return self.model_kind if self.run_id is None else self.model_kind.upper()

    @property
    def base(self):
        return f"{self.job_id}/{self.wire_kind}/{self.request_id}"

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
    bundle = dict(
        files=entries, target_row_count=target_row_count,
        model_version=request.model_version, feature_version=request.feature_version)
    if request.run_id is not None:
        bundle["run_id"] = request.run_id
    immutable(store, f"requests/{request.base}/input-bundle.json", encode(bundle))
    document = dict(request.identity(), **request.versions(), target_row_count=target_row_count, files=entries)
    immutable(store, request.manifest, encode(document))
    return document


def tx_ids(data):
    if "tx_id" not in data.column_names or data.schema.field("tx_id").type != pa.int64():
        raise ProtocolError("tx_id must be int64")
    ids = data.column("tx_id").to_pylist()
    if None in ids or len(set(ids)) != len(ids):
        raise ProtocolError("Null or duplicate tx_id")
    return set(ids)
