"""Preserved native SAML graph and exact cached features from the baseline."""
from pathlib import Path
import numpy as np
import torch
from torch_geometric.sampler import NeighborSampler
from fraudgt_lab.data import FeatureAdapter, GraphBatch
from fraudgt_lab.official_loader import PeriodGraph, MappedFeatureStore, MappedGraphStore, FORWARD, REVERSE
from experiment import SAML
from common_model import project
CACHE = SAML/'cache'
SG = Path('/workspace/kimi/Claude_GNN/final_model/experiments/v10_gnn_verify_20261025/cache/saml')
N, NN = 9504852, 855460

def mmap(path): return np.load(path,mmap_mode='r')

class SamlAdapter(FeatureAdapter):
    def __init__(self):
        self.edge = mmap(CACHE / 'edge22.npy')
        self.port_arrays = [mmap(CACHE / f'{role}_ports.npy') for role in ('incoming','outgoing')]
    def edge_features(self, ids):
        return np.ascontiguousarray(self.edge[ids])
    def ports(self, ids):
        return np.column_stack([a[ids] for a in self.port_arrays]).astype('float32')

class GpuAdapter:
    """Exact cached feature lookup on CUDA; same PyG graph and query order."""
    def __init__(self, graph):
        self.edge = torch.tensor(np.asarray(mmap(CACHE/'edge22.npy')), device='cuda')
        self.node = torch.tensor(np.asarray(graph.nodes), device='cuda')
        self.ports = torch.tensor(np.column_stack([mmap(CACHE/f'{role}_ports.npy') for role in ('incoming','outgoing')]), dtype=torch.float32, device='cuda')
        self.original = {kind: torch.tensor(np.asarray(ids).astype('int64'),device='cuda') for kind,ids in graph.ids.items()}
        self.src = torch.tensor(np.asarray(graph.src).astype('int64'),device='cuda')
        self.dst = torch.tensor(np.asarray(graph.dst).astype('int64'),device='cuda')
        self.positions = torch.full((N,),-1,dtype=torch.int64,device='cuda')

    def materialize(self, graph, sampled, seed_ids):
        rows = sampled[FORWARD].input_id.numpy()
        targets = torch.tensor(np.asarray(seed_ids[rows]).astype('int64'),device='cuda')
        forward = self.original[FORWARD][sampled[FORWARD].e_id.to('cuda')]
        reverse = self.original[REVERSE][sampled[REVERSE].e_id.to('cuda')]
        all_ids = torch.cat([forward,reverse])
        nodes = sampled['node'].n_id.to('cuda')
        indices = torch.cat([sampled[FORWARD].edge_index.to('cuda'),sampled[REVERSE].edge_index.to('cuda').flip(0)],dim=1)
        target_index = sampled[FORWARD].edge_label_index.to('cuda')
        # Retain endpoint/transaction-ID checks on every production batch.
        assert torch.equal(nodes[target_index[0]],self.src[targets])
        assert torch.equal(nodes[target_index[1]],self.dst[targets])
        assert torch.equal(nodes[indices[0]],self.src[all_ids])
        assert torch.equal(nodes[indices[1]],self.dst[all_ids])
        ego = torch.zeros(len(nodes),dtype=torch.float32,device='cuda')
        ego[target_index.flatten()] = 1
        node_features = torch.cat([self.node[nodes],ego[:,None]],dim=1)
        self.positions.fill_(-1)
        self.positions[forward] = torch.arange(len(forward),device='cuda')
        positions = self.positions[targets]
        incoming = torch.arange(len(all_ids),device='cuda') < len(forward)
        batch = GraphBatch(node_features,indices,self.edge[all_ids],target_index,self.edge[targets],
                           incoming,~incoming,positions,self.ports[all_ids],self.ports[targets])
        stats = dict(targets=len(targets),nodes=len(nodes),forward_edges=len(forward),reverse_edges=len(reverse),
                     target_edges_not_sampled=int((positions<0).sum()),unique_nodes=len(nodes),disjoint=False,relations=2)
        return rows,batch,stats

class SamlGraph(PeriodGraph):
    def __init__(self, config):
        self.config, self.scope, self.variant = config, 'test', 'multi_fraudgt_format'
        self.relations, self.disjoint = [FORWARD, REVERSE], False
        self.ids, self.arrays = {}, {}
        for kind, role in [(FORWARD,'incoming'), (REVERSE,'outgoing')]:
            row = np.load(CACHE / f'{role}_row.npy', mmap_mode='c')
            ptr = np.load(SG / f'{role}_time_offsets.npy', mmap_mode='c')
            self.arrays[kind] = (torch.from_numpy(row), torch.from_numpy(ptr))
            self.ids[kind] = mmap(SG / f'{role}_time_ids.npy')
        self.nodes = mmap(CACHE / 'nodes19.npy')
        self.feature_store = MappedFeatureStore(self.nodes)
        self.graph_store = MappedGraphStore(self.arrays, NN)
        self.sampler = NeighborSampler((self.feature_store,self.graph_store), num_neighbors=[50,50], replace=False, subgraph_type='directional', disjoint=False)
        self.sampler.edge_types = list(self.relations)
        self.src, self.dst = [mmap(SG / f'{name}.npy') for name in ('src','dst')]

class ReducedSamlGPU(GpuAdapter):
    def materialize(self,graph,sampled,seed_ids):
        rows,batch,stats=super().materialize(graph,sampled,seed_ids)
        return rows,project(batch),stats
