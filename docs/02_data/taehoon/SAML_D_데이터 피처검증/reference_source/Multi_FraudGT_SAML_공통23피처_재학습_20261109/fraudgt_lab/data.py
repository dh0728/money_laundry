"""Translate actual PyG sampled batches into the preserved V10 model inputs."""
from dataclasses import dataclass
import numpy as np
import torch
from . import LEGACY_ROOT, PROJECT_ROOT
from .config import EDGE_INDICES, FORMAT_NAMES
from .official_loader import FORWARD, REVERSE
from graph_runtime import HIInputs
from common import G


def load_cohort(scope):
    with np.load(LEGACY_ROOT / 'cache' / f'{scope}.npz') as data:
        return {key: data[key] for key in data.files}


@dataclass
class GraphBatch:
    node_features: torch.Tensor
    edge_index: torch.Tensor
    edge_features: torch.Tensor
    target_index: torch.Tensor
    target_features: torch.Tensor
    incoming: torch.Tensor
    outgoing: torch.Tensor
    target_edge_positions: torch.Tensor
    ports: torch.Tensor
    target_ports: torch.Tensor

    def to(self, device):
        return GraphBatch(**{k: v.to(device) for k, v in vars(self).items()})


class FeatureAdapter:
    def __init__(self, use_ports=False):
        self.inputs = HIInputs()
        self.formats = np.load(G / 'fmt.npy', mmap_mode='r')
        port_root = PROJECT_ROOT / 'experiments/v10_fraudgt_compare_20261026/cache'
        self.port_arrays = ([np.load(port_root / f'{role}_ports.npy', mmap_mode='r')
                             for role in ('incoming', 'outgoing')] if use_ports else [])

    def edge_features(self, ids):
        # Read mmap rows in increasing order, once per transaction. Restore the
        # exact sampled order afterwards; no graph edge or feature is changed.
        ordered, restore = np.unique(ids, return_inverse=True)
        numeric = self.inputs.edges(ordered)[:, EDGE_INDICES]
        code = np.asarray(self.formats[ordered], dtype=np.int64)
        code = np.where((code >= 0) & (code < 7), code, 7)
        values = np.column_stack([numeric, np.eye(len(FORMAT_NAMES), dtype=np.float32)[code]])
        return np.ascontiguousarray(values[restore], dtype=np.float32)

    def ports(self, ids):
        if not self.port_arrays:
            return np.zeros((len(ids), 2), dtype=np.float32)
        ordered, restore = np.unique(ids, return_inverse=True)
        return np.column_stack([a[ordered] for a in self.port_arrays])[restore].astype(np.float32)

    def materialize(self, graph, sampled, seed_ids):
        rows = sampled[FORWARD].input_id.numpy()
        targets = np.asarray(seed_ids[rows], dtype=np.int64)
        forward_ids = np.asarray(graph.ids[FORWARD][sampled[FORWARD].e_id.numpy()], dtype=np.int64)
        has_reverse = REVERSE in graph.relations
        reverse_ids = (np.asarray(graph.ids[REVERSE][sampled[REVERSE].e_id.numpy()], dtype=np.int64)
                       if has_reverse else np.empty(0, dtype=np.int64))
        all_ids = np.concatenate([forward_ids, reverse_ids])
        nodes = sampled['node'].n_id.numpy()
        indices = np.concatenate([sampled[FORWARD].edge_index.numpy(),
                                  sampled[REVERSE].edge_index.numpy()[::-1] if has_reverse else np.empty((2,0),dtype=np.int64)], axis=1)
        target_index = sampled[FORWARD].edge_label_index.numpy()
        assert np.array_equal(nodes[target_index[0]], graph.src[targets])
        assert np.array_equal(nodes[target_index[1]], graph.dst[targets])
        assert np.array_equal(nodes[indices[0]], graph.src[all_ids])
        assert np.array_equal(nodes[indices[1]], graph.dst[all_ids])
        if graph.disjoint:
            groups = sampled['node'].batch.numpy()
            assert np.array_equal(groups[target_index[0]], groups[target_index[1]])
            assert np.array_equal(groups[indices[0]], groups[indices[1]]), 'Edges must not cross target graphs'
        else:
            groups = np.zeros(len(nodes), dtype=np.int64)
            assert len(np.unique(nodes)) == len(nodes), 'Shared batch must deduplicate nodes'
            assert len(np.unique(forward_ids)) == len(forward_ids)
        ego = np.zeros(len(nodes), dtype=np.float32)
        ego[np.unique(target_index)] = 1
        node_features = np.column_stack([sampled['node'].x.numpy(), ego]).astype(np.float32)
        positions = np.full(len(targets), -1, dtype=np.int64)
        width = len(graph.src)
        context_keys = groups[indices[1,:len(forward_ids)]] * width + forward_ids
        target_keys = groups[target_index[0]] * width + targets
        order = np.argsort(context_keys)
        offset = np.searchsorted(context_keys[order], target_keys)
        valid = offset < len(order)
        found = np.flatnonzero(valid)
        found = found[context_keys[order[offset[found]]] == target_keys[found]]
        positions[found] = order[offset[found]]
        arrays = [node_features, indices, self.edge_features(all_ids), target_index,
                  self.edge_features(targets), np.arange(len(all_ids)) < len(forward_ids),
                  np.arange(len(all_ids)) >= len(forward_ids), positions,
                  self.ports(all_ids), self.ports(targets)]
        batch = GraphBatch(*[torch.from_numpy(np.ascontiguousarray(v)) for v in arrays])
        stats = {'targets': len(targets), 'nodes': len(nodes), 'forward_edges': len(forward_ids),
                 'reverse_edges': len(reverse_ids), 'target_edges_not_sampled': int((positions < 0).sum()),
                 'unique_nodes': len(np.unique(nodes)), 'disjoint': graph.disjoint,
                 'relations': len(graph.relations)}
        return rows, batch, stats
