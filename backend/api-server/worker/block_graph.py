"""Pure, bounded block generator (policy block-pin-1).

Implements P0-P7 of worktable/alert_motif_design.md §7: pinning, hubs, faces/stars/
RELAY, PASS/PATH/BRIDGE flow relations, capped Kruskal assembly, CLOSURE walks,
single-seed shapes (policy, default off) and the output contract. Non-seed hops of
PATH, BRIDGE, CLOSURE and shapes become CONNECTION members; context is never a
member. No labels, persistence or review state.

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
    # Stage 2: non-seed walks (PATH, CLOSURE), BRIDGE and single-seed shapes.
    path_gap_max: int = 2
    walk_scan: int = 128
    ear_max: int = 12
    bridge_min_mids: int = 2
    shape_min_mids: int = 3
    shape_min_hops: int = 3
    # Ablation switches (design §13): the dangling rule, the contested-bridge rule and
    # dropping star spokes that an adopted PASS already explains as pass-through.
    absorb_dangling: bool = True
    # Off by default after the stage-2 ablation (block_graph_stage2_result_20261012.md):
    # the rule fragmented blocks without reducing mixing.
    contested_check: bool = False
    star_exclude_passthrough: bool = False
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
                    self.max_edge_visits, self.max_relations, self.walk_scan, self.ear_max,
                    self.bridge_min_mids, self.shape_min_mids, self.shape_min_hops)
        non_negative = (self.relay_lead_us, self.context_pad_us, self.hub_max_seed_share_percent,
                        self.path_gap_max)
        flags = (self.single_seed_shapes, self.absorb_dangling, self.contested_check,
                 self.star_exclude_passthrough)
        if (not self.version
                or any(type(value) is not int or value < 1 for value in positive)
                or any(type(value) is not int or value < 0 for value in non_negative)
                or any(type(value) is not bool for value in flags)
                or self.bridge_min_mids < 2 or self.shape_min_mids < 2 or self.shape_min_hops < 2
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
    extra: tuple = ()  # non-seed transactions that become CONNECTION members

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
        self.contested_in, self.contested_out = set(), set()
        self.pass_following = set()   # seeds that are the inbound leg of an adopted PASS
        self.pass_preceding = set()   # seeds that are the outbound leg of an adopted PASS
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

    # ----- amount band and bounded walks -----
    def in_band(self, a, b):
        policy = self.policy
        return (a >= 0 and b >= 0 and policy.ratio_num * a <= policy.ratio_den * b
                and policy.ratio_num * b <= policy.ratio_den * a)

    @staticmethod
    def excess(a, b):
        return Fraction(max(a, b), min(a, b)) - 1

    def scan_rows(self, adjacency, account, low, high, anchor, limit):
        """Time-nearest rows of one account face inside [low, high], at most `limit`."""
        rows, begin, end = self.index.interval(adjacency, account, low, high)
        count = end - begin
        if count <= limit:
            pool, examined = rows[begin:end], count
        else:
            pool, examined, _ = self.index.nearest(rows, begin, end, anchor, limit)
            self.stats["walk_truncated"] += 1
        self.visits += examined
        if self.visits > self.policy.max_edge_visits:
            raise GraphBudgetExceeded("EDGE_VISITS")
        return pool, count > limit

    def best_step(self, prev, forward):
        """Best in-band continuation of `prev`: out of its receiver (forward) or into its sender.

        Returns (position, 'SEED' | 'STEP') or (None, reason). A seed is returned as the
        step's end point; the caller decides whether it is an arrival or a stop.
        """
        policy = self.policy
        window, lag = policy.hub_window_us, policy.hop_lag_us
        account = self.targets[prev] if forward else self.sources[prev]
        side = "out" if forward else "in"
        t = self.times[prev]
        if self.is_hub(account, side, t - window, t + window):
            return None, "HUB"
        adjacency = self.index.outgoing if forward else self.index.incoming
        low, high = (t, t + lag) if forward else (t - lag, t)
        pool, truncated = self.scan_rows(adjacency, account, low, high, t, policy.walk_scan)
        best, best_key = None, None
        for pos in pool:
            if pos == prev or self.sources[pos] == self.targets[pos]:
                continue
            tp = self.times[pos]
            if (forward and not t < tp <= t + lag) or (not forward and not t - lag <= tp < t):
                continue
            if not self.in_band(self.amounts[prev], self.amounts[pos]):
                continue
            key = (self.excess(self.amounts[prev], self.amounts[pos]), abs(tp - t), self.ids[pos])
            if best_key is None or key < best_key:
                best, best_key = pos, key
        if best is None:
            return None, "TRUNCATED" if truncated else "NONE"
        return best, "SEED" if best in self.seeds else "STEP"

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
            explained = (self.pass_following if side == "in" else self.pass_preceding) \
                if policy.star_exclude_passthrough else ()
            members = sorted((s for s in block
                              if s not in self.owned_by_star and self.starside.get(s, face) == face
                              and s not in explained),
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
            self.pass_following.add(e)
            self.pass_preceding.add(f)
        contested_in, contested_out = set(), set()
        for candidate in candidates:
            if candidate in adopted_set:
                continue
            e, f = candidate[4], candidate[5]
            contested_in.add(e)
            contested_out.add(f)
            self.rejected.append(RejectedRelation(Witness("PASS", self.tx_tuple((e, f))), "PASS_CONTESTED"))
            self.add_link(e, f, "BOUNDARY_PASS")
        # A contested bridge is role-specific: the inbound leg of an unresolved pass-through
        # stays contested even when the same transaction is the outbound leg of an adopted PASS.
        self.contested_in = contested_in - self.pass_following
        self.contested_out = contested_out - self.pass_preceding
        self.contested = self.contested_in | self.contested_out
        self.stats["pass_adopted"] = len(adopted)
        self.stats["pass_contested"] = len(candidates) - len(adopted)

    # ----- P3: PATH and BRIDGE (stage 2) -----
    def paths(self):
        """Seed → 1..path_gap_max non-seed in-band hops → seed, following the best step only."""
        policy = self.policy
        if policy.path_gap_max < 1:
            return
        best_by_arrival = {}
        for e in self.ordered_seeds:
            if e in self.selfie or e in self.pass_following or self.amounts[e] < 0:
                continue
            prev, steps, visited = e, [], {self.sources[e], self.targets[e]}
            total = Fraction(0)
            for hop in range(policy.path_gap_max + 1):
                pos, kind = self.best_step(prev, True)
                if pos is None:
                    break
                total += self.excess(self.amounts[prev], self.amounts[pos])
                if kind == "SEED":
                    if steps and pos != e and pos not in self.pass_preceding:
                        key = (len(steps), total, self.times[pos] - self.times[e], self.ids[e])
                        current = best_by_arrival.get(pos)
                        if current is None or key < current[0]:
                            best_by_arrival[pos] = (key, e, tuple(steps))
                    break
                if hop == policy.path_gap_max or self.targets[pos] in visited:
                    break
                steps.append(pos)
                visited.add(self.targets[pos])
                prev = pos
        for arrival in sorted(best_by_arrival, key=self.ids.__getitem__):
            key, e, steps = best_by_arrival[arrival]
            self.relations.append(_Relation(
                TIER_FLOW, 2, (key[0], key[1], key[2]), self.tx_tuple((e, arrival) + steps),
                "PATH", (e, arrival), extra=steps))
            self.stats["paths"] += 1

    def bridges(self):
        """S→m→T legs through distinct intermediaries, time-order independent (|Δt| ≤ hop_lag)."""
        policy = self.policy
        lag, window = policy.hop_lag_us, policy.hub_window_us
        legs = defaultdict(dict)  # (S, T) -> m -> (key, first leg, second leg)

        def offer(S, T, m, key, first, second):
            current = legs[(S, T)].get(m)
            if current is None or key < current[0]:
                legs[(S, T)][m] = (key, first, second)

        for e in self.ordered_seeds:
            if e in self.selfie or self.amounts[e] < 0:
                continue
            t, amount = self.times[e], self.amounts[e]
            # e as the first leg S→m: look for m→T within ±lag.
            S, m = self.sources[e], self.targets[e]
            if not self.is_hub(m, "out", t - window, t + window):
                pool, _ = self.scan_rows(self.index.outgoing, m, t - lag, t + lag, t, 2 * policy.walk_scan)
                for f in pool:
                    T = self.targets[f]
                    if f == e or T in (S, m) or self.sources[f] == self.targets[f]:
                        continue
                    if self.in_band(amount, self.amounts[f]):
                        offer(S, T, m, (self.excess(amount, self.amounts[f]), abs(self.times[f] - t),
                                        self.ids[f]), e, f)
            # e as the second leg m→T: look for S→m within ±lag.
            m, T = self.sources[e], self.targets[e]
            if not self.is_hub(m, "in", t - window, t + window):
                pool, _ = self.scan_rows(self.index.incoming, m, t - lag, t + lag, t, 2 * policy.walk_scan)
                for g in pool:
                    S = self.sources[g]
                    if g == e or S in (T, m) or self.sources[g] == self.targets[g]:
                        continue
                    if self.in_band(self.amounts[g], amount):
                        offer(S, T, m, (self.excess(self.amounts[g], amount), abs(self.times[g] - t),
                                        self.ids[g]), g, e)
        for (S, T), by_m in sorted(legs.items()):
            if len(by_m) < min(policy.bridge_min_mids, policy.shape_min_mids):
                continue
            items = sorted(by_m.values(), key=lambda item: (min(self.tkey(item[1]), self.tkey(item[2])), item[0]))
            chosen, bounds = [], None
            for item in items:
                if len(chosen) >= policy.star_max:
                    break
                times = (self.times[item[1]], self.times[item[2]])
                candidate = self.span_union(bounds, (min(times), max(times)))
                if candidate[1] - candidate[0] > policy.span_max_us:
                    continue
                chosen.append(item)
                bounds = candidate
            positions = {pos for item in chosen for pos in item[1:]}
            seeds = tuple(sorted(positions & self.seeds, key=self.tkey))
            extra = tuple(sorted(positions - self.seeds, key=self.tkey))
            if len(seeds) >= 2 and len(chosen) >= policy.bridge_min_mids:
                self.relations.append(_Relation(
                    TIER_FLOW, 1, (-len(chosen), -len(seeds), bounds[1] - bounds[0]),
                    self.tx_tuple(positions), "BRIDGE", seeds, extra=extra))
                self.stats["bridges"] += 1

    # ----- P5: closure walks (stage 2) -----
    def walk_closure(self, root, end, forward):
        policy = self.policy
        core = self.core[root]
        accounts = {self.sources[pos] for pos in core} | {self.targets[pos] for pos in core}
        prev, steps, visited = end, [], {self.sources[end], self.targets[end]}
        for _ in range(policy.ear_max):
            pos, kind = self.best_step(prev, forward)
            if pos is None or kind == "SEED":
                break
            steps.append(pos)
            arrival = self.targets[pos] if forward else self.sources[pos]
            if arrival in accounts:
                extra = [end] + steps
                if self.merged_size([root], extra) > policy.core_max:
                    self.limits[end].add("CORE_CAP")
                    return False
                low, high = self.merged_bounds([root], extra)
                if high - low > policy.span_max_us:
                    self.limits[end].add("COMPONENT_SPAN")
                    return False
                self.adopt(root, "CLOSURE", extra)
                self.stats["adopted_CLOSURE"] += 1
                return True
            if arrival in visited:
                break
            visited.add(arrival)
            prev = pos
        return False

    def closures(self):
        for root in sorted({self.find(s) for s in self.seeds}, key=self.ids.__getitem__):
            if not self.witnesses[root] or self.frozen[root] or not self.established(root):
                continue
            core = self.core[root]
            leaves = {self.sources[pos] for pos in core}
            enters = {self.targets[pos] for pos in core}
            core_seeds = sorted(core & self.seeds, key=self.tkey)
            for end in core_seeds:
                if self.targets[end] not in leaves:   # tail: nothing leaves its receiver inside the block
                    self.walk_closure(root, end, True)
            for end in core_seeds:
                if self.sources[end] not in enters:   # head: nothing enters its sender inside the block
                    self.walk_closure(root, end, False)

    # ----- P6: single-seed shapes (policy, default off) -----
    def shapes(self):
        policy = self.policy
        if not policy.single_seed_shapes:
            return
        for e in self.ordered_seeds:
            root = self.find(e)
            # A pinned single-seed shape is re-walked so that a re-run reproduces it (I10).
            if (e in self.selfie or len(self.comp_seeds[root]) >= 2 or self.witnesses[root]
                    or self.amounts[e] < 0):
                continue
            prev, steps, visited = e, [], {self.sources[e], self.targets[e]}
            for _ in range(policy.ear_max):
                pos, kind = self.best_step(prev, True)
                if pos is None or kind == "SEED":
                    break
                steps.append(pos)
                arrival = self.targets[pos]
                if arrival == self.sources[e]:
                    if len(steps) + 1 >= policy.shape_min_hops and len(steps) + 1 <= policy.core_max:
                        self.adopt(root, "SHAPE_CYCLE", [e] + steps)
                        self.limits[e].add("SINGLE_SEED_SHAPE")
                        self.stats["adopted_SHAPE_CYCLE"] += 1
                    break
                if arrival in visited:
                    break
                visited.add(arrival)
                prev = pos
            if not self.witnesses[root]:
                extra = self.shape_bridge(e)
                if extra and len(extra) + 1 <= policy.core_max:
                    self.adopt(root, "SHAPE_BRIDGE", (e,) + tuple(extra))
                    self.limits[e].add("SINGLE_SEED_SHAPE")
                    self.stats["adopted_SHAPE_BRIDGE"] += 1

    def shape_bridge(self, e):
        """Non-seed spokes of S next to e that reach one T through ≥ shape_min_mids intermediaries."""
        policy = self.policy
        lag, window = policy.hop_lag_us, policy.hub_window_us
        S, t, amount = self.sources[e], self.times[e], self.amounts[e]
        if self.is_hub(S, "out", t - window, t + window):
            return ()
        spokes, _ = self.scan_rows(self.index.outgoing, S, t - lag, t + lag, t, 2 * policy.walk_scan)
        legs = defaultdict(dict)  # T -> m -> (key, spoke, second leg)
        for spoke in sorted(spokes, key=self.tkey):
            m = self.targets[spoke]
            if m == S or (spoke != e and (spoke in self.seeds or not self.in_band(amount, self.amounts[spoke]))):
                continue
            ts = self.times[spoke]
            if self.is_hub(m, "out", ts - window, ts + window):
                continue
            pool, _ = self.scan_rows(self.index.outgoing, m, ts - lag, ts + lag, ts, policy.walk_scan)
            for f in pool:
                T = self.targets[f]
                if f in self.seeds or T in (S, m) or self.sources[f] == self.targets[f]:
                    continue
                if not self.in_band(self.amounts[spoke], self.amounts[f]):
                    continue
                key = (self.excess(self.amounts[spoke], self.amounts[f]), abs(self.times[f] - ts), self.ids[f])
                current = legs[T].get(m)
                if current is None or key < current[0]:
                    legs[T][m] = (key, spoke, f)
        best = ()
        for T in sorted(legs):
            by_m = legs[T]
            if self.targets[e] not in by_m or len(by_m) < policy.shape_min_mids:
                continue
            positions = sorted({pos for item in by_m.values() for pos in item[1:]} - {e}, key=self.tkey)
            if len(positions) > len(best):
                best = tuple(positions)
        return best

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
        members = relation.seeds + relation.extra
        if any(self.frozen[root] for root in roots):
            self.link_roots(by_root, roots, "BOUNDARY_CAP")
            return
        if self.merged_size(roots, members) > policy.core_max:
            self.link_roots(by_root, roots, "BOUNDARY_CAP")
            for s in relation.seeds:
                self.limits[s].add("CORE_CAP")
            return
        low, high = self.merged_bounds(roots, members)
        if high - low > policy.span_max_us:
            self.link_roots(by_root, roots, "BOUNDARY_SPAN")
            for s in relation.seeds:
                self.limits[s].add("COMPONENT_SPAN")
            return
        if sum(1 for root in roots if self.pinned[root] is not None) >= 2:
            self.link_roots(by_root, roots, "BOUNDARY_OPEN_PAIR")
            return
        self.adopt(self.merge(roots), relation.kind, members)
        self.stats["adopted_" + relation.kind] += 1

    def absorbable(self, root, account, side, chunk_seeds):
        policy = self.policy
        if not self.established(root):
            return True
        contested = self.contested_in if side == "in" else self.contested_out
        if policy.contested_check and any(s in contested for s in chunk_seeds):
            return False
        members = self.comp_seeds[root] | self.core[root]
        if not policy.absorb_dangling:
            dangling = False
        elif side == "in":
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

        Returns (accepted roots, witness members, limit marks). Nothing is merged and no
        limit is recorded until the caller has checked that the resulting witness is
        valid: a rejected witness never leaves two blocks joined without evidence, and
        never leaves a cap mark on seeds that no witness held back (I10).
        """
        policy = self.policy
        contributions = contributions or {}
        accepted, ids_acc, bounds_acc, marks = [], set(), None, []
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
                    marks.extend((s, "CORE_CAP") for s in by_root[root])
                    skipped.append((root, "BOUNDARY_CAP"))
                    continue
                low, high = self.span_union(bounds_acc, root_bounds)
                if high - low > policy.span_max_us:
                    marks.extend((s, "COMPONENT_SPAN") for s in by_root[root])
                    skipped.append((root, "BOUNDARY_SPAN"))
                    continue
            ids_acc |= root_ids
            bounds_acc = self.span_union(bounds_acc, root_bounds)
            accepted.append(root)
        members = [s for item in accepted for s in contributions.get(item, by_root[item])]
        return accepted, members, marks

    def apply_marks(self, marks):
        for s, flag in marks:
            self.limits[s].add(flag)

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
        separate = []
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
                separate.append((root, "BOUNDARY_SAME_FOCAL"))
            elif self.absorbable(root, account, side, by_root[root]):
                take.append(root)
            else:
                separate.append((root, "BOUNDARY_SAME_FOCAL"))
        counterparty = self.targets if side == "out" else self.sources
        excluded = set()
        while True:
            skipped = separate + [(root, "BOUNDARY_SAME_FOCAL")
                                  for root in sorted(excluded, key=self.ids.__getitem__)]
            candidates = [root for root in take if root not in excluded]
            established = [root for root in candidates if self.established(root)]
            isolated = [root for root in candidates if not self.established(root)]
            if relation.tier == TIER_WEAK:
                # A weak star may attach one established block in its lifetime; an anchor
                # that already holds more than its published spokes has used that slot (I10).
                slot_used = anchor is not None and bool(self.comp_seeds[anchor] - set(contributions[anchor]))
                if slot_used:
                    skipped.extend((root, "BOUNDARY_SAME_FOCAL") for root in established)
                    established = []
                elif len(established) > 1:
                    dominant = max(established,
                                   key=lambda root: (self.face_bridges(root, account, side), -self.ids[root]))
                    skipped.extend((root, "BOUNDARY_SAME_FOCAL") for root in established if root != dominant)
                    established = [dominant]
            order = (([anchor] if anchor is not None else [])
                     + sorted(established, key=lambda root: (-self.face_bridges(root, account, side), self.ids[root]))
                     + sorted(isolated, key=lambda root: self.tkey(by_root[root][0])))
            accepted, members, marks = self.plan_union(by_root, order, skipped, contributions)
            if (len(members) >= 2
                    and len({counterparty[s] for s in members}) >= self.policy.star_min_counterparties):
                self.apply_marks(marks)
                self.adopt(self.merge(accepted), relation.kind, members)
                self.stats["adopted_" + relation.kind] += 1
                self.finish_links(by_root, accepted, skipped)
                return
            # Not a fan: an established block planned first that filled the cap or the
            # span must not keep the other spokes from forming their own star. A re-run
            # skips that block as a pinned block without spokes on this face, so the
            # batch run steps it aside the same way (I10).
            blockers = [root for root in accepted if root != anchor and self.established(root)]
            if not blockers:
                break
            excluded.update(blockers)
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
            focal = relation.focal

            def contested(root):
                return self.policy.contested_check and any(
                    s in (self.contested_in if self.targets[s] == focal else self.contested_out)
                    for s in by_root[root])

            clean = [root for root in extended if not contested(root)]
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
        accepted, members, marks = self.plan_union(by_root, order, skipped, contributions)
        ins, outs = set(relation.parts[0]), set(relation.parts[1])
        if len(members) >= 2 and any(s in ins for s in members) and any(s in outs for s in members):
            self.apply_marks(marks)
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
        self.passes()      # before faces: an adopted PASS may exclude star spokes (ablation)
        self.faces()
        self.relays()
        self.paths()
        self.bridges()
        self.assemble()
        self.closures()
        self.shapes()
        return self.output()
