"""Validate an optional, secret-free selection of images for one release."""
import json
from pathlib import Path
import re


def validate(manifest, *, environment=None, account=None):
    fields = {"version", "environment", "account_id", "region", "app_sha", "images"}
    if not isinstance(manifest, dict) or set(manifest) != fields:
        raise ValueError("Unexpected release image manifest fields.")
    if type(manifest["version"]) is not int or manifest["version"] != 1:
        raise ValueError("Unsupported release image manifest version.")
    if manifest["environment"] not in ("dev", "prod") or manifest["region"] != "ap-northeast-2":
        raise ValueError("Invalid image environment or region.")
    for key, pattern in (("account_id", r"[0-9]{12}"), ("app_sha", r"[0-9a-f]{40}")):
        if not isinstance(manifest[key], str) or not re.fullmatch(pattern, manifest[key]):
            raise ValueError("Invalid image account or application SHA.")
    if environment is not None and manifest["environment"] != environment:
        raise ValueError("Image manifest belongs to a different environment.")
    if account is not None and manifest["account_id"] != account:
        raise ValueError("Image manifest belongs to a different AWS account.")
    images = manifest["images"]
    if not isinstance(images, dict) or set(images) != {"api", "web"}:
        raise ValueError("Exactly one API and one web image are required.")
    registry = f"{manifest['account_id']}.dkr.ecr.{manifest['region']}.amazonaws.com"
    for service, reference in images.items():
        pattern = re.escape(f"{registry}/aml-{service}@sha256:") + r"[0-9a-f]{64}"
        if not isinstance(reference, str) or not re.fullmatch(pattern, reference):
            raise ValueError("Images must use the expected ECR repository and a SHA-256 digest.")
    return manifest


def load(path, *, environment=None, account=None):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 100_000:
        raise ValueError("Invalid release image manifest file.")
    return validate(json.loads(path.read_text(encoding="utf-8")), environment=environment, account=account)


def from_record(record, *, environment):
    """Select only deployment fields from the verified image-transfer receipt."""
    if not isinstance(record, dict) or not isinstance(record.get("images"), list) or len(record["images"]) != 2:
        raise ValueError("Expected a preparation record for two images.")
    manifest = {
        "version": 1,
        "environment": record.get("environment"),
        "account_id": record.get("account_id"),
        "region": record.get("region"),
        "app_sha": record.get("app_sha"),
        "images": {},
    }
    registry = f"{manifest['account_id']}.dkr.ecr.{manifest['region']}.amazonaws.com"
    for entry in record["images"]:
        if not isinstance(entry, dict) or entry.get("repository") not in ("aml-api", "aml-web"):
            raise ValueError("Unexpected image preparation repository.")
        service = entry["repository"].removeprefix("aml-")
        if service in manifest["images"]:
            raise ValueError("Duplicate image preparation repository.")
        tag = f"{registry}/aml-{service}:{environment}-{manifest['app_sha']}"
        pinned = f"{registry}/aml-{service}@{entry.get('digest')}"
        if entry.get("image") != tag or entry.get("pinned_image") != pinned:
            raise ValueError("Image preparation tag or digest does not match its reference.")
        manifest["images"][service] = pinned
    return validate(manifest, environment=environment)
