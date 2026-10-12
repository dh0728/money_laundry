"""Pure, bounded block generator (policy block-pin-1), stage 1.

Implements P0-P2 (pinning, hubs, faces/stars/RELAY), the PASS part of P3, P4
(capped Kruskal assembly) and P7 (output) of worktable/alert_motif_design.md §7.
PATH, BRIDGE, CLOSURE and single-seed shapes are stage 2 and absent here, so every
core transaction of this stage is a seed. No labels, persistence or review state.

Determinism: the output is a pure function of (frozen ledger, seeds, seed_groups,
policy). Every decision iterates (time, id)-sorted structures; union-find survivors
are the smallest transaction ID; ties end with transaction-ID tuples.
"""
from bisect import bisect_left, bisect_right
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from fractions import Fraction
import hashlib
import json
from typing import Iterable

from flow_graph import (FlowBatch, FlowGraph, FlowIndex, GraphBudgetExceeded, HOUR_US,
                        RejectedRelation, UnassignedSeed, Witness)

STAR_KINDS = {"out": "STAR_OUT", "in": "STAR_IN"}
FOCAL_KINDS = ("STAR_OUT", "STAR_IN", "RELAY")
# Tier order of P4: flow relations first, then strong stars, then weak stars and relays.
# A pinned star is reserved in P2 (its face) and anchored in P4; it has no tier of its own.
TIER_FLOW, TIER_STRONG, TIER_WEAK = 1, 2, 3
UNASSIGNED_PRIORITY = ("SELF_TRANSFER", "AMBIGUOUS_HUB", "CORE_CAP", "COMPONENT_SPAN",
                       "FROZEN_LEGACY", "SEARCH_BUDGET", "LINK_ONLY", "NO_STRUCTURE")


class BlockInputError(ValueError):
    """Input contract violation: overlapping seed groups or a table without amounts."""


@dataclass(frozen=True, slots=True)
class BlockPolicy:
    version: str = "block-pin-1"
    core_max: int = 64
    span_max_us: int = 240 * HOUR_US
    hop_lag_us: int = 96 * HOUR_US
    # Amount band [num/den, den/num] = [0.8, 1.25]: num*a <= den*b and num*b <= den*a.
    ratio_num: int = 4
    ratio_den: int = 5
    pass_margin: int = 4
    pass_margin_floor_num: int = 1
    pass_margin_floor_den: int = 1000
    star_gap_us: int = 96 * HOUR_US
    star_width_us: int = 192 * HOUR_US
    star_max: int = 32
    star_strong: int = 5
    # A star needs this many distinct counterparties; repeated transfers between one
    # pair of accounts are not a fan (stage-1 refinement measured on hub_fp).
    star_min_counterparties: int = 2
    relay_lead_us: int = 6 * HOUR_US
    relay_window_us: int = 120 * HOUR_US
    relay_mode: str = "WEAK"
    hub_min_activity: int = 512
    hub_max_seed_share_percent: int = 20
    hub_window_us: int = 72 * HOUR_US
    context_pad_us: int = 24 * HOUR_US
    link_max: int = 32
    single_seed_shapes: bool = False
    max_edge_visits: int = 20_000_000
    max_relations: int = 200_000

    def validate(self):
        positive = (self.core_max, self.span_max_us, self.hop_lag_us, self.ratio_num,
                    self.ratio_den, self.pass_margin, self.pass_margin_floor_num,
                    self.pass_margin_floor_den, self.star_gap_us, self.star_width_us,
                    self.star_max, self.star_strong, self.star_min_counterparties, self.relay_window_us,
                    self.hub_min_activity, self.hub_window_us, self.link_max,
                    self.max_edge_visits, self.max_relations)
        non_negative = (self.relay_lead_us, self.context_pad_us, self.hub_max_seed_share_percent)
        if (not self.version
                or any(type(value) is not int or value < 1 for value in positive)
                or any(type(value) is not int or value < 0 for value in non_negative)
                or type(self.single_seed_shapes) is not bool
                or self.ratio_num >= self.ratio_den
                or self.hub_max_seed_share_percent > 100
                or self.relay_mode not in ("WEAK", "LINK_ONLY", "STRONG")
                or self.star_width_us < self.star_gap_us
                or self.star_max < 2 or self.star_strong < 2 or self.core_max < 2):
            raise ValueError("Invalid block policy")


@dataclass(frozen=True, slots=True)
class BlockGraph:
    """One block. Field order matches FlowGraph; the extra fields describe the block."""
    seed_ids: tuple[int, ...]
    connection_ids: tuple[int, ...]
    context_ids: tuple[int, ...]
    witnesses: tuple[Witness, ...]
    limits: tuple[str, ...]
    boundary_witnesses: tuple[Witness, ...]
    focal_accounts: tuple[int, ...]
    first_us: int
    last_us: int
    pinned_group: int | None

    @property
    def core_ids(self):
        return self.seed_ids + self.connection_ids

    def flow_graph(self) -> FlowGraph:
        return FlowGraph(self.seed_ids, self.connection_ids, self.context_ids,
                         self.witnesses, self.limits, self.boundary_witnesses)


@dataclass(frozen=True, slots=True)
class BlockBatch:
    graphs: tuple[BlockGraph, ...]
    unassigned: tuple[UnassignedSeed, ...]
    rejected_relations: tuple[RejectedRelation, ...]
    edge_visits: int
    policy_digest: str
    stats: dict

    @property
    def ungrouped_seed_ids(self):
        return tuple(item.tx_id for item in self.unassigned)

    def flow_batch(self) -> FlowBatch:
        """The current publication contract; context is never a member here."""
        return FlowBatch(tuple(graph.flow_graph() for graph in self.graphs), self.unassigned,
                         self.rejected_relations, 0, self.edge_visits, self.policy_digest)


@dataclass(slots=True)
class _Relation:
    tier: int
    rank: int
    strength: tuple
    tx_ids: tuple
    kind: str
    seeds: tuple
    focal: int | None = None
    side: str | None = None
    parts: tuple = ()
    extend: bool = False

    def key(self):
        return (self.tier, self.rank, self.strength, self.tx_ids)


def build_block_graphs(index: FlowIndex, seed_ids: Iterable[int], policy: BlockPolicy, *,
                       seed_groups=()) -> BlockBatch:
    """Build blocks from already-classified valid seeds.

    ``seed_groups`` items are ``(seed_ids, historical_core_ids, historical_member_ids)``
    or the same plus a fourth item with the adopted witnesses of that OPEN Alert
    (``Witness`` objects or ``(kind, tx_ids)`` pairs). Groups are pinned before any
    relation is considered; two pinned groups are never joined (I4).
    """
    policy.validate()
    return _Build(index, seed_ids, policy, seed_groups).run()


class _Build:
    def __init__(self, index, seed_ids, policy, seed_groups):
        edges = index.edges
        if not hasattr(edges, "amount_usd_micros"):
            raise BlockInputError("EdgeTable without amount column")
        self.index, self.policy, self.edges = index, policy, edges
        self.times, self.sources, self.targets, self.ids = (
            edges.occurred_us, edges.from_accounts, edges.to_accounts, edges.tx_ids)
        self.amounts = edges.amount_usd_micros
        self.seed_ids = frozenset(seed_ids)
        self.seeds = {edges.position(key) for key in self.seed_ids}
        self.ordered_seeds = sorted(self.seeds, key=self.ids.__getitem__)
        self.selfie = {s for s in self.seeds if self.sources[s] == self.targets[s]}
        self.seed_groups = seed_groups
        self.visits = 0
        self.limits = defaultdict(set)
        self.parent = {s: s for s in self.seeds}
        self.comp_seeds = {s: {s} for s in self.seeds}
        self.core = {s: set() for s in self.seeds}
        self.witnesses = {s: [] for s in self.seeds}
        self.reserved_ids = {s: set() for s in self.seeds}
        self.bounds = {s: None for s in self.seeds}
        self.pinned = {s: None for s in self.seeds}
        self.frozen = {s: False for s in self.seeds}
        self.starside = {}
        self.focal_published = defaultdict(set)
        self.owned_by_star = {}
        self.contested = set()
        self.links = []
        self.link_seeds = set()
        self.rejected = []
        self.relations = []
        self.stats = Counter()
        self.hub_cache = {}
        self.seed_in, self.seed_out = defaultdict(list), defaultdict(list)
        for s in self.ordered_seeds:
            if s in self.selfie:
                continue
            self.seed_in[self.targets[s]].append(s)
            self.seed_out[self.sources[s]].append(s)
        for adjacency in (self.seed_in, self.seed_out):
            for rows in adjacency.values():
                rows.sort(key=self.tkey)

    # ----- helpers -----
    def tkey(self, pos):
        return (self.times[pos], self.ids[pos])

    def tx_tuple(self, positions):
        return tuple(sorted(self.ids[pos] for pos in positions))

    def find(self, s):
        while self.parent[s] != s:
            self.parent[s] = self.parent[self.parent[s]]
            s = self.parent[s]
        return s

    @staticmethod
    def span_union(a, b):
        if a is None:
            return b
        if b is None:
            return a
        return (min(a[0], b[0]), max(a[1], b[1]))

    def merge(self, roots):
        roots = sorted(set(roots), key=self.ids.__getitem__)
        survivor = roots[0]
        for other in roots[1:]:
            self.parent[other] = survivor
            self.comp_seeds[survivor] |= self.comp_seeds.pop(other)
            self.core[survivor] |= self.core.pop(other)
            self.witnesses[survivor].extend(self.witnesses.pop(other))
            self.reserved_ids[survivor] |= self.reserved_ids.pop(other)
            self.bounds[survivor] = self.span_union(self.bounds[survivor], self.bounds.pop(other))
            if self.pinned[survivor] is None:
                self.pinned[survivor] = self.pinned[other]
            self.pinned.pop(other)
            self.frozen[survivor] = self.frozen[survivor] or self.frozen.pop(other)
        return survivor

    def adopt(self, root, kind, positions):
        positions = set(positions)
        self.witnesses[root].append(Witness(kind, self.tx_tuple(positions)))
        self.core[root] |= positions
        times = [self.times[pos] for pos in positions]
        self.bounds[root] = self.span_union(self.bounds[root], (min(times), max(times)))

    def established(self, root):
        return len(self.comp_seeds[root]) >= 2 or self.pinned[root] is not None

    def face_bridges(self, root, account, side):
        column = self.targets if side == "in" else self.sources
        return sum(column[s] == account for s in self.comp_seeds[root])

    def merged_size(self, roots, extra):
        members = {self.ids[pos] for pos in extra}
        for root in roots:
            members.update(self.ids[pos] for pos in self.core[root])
            members.update(self.reserved_ids[root])
        return len(members)

    def merged_bounds(self, roots, extra):
        bounds = None
        for root in roots:
            bounds = self.span_union(bounds, self.bounds[root])
        times = [self.times[pos] for pos in extra]
        return self.span_union(bounds, (min(times), max(times)))

    def add_link(self, a, b, kind, extra=()):
        self.links.append((a, b, kind, self.tx_tuple({a, b, *extra})))
        self.link_seeds.update((a, b))

    def link_roots(self, by_root, roots, kind, extra=()):
        roots = sorted(roots, key=self.ids.__getitem__)
        for i, left in enumerate(roots):
            for right in roots[i + 1:]:
                self.add_link(by_root[left][0], by_root[right][0], kind, extra)

    def is_hub(self, account, side, low, high):
        key = (account, side, low, high)
        cached = self.hub_cache.get(key)
        if cached is None:
            adjacency = self.index.incoming if side == "in" else self.index.outgoing
            _, begin, end = self.index.interval(adjacency, account, low, high)
            activity = end - begin
            if activity < self.policy.hub_min_activity:
                cached = False
            else:
                rows = (self.seed_in if side == "in" else self.seed_out).get(account, ())
                seed_begin = bisect_left(rows, low, key=self.times.__getitem__)
                seed_end = bisect_right(rows, high, key=self.times.__getitem__)
                cached = (seed_end - seed_begin) * 100 < activity * self.policy.hub_max_seed_share_percent
            self.hub_cache[key] = cached
        return cached

    def relay_focal(self, positions):
        common = None
        for pos in positions:
            accounts = {self.sources[pos], self.targets[pos]}
            common = accounts if common is None else common & accounts
        return next(iter(common)) if common and len(common) == 1 else None

    # ----- P0 -----
    def normalize_groups(self):
        pinned_seen = set()
        for group_index, group in enumerate(self.seed_groups):
            group = tuple(group)
            owned, historical_core = group[0], group[1]
            adopted = group[3] if len(group) > 3 else ()
            selected = sorted({self.edges.position(key) for key in owned if key in self.seed_ids},
                              key=self.ids.__getitem__)
            if not selected:
                continue
            if pinned_seen & set(selected):
                raise BlockInputError("INVALID_SEED_GROUPS")
            pinned_seen.update(selected)
            root = self.merge(selected)
            self.pinned[root] = group_index
            self.reserved_ids[root].update(int(key) for key in historical_core)
            self.reserved_ids[root].update(self.ids[s] for s in selected)
            self.frozen[root] = len(self.reserved_ids[root]) > self.policy.core_max
            for key in historical_core:
                try:
                    pos = self.edges.position(int(key))
                except ValueError:
                    continue  # Held evidence still counts for capacity, not for time.
                self.bounds[root] = self.span_union(self.bounds[root], (self.times[pos], self.times[pos]))
            for witness in adopted:
                kind, tx_ids = ((witness.kind, witness.tx_ids) if isinstance(witness, Witness)
                                else (witness[0], tuple(witness[1])))
                if kind not in FOCAL_KINDS:
                    continue
                positions = []
                for key in tx_ids:
                    try:
                        positions.append(self.edges.position(int(key)))
                    except ValueError:
                        pass
                focal = self.relay_focal(positions) if kind == "RELAY" else None
                if kind == "RELAY" and focal is None:
                    continue
                for pos in positions:
                    if pos not in self.seeds or pos in self.selfie or self.find(pos) != root:
                        continue
                    if kind == "STAR_OUT":
                        face = (self.sources[pos], "out")
                    elif kind == "STAR_IN":
                        face = (self.targets[pos], "in")
                    else:
                        face = (focal, "in" if self.targets[pos] == focal else "out")
                    self.starside.setdefault(pos, face)
                    self.focal_published[(face[0], kind)].add(pos)
            self.stats["pinned_groups"] += 1

    # ----- P2 -----
    def faces(self):
        policy = self.policy
        intervals = []
        for side, adjacency in (("out", self.seed_out), ("in", self.seed_in)):
            for account in sorted(adjacency):
                rows = adjacency[account]
                start = 0
                for i in range(1, len(rows) + 1):
                    if (i == len(rows)
                            or self.times[rows[i]] - self.times[rows[i - 1]] > policy.star_gap_us
                            or self.times[rows[i]] - self.times[rows[start]] > policy.star_width_us):
                        intervals.append((account, side, rows[start:i]))
                        start = i
        self.visits += sum(len(block) for _, _, block in intervals)
        self.stats["face_intervals"] = len(intervals)

        def order(item):
            account, side, block = item
            return (-len(block), self.times[block[-1]] - self.times[block[0]],
                    self.tkey(block[0]), 0 if side == "out" else 1, account)

        for account, side, block in sorted(intervals, key=order):
            low = self.times[block[0]] - policy.hub_window_us
            high = self.times[block[-1]] + policy.hub_window_us
            if self.is_hub(account, side, low, high):
                for s in block:
                    self.limits[s].add("AMBIGUOUS_HUB")
                self.rejected.append(RejectedRelation(
                    Witness(STAR_KINDS[side], self.tx_tuple(block)), "AMBIGUOUS_HUB"))
                self.stats["hub_faces"] += 1
                continue
            face = (account, side)
            # Seeds reserved for another face (their published star lives there) are
            # skipped; pinned-group conflicts are resolved in P4, not here, so that a
            # re-run forms exactly the chunks of the batch run (I10).
            members = sorted((s for s in block
                              if s not in self.owned_by_star and self.starside.get(s, face) == face),
                             key=self.tkey)
            counterparty = self.targets if side == "out" else self.sources
            pieces = [members[i:i + policy.star_max] for i in range(0, len(members), policy.star_max)]
            previous = None
            for piece in pieces:
                distinct = len({counterparty[s] for s in piece})
                if len(piece) >= 2 and distinct >= policy.star_min_counterparties:
                    self.owned_by_star.update((s, face) for s in piece)
                    extend = any(self.starside.get(s) == face and self.pinned[self.find(s)] is not None
                                 for s in piece)
                    tier = TIER_STRONG if len(piece) >= policy.star_strong else TIER_WEAK
                    self.relations.append(_Relation(
                        tier, 0, (-len(piece), self.times[piece[-1]] - self.times[piece[0]]),
                        self.tx_tuple(piece), STAR_KINDS[side], tuple(piece), account, side,
                        extend=extend))
                    self.stats["stars"] += 1
                    self.stats["stars_extend"] += extend
                elif len(piece) >= 2:
                    self.stats["repeat_pairs_skipped"] += 1
                if previous is not None:
                    self.add_link(previous[-1], piece[0], "BOUNDARY_STAR_CHUNK")
                    for s in previous + piece:
                        self.limits[s].add("STAR_CHUNKED")
                previous = piece

    def relays(self):
        policy = self.policy
        by_account = defaultdict(lambda: {"in": [], "out": []})
        for relation in self.relations:
            if relation.kind in ("STAR_IN", "STAR_OUT"):
                by_account[relation.focal][relation.side].append(relation)
        for account in sorted(by_account):
            ins = sorted(by_account[account]["in"], key=lambda r: self.tkey(r.seeds[0]))
            outs = sorted(by_account[account]["out"], key=lambda r: self.tkey(r.seeds[0]))
            used = set()
            for incoming in ins:
                start = self.times[incoming.seeds[0]]
                for outgoing in outs:
                    if id(outgoing) in used:
                        continue
                    gap = self.times[outgoing.seeds[0]] - start
                    if gap > policy.relay_window_us:
                        break
                    if gap < -policy.relay_lead_us:
                        continue
                    used.add(id(outgoing))
                    seeds = tuple(sorted(incoming.seeds + outgoing.seeds, key=self.tkey))
                    self.relations.append(_Relation(
                        TIER_WEAK, 1, (-len(seeds), gap), self.tx_tuple(seeds), "RELAY", seeds,
                        account, None, (incoming.seeds, outgoing.seeds)))
                    self.stats["relays"] += 1
                    break

    # ----- P3 (PASS only in stage 1) -----
    def passes(self):
        policy = self.policy
        window = policy.hub_window_us
        candidates = []
        for account in sorted(self.seed_out):
            ins = self.seed_in.get(account)
            if not ins:
                continue
            for f in self.seed_out[account]:
                t_f = self.times[f]
                low = bisect_left(ins, t_f - policy.hop_lag_us, key=self.times.__getitem__)
                high = bisect_left(ins, t_f, key=self.times.__getitem__)
                self.visits += high - low
                if self.visits > policy.max_edge_visits:
                    raise GraphBudgetExceeded("EDGE_VISITS")
                for e in ins[low:high]:
                    a, b = self.amounts[e], self.amounts[f]
                    if a < 0 or b < 0:
                        for s in (e, f):
                            if self.amounts[s] < 0:
                                self.limits[s].add("AMOUNT_MISSING")
                        continue
                    if not (policy.ratio_num * a <= policy.ratio_den * b
                            and policy.ratio_num * b <= policy.ratio_den * a):
                        continue
                    if (self.is_hub(account, "in", self.times[e] - window, self.times[e] + window)
                            or self.is_hub(account, "out", t_f - window, t_f + window)):
                        self.limits[e].add("AMBIGUOUS_HUB")
                        self.limits[f].add("AMBIGUOUS_HUB")
                        self.stats["pass_hub_skipped"] += 1
                        continue
                    excess = Fraction(max(a, b), min(a, b)) - 1
                    candidates.append((excess, t_f - self.times[e], self.ids[e], self.ids[f], e, f))
        candidates.sort()
        self.stats["pass_candidates"] = len(candidates)
        # A transaction is the inbound leg at its receiver and the outbound leg at its
        # sender; matching and competition are per role, so chains stay possible.
        by_inbound, by_outbound = defaultdict(list), defaultdict(list)
        for candidate in candidates:
            by_inbound[candidate[4]].append(candidate)
            by_outbound[candidate[5]].append(candidate)
        used_inbound, used_outbound, matched = set(), set(), []
        for candidate in candidates:
            if candidate[4] in used_inbound or candidate[5] in used_outbound:
                continue
            used_inbound.add(candidate[4])
            used_outbound.add(candidate[5])
            matched.append(candidate)
        floor = Fraction(policy.pass_margin_floor_num, policy.pass_margin_floor_den)
        adopted = []
        for candidate in matched:
            threshold = policy.pass_margin * max(candidate[0], floor)
            if all(other[0] >= threshold
                   for other in by_inbound[candidate[4]] + by_outbound[candidate[5]]
                   if other is not candidate):
                adopted.append(candidate)
        adopted_set = set(adopted)
        adopted_seeds = set()
        for candidate in adopted:
            e, f = candidate[4], candidate[5]
            self.relations.append(_Relation(TIER_FLOW, 0, (candidate[0], candidate[1]),
                                            self.tx_tuple((e, f)), "PASS", (e, f)))
            adopted_seeds.update((e, f))
        contested_seeds = set()
        for candidate in candidates:
            if candidate in adopted_set:
                continue
            e, f = candidate[4], candidate[5]
            contested_seeds.update((e, f))
            self.rejected.append(RejectedRelation(Witness("PASS", self.tx_tuple((e, f))), "PASS_CONTESTED"))
            self.add_link(e, f, "BOUNDARY_PASS")
        self.contested = contested_seeds - adopted_seeds
        self.stats["pass_adopted"] = len(adopted)
        self.stats["pass_contested"] = len(candidates) - len(adopted)

    # ----- P4 -----
    def assemble(self):
        self.relations.sort(key=_Relation.key)
        if len(self.relations) + len(self.links) > self.policy.max_relations:
            raise GraphBudgetExceeded("RELATIONS")
        for relation in self.relations:
            if relation.tier == TIER_FLOW:
                self.join_strict(relation)
            elif relation.kind == "RELAY":
                self.join_relay(relation)
            else:
                self.join_star(relation)

    def group_by_root(self, seeds):
        by_root = defaultdict(list)
        for s in seeds:
            by_root[self.find(s)].append(s)
        return by_root

    def join_strict(self, relation):
        """T1 flow relations: join unless a cap, the span or OPEN identity forbids it.

        Caps are judged before the OPEN-pair rule so that a re-run reports the same link
        kind as the batch run did (two blocks that stayed apart because of a cap).
        """
        policy = self.policy
        by_root = self.group_by_root(relation.seeds)
        roots = sorted(by_root, key=self.ids.__getitem__)
        if any(self.frozen[root] for root in roots):
            self.link_roots(by_root, roots, "BOUNDARY_CAP")
            return
        if self.merged_size(roots, relation.seeds) > policy.core_max:
            self.link_roots(by_root, roots, "BOUNDARY_CAP")
            for s in relation.seeds:
                self.limits[s].add("CORE_CAP")
            return
        low, high = self.merged_bounds(roots, relation.seeds)
        if high - low > policy.span_max_us:
            self.link_roots(by_root, roots, "BOUNDARY_SPAN")
            for s in relation.seeds:
                self.limits[s].add("COMPONENT_SPAN")
            return
        if sum(1 for root in roots if self.pinned[root] is not None) >= 2:
            self.link_roots(by_root, roots, "BOUNDARY_OPEN_PAIR")
            return
        self.adopt(self.merge(roots), relation.kind, relation.seeds)
        self.stats["adopted_" + relation.kind] += 1

    def absorbable(self, root, account, side, chunk_seeds):
        if not self.established(root):
            return True
        if any(s in self.contested for s in chunk_seeds):
            return False
        members = self.comp_seeds[root]
        if side == "in":
            dangling = not any(self.sources[s] == account for s in members)
        else:
            dangling = not any(self.targets[s] == account for s in members)
        return dangling or self.face_bridges(root, account, side) >= 2

    def published_spokes(self, root, by_root, focal, kinds):
        """A pinned block contributes only the spokes already published at this focal.

        Everything else in the block joined through other relations; adding it to a new
        witness would make a re-run differ from the batch result (I10).
        """
        allowed = set().union(*(self.focal_published.get((focal, kind), set()) for kind in kinds))
        return [s for s in by_root[root] if s in allowed]

    def plan_union(self, by_root, order, skipped, contributions=None):
        """Decide, without merging, which roots fit the caps in this order.

        Returns (accepted roots, witness members). Nothing is merged until the caller
        has checked that the resulting witness is valid, so a rejected witness never
        leaves two blocks joined without evidence.
        """
        policy = self.policy
        contributions = contributions or {}
        accepted, ids_acc, bounds_acc = [], set(), None
        for root in order:
            if self.frozen[root]:
                skipped.append((root, "BOUNDARY_CAP"))
                continue
            times = [self.times[s] for s in by_root[root]]
            root_ids = ({self.ids[pos] for pos in self.core[root]} | self.reserved_ids[root]
                        | {self.ids[s] for s in by_root[root]})
            root_bounds = self.span_union(self.bounds[root], (min(times), max(times)))
            if accepted:
                if len(ids_acc | root_ids) > policy.core_max:
                    for s in by_root[root]:
                        self.limits[s].add("CORE_CAP")
                    skipped.append((root, "BOUNDARY_CAP"))
                    continue
                low, high = self.span_union(bounds_acc, root_bounds)
                if high - low > policy.span_max_us:
                    for s in by_root[root]:
                        self.limits[s].add("COMPONENT_SPAN")
                    skipped.append((root, "BOUNDARY_SPAN"))
                    continue
            ids_acc |= root_ids
            bounds_acc = self.span_union(bounds_acc, root_bounds)
            accepted.append(root)
        members = [s for item in accepted for s in contributions.get(item, by_root[item])]
        return accepted, members

    def finish_links(self, by_root, accepted, skipped):
        anchor = by_root[accepted[0]][0] if accepted else None
        for root, kind in skipped:
            if anchor is not None:
                self.add_link(anchor, by_root[root][0], kind)
        if anchor is None and len(skipped) >= 2:
            self.link_roots(by_root, [root for root, _ in skipped], "BOUNDARY_SAME_FOCAL")

    def join_star(self, relation):
        account, side = relation.focal, relation.side
        by_root = self.group_by_root(relation.seeds)
        roots = sorted(by_root, key=self.ids.__getitem__)
        skipped = []
        # A pinned block whose published star lives on this face is the anchor: the star's
        # own body, accepted first and contributing only its published spokes. A pinned
        # block touched through any other seed was not absorbed when it was built, so it
        # stays separate (link); a second pinned block is an OPEN pair (I4, I10).
        pinned = [root for root in roots if self.pinned[root] is not None or self.frozen[root]]
        kinds = (STAR_KINDS[side],)
        contributions = {root: self.published_spokes(root, by_root, account, kinds) for root in pinned}
        anchor = next((root for root in pinned if contributions[root]), None)
        take = []
        for root in roots:
            if root == anchor:
                continue
            if root in pinned:
                skipped.append((root, "BOUNDARY_SAME_FOCAL"))
            elif self.absorbable(root, account, side, by_root[root]):
                take.append(root)
            else:
                skipped.append((root, "BOUNDARY_SAME_FOCAL"))
        established = [root for root in take if self.established(root)]
        isolated = [root for root in take if not self.established(root)]
        if relation.tier == TIER_WEAK:
            # A weak star may attach one established block in its lifetime; an anchor that
            # already holds more than its published spokes has used that slot (I10).
            slot_used = anchor is not None and bool(self.comp_seeds[anchor] - set(contributions[anchor]))
            if slot_used:
                skipped.extend((root, "BOUNDARY_SAME_FOCAL") for root in established)
                established = []
            elif len(established) > 1:
                dominant = max(established, key=lambda root: (self.face_bridges(root, account, side), -self.ids[root]))
                skipped.extend((root, "BOUNDARY_SAME_FOCAL") for root in established if root != dominant)
                established = [dominant]
        order = (([anchor] if anchor is not None else [])
                 + sorted(established, key=lambda root: (-self.face_bridges(root, account, side), self.ids[root]))
                 + sorted(isolated, key=lambda root: self.tkey(by_root[root][0])))
        accepted, members = self.plan_union(by_root, order, skipped, contributions)
        counterparty = self.targets if side == "out" else self.sources
        if (len(members) >= 2
                and len({counterparty[s] for s in members}) >= self.policy.star_min_counterparties):
            self.adopt(self.merge(accepted), relation.kind, members)
            self.stats["adopted_" + relation.kind] += 1
            self.finish_links(by_root, accepted, skipped)
        else:
            # Not a fan after all (repeated pair or nothing to join): no merge, links only.
            self.stats["stars_rejected"] += 1
            self.link_roots(by_root, roots, "BOUNDARY_SAME_FOCAL")

    def join_relay(self, relation):
        mode = self.policy.relay_mode
        by_root = self.group_by_root(relation.seeds)
        roots = sorted(by_root, key=self.ids.__getitem__)
        skipped = []
        if mode == "LINK_ONLY":
            self.link_roots(by_root, roots, "BOUNDARY_SAME_FOCAL")
            return
        # Pinned blocks: the one with published spokes at this focal is the anchor and
        # contributes only those spokes; any other pinned block stays separate (I4, I10).
        pinned = [root for root in roots if self.pinned[root] is not None or self.frozen[root]]
        contributions = {root: self.published_spokes(root, by_root, relation.focal, FOCAL_KINDS)
                         for root in pinned}
        # The block that already published this relay is the anchor; otherwise a block
        # with a published star at this focal (the relay may grow around it).
        anchor = next((root for root in pinned
                       if self.published_spokes(root, by_root, relation.focal, ("RELAY",))), None)
        if anchor is None:
            anchor = next((root for root in pinned if contributions[root]), None)
        skipped.extend((root, "BOUNDARY_SAME_FOCAL") for root in pinned if root != anchor)
        free = [root for root in roots if root not in pinned]
        if mode == "WEAK":
            own = set(relation.seeds)
            # A weak relay binds its own two chunks and attaches to at most one
            # component that carries structure beyond those chunks (the anchor counts).
            pure = [root for root in free if self.comp_seeds[root] <= own]
            extended = [root for root in free if not self.comp_seeds[root] <= own]
            clean = [root for root in extended if not any(s in self.contested for s in by_root[root])]
            skipped.extend((root, "BOUNDARY_SAME_FOCAL") for root in extended if root not in clean)
            if anchor is not None and self.comp_seeds[anchor] - set(contributions[anchor]):
                skipped.extend((root, "BOUNDARY_SAME_FOCAL") for root in clean)
                clean = []
            elif len(clean) > 1:
                dominant = max(clean, key=lambda root: (len(by_root[root]), -self.ids[root]))
                skipped.extend((root, "BOUNDARY_SAME_FOCAL") for root in clean if root != dominant)
                clean = [dominant]
            take = clean + pure
        else:
            take = free
        order = (([anchor] if anchor is not None else [])
                 + sorted(take, key=lambda root: (-len(by_root[root]), self.ids[root])))
        accepted, members = self.plan_union(by_root, order, skipped, contributions)
        ins, outs = set(relation.parts[0]), set(relation.parts[1])
        if len(members) >= 2 and any(s in ins for s in members) and any(s in outs for s in members):
            self.adopt(self.merge(accepted), "RELAY", members)
            self.stats["adopted_RELAY"] += 1
            self.finish_links(by_root, accepted, skipped)
        else:
            self.stats["relays_rejected"] += 1
            self.link_roots(by_root, roots, "BOUNDARY_SAME_FOCAL")

    # ----- P7 -----
    def output(self):
        policy = self.policy
        roots = sorted({self.find(s) for s in self.seeds}, key=self.ids.__getitem__)
        publishable = {root for root in roots if self.witnesses[root] and not self.frozen[root]}
        link_items = defaultdict(dict)
        for a, b, kind, tx_ids in self.links:
            left, right = self.find(a), self.find(b)
            if left == right or left not in publishable or right not in publishable:
                continue
            for x, y in ((left, right), (right, left)):
                previous = link_items[x].get((y, kind))
                if previous is None or tx_ids < previous:
                    link_items[x][(y, kind)] = tx_ids
        graphs, covered = [], set()
        for root in roots:
            if root not in publishable:
                if self.frozen[root]:
                    for s in self.comp_seeds[root]:
                        self.limits[s].add("FROZEN_LEGACY")
                continue
            witnesses = tuple(sorted(set(self.witnesses[root]), key=lambda w: (w.kind, w.tx_ids)))
            core = {self.edges.position(key) for witness in witnesses for key in witness.tx_ids}
            seeds = core & self.seeds
            self.self_check(root, witnesses, core, seeds)
            limits = set().union(*(self.limits[s] for s in self.comp_seeds[root]))
            links = sorted(link_items[root].items(), key=lambda item: (item[1], item[0][1]))
            if len(links) > policy.link_max:
                links = links[:policy.link_max]
                limits.add("LINK_SELECTION")
            times = [self.times[pos] for pos in core]
            first, last = min(times), max(times)
            degree = Counter()
            for pos in core:
                degree[(self.sources[pos], "out")] += 1
                degree[(self.targets[pos], "in")] += 1
            focal = sorted({account for (account, side), count in degree.items() if count >= 2
                            and not self.is_hub(account, side, first - policy.hub_window_us,
                                                last + policy.hub_window_us)})
            graphs.append(BlockGraph(
                self.tx_tuple(seeds), self.tx_tuple(core - seeds), (), witnesses, tuple(sorted(limits)),
                tuple(sorted((Witness(kind, tx_ids) for (_, kind), tx_ids in links),
                             key=lambda w: (w.kind, w.tx_ids))),
                tuple(focal), first - policy.context_pad_us, last + policy.context_pad_us,
                self.pinned[root]))
            covered |= seeds
        unassigned = []
        for s in sorted(self.seeds - covered, key=self.ids.__getitem__):
            flags = set(self.limits[s])
            if s in self.selfie:
                flags.add("SELF_TRANSFER")
            if s in self.link_seeds:
                flags.add("LINK_ONLY")
            reason = next((name for name in UNASSIGNED_PRIORITY if name in flags), "NO_STRUCTURE")
            unassigned.append(UnassignedSeed(self.ids[s], reason))
        self.rejected.sort(key=lambda item: (item.reason, item.witness.kind, item.witness.tx_ids))
        digest = hashlib.sha256(json.dumps(asdict(policy), sort_keys=True,
                                           separators=(",", ":")).encode("utf-8")).hexdigest()
        self.stats["graphs"] = len(graphs)
        self.stats["unassigned"] = len(unassigned)
        return BlockBatch(tuple(graphs), tuple(unassigned), tuple(self.rejected), self.visits, digest,
                          dict(sorted(self.stats.items())))

    def self_check(self, root, witnesses, core, seeds):
        """The same invariants alert_lifecycle enforces at publication (I3, I5, I6)."""
        if not seeds or not witnesses or not seeds <= self.comp_seeds[root]:
            raise BlockInputError("SELF_CHECK: block without seeds or witnesses")
        for witness in witnesses:
            keys = set(witness.tx_ids)
            if len(keys) < 2 or len(keys) != len(witness.tx_ids):
                raise BlockInputError("SELF_CHECK: witness needs two distinct transactions")
            if not {self.edges.position(key) for key in keys} & seeds:
                raise BlockInputError("SELF_CHECK: witness without a seed")
        if len({self.ids[pos] for pos in core} | self.reserved_ids[root]) > self.policy.core_max:
            raise BlockInputError("SELF_CHECK: core exceeds core_max")

    def run(self):
        self.normalize_groups()
        self.faces()
        self.relays()
        self.passes()
        self.assemble()
        return self.output()
