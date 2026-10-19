"""The delivered v10 network and checkpoint loader, from the team's 01_binary_v10.ipynb.

Layer layout, option names and score() are unchanged so the packaged state_dict loads
with strict=True and reproduces the team's reference outputs.
"""
from dataclasses import dataclass
import json

import numpy as np
import torch
from torch_geometric.nn import TransformerConv

from models.binary_v10.spec import ASSET_SHA256, asset


@dataclass(frozen=True)
class Options:
    neighbors: int = 100
    outgoing: bool = True
    reverse_mp: bool = True
    ego: bool = False
    ports: bool = False
    seed: int = 42


class GraphEncoder(torch.nn.Module):
    """Checkpoint-compatible two-layer encoder with separate message directions."""

    def __init__(self, options):
        super().__init__()
        self.options = options
        node_dim = 19 + int(options.ego)
        edge_dim = 17 + int(options.ports)
        self.conv1 = TransformerConv(node_dim, 64, heads=2, edge_dim=edge_dim, dropout=0.0)
        self.conv2 = TransformerConv(128, 64, heads=2, edge_dim=edge_dim, dropout=0.0)
        self.head = torch.nn.Sequential(torch.nn.Linear(256 + edge_dim, 128), torch.nn.ReLU())
        if options.reverse_mp:
            self.reverse1 = TransformerConv(node_dim, 64, heads=2, edge_dim=edge_dim, dropout=0.0, root_weight=False)
            self.reverse2 = TransformerConv(128, 64, heads=2, edge_dim=edge_dim, dropout=0.0, root_weight=False)
            self.merge1 = torch.nn.Linear(256, 128, bias=False)
            self.merge2 = torch.nn.Linear(256, 128, bias=False)

    def encode(self, x, edge_index, edge_attr, target_index, target_attr, incoming, outgoing):
        direct, direct_attr = edge_index[:, incoming], edge_attr[incoming]
        reverse, reverse_attr = edge_index[:, outgoing].flip(0), edge_attr[outgoing]
        hidden = self.conv1(x, direct, direct_attr)
        if self.options.reverse_mp:
            hidden = self.merge1(torch.cat([hidden, self.reverse1(x, reverse, reverse_attr)], dim=1))
        hidden = hidden.relu()
        encoded = self.conv2(hidden, direct, direct_attr)
        if self.options.reverse_mp:
            encoded = self.merge2(torch.cat([encoded, self.reverse2(hidden, reverse, reverse_attr)], dim=1))
        encoded = encoded.relu()
        return self.head(torch.cat([encoded[target_index[0]], encoded[target_index[1]], target_attr], dim=1))


class BinaryGNN(GraphEncoder):
    """V10: one independent binary risk head, including unmatched laundering."""

    def __init__(self, masses, options, pos_weight=300.0):
        super().__init__(options)
        self.risk_head = torch.nn.Linear(128, 1)
        self.register_buffer("risk_offset", torch.tensor(-np.log(pos_weight), dtype=torch.float32))

    def forward(self, *batch):
        return self.risk_head(self.encode(*batch)).squeeze(-1)

    def scores(self, *batch):
        return (self(*batch) + self.risk_offset).sigmoid()


class Predictor:
    """One immutable model instance loaded from the checksummed package files."""

    def __init__(self, device="cpu", threads=2):
        meta = json.loads(asset("binary.json").read_text(encoding="utf-8"))
        if meta["bundle_sha256"] != ASSET_SHA256["binary.pt"]:
            raise ValueError("Model metadata does not match the weights")
        checkpoint = torch.load(asset("binary.pt"), map_location="cpu", weights_only=True)
        self.options = Options(**checkpoint["options"])
        if not self.options.ego or self.options.ports:
            raise ValueError("Bundle supports the selected ego/no-ports checkpoints")
        self.device = device
        self.model = BinaryGNN(checkpoint["train_masses"], self.options).to(device).eval()
        self.model.load_state_dict(checkpoint["state_dict"])
        for parameter in self.model.parameters():
            parameter.requires_grad_(False)
        self.threshold = checkpoint["validation_threshold"]
        torch.set_num_threads(threads)

    def risk(self, graph):
        """Laundering risk score of the one target transaction in a GraphInput."""
        with torch.no_grad():
            return float(self.model.scores(*graph.tensors(self.device))[0])
