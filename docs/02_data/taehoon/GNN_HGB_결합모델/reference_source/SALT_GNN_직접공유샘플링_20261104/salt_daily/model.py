"""SALT with paper-listed hyperparameters and the retained daily V10 graph adapter.

All variants share the input dimensions, output head, sampled contexts and
two message-passing layers. This is not certified as an official reproduction.
"""
from . import config  # Establish the existing dependency paths first.
import torch
from torch import nn
from torch_geometric.nn import TransformerConv


def message_statistics(messages, destination, nodes):
    """Population mean/std/min/max, with exact zeros for empty neighborhoods."""
    width = messages.shape[1]
    counts = messages.new_zeros(nodes)
    counts.index_add_(0, destination, messages.new_ones(len(messages)))
    total = messages.new_zeros((nodes, width)).index_add(0, destination, messages)
    mean = total / counts.clamp_min(1).unsqueeze(1)
    # Centered second moment avoids cancellation for nearly equal messages.
    centered = messages - mean[destination]
    variance = messages.new_zeros((nodes, width)).index_add(0, destination, centered.square())
    variance = variance / counts.clamp_min(1).unsqueeze(1)
    std = torch.where(variance > 0, variance.clamp_min(1e-20).sqrt(), torch.zeros_like(variance))
    index = destination[:, None].expand(-1, width)
    low = messages.new_full((nodes, width), float('inf')).scatter_reduce(0, index, messages, reduce='amin', include_self=True)
    high = messages.new_full((nodes, width), float('-inf')).scatter_reduce(0, index, messages, reduce='amax', include_self=True)
    occupied = counts[:, None] > 0
    low = torch.where(occupied, low, torch.zeros_like(low))
    high = torch.where(occupied, high, torch.zeros_like(high))
    return torch.cat((mean, std, low, high), dim=1), counts


def scaled_statistics(statistics, degree, delta):
    gamma = degree.log1p().unsqueeze(1)
    amplification = gamma / delta
    attenuation = torch.where(gamma > 0, delta / gamma.clamp_min(1e-12), torch.zeros_like(gamma))
    return torch.cat((statistics, statistics * amplification, statistics * attenuation), dim=1)


def mlp(input_width, hidden):
    return nn.Sequential(nn.Linear(input_width, hidden), nn.ReLU(), nn.Linear(hidden, hidden))


def model_kwargs(protocol, delta):
    architecture = protocol.get('architecture', {})
    assert architecture.get('layers', 2) == 2, 'This implementation has two message-passing layers'
    return dict(hidden=architecture.get('common_hidden', 20),
                heads=architecture.get('heads', 2), delta=delta,
                dropout=architecture.get('dropout', .083),
                final_dropout=architecture.get('final_dropout', .288),
                edge_dim=architecture.get('edge_dim', 14))


class Statistics(nn.Module):
    def __init__(self, hidden, edge_dim):
        super().__init__()
        self.edge = nn.Linear(edge_dim, hidden)
        self.update = mlp(13 * hidden, hidden)

    def forward(self, nodes, index, attributes, degree, delta):
        messages = nodes[index[0]] + self.edge(attributes)
        statistics, _ = message_statistics(messages, index[1], len(nodes))
        return self.update(torch.cat((nodes, scaled_statistics(statistics, degree, delta)), dim=1))


class DailyLayer(nn.Module):
    def __init__(self, hidden, heads, mode, edge_dim=14, dropout=.083):
        super().__init__()
        self.mode = mode
        self.attention = nn.ModuleList([
            TransformerConv(hidden, hidden // heads, heads=heads, edge_dim=edge_dim,
                            dropout=0., root_weight=False, bias=False) for _ in range(2)
        ]) if mode in ('A0', 'A3') else None
        self.statistics = nn.ModuleList([Statistics(hidden, edge_dim) for _ in range(2)]) if mode in ('A1', 'A3') else None
        if self.attention is not None:
            for layer in self.attention:
                # PyG creates this projection even with root_weight=False.
                # The root path belongs exclusively to the common fusion MLP.
                layer.lin_skip.requires_grad_(False)
        self.attention_merge = nn.Linear(2 * hidden, hidden) if self.attention is not None else None
        self.statistics_merge = nn.Linear(2 * hidden, hidden) if self.statistics is not None else None
        self.fusion = mlp((3 if mode == 'A3' else 2) * hidden, hidden)
        # The paper gives a dropout rate without a complete executable placement.
        # Use hidden-state dropout after fusion; attention coefficient dropout stays 0.
        self.dropout = nn.Dropout(dropout)

    def forward(self, nodes, index, attributes, incoming, outgoing, degree, delta):
        parts = [nodes]
        masks = (incoming, outgoing)
        edges = (index[:, incoming], index[:, outgoing].flip(0))
        if self.statistics is not None:
            stats = [layer(nodes, edges[i], attributes[masks[i]], degree[:, i], delta[i])
                     for i, layer in enumerate(self.statistics)]
            parts.append(self.statistics_merge(torch.cat(stats, dim=1)))
        if self.attention is not None:
            attention = [layer(nodes, edges[i], attributes[masks[i]]) for i, layer in enumerate(self.attention)]
            parts.append(self.attention_merge(torch.cat(attention, dim=1)))
        return self.dropout((nodes + self.fusion(torch.cat(parts, dim=1))) / 2)


class DailySALT(nn.Module):
    def __init__(self, variant='A3', hidden=20, heads=2, delta=(1., 1.), dropout=.083, final_dropout=.288, edge_dim=14):
        super().__init__()
        if variant not in ('A0', 'A1', 'A2', 'A3'):
            raise ValueError(variant)
        self.variant = variant
        self.register_buffer('delta', torch.tensor(delta, dtype=torch.float32))
        self.node_encoder = nn.Linear(20, hidden)  # 19 business features + ego indicator.
        if variant == 'A2':
            self.attention_layers = nn.ModuleList([DailyLayer(hidden, heads, 'A0', edge_dim=edge_dim, dropout=dropout) for _ in range(2)])
            self.statistic_layers = nn.ModuleList([DailyLayer(hidden, heads, 'A1', edge_dim=edge_dim, dropout=dropout) for _ in range(2)])
            self.final_fusion = mlp(3 * hidden, hidden)
        else:
            self.layers = nn.ModuleList([DailyLayer(hidden, heads, variant, edge_dim=edge_dim, dropout=dropout) for _ in range(2)])
        self.head = nn.Sequential(nn.Linear(2 * hidden + edge_dim, hidden), nn.ReLU(),
                                  nn.Dropout(final_dropout), nn.Linear(hidden, 2))

    def forward(self, x, index, attributes, target_index, target_attributes, incoming, outgoing, degree, return_logits=False):
        initial = self.node_encoder(x).relu()
        if self.variant == 'A2':
            attention = statistics = initial
            for a_layer, s_layer in zip(self.attention_layers, self.statistic_layers):
                attention = a_layer(attention, index, attributes, incoming, outgoing, degree, self.delta)
                statistics = s_layer(statistics, index, attributes, incoming, outgoing, degree, self.delta)
            nodes = (initial + self.final_fusion(torch.cat((initial, statistics, attention), dim=1))) / 2
        else:
            nodes = initial
            for layer in self.layers:
                nodes = layer(nodes, index, attributes, incoming, outgoing, degree, self.delta)
        logits = self.head(torch.cat((nodes[target_index[0]], nodes[target_index[1]], target_attributes), dim=1))
        # sigmoid(logit_1 - logit_0) equals the two-class softmax fraud probability.
        return logits if return_logits else logits[:, 1] - logits[:, 0]

