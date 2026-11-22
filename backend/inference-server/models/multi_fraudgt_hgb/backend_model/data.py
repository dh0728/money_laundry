from dataclasses import dataclass
import torch

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

