from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path


def utc():
    return datetime.now(timezone.utc).isoformat()


def read_json(path):
    return json.loads(Path(path).read_text())


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def log(folder, event, **values):
    row = dict(utc=utc(), event=event, **values)
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / 'events.jsonl').open('a') as handle:
        handle.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n')
    write_json(folder / 'status.json', row)
    print(json.dumps(row, ensure_ascii=False), flush=True)


def memory():
    values = {}
    for line in Path('/proc/self/status').read_text().splitlines():
        if line.split(':')[0] in ('VmRSS', 'RssAnon', 'RssFile'):
            key, value = line.split(':', 1)
            values[key + '_bytes'] = int(value.split()[0]) * 1024
    for name in ('memory.current', 'memory.max'):
        value = (Path('/sys/fs/cgroup') / name).read_text().strip()
        values[name] = int(value) if value.isdigit() else value
    return values

