"""Batch-wide account/minute expansion, equivalent to the prior shared union.

Accounts with different query minutes remain distinct sampling states so the
same-minute inclusion rule is preserved. Final nodes and transaction IDs share
one graph with exactly the prior target order, direction flags and batch Ego.
"""
import ctypes as C
import subprocess
import numpy as np
from .config import ROOT
from .storage import sha
from graph_runtime import Topology


def copy_result(lib, handle, index):
    """Own the result without caching a ctypes array type for every length."""
    size = lib.result_size(handle, index)
    if size < 0:
        raise RuntimeError('Invalid native result size')
    result = np.empty(size, dtype=np.int64)
    if size:
        pointer = lib.result_data(handle, index)
        if not pointer:
            raise RuntimeError('Missing native result data')
        C.memmove(result.ctypes.data, pointer, result.nbytes)
    return result


def load_native():
    source = ROOT/'salt_daily/shared_sampler.c'
    directory = ROOT/'cache/shared_sampler'
    directory.mkdir(parents=True, exist_ok=True)
    path = directory/f'shared_{sha(source)[:16]}.so'
    if not path.exists():
        temporary = path.with_suffix('.tmp.so')
        subprocess.run(['gcc','-O3','-std=c11','-fPIC','-shared',str(source),'-o',str(temporary)],
                       check=True, capture_output=True)
        temporary.replace(path)
    lib = C.CDLL(str(path))
    i=C.c_int64; p=C.POINTER(i); p32=C.POINTER(C.c_int32); u32=C.POINTER(C.c_uint32)
    lib.sample_batch.argtypes=[p32,p32,p32,i,p,i,i,i]+[p,u32]*4
    lib.sample_batch.restype=C.c_void_p
    lib.result_size.argtypes=[C.c_void_p,C.c_int];lib.result_size.restype=i
    lib.result_data.argtypes=[C.c_void_p,C.c_int];lib.result_data.restype=p
    lib.free_result.argtypes=[C.c_void_p];lib.free_result.restype=None
    return lib


class SharedTopology(Topology):
    def __init__(self, dataset='hi', cap=100):
        super().__init__(dataset,cap)
        self.lib=load_native()

    def batch(self, ids):
        ids = np.ascontiguousarray(ids, dtype=np.int64)
        assert len(ids) > 0 and ids.min() >= 0 and ids.max() < self.width
        handle = self.lib.sample_batch(*self.rawptr, self.width,
            ids.ctypes.data_as(C.POINTER(C.c_int64)), len(ids), self.nn, self.cap, *self.indexptr)
        if not handle:
            raise RuntimeError('Native daily graph construction failed')
        try:
            return tuple(copy_result(self.lib, handle, k) for k in range(8))
        finally:
            self.lib.free_result(handle)
