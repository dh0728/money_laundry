"""Pure, bounded transaction-flow construction. No labels, persistence or review state.

Transaction identifiers are distinct from zero-based internal row positions.
The caller freezes facts and score validity before supplying seed IDs.
"""
from array import array
from bisect import bisect_left, bisect_right
from collections import defaultdict, deque
from dataclasses import asdict, dataclass
import hashlib
import json
from heapq import nsmallest
from typing import Iterable

HOUR_US = 3_600_000_000


class GraphBudgetExceeded(RuntimeError):
    """No successful batch may be published after this exception."""


@dataclass(frozen=True, slots=True)
class FlowPolicy:
    version: str = "flow-evidence-1"
    window_us: int = 72 * HOUR_US
    max_hops: int = 2
    neighbors_per_step: int = 64
    context_per_seed: int = 100
    max_context_edges: int = 200
    component_span_us: int = 240 * HOUR_US
    max_edge_visits: int = 20_000_000
    max_relations: int = 200_000
    max_core_edges: int = 4096
    hub_min_activity: int = 512
    hub_max_seed_share_percent: int = 20
    hub_context_per_seed: int = 16

    def validate(self):
        positive = (self.window_us, self.max_hops, self.neighbors_per_step,
                    self.component_span_us, self.max_edge_visits,
                    self.max_relations, self.max_core_edges, self.hub_min_activity,
                    self.hub_max_seed_share_percent, self.hub_context_per_seed)
        if (not self.version or any(type(value) is not int or value < 1 for value in positive)
                or any(type(value) is not int or value < 0
                       for value in (self.context_per_seed, self.max_context_edges))
                or self.component_span_us < self.window_us
                or self.hub_max_seed_share_percent > 100):
            raise ValueError("Invalid flow policy")


class EdgeTable:
    """Compact columns. Append before indexing; never mutate a frozen table."""

    def __init__(self):
        self.tx_ids = array("q")
        self.occurred_us = array("q")
        self.from_accounts = array("q")
        self.to_accounts = array("q")
        self._positions = None
        self._frozen = False

    def __len__(self):
        return len(self.tx_ids)

    def append(self, tx_id: int, occurred_us: int, from_account: int, to_account: int):
        if self._frozen:
            raise ValueError("Cannot append to frozen edge table")
        if (any(type(value) is not int for value in
                (tx_id, occurred_us, from_account, to_account))
                or tx_id <= 0 or from_account <= 0 or to_account <= 0):
            raise ValueError("Invalid edge identity/time/account")
        # Check every value before mutating any column.
        if any(not -(1 << 63) <= value < (1 << 63)
               for value in (tx_id, occurred_us, from_account, to_account)):
            raise ValueError("Edge value exceeds signed int64")
        self.tx_ids.append(tx_id)
        self.occurred_us.append(occurred_us)
        self.from_accounts.append(from_account)
        self.to_accounts.append(to_account)

    def freeze(self):
        if not self._frozen:
            if len({len(self.tx_ids), len(self.occurred_us),
                    len(self.from_accounts), len(self.to_accounts)}) != 1:
                raise ValueError("Edge column lengths differ")
            if not all(tx_id == pos + 1 for pos, tx_id in enumerate(self.tx_ids)):
                positions = {tx_id: pos for pos, tx_id in enumerate(self.tx_ids)}
                if len(positions) != len(self):
                    raise ValueError("Duplicate transaction ID")
                self._positions = positions
            for name in ("tx_ids", "occurred_us", "from_accounts", "to_accounts"):
                setattr(self, name, memoryview(getattr(self, name)).toreadonly())
            self._frozen = True
        return self

    def position(self, tx_id: int) -> int:
        if not self._frozen:
            raise ValueError("Freeze edge table before looking up transaction IDs")
        if type(tx_id) is not int:
            raise ValueError("Transaction ID must be int64, not a row position")
        if self._positions is None:
            if 1 <= tx_id <= len(self):
                return tx_id - 1
            raise ValueError("Unknown seed transaction")
        try:
            return self._positions[tx_id]
        except KeyError as exc:
            raise ValueError("Unknown seed transaction") from exc


class FlowIndex:
    """One shared index per immutable snapshot; no per-seed copy of the ledger."""

    def __init__(self, edges: EdgeTable):
        self.edges = edges.freeze()
        self.incoming = defaultdict(list)
        self.outgoing = defaultdict(list)
        for pos in range(len(edges)):
            self.incoming[edges.to_accounts[pos]].append(pos)
            self.outgoing[edges.from_accounts[pos]].append(pos)
        order = lambda pos: (edges.occurred_us[pos], edges.tx_ids[pos])
        for index in (self.incoming, self.outgoing):
            for rows in index.values():
                rows.sort(key=order)

    def interval(self, index, account, low, high, *, after=None, before=None):
        rows = index.get(account, ())
        time_at = self.edges.occurred_us.__getitem__
        begin = bisect_left(rows, low, key=time_at)
        end = bisect_right(rows, high, key=time_at)
        if after is not None:
            begin = max(begin, bisect_right(rows, after, key=time_at))
        if before is not None:
            end = min(end, bisect_left(rows, before, key=time_at))
        return rows, begin, max(begin, end)

    def nearest(self, rows, begin, end, anchor, limit, exclude=None):
        """Exact nearest selection without scanning a high-degree account.

        The boundary-time expansion preserves ascending IDs across large ties.
        Return selected positions, actual examined positions, eligible count.
        """
        times, ids = self.edges.occurred_us, self.edges.tx_ids
        count = end - begin
        if count <= limit + 1:
            pool = rows[begin:end]
        else:
            pivot = bisect_left(rows, anchor, begin, end, key=times.__getitem__)
            left = max(begin, pivot - limit - 1)
            right = min(end, pivot + limit + 1)
            pool = rows[left:right]
            if left > begin:
                tie_start = bisect_left(rows, times[rows[left]], begin, left,
                                       key=times.__getitem__)
                pool = list(set(pool) | set(rows[tie_start:min(left, tie_start + limit + 1)]))
        eligible_count = count
        if exclude is not None:
            excluded_at = bisect_left(
                rows, (times[exclude], ids[exclude]), begin, end,
                key=lambda pos: (times[pos], ids[pos]))
            if excluded_at < end and rows[excluded_at] == exclude:
                eligible_count -= 1
        eligible = [pos for pos in pool if pos != exclude]
        selected = nsmallest(limit, eligible,
                             key=lambda pos: (abs(times[pos] - anchor), times[pos], ids[pos]))
        return selected, len(pool), int(eligible_count)


@dataclass(frozen=True, slots=True)
class Witness:
    kind: str
    tx_ids: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class FlowGraph:
    seed_ids: tuple[int, ...]
    connection_ids: tuple[int, ...]
    context_ids: tuple[int, ...]
    witnesses: tuple[Witness, ...]
    limits: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class UnassignedSeed:
    tx_id: int
    reason: str


@dataclass(frozen=True, slots=True)
class RejectedRelation:
    witness: Witness
    reason: str


@dataclass(frozen=True, slots=True)
class FlowBatch:
    graphs: tuple[FlowGraph, ...]
    unassigned: tuple[UnassignedSeed, ...]
    rejected_relations: tuple[RejectedRelation, ...]
    selected_neighbor_windows: int
    edge_visits: int
    policy_digest: str

    @property
    def ungrouped_seed_ids(self):
        return tuple(item.tx_id for item in self.unassigned)

    @property
    def rejected_span_relations(self):
        return sum(item.reason == "COMPONENT_SPAN" for item in self.rejected_relations)


def build_flow_graphs(index: FlowIndex, seed_ids: Iterable[int],
                      policy: FlowPolicy) -> FlowBatch:
    """Build from already-classified valid seeds, including historical unassigned ones.

    A two-edge observed flow/branch/repeat is evidence; a single isolated edge is
    not. Evidence establishes a reviewable relationship, not a laundering verdict.
    Neighbor/context selection is declared policy, unlike fatal compute budgets.
    """
    policy.validate()
    edges = index.edges
    times, sources, targets, ids = (edges.occurred_us, edges.from_accounts,
                                   edges.to_accounts, edges.tx_ids)
    seeds = {edges.position(tx_id) for tx_id in seed_ids}
    ordered_seeds = sorted(seeds, key=ids.__getitem__)
    visits = 0
    selected_windows = 0
    relations = {}
    explored = {}
    seed_limits = defaultdict(set)
    support = {}
    weak_relations = {}

    seed_incoming, seed_outgoing = defaultdict(list), defaultdict(list)
    for pos in ordered_seeds:
        seed_incoming[targets[pos]].append(pos)
        seed_outgoing[sources[pos]].append(pos)
    for seed_index in (seed_incoming, seed_outgoing):
        for rows in seed_index.values():
            rows.sort(key=lambda pos: (times[pos], ids[pos]))

    def ambiguous_hub(adjacency, seed_adjacency, account, low, high):
        _, begin, end = index.interval(adjacency, account, low, high)
        activity = end - begin
        if activity < policy.hub_min_activity:
            return False
        _, seed_begin, seed_end = index.interval(seed_adjacency, account, low, high)
        return ((seed_end - seed_begin) * 100
                < activity * policy.hub_max_seed_share_percent)

    def scan(adjacency, account, low, high, anchor, *, after=None, before=None,
             bounded=True, seed=None, exclude=None, limit=None):
        nonlocal visits, selected_windows
        rows, begin, end = index.interval(adjacency, account, low, high,
                                         after=after, before=before)
        if bounded:
            limit = policy.neighbors_per_step if limit is None else limit
            positions, examined, eligible_count = index.nearest(
                rows, begin, end, anchor, limit, exclude)
        else:
            positions = [pos for pos in rows[begin:end] if pos != exclude]
            examined, eligible_count = end - begin, len(positions)
        visits += examined
        if visits > policy.max_edge_visits:
            raise GraphBudgetExceeded("EDGE_VISITS")
        if bounded and eligible_count > limit:
            selected_windows += 1
            seed_limits[seed].add("NEIGHBOR_SELECTION")
        return sorted(positions, key=lambda pos: (abs(times[pos] - anchor), times[pos], ids[pos]))

    def add_relation(kind, path):
        relation_seeds = tuple(sorted(set(path) & seeds, key=ids.__getitem__))
        if not relation_seeds:
            return
        key = (kind, tuple(ids[pos] for pos in relation_seeds))
        path = tuple(path)
        rank = (len(set(path) - seeds), max(times[pos] for pos in path)
                - min(times[pos] for pos in path), tuple(ids[pos] for pos in path))
        existing = relations.get(key)
        if existing is None or rank < existing[0]:
            relations[key] = (rank, relation_seeds, path)
        if len(relations) + len(weak_relations) > policy.max_relations:
            raise GraphBudgetExceeded("RELATIONS")

    def reject_ambiguous(kind, path):
        transaction_ids = tuple(ids[pos] for pos in path)
        weak_relations[(kind, transaction_ids)] = RejectedRelation(
            Witness(kind, transaction_ids), "AMBIGUOUS_HUB")
        if len(relations) + len(weak_relations) > policy.max_relations:
            raise GraphBudgetExceeded("RELATIONS")

    for seed in ordered_seeds:
        low, high = times[seed] - policy.window_us, times[seed] + policy.window_us
        members = set()
        queue = deque([(seed, "UPSTREAM", (seed,), 0),
                       (seed, "DOWNSTREAM", (seed,), 0)])
        seen = {(seed, "UPSTREAM"), (seed, "DOWNSTREAM")}
        # Peers are leaves, never a permission to traverse arbitrary undirected links.
        for adjacency, seed_adjacency, account, kind in (
                (index.outgoing, seed_outgoing, sources[seed], "BRANCH_OUT"),
                (index.incoming, seed_incoming, targets[seed], "BRANCH_IN")):
            ambiguous = ambiguous_hub(adjacency, seed_adjacency, account, low, high)
            if ambiguous:
                seed_limits[seed].add("AMBIGUOUS_HUB")
            limit = min(policy.neighbors_per_step, policy.hub_context_per_seed) if ambiguous else None
            for other in scan(adjacency, account, low, high, times[seed],
                              seed=seed, exclude=seed, limit=limit):
                if other == seed:
                    continue
                members.add(other)
                if sources[seed] != targets[seed] and sources[other] != targets[other]:
                    path = tuple(sorted((seed, other), key=lambda pos: (times[pos], ids[pos])))
                    if other not in seeds:
                        relation_kind = ("REPEAT" if sources[other] == sources[seed]
                                         and targets[other] == targets[seed] else kind)
                        candidate = (abs(times[other] - times[seed]), ids[other], relation_kind, path)
                        if seed not in support or candidate[:3] < support[seed][:3]:
                            support[seed] = candidate
        while queue:
            at, direction, path, depth = queue.popleft()
            if depth == policy.max_hops:
                continue
            upstream = direction == "UPSTREAM"
            adjacency = index.incoming if upstream else index.outgoing
            seed_adjacency = seed_incoming if upstream else seed_outgoing
            account = sources[at] if upstream else targets[at]
            bounds = {"before": times[at]} if upstream else {"after": times[at]}
            ambiguous = ambiguous_hub(adjacency, seed_adjacency, account, low, high)
            if ambiguous:
                seed_limits[seed].add("AMBIGUOUS_HUB")
            limit = min(policy.neighbors_per_step, policy.hub_context_per_seed) if ambiguous else None
            choices = set(scan(adjacency, account, low, high, times[seed],
                               seed=seed, limit=limit, **bounds))
            # Seed-to-seed evidence is not lost merely due to normal neighbor selection.
            if not ambiguous:
                choices.update(scan(seed_adjacency, account, low, high, times[seed],
                                    bounded=False, **bounds))
            for other in sorted(choices, key=lambda pos: (abs(times[pos] - times[seed]),
                                                          times[pos], ids[pos])):
                if other in path or sources[other] == targets[other]:
                    continue
                extended = (other,) + path if upstream else path + (other,)
                members.add(other)
                if other in seeds:
                    if ambiguous:
                        reject_ambiguous("FLOW", extended)
                    else:
                        add_relation("FLOW", extended)
                    continue
                if sources[seed] != targets[seed]:
                    candidate = (abs(times[other] - times[seed]), ids[other], "FLOW", extended)
                    if seed not in support or candidate[:3] < support[seed][:3]:
                        support[seed] = candidate
                state = (other, direction)
                if state not in seen:
                    seen.add(state)
                    if not ambiguous:
                        queue.append((other, direction, extended, depth + 1))
        explored[seed] = members

    # Shared-source/destination seed groups are hyperedges, not a quadratic clique.
    for kind, adjacency in (("BRANCH_OUT", seed_outgoing), ("BRANCH_IN", seed_incoming)):
        for account in sorted(adjacency):
            rows = adjacency[account]
            begin = 0
            while begin < len(rows):
                end = begin + 1
                while (end < len(rows)
                       and times[rows[end]] - times[rows[end - 1]] <= policy.window_us
                       and times[rows[end]] - times[rows[begin]] <= policy.component_span_us):
                    end += 1
                block = rows[begin:end]
                if len(block) >= 2:
                    full_index = index.outgoing if kind == "BRANCH_OUT" else index.incoming
                    if ambiguous_hub(full_index, adjacency, account,
                                     times[block[0]], times[block[-1]]):
                        reject_ambiguous(kind, block)
                        for member_seed in block:
                            seed_limits[member_seed].add("AMBIGUOUS_HUB")
                        begin = end
                        continue
                    same_pair = all(sources[pos] == sources[block[0]]
                                    and targets[pos] == targets[block[0]] for pos in block)
                    add_relation("REPEAT" if same_pair else kind, block)
                begin = end

    for seed, (_, _, kind, path) in support.items():
        add_relation("SUPPORTED_" + kind, path)

    parents = {seed: seed for seed in seeds}
    anchors = {seed: {seed} for seed in seeds}
    cores = {seed: {seed} for seed in seeds}
    core_bounds = {seed: (times[seed], times[seed]) for seed in seeds}
    witnesses = {seed: [] for seed in seeds}

    def root(seed):
        while parents[seed] != seed:
            parents[seed] = parents[parents[seed]]
            seed = parents[seed]
        return seed

    if len(relations) + len(weak_relations) > policy.max_relations:
        raise GraphBudgetExceeded("RELATIONS")
    rejected, span_rejected_seeds = list(weak_relations.values()), set()
    def apply_relation(kind, relation_seeds, path):
        roots = sorted({root(seed) for seed in relation_seeds}, key=ids.__getitem__)
        survivor = roots[0]
        additions = set(path).union(*(cores[value] for value in roots[1:]))
        earliest = min([times[pos] for pos in path] + [core_bounds[value][0] for value in roots])
        latest = max([times[pos] for pos in path] + [core_bounds[value][1] for value in roots])
        if latest - earliest > policy.component_span_us:
            rejected.append(RejectedRelation(
                Witness(kind, tuple(ids[pos] for pos in path)), "COMPONENT_SPAN"))
            span_rejected_seeds.update(relation_seeds)
            return
        if len(cores[survivor]) + len(additions - cores[survivor]) > policy.max_core_edges:
            raise GraphBudgetExceeded("CORE_SIZE")
        for other in roots[1:]:
            parents[other] = survivor
            anchors[survivor].update(anchors.pop(other))
            witnesses[survivor].extend(witnesses.pop(other))
            cores.pop(other)
            core_bounds.pop(other)
        cores[survivor].update(additions)
        core_bounds[survivor] = (earliest, latest)
        witnesses[survivor].append(Witness(kind, tuple(ids[pos] for pos in path)))

    for (kind, _), (_, relation_seeds, path) in sorted(
            relations.items(), key=lambda item: (item[1][0], item[0])):
        if kind in ("BRANCH_OUT", "BRANCH_IN", "REPEAT") and len(path) > 2:
            # A span conflict on one existing root must not veto unrelated valid
            # members of a large branch. Adjacent links are O(n), never a clique.
            for left, right in zip(path, path[1:]):
                apply_relation(kind, (left, right), (left, right))
        else:
            apply_relation(kind, relation_seeds, path)

    output, covered = [], set()
    for seed in ordered_seeds:
        if root(seed) != seed or not witnesses[seed]:
            continue
        graph_seeds, core = anchors[seed], cores[seed]
        context, limits, context_queues = set(), set(), []
        for member_seed in sorted(graph_seeds, key=ids.__getitem__):
            limits.update(seed_limits[member_seed])
            eligible = explored[member_seed] - core - seeds
            ordered = sorted(eligible, key=lambda pos: (abs(times[pos] - times[member_seed]),
                                                         times[pos], ids[pos]))
            context_limit = (min(policy.context_per_seed, policy.hub_context_per_seed)
                             if "AMBIGUOUS_HUB" in seed_limits[member_seed]
                             else policy.context_per_seed)
            context_queues.append(deque(ordered[:context_limit]))
            if len(ordered) > context_limit:
                limits.add("CONTEXT_SELECTION")
        # Fair allocation prevents one dense seed from consuming the whole context budget.
        active = deque(context_queues)
        while active and len(context) < policy.max_context_edges:
            candidates = active.popleft()
            while candidates and candidates[0] in context:
                candidates.popleft()
            if candidates:
                context.add(candidates.popleft())
            if candidates:
                active.append(candidates)
        if any(pos not in context for candidates in active for pos in candidates):
            limits.add("CONTEXT_SELECTION")
        output.append(FlowGraph(
            tuple(sorted(ids[pos] for pos in graph_seeds)),
            tuple(sorted(ids[pos] for pos in core - graph_seeds)),
            tuple(sorted(ids[pos] for pos in context)),
            tuple(sorted(set(witnesses[seed]), key=lambda witness: (witness.kind, witness.tx_ids))),
            tuple(sorted(limits))))
        covered.update(graph_seeds)
    unassigned = []
    for seed in sorted(seeds - covered, key=ids.__getitem__):
        if seed in span_rejected_seeds:
            reason = "COMPONENT_SPAN"
        elif sources[seed] == targets[seed]:
            reason = "SELF_TRANSFER_NO_WITNESS"
        elif "AMBIGUOUS_HUB" in seed_limits[seed]:
            reason = "AMBIGUOUS_HUB_NO_WITNESS"
        elif seed_limits[seed]:
            reason = "NEIGHBOR_SELECTION_NO_WITNESS"
        else:
            reason = "NO_RELATION_WITHIN_POLICY"
        unassigned.append(UnassignedSeed(ids[seed], reason))
    policy_digest = hashlib.sha256(json.dumps(
        asdict(policy), sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    rejected.sort(key=lambda item: (item.reason, item.witness.kind, item.witness.tx_ids))
    return FlowBatch(tuple(output), tuple(unassigned), tuple(rejected),
                     selected_windows, visits, policy_digest)

