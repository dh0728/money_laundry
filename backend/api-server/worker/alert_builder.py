"""Pattern-independent investigation candidates from a frozen transaction snapshot.

Pure computation: scheduling, persistence and run fencing belong to the pipeline.
Every exploration limit must be supplied explicitly; there are no production defaults.
"""
from collections import OrderedDict, defaultdict, deque
from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from datetime import datetime, timedelta
import math
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Transaction:
    tx_id: int
    occurred_at: datetime
    source: str
    destination: str


@dataclass(frozen=True)
class Policy:
    version: str
    threshold: float
    day_radius: int
    max_depth: int
    max_transactions: int
    max_account_transactions: int

    def validate(self):
        if (not self.version or isinstance(self.threshold, bool)
                or not math.isfinite(self.threshold) or not 0 <= self.threshold <= 1
                or type(self.day_radius) is not int or self.day_radius < 0
                or any(type(value) is not int or value < 1 for value in (
                    self.max_depth, self.max_transactions, self.max_account_transactions))):
            raise ValueError("Invalid Alert policy")


@dataclass(frozen=True)
class Membership:
    tx_id: int
    role: str
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class Candidate:
    seed_ids: tuple[int, ...]
    transactions: tuple[Membership, ...]
    limits: tuple[str, ...]
    policy_version: str


def _overlapping_pairs(member_groups):
    """Yield the old sorted pair order without retaining all pair combinations.

    Membership is snapshotted before merging: later mutations must not add pairs.
    Only one left group's distinct right neighbours are held at a time.
    """
    memberships = [tuple(members) for members in member_groups]
    owners = defaultdict(list)
    for index, members in enumerate(memberships):
        for tx_id in members:
            owners[tx_id].append(index)
    for left, members in enumerate(memberships):
        rights = set()
        for tx_id in members:
            indexes = owners[tx_id]
            for offset in range(bisect_right(indexes, left), len(indexes)):
                rights.add(indexes[offset])
        for right in sorted(rights):
            yield left, right


class _NeighbourIndex:
    """Immutable per-run time indexes; bounded cache shared by seed traversals."""
    def __init__(self, rows, policy):
        self.rows, self.policy = rows, policy
        incoming, outgoing, activity = defaultdict(list), defaultdict(list), defaultdict(list)
        for row in rows.values():
            incoming[row.destination].append(row)
            outgoing[row.source].append(row)
            activity[row.source].append(row.occurred_at)
            if row.source != row.destination:
                activity[row.destination].append(row.occurred_at)
        self.activity = {key: sorted(times) for key, times in activity.items()}
        self.incoming = self._sort(incoming)
        self.outgoing = self._sort(outgoing)
        self.cache = OrderedDict()

    def choices(self, tx_id, direction):
        key = (tx_id, direction)
        if key not in self.cache:
            self.cache[key] = self._choices(tx_id, direction)
            if len(self.cache) > 1024:
                self.cache.popitem(last=False)
        self.cache.move_to_end(key)
        return self.cache[key]

    @staticmethod
    def _sort(index):
        result = {}
        for account, rows in index.items():
            rows.sort(key=lambda row: (row.occurred_at, row.tx_id))
            result[account] = ([row.occurred_at for row in rows], rows)
        return result

    def _choices(self, tx_id, direction):
        row = self.rows[tx_id]
        day = row.occurred_at.astimezone(ZoneInfo('Asia/Seoul')).replace(
            hour=0, minute=0, second=0, microsecond=0)
        low = day - timedelta(days=self.policy.day_radius)
        high = day + timedelta(days=self.policy.day_radius + 1)
        choices, limits = defaultdict(set), set()
        directions = [(row.source, self.incoming, 'UPSTREAM'),
                      (row.destination, self.outgoing, 'DOWNSTREAM')]
        if direction == 'BOTH':
            directions += [(row.source, self.outgoing, 'SHARED_SOURCE'),
                           (row.destination, self.incoming, 'SHARED_DESTINATION')]
        else:
            directions = [item for item in directions if item[2] == direction]
        for account, index, reason in directions:
            activity = self.activity[account]
            if bisect_left(activity, high) - bisect_left(activity, low) > self.policy.max_account_transactions:
                limits.add('ACCOUNT_ACTIVITY')
                continue
            times, adjacent = index.get(account, ((), ()))
            begin, end = bisect_left(times, low), bisect_left(times, high)
            if reason == 'UPSTREAM':
                end = min(end, bisect_left(times, row.occurred_at))
                outside = bool(times and times[0] < low)
            elif reason == 'DOWNSTREAM':
                begin = max(begin, bisect_right(times, row.occurred_at))
                outside = bool(times and times[-1] >= high)
            else:
                outside = begin > 0 or end < len(times)
            if outside:
                limits.add('TIME_WINDOW')
            for offset in range(begin, end):
                other = adjacent[offset]
                if other.tx_id != tx_id:
                    choices[other.tx_id].add(reason)
        return {key: frozenset(value) for key, value in choices.items()}, frozenset(limits)


def build_candidates(transactions, binary_scores, policy, *, coverage_start, coverage_end):
    """Scores apply to this run's TARGETs; unscored CONTEXT may be included.

    Coverage is the snapshot's declared temporal range, not its first/last row.
    Predictions from the pattern classifier deliberately are not an input.
    """
    policy.validate()
    if (coverage_start.utcoffset() is None or coverage_end.utcoffset() is None
            or coverage_start > coverage_end):
        raise ValueError("Invalid snapshot coverage")
    rows = {}
    for row in transactions:
        if (type(row.tx_id) is not int or row.tx_id <= 0 or row.tx_id in rows
                or not row.source or not row.destination or row.occurred_at.utcoffset() is None
                or not coverage_start <= row.occurred_at <= coverage_end):
            raise ValueError("Invalid or duplicate transaction")
        rows[row.tx_id] = row
    for tx_id, score in binary_scores.items():
        if (type(tx_id) is not int or tx_id not in rows or isinstance(score, bool)
                or not math.isfinite(score) or not 0 <= score <= 1):
            raise ValueError("Invalid binary score")
    seeds = sorted(tx_id for tx_id, score in binary_scores.items() if score >= policy.threshold)
    seed_set = set(seeds)
    neighbours = _NeighbourIndex(rows, policy)
    groups = []
    for seed_id in seeds:
        seed = rows[seed_id]
        members = {seed_id: {"SEED"}}
        limits = set()
        queue = deque([(seed_id, 0, "BOTH")])
        visited = {(seed_id, "BOTH")}

        while queue:
            tx_id, depth, direction = queue.popleft()
            choices, observed_limits = neighbours.choices(tx_id, direction)
            limits.update(observed_limits)
            ordered = sorted(choices, key=lambda key: (abs(rows[key].occurred_at - seed.occurred_at),
                                                       rows[key].occurred_at, key))
            for other_id in ordered:
                if depth >= policy.max_depth:
                    if other_id not in members:
                        limits.add("DEPTH")
                    continue
                if other_id not in members and len(members) >= policy.max_transactions:
                    limits.add("TRANSACTION_COUNT")
                    continue
                members.setdefault(other_id, set()).update(choices[other_id])
                for reason in sorted(choices[other_id]):
                    # Peers remain visible, but only a direct flow continues exploration.
                    if reason not in ("UPSTREAM", "DOWNSTREAM"):
                        continue
                    next_direction = reason
                    state = (other_id, next_direction)
                    if state not in visited:
                        visited.add(state)
                        queue.append((other_id, depth + 1, next_direction))
        groups.append([set((seed_id,)), members, limits])

    # Candidate pairs must share actual transactions, never just an account ID.
    parents = list(range(len(groups)))

    def root(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    for left, right in _overlapping_pairs(group[1] for group in groups):
        left, right = root(left), root(right)
        if left == right:
            continue
        a, b = groups[left], groups[right]
        linked_seeds = not a[0].isdisjoint(b[1]) or not b[0].isdisjoint(a[1])
        # Shared context alone is not evidence that two seed flows are one block.
        if not linked_seeds:
            continue
        combined = a[1].keys() | b[1].keys()
        if len(combined) > policy.max_transactions:
            a[2].add("MERGE_LIMIT")
            b[2].add("MERGE_LIMIT")
            continue
        a[0].update(b[0])
        a[2].update(b[2])
        for key, reasons in b[1].items():
            a[1].setdefault(key, set()).update(reasons)
        parents[right] = left

    output = []
    for index, (anchors, members, limits) in enumerate(groups):
        if root(index) != index:
            continue
        membership = []
        for tx_id in sorted(members):
            reasons = members[tx_id]
            role = ("SEED" if tx_id in seed_set else "CONNECTION"
                    if reasons & {"UPSTREAM", "DOWNSTREAM"} else "CONTEXT")
            membership.append(Membership(tx_id, role, tuple(sorted(reasons))))
        output.append(Candidate(tuple(sorted(anchors)), tuple(membership), tuple(sorted(limits)), policy.version))
    return sorted(output, key=lambda candidate: candidate.seed_ids)
