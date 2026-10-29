"""Atomic artifacts and an append-only chronological experiment journal."""

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

from . import RUN_ROOT


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str) + "\n")
    temporary.replace(path)


def log(event: str, **values) -> None:
    RUN_ROOT.mkdir(parents=True, exist_ok=True)
    record = {"utc": datetime.now(timezone.utc).isoformat(), "event": event, **values}
    with (RUN_ROOT / "events.jsonl").open("a") as stream:
        stream.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
    write_json(RUN_ROOT / "current_status.json", record)
    print(json.dumps(record, ensure_ascii=False, default=str), flush=True)


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = list(dict.fromkeys(key for row in rows for key in row))
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fields)
        writer.writeheader()
        writer.writerows(rows)

