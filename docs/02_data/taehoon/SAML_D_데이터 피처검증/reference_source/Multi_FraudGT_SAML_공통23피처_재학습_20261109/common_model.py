"""Remove unavailable columns physically, without changing graph/model blocks."""
from dataclasses import replace
import torch
from experiment import NODE_KEEP, EDGE_KEEP, VARIANT
from fraudgt_lab.models import make_model
from fraudgt_lab.data import FeatureAdapter
from gpu_adapter import GpuAdapter

def project(batch):
    return replace(batch,node_features=batch.node_features[:,list(NODE_KEEP)],
        edge_features=batch.edge_features[:,list(EDGE_KEEP)],
        target_features=batch.target_features[:,list(EDGE_KEEP)])

def compact_model(config):
    model = make_model(VARIANT,config)
    def sliced(layer, columns):
        # Preserve dropout RNG and the original retained initial weights.
        with torch.random.fork_rng(devices=[]):
            result = torch.nn.Linear(len(columns),layer.out_features)
        with torch.no_grad():
            result.weight.copy_(layer.weight[:,list(columns)])
            result.bias.copy_(layer.bias)
        return result
    model.node_encoder = sliced(model.node_encoder,NODE_KEEP)
    model.edge_encoder = torch.nn.ModuleList([sliced(layer,EDGE_KEEP+(22,)) for layer in model.edge_encoder])
    return model

class ReducedCPU(FeatureAdapter):
    def materialize(self,graph,sampled,seed_ids):
        rows,batch,stats = super().materialize(graph,sampled,seed_ids)
        return rows,project(batch),stats

class ReducedGPU(GpuAdapter):
    def materialize(self,graph,sampled,seed_ids):
        rows,batch = super().materialize(graph,sampled,seed_ids)
        batch=project(batch)
        assert batch.node_features.shape[1]==11 and batch.edge_features.shape[1]==20
        return rows,batch,dict(targets=len(rows))
