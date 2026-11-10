"""Observed payment type and immutable first-counterparty port ranks.

Features depend on transaction IDs, never labels or membership in a mini-batch.
Parallel transactions remain distinct. The chronological ports are precomputed
by the preserved FraudGT implementation, with past ranks independent of future
transactions. Keep the raw values to match that implementation.
"""
from .config import PROJECT
from common import G
import numpy as np

FORMAT_NAMES = ('ACH', 'Bitcoin', 'Cash', 'Cheque', 'Credit Card', 'Reinvestment', 'Wire', 'Unknown')
PORT_ROOT = PROJECT / 'experiments/v10_fraudgt_compare_20261026/cache'
INPUT_PATHS = (G/'fmt.npy', PORT_ROOT/'incoming_ports.npy', PORT_ROOT/'outgoing_ports.npy')


def encode_formats(codes):
    codes = np.asarray(codes, dtype=np.int64)
    codes = np.where((codes >= 0) & (codes < 7), codes, 7)
    return np.eye(len(FORMAT_NAMES), dtype=np.float32)[codes]


class ExtraEdgeFeatures:
    def __init__(self):
        self.formats, self.in_ports, self.out_ports = (
            np.load(path, mmap_mode='r') for path in INPUT_PATHS)
        assert len(self.formats) == len(self.in_ports) == len(self.out_ports)

    def values(self, ids):
        ids = np.asarray(ids, dtype=np.int64)
        ordered, restore = np.unique(ids, return_inverse=True)
        ports = np.column_stack((self.in_ports[ordered], self.out_ports[ordered]))
        assert np.all(ports >= 0), 'Uninitialized port feature'
        values = np.column_stack((encode_formats(self.formats[ordered]), ports)).astype(np.float32)
        return np.ascontiguousarray(values[restore])

    def append(self, original, ids):
        assert original.shape == (len(ids), 14)
        return np.ascontiguousarray(np.column_stack((original, self.values(ids))), dtype=np.float32)
