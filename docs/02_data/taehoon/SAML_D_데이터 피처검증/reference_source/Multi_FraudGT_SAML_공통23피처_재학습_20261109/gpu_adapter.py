"""Lossless CUDA lookup; sampled graphs remain the original PyG graphs."""
import json
from pathlib import Path
from types import SimpleNamespace
import numpy as np
import torch
from fraudgt_lab import GRAPH_ROOT
from fraudgt_lab.config import EDGE_INDICES
from fraudgt_lab.data import FeatureAdapter, GraphBatch
from fraudgt_lab.official_loader import FORWARD, REVERSE
from gpu_features import CudaFeatureStore

def read_json(path): return json.loads(Path(path).read_text())

class GpuAdapter:
    def __init__(self,cpu):
        # Explicit original Multi input root; do not rely on SALT's fallback path.
        cpu.inputs.test=np.load(GRAPH_ROOT/'cache/hi/test_edge17.npy',mmap_mode='r')
        cpu.inputs.test_origin=read_json(GRAPH_ROOT/'cache/hi/test_edges_complete.json')['origin']
        extra=SimpleNamespace(in_ports=cpu.port_arrays[0],out_ports=cpu.port_arrays[1],formats=cpu.formats)
        self.cache=CudaFeatureStore(cpu.inputs,extra,len(cpu.inputs.minute),list(EDGE_INDICES))
        self.original={};self.node=self.src=self.dst=None

    def set_graph(self,graph):
        self.original.clear();self.node=self.src=self.dst=None
        torch.cuda.empty_cache()
        # Keep full ID maps compact; convert only selected rows to int64.
        self.original={k:torch.tensor(np.asarray(v).astype('int32'),device='cuda') for k,v in graph.ids.items()}
        self.node=torch.tensor(np.asarray(graph.nodes),device='cuda')
        self.src=torch.tensor(np.asarray(graph.src),device='cuda')
        self.dst=torch.tensor(np.asarray(graph.dst),device='cuda')

    def materialize(self,graph,sampled,seed_ids):
        rows=sampled[FORWARD].input_id.numpy()
        targets=torch.tensor(np.asarray(seed_ids[rows]).astype('int64'),device='cuda')
        forward=self.original[FORWARD][sampled[FORWARD].e_id.to('cuda')].long()
        reverse=self.original[REVERSE][sampled[REVERSE].e_id.to('cuda')].long()
        all_ids=torch.cat([forward,reverse]);nodes=sampled['node'].n_id.to('cuda')
        indices=torch.cat([sampled[FORWARD].edge_index.to('cuda'),sampled[REVERSE].edge_index.to('cuda').flip(0)],dim=1)
        target_index=sampled[FORWARD].edge_label_index.to('cuda')
        assert torch.equal(nodes[target_index[0]],self.src[targets].long())
        assert torch.equal(nodes[target_index[1]],self.dst[targets].long())
        assert torch.equal(nodes[indices[0]],self.src[all_ids].long())
        assert torch.equal(nodes[indices[1]],self.dst[all_ids].long())
        ego=torch.zeros(len(nodes),dtype=torch.float32,device='cuda');ego[target_index.flatten()]=1
        node_features=torch.cat([self.node[nodes],ego[:,None]],dim=1)
        ordered,order=torch.sort(forward);offset=torch.searchsorted(ordered,targets)
        valid=offset<len(order);safe=offset.clamp(max=len(order)-1)
        valid &= ordered[safe]==targets
        positions=torch.where(valid,order[safe],-1)
        incoming=torch.arange(len(all_ids),device='cuda')<len(forward)
        edge=self.cache.edges(all_ids);target=self.cache.edges(targets)
        batch=GraphBatch(node_features,indices,edge[:,:22],target_index,target[:,:22],incoming,~incoming,positions,edge[:,22:],target[:,22:])
        return rows,batch
