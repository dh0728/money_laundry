"""Graph-level features of one Alert (its core transactions), used by the Alert type decision tree.

Copied from worktable/worker_experiments/alert_type_tree/alert_features.py, which the tree was trained
with; only the amount ratio loop now visits just the transactions arriving at each sender (same values).

Input per transaction: occurred time (us), from account, to account, amount (USD), payment format.
Every feature is a number computed from the Alert's own transactions only. Time span is left out on purpose:
in the synthetic datasets it follows dataset length, not laundering (Alert parameter audit, 2026-10-27).
Time is used only to order transactions for longest_chain and amount_ratio_chain.
"""
from collections import Counter, defaultdict
import math

FEATURES = (
    "tx_count", "account_count", "density", "components",
    "source_count", "sink_count", "middle_count", "middle_share",
    "max_out_degree", "max_in_degree", "max_out_share", "max_in_share",
    "max_through_degree", "hub_out_in_ratio",
    "sources_to_sinks_ratio", "two_hop_paths_top", "longest_chain",
    "cycle_size", "reciprocal_pairs", "repeat_pair_share",
    "amount_cv", "amount_ratio", "amount_ratio_chain",
    "format_count", "top_format_share",
)


def _scc_max(nodes, out_edges):
    """Size of the largest strongly connected component with a directed cycle (0 if none)."""
    index, low, stack, on, best, counter = {}, {}, [], set(), 0, [0]
    for root in nodes:
        if root in index:
            continue
        work = [(root, iter(out_edges[root]))]
        index[root] = low[root] = counter[0]; counter[0] += 1
        stack.append(root); on.add(root)
        while work:
            v, it = work[-1]
            advanced = False
            for w in it:
                if w not in index:
                    index[w] = low[w] = counter[0]; counter[0] += 1
                    stack.append(w); on.add(w)
                    work.append((w, iter(out_edges[w])))
                    advanced = True
                    break
                if w in on:
                    low[v] = min(low[v], index[w])
            if advanced:
                continue
            work.pop()
            if work:
                low[work[-1][0]] = min(low[work[-1][0]], low[v])
            if low[v] == index[v]:
                size = 0
                while True:
                    w = stack.pop(); on.discard(w); size += 1
                    if w == v:
                        break
                if size >= 2:
                    best = max(best, size)
    return best


def features(rows):
    """rows: list of (occurred_us, src, dst, amount_usd, payment_format). Returns a tuple in FEATURES order."""
    n = len(rows)
    out_nb, in_nb = defaultdict(set), defaultdict(set)
    pairs = Counter()
    for _, s, d, _, _ in rows:
        out_nb[s].add(d)
        in_nb[d].add(s)
        pairs[(s, d)] += 1
    nodes = set(out_nb) | set(in_nb)
    a = len(nodes)
    sources = [v for v in nodes if out_nb[v] and not in_nb[v]]
    sinks = [v for v in nodes if in_nb[v] and not out_nb[v]]
    middles = [v for v in nodes if in_nb[v] and out_nb[v]]
    max_out = max((len(out_nb[v]) for v in nodes), default=0)
    max_in = max((len(in_nb[v]) for v in nodes), default=0)
    through = max((min(len(in_nb[v]), len(out_nb[v])) for v in middles), default=0)
    hub = max(nodes, key=lambda v: (len(out_nb[v]) + len(in_nb[v]), str(v)))
    hub_ratio = (len(out_nb[hub]) + 1) / (len(in_nb[hub]) + 1)
    # weak components
    parent = {v: v for v in nodes}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for s, d in pairs:
        parent[find(s)] = find(d)
    components = len({find(v) for v in nodes})
    # two-hop paths from the widest source to the widest sink (scatter-gather shape)
    top_src = max(sources, key=lambda v: (len(out_nb[v]), str(v)), default=None)
    top_snk = max(sinks, key=lambda v: (len(in_nb[v]), str(v)), default=None)
    two_hop = 0
    if top_src is not None and top_snk is not None:
        two_hop = sum(1 for m in out_nb[top_src] if top_snk in out_nb[m])
    # longest time-respecting chain: tx b follows tx a when a.dst == b.src and a.time <= b.time
    order = sorted(range(n), key=lambda i: rows[i][0])
    best_end = defaultdict(int)  # account -> longest chain ending at it (by transactions seen so far)
    chain, ratios = 0, []
    for i in order:
        t, s, d, amt, _ = rows[i]
        length = best_end[s] + 1
        if length > best_end[d]:
            best_end[d] = length
        chain = max(chain, length)
    # Amount ratio of each transaction to every earlier-or-equal one arriving at its sender.
    arriving = defaultdict(list)
    for i in range(n):
        arriving[rows[i][2]].append(i)
    for j in range(n):
        for i in arriving[rows[j][1]]:
            if rows[i][0] <= rows[j][0] and i != j and rows[i][3] > 0:
                ratios.append(rows[j][3] / rows[i][3])
    reciprocal = sum(1 for (s, d) in pairs if s < d and (d, s) in pairs) if a else 0
    amounts = [r[3] for r in rows]
    mean = sum(amounts) / n
    sd = math.sqrt(sum((x - mean) ** 2 for x in amounts) / n)
    formats = Counter(r[4] for r in rows)
    positive = [x for x in amounts if x > 0]
    return (
        n, a, len(pairs) / (a * (a - 1)) if a > 1 else 0.0, components,
        len(sources), len(sinks), len(middles), len(middles) / a if a else 0.0,
        max_out, max_in, max_out / n, max_in / n,
        through, hub_ratio,
        (len(sources) + 1) / (len(sinks) + 1), two_hop, chain,
        _scc_max(sorted(nodes, key=str), {v: sorted(out_nb[v], key=str) for v in nodes}),
        reciprocal, sum(c - 1 for c in pairs.values()) / n,
        sd / mean if mean else 0.0,
        max(positive) / min(positive) if positive else 1.0,
        sorted(ratios)[len(ratios) // 2] if ratios else 1.0,
        len(formats), formats.most_common(1)[0][1] / n,
    )
