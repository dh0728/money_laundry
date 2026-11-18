"""V10 control and FraudGT blocks with explicit transaction-ID readout.

FraudGT math follows upstream GTLayer/SparseNodeTransformer at f88db9dc.
Official readout scores only sampled target edges and reports omitted targets.
An explicit all_targets diagnostic extension is available but disabled by default.
"""

import math
import torch
from torch import nn
from torch_geometric.utils import softmax

from .config import EDGE_DIM
from .data import GraphBatch


class FraudGTBlock(nn.Module):
    """Sparse attention, attribute bias, gated values and updated edge embeddings."""

    def __init__(self, relations: int, hidden: int = 64, heads: int = 8, attention_dropout: float = 0.2):
        super().__init__()
        self.hidden = hidden
        self.heads = heads
        self.node_norm = nn.LayerNorm(hidden)
        self.node_ffn_norm = nn.LayerNorm(hidden)
        self.edge_norm = nn.ModuleList([nn.LayerNorm(hidden) for _ in range(relations)])
        self.query = nn.Linear(hidden, hidden)
        self.key = nn.Linear(hidden, hidden)
        self.value = nn.Linear(hidden, hidden)
        self.node_output = nn.Linear(hidden, hidden)
        self.edge_bias = nn.ModuleList([nn.Linear(hidden, hidden) for _ in range(relations)])
        self.edge_gate = nn.ModuleList([nn.Linear(hidden, hidden) for _ in range(relations)])
        self.edge_output = nn.ModuleList([nn.Linear(hidden, hidden) for _ in range(relations)])
        self.relation_keys = nn.Parameter(torch.empty(relations, heads, hidden // heads, hidden // heads))
        nn.init.xavier_uniform_(self.relation_keys)
        self.node_ffn = nn.Sequential(nn.Linear(hidden, hidden * 2), nn.GELU(), nn.Linear(hidden * 2, hidden))
        self.edge_ffn = nn.ModuleList([nn.Sequential(nn.Linear(hidden, hidden * 2), nn.GELU(), nn.Linear(hidden * 2, hidden)) for _ in range(relations)])
        self.attention_dropout = nn.Dropout(attention_dropout)

    def forward(self, nodes: torch.Tensor, indices: list, edges: list):
        normalized = self.node_norm(nodes)
        shape = (-1, self.heads, self.hidden // self.heads)
        query = self.query(normalized).view(shape)
        key = self.key(normalized).view(shape)
        value = self.value(normalized).view(shape)
        destinations, scores, messages, next_edges = [], [], [], []
        for relation, (index, attributes) in enumerate(zip(indices, edges)):
            source, destination = index
            edge_normalized = self.edge_norm[relation](attributes)
            # Transform each node once per relation, instead of allocating an E×H×D×D tensor.
            transformed_key = torch.einsum("hij,nhj->nhi", self.relation_keys[relation], key)
            vector_score = query[destination] * transformed_key[source] + self.edge_bias[relation](edge_normalized).view(shape)
            scalar_score = (vector_score.sum(-1) / math.sqrt(self.hidden // self.heads)).clamp(-5, 5)
            message = value[source] * self.edge_gate[relation](edge_normalized).view(shape).sigmoid()
            updated = attributes + self.edge_output[relation](vector_score.reshape(-1, self.hidden))
            updated = updated + self.edge_ffn[relation](updated)
            destinations.append(destination)
            scores.append(scalar_score)
            messages.append(message)
            next_edges.append(updated)
        destination = torch.cat(destinations)
        attention = softmax(torch.cat(scores), destination, num_nodes=len(nodes))
        message = self.attention_dropout(attention).unsqueeze(-1) * torch.cat(messages)
        aggregate = nodes.new_zeros((len(nodes), self.heads, self.hidden // self.heads))
        aggregate.index_add_(0, destination, message)
        updated_nodes = nodes + self.node_output(aggregate.flatten(1))
        # Preserve the published code's normalization/FFN ordering exactly.
        normalized_nodes = self.node_ffn_norm(updated_nodes)
        updated_nodes = normalized_nodes + self.node_ffn(normalized_nodes)
        return updated_nodes, next_edges

    def forward_queries(self, nodes, indices, edges, target_index, target_edges):
        """Read every seed without adding unsampled edges to message passing.

        Use the same relation-0 edge update as the published block. This repairs
        the upstream readout's omission of seeds absent from sampled e_id.
        No new parameters, neighbors, attention edges or labels are introduced.
        """
        updated_nodes, next_edges = self.forward(nodes, indices, edges)
        normalized = self.node_norm(nodes)
        shape = (-1, self.heads, self.hidden // self.heads)
        query = self.query(normalized).view(shape)
        key = self.key(normalized).view(shape)
        transformed = torch.einsum('hij,nhj->nhi', self.relation_keys[0], key)
        source, destination = target_index
        edge_normalized = self.edge_norm[0](target_edges)
        vector = query[destination] * transformed[source] + self.edge_bias[0](edge_normalized).view(shape)
        target_edges = target_edges + self.edge_output[0](vector.reshape(-1, self.hidden))
        target_edges = target_edges + self.edge_ffn[0](target_edges)
        return updated_nodes, next_edges, target_edges


class FraudGT(nn.Module):
    """Basic, PE and Multi variants; 34 business features in every variant."""

    def __init__(self, variant: str, readout="official"):
        super().__init__()
        self.variant = variant
        self.readout = readout
        self.use_ports = variant in ("pe_fraudgt_format", "multi_fraudgt_format")
        self.reverse = variant == "multi_fraudgt_format"
        # Official defaults set add_ego_id=False; only the Multi YAML enables it.
        self.use_ego = self.reverse
        relations = 2 if self.reverse else 1
        port_columns = 1 if self.reverse else (2 if self.use_ports else 0)
        self.node_encoder = nn.Linear(20 if self.use_ego else 19, 64)
        self.edge_encoder = nn.ModuleList([nn.Linear(EDGE_DIM + port_columns, 64) for _ in range(relations)])
        self.layers = nn.ModuleList([FraudGTBlock(relations) for _ in range(2)])
        self.head = nn.Sequential(nn.Linear(192, 192), nn.ReLU(), nn.Linear(192, 1))
        self.checkpoint_layers = True

    def forward(self, batch: GraphBatch):
        masks = [batch.incoming] + ([batch.outgoing] if self.reverse else [])
        indices, edges = [], []
        for relation, mask in enumerate(masks):
            index = batch.edge_index[:, mask]
            if relation == 1:
                index = index.flip(0)
            attributes = batch.edge_features[mask]
            if self.use_ports:
                ports = batch.ports[mask, relation:relation + 1] if self.reverse else batch.ports[mask]
                attributes = torch.cat([attributes, ports], dim=1)
            indices.append(index)
            edges.append(self.edge_encoder[relation](attributes))
        nodes = self.node_encoder(batch.node_features if self.use_ego else batch.node_features[:, :19])
        if self.readout == 'official':
            # Same sampled-edge mask/order as upstream hetero_edge._apply_index.
            present = torch.nonzero(batch.target_edge_positions >= 0).flatten()
            selection = present[torch.argsort(batch.target_edge_positions[present])]
            for layer in self.layers:
                if self.training and self.checkpoint_layers:
                    from torch.utils.checkpoint import checkpoint
                    nodes, edges = checkpoint(layer, nodes, indices, edges, use_reentrant=False, preserve_rng_state=True)
                else:
                    nodes, edges = layer(nodes, indices, edges)
            positions = batch.target_edge_positions[selection]
            source, destination = batch.target_index[:, selection]
            representation = torch.cat([nodes[source], nodes[destination], edges[0][positions]], dim=1)
        elif self.readout == 'all_targets':
            # Optional deployment/diagnostic extension, disabled for the official comparison.
            attributes = batch.target_features
            if self.use_ports:
                ports = batch.target_ports[:, :1] if self.reverse else batch.target_ports
                attributes = torch.cat([attributes, ports], dim=1)
            queries = self.edge_encoder[0](attributes)
            for layer in self.layers:
                if self.training and self.checkpoint_layers:
                    from torch.utils.checkpoint import checkpoint
                    nodes, edges, queries = checkpoint(layer.forward_queries, nodes, indices, edges,
                        batch.target_index, queries, use_reentrant=False, preserve_rng_state=True)
                else:
                    nodes, edges, queries = layer.forward_queries(nodes, indices, edges, batch.target_index, queries)
            source, destination = batch.target_index
            representation = torch.cat([nodes[source], nodes[destination], queries], dim=1)
            selection = torch.arange(len(source), device=nodes.device)
        else:
            raise ValueError(self.readout)
        return self.head(representation).squeeze(-1), selection


def make_model(variant, config=None):
    if variant not in ('fraudgt_format', 'pe_fraudgt_format', 'multi_fraudgt_format'):
        raise ValueError(variant)
    model = FraudGT(variant, readout=config.readout if config else 'official')
    if config is not None:
        model.checkpoint_layers = config.checkpoint_layers
    return model
