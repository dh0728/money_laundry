"""Release unused CPU allocations at progress boundaries, preserving live tensors."""
from pathlib import Path
from datetime import datetime, timezone
import ctypes
import gc
import json
import time


def memory_snapshot():
    values = {}
    for line in Path('/proc/self/status').read_text().splitlines():
        name, _, value = line.partition(':')
        if name in ('VmRSS', 'RssAnon', 'RssFile', 'VmData'):
            values[name + '_bytes'] = int(value.split()[0]) * 1024
    values['cgroup_bytes'] = int(Path('/sys/fs/cgroup/memory.current').read_text())
    return values


class MemoryMaintenance:
    """Collect dead objects and return free glibc pages, never live model storage."""

    def __init__(self, run_dir, seed_batch, batches_between_cleanups=32):
        self.path = Path(run_dir) / 'memory_maintenance.jsonl'
        self.target_interval = seed_batch * batches_between_cleanups
        self.last_key = None
        self.last_bucket = None
        self.library = ctypes.CDLL(None)
        self.trim = self.library.malloc_trim
        self.trim.argtypes = [ctypes.c_size_t]
        self.trim.restype = ctypes.c_int

    def cleanup(self, reason, progress=None):
        before = memory_snapshot()
        started = time.monotonic()
        collected = gc.collect()
        released = self.trim(0)
        after = memory_snapshot()
        record = {
            'utc': datetime.now(timezone.utc).isoformat(), 'reason': reason,
            'seconds': time.monotonic() - started, 'gc_collected_objects': collected,
            'malloc_trim_return': released, 'before': before, 'after': after,
            'rss_released_bytes': before['VmRSS_bytes'] - after['VmRSS_bytes'],
        }
        if progress is not None:
            phase = progress['phase']
            record.update(variant=progress.get('variant'), epoch=progress['epoch'],
                          phase=phase, completed=progress[phase]['completed'])
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open('a') as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + '\n')
        return record

    def on_progress(self, progress):
        phase = progress['phase']
        key = (progress.get('variant'), progress['epoch'], phase)
        bucket = progress[phase]['completed'] // self.target_interval
        if key != self.last_key or bucket != self.last_bucket:
            reason = 'phase_start' if key != self.last_key else 'periodic'
            self.last_key, self.last_bucket = key, bucket
            return self.cleanup(reason, progress)
        return None
