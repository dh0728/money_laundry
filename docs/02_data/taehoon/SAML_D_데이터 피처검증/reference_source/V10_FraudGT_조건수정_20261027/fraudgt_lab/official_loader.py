"""Actual PyG LinkNeighborLoader over period graphs and memory-mapped CSC.

The stores only expose graph/feature storage. Neighbor selection, node sharing,
and sampled batch construction are performed by PyG, with no 64-root grouping.
"""
from pathlib import Path
import ctypes as C
import hashlib
import fcntl
import json
import subprocess
import numpy as np
import torch
from torch_geometric.data import FeatureStore, GraphStore, TensorAttr
from torch_geometric.data.graph_store import EdgeAttr, EdgeLayout
from torch_geometric.loader import LinkNeighborLoader
from torch_geometric.sampler import NeighborSampler
from . import EXPERIMENT_ROOT, GRAPH_ROOT
from .storage import write_json
from .config import TrainConfig
from common import G

FORWARD = ('node', 'to', 'node')
REVERSE = ('node', 'rev_to', 'node')
from .population import split_window

def relations_for(variant):
    return [FORWARD, REVERSE] if variant == 'multi_fraudgt_format' else [FORWARD]


def build_index(scope):
    """Serialize cache creation when both comparison notebooks start together."""
    root = EXPERIMENT_ROOT / 'graph_cache'
    root.mkdir(exist_ok=True)
    with (root / 'index.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _build_index_locked(scope)


def _build_index_locked(scope):
    """Cache cumulative period CSC without labels or future-period edges."""
    end_day = split_window(scope)['last_day']
    reusable = EXPERIMENT_ROOT / 'legacy_graph_cache' / {'train':'train','val':'validation','test':'historical_test'}[scope]
    if (reusable / 'complete.json').exists():
        metadata = json.loads((reusable / 'complete.json').read_text())
        if metadata['end_day'] == end_day:
            return reusable
    folder = EXPERIMENT_ROOT / 'graph_cache' / scope
    marker = folder / 'complete.json'
    if marker.exists():
        assert json.loads(marker.read_text())['end_day'] == end_day
        return folder
    folder.mkdir(parents=True, exist_ok=True)
    old = GRAPH_ROOT / 'cache/hi'
    nodes = json.loads((old / 'complete.json').read_text())['nodes']
    minute = np.load(G / 'minute.npy', mmap_mode='r')
    source = Path(__file__).with_name('csc_index.c')
    library = EXPERIMENT_ROOT / 'graph_cache' / ('index_' + hashlib.sha256(source.read_bytes()).hexdigest()[:12] + '.so')
    if not library.exists():
        subprocess.run(['gcc', '-O3', '-std=c11', '-fPIC', '-shared', str(source), '-o', str(library)], check=True)
    lib = C.CDLL(str(library))
    p64, p32, pu = C.POINTER(C.c_int64), C.POINTER(C.c_int32), C.POINTER(C.c_uint32)
    lib.count_prefix.argtypes = [p64, pu, p32, C.c_int64, C.c_int64, p64]
    lib.write_prefix.argtypes = [p64, pu, p32, C.c_int64, p64, p64, pu]
    counts = {}
    for role, peer_name in [('incoming', 'src'), ('outgoing', 'dst')]:
        offsets = np.load(old / f'{role}_time_offsets.npy', mmap_mode='r')
        ids = np.load(old / f'{role}_time_ids.npy', mmap_mode='r')
        peer = np.load(G / f'{peer_name}.npy', mmap_mode='r')
        ptr = np.lib.format.open_memmap(folder / f'{role}_ptr.npy', mode='w+', dtype=np.int64, shape=(nodes + 1,))
        lib.count_prefix(offsets.ctypes.data_as(p64), ids.ctypes.data_as(pu),
                         minute.ctypes.data_as(p32), nodes, (end_day + 1) * 1440, ptr.ctypes.data_as(p64))
        edges = int(ptr[-1])
        row = np.lib.format.open_memmap(folder / f'{role}_row.npy', mode='w+', dtype=np.int64, shape=(edges,))
        original = np.lib.format.open_memmap(folder / f'{role}_ids.npy', mode='w+', dtype=np.uint32, shape=(edges,))
        lib.write_prefix(offsets.ctypes.data_as(p64), ids.ctypes.data_as(pu), peer.ctypes.data_as(p32),
                         nodes, ptr.ctypes.data_as(p64), row.ctypes.data_as(p64), original.ctypes.data_as(pu))
        ptr.flush(); row.flush(); original.flush()
        counts[role] = edges
        del ptr, row, original
    assert counts['incoming'] == counts['outgoing']
    write_json(marker, {'scope': scope, 'end_day': end_day, 'cutoff_minute_exclusive': (end_day + 1) * 1440,
                        'nodes': nodes, 'edges_per_relation': counts, 'labels_used': False,
                        'sampling_implementation': 'PyG LinkNeighborLoader, not this index conversion'})
    return folder


class MappedFeatureStore(FeatureStore):
    def __init__(self, nodes):
        super().__init__()
        self.nodes = nodes

    def _get_tensor(self, attr):
        assert attr.group_name == 'node' and attr.attr_name == 'x'
        index = attr.index.numpy() if isinstance(attr.index, torch.Tensor) else attr.index
        return torch.from_numpy(np.array(self.nodes if index is None else self.nodes[index], copy=True))

    def _get_tensor_size(self, attr):
        return self.nodes.shape

    def get_all_tensor_attrs(self):
        return [TensorAttr(group_name='node', attr_name='x', index=None)]

    def _put_tensor(self, tensor, attr):
        raise RuntimeError('Immutable V10 inputs')

    def _remove_tensor(self, attr):
        return False


class MappedGraphStore(GraphStore):
    def __init__(self, arrays, nodes):
        super().__init__()
        self.arrays, self.nodes = arrays, nodes

    def get_all_edge_attrs(self):
        return [EdgeAttr(edge_type=kind, layout=EdgeLayout.CSC, is_sorted=True,
                         size=(self.nodes, self.nodes)) for kind in self.arrays]

    def _get_edge_index(self, attr):
        assert attr.layout == EdgeLayout.CSC
        return self.arrays[attr.edge_type]

    def _put_edge_index(self, edge_index, edge_attr):
        raise RuntimeError('Immutable period graph')

    def _remove_edge_index(self, edge_attr):
        return False


class PeriodGraph:
    def __init__(self, scope, variant='fraudgt_format', config=None):
        self.config = config or TrainConfig()
        self.scope, self.variant = scope, variant
        self.relations = relations_for(variant)
        self.disjoint = self.config.graph_mode == 'disjoint'
        folder = build_index(scope)
        self.metadata = json.loads((folder / 'complete.json').read_text())
        self.ids, self.arrays = {}, {}
        for kind, role in [(FORWARD, 'incoming'), (REVERSE, 'outgoing')]:
            if kind not in self.relations:
                continue
            # Copy-on-write maps are writable to Torch but never modify disk inputs.
            row = np.load(folder / f'{role}_row.npy', mmap_mode='c')
            ptr = np.load(folder / f'{role}_ptr.npy', mmap_mode='c')
            self.arrays[kind] = (torch.from_numpy(row), torch.from_numpy(ptr))
            self.ids[kind] = np.load(folder / f'{role}_ids.npy', mmap_mode='r')
        date = str(np.datetime64('2022-08-01') + np.timedelta64(split_window(scope)['last_day'], 'D'))
        self.nodes = np.load(G / 'nodes' / f'{date}.npy', mmap_mode='r')
        self.feature_store = MappedFeatureStore(self.nodes)
        self.graph_store = MappedGraphStore(self.arrays, self.metadata['nodes'])
        self.sampler = NeighborSampler((self.feature_store, self.graph_store),
                                      num_neighbors=[50, 50], replace=False,
                                      subgraph_type='directional', disjoint=self.disjoint)
        # Keep metadata iteration stable across process restarts, as HeteroData does.
        self.sampler.edge_types = list(self.relations)
        self.src, self.dst = [np.load(G / f'{name}.npy', mmap_mode='r') for name in ('src', 'dst')]

    def loader(self, ids, labels=None, batch_size=2048, shuffle=False, batch_sizes=None, seed=42):
        ids = np.asarray(ids, dtype=np.int64)
        edge_index = torch.from_numpy(np.stack([self.src[ids], self.dst[ids]]).astype(np.int64))
        labels = torch.zeros(len(ids)) if labels is None else torch.as_tensor(labels)
        options = {'batch_size': batch_size, 'shuffle': shuffle}
        if batch_sizes is not None:
            bounds = np.r_[0, np.cumsum(batch_sizes)]
            assert bounds[-1] == len(ids) and max(batch_sizes) <= batch_size
            options = {'batch_sampler': [range(int(a), int(b)) for a, b in zip(bounds[:-1], bounds[1:])]}
        return LinkNeighborLoader((self.feature_store, self.graph_store),
                                  num_neighbors=[50, 50], edge_label_index=(FORWARD, edge_index),
                                  edge_label=labels, **options,
                                  num_workers=self.config.loader_workers, neighbor_sampler=self.sampler,
                                  replace=False, disjoint=self.disjoint, subgraph_type='directional',
                                  filter_per_worker=False, generator=torch.Generator().manual_seed(seed))
