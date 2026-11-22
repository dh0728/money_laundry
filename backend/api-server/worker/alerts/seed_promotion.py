"""Seed promotion before the block generator: low-score transactions linked to seeds become seeds.

The model misses some transactions of a laundering pattern, and the generator only joins seeds,
so a missed transaction splits the pattern. Two steps, judged afresh on every run from the
window's stored scores (nothing carries over between runs):

1. Dual threshold: a scored transaction at or above ``low`` that shares an account with a seed.
2. Amount-ratio chaining: from every seed (including step 1), follow the receiver's later outgoing
   transactions worth 0.5-1.05 times the incoming amount within 7 days, and the sender's earlier
   incoming transactions by the same rule, up to 6 steps. Only transactions scored at or above
   ``floor`` with a known amount are followed.

``low`` and ``floor`` depend on the model's score scale and live in the bound binary model's spec;
a model without them gets no promotion. Measured in the Alert generator study (2026-11-04,
HI-Small tuning, HI-Medium test).
"""
from bisect import bisect_left
from collections import defaultdict, deque

CHAIN_RATIO = (0.5, 1.05)
CHAIN_LAG_US = 7 * 86_400 * 1_000_000
CHAIN_DEPTH = 6


def promote(edges, probability, seeds, low, floor):
    """Positions in ``edges`` (EdgeTable of the window, rows in ascending tx_id order) to add as seeds.

    ``probability`` maps a scored tx_id to its score; ``seeds`` are the tx_ids already seeds.
    Only scored transactions at or above ``low`` or ``floor`` are visited, not the whole window.
    """
    tx_ids, times = edges.tx_ids, edges.occurred_us
    sources, targets, amounts = edges.from_accounts, edges.to_accounts, edges.amount_usd_micros

    def position(key):
        i = bisect_left(tx_ids, key)
        return i if i < len(tx_ids) and tx_ids[i] == key else None

    seeded = {i for i in map(position, seeds) if i is not None}
    accounts = set()
    for i in seeded:
        accounts.add(sources[i])
        accounts.add(targets[i])
    lowest = min(low, floor)
    scored = sorted(i for i in (position(key) for key, value in probability.items() if value >= lowest)
                    if i is not None)
    promoted = [i for i in scored if i not in seeded and probability[tx_ids[i]] >= low
                and (sources[i] in accounts or targets[i] in accounts)]
    seeded.update(promoted)
    # Chain only through scored transactions with a known amount, in time order.
    outgoing, incoming = defaultdict(list), defaultdict(list)
    for i in sorted(scored, key=times.__getitem__):
        if amounts[i] > 0 and probability[tx_ids[i]] >= floor:
            outgoing[sources[i]].append(i)
            incoming[targets[i]].append(i)
    lower, upper = CHAIN_RATIO
    queue = deque((i, 0) for i in sorted(seeded))
    seen = set(seeded)
    while queue:
        i, depth = queue.popleft()
        if depth >= CHAIN_DEPTH or amounts[i] <= 0:
            continue
        for e in outgoing.get(targets[i], ()):
            gap = times[e] - times[i]
            if 0 < gap <= CHAIN_LAG_US and e not in seen and lower <= amounts[e] / amounts[i] <= upper:
                seen.add(e)
                promoted.append(e)
                queue.append((e, depth + 1))
        for e in incoming.get(sources[i], ()):
            gap = times[i] - times[e]
            if 0 < gap <= CHAIN_LAG_US and e not in seen and lower <= amounts[i] / amounts[e] <= upper:
                seen.add(e)
                promoted.append(e)
                queue.append((e, depth + 1))
    return promoted
