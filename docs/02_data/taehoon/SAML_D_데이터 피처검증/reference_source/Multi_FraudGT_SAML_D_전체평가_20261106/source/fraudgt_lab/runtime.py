"""Freeze portable runs and show progress without changing model equations."""
from contextlib import contextmanager
import ctypes
import fcntl
import gc
import json
from . import PACKAGE_ROOT, EXPERIMENT_ROOT, RUN_ROOT
from .config import protocol, digest
from .setup_data import validate_inputs
from .storage import write_json


@contextmanager
def lock(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+') as f:
        try: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError as e: raise RuntimeError(f'Already running: {path}') from e
        yield


def prepare(config, build_graphs=False):
    inputs=validate_inputs()
    marker=EXPERIMENT_ROOT/'input_manifest.json'
    if marker.exists() and json.loads(marker.read_text()) != inputs:
        raise ValueError('Prepared inputs changed; use a new work directory')
    write_json(marker,inputs)
    contract=protocol(config)
    contract['input_manifest_sha256']=digest(marker)
    source={str(p.relative_to(PACKAGE_ROOT)):digest(p) for p in sorted((PACKAGE_ROOT/'fraudgt_lab').glob('*')) if p.suffix in ('.py','.c')}
    for name,value in (('protocol.json',contract),('code_manifest.json',source)):
        path=RUN_ROOT/name
        # JSON normalization converts protocol tuples to lists.
        if path.exists() and json.loads(path.read_text()) != json.loads(json.dumps(value)):
            raise ValueError(f'{name} changed; use a new run name')
        write_json(path,value)
    if build_graphs:
        from .official_loader import build_index
        for scope in ('train','val','test'): build_index(scope)
    return contract


class Progress:
    def __init__(self):
        self.key=None;self.bar=None;self.bucket=None
        try: self.trim=ctypes.CDLL(None).malloc_trim
        except AttributeError: self.trim=None
    def __call__(self,p):
        from tqdm.auto import tqdm
        key=(p['variant'],p['epoch'],p['phase']);value=p[p['phase']]
        if key!=self.key:
            self.close();self.key=key;self.bucket=None
            self.bar=tqdm(total=value['total'],desc=f'{key[0]} ep{key[1]} {key[2]}',mininterval=1)
        self.bar.update(value['completed']-self.bar.n)
        self.bar.set_postfix(scored=value.get('scored'),loss=value.get('loss'),refresh=False)
        bucket=value['completed']//65536
        if bucket!=self.bucket:
            gc.collect()
            if self.trim:self.trim(0)
            self.bucket=bucket
    def close(self):
        if self.bar is not None:self.bar.close();self.bar=None
