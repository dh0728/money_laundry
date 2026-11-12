"""Validated relative paths and atomic JSON artifacts."""

import hashlib
import json
from pathlib import Path
from .schema import ROOT


def resolve_path(value):
    path = Path(value)
    return path.resolve() if path.is_absolute() else (ROOT / path).resolve()


def load_settings(path=None):
    settings = json.loads((Path(path) if path else ROOT / "settings.json").read_text())
    for key in ["transactions", "kyc", "output_dir"]:
        settings[key] = str(resolve_path(settings[key]))
    return settings


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False))
    temp.replace(path)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sql_string(value):
    return "'" + str(value).replace("'", "''") + "'"
