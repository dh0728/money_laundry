"""Official class-weighted binary loss and AdamW parameter groups."""

import torch
from torch.nn import functional as F


def class_weighted_loss(logits, labels, config):
    """Upstream binary branch, before mean reduction; no sampling weight here."""
    weights = torch.where(labels > 0, config.positive_weight, 1.0)
    return F.binary_cross_entropy_with_logits(logits, labels, weight=weights, reduction='none')


def make_optimizer(model, config):
    named = list(model.named_parameters())
    no_decay = ('bias', 'LayerNorm.bias', 'LayerNorm.weight')
    groups = [
        {'params': [p for name, p in named if not any(key in name for key in no_decay)],
         'weight_decay': config.weight_decay},
        {'params': [p for name, p in named if any(key in name for key in no_decay)],
         'weight_decay': 0.0},
    ]
    return torch.optim.AdamW(groups, lr=config.learning_rate(1), weight_decay=config.weight_decay)
