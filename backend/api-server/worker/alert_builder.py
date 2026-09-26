"""Pattern-independent investigation candidates from a frozen transaction snapshot.

Pure computation: scheduling, persistence and run fencing belong to the pipeline.
Every exploration limit must be supplied explicitly; there are no production defaults.
"""
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta
import math


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
    before: timedelta
    after: timedelta
    max_depth: int
    max_transactions: int
    max_account_transactions: int
    min_shared_transactions: int

    def validate(self):
        if (not self.version or isinstance(self.threshold, bool)
                or not math.isfinite(self.threshold) or not 0 <= self.threshold <= 1
                or self.before < timedelta(0) or self.after < timedelta(0)
                or any(type(value) is not int or value < 1 for value in (
                    self.max_depth, self.max_transactions, self.max_account_transactions,
                    self.min_shared_transactions))):
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


def build_candidates(transactions, binary_scores, policy, *, coverage_start, coverage_end):
    """Scores apply to this run's TARGETs; unscored CONTEXT may be included.

    Coverage is the snapshot's declared temporal range, not its first/last row.
    Predictions from the pattern classifier deliberately are not an input.
    """
    policy.validate()
    if (coverage_start.utcoffset() is None or coverage_end.utcoffset() is None
            or coverage_start > coverage_end):
        raise ValueError("Invalid snapshot coverage")
    rows, incoming, outgoing = {}, defaultdict(list), defaultdict(list)
    for row in transactions:
        if (type(row.tx_id) is not int or row.tx_id <= 0 or row.tx_id in rows
                or not row.source or not row.destination or row.occurred_at.utcoffset() is None
                or not coverage_start <= row.occurred_at <= coverage_end):
            raise ValueError("Invalid or duplicate transaction")
        rows[row.tx_id] = row
        incoming[row.destination].append(row)
        outgoing[row.source].append(row)
    for tx_id, score in binary_scores.items():
        if (type(tx_id) is not int or tx_id not in rows or isinstance(score, bool)
                or not math.isfinite(score) or not 0 <= score <= 1):
            raise ValueError("Invalid binary score")
    seeds = sorted(tx_id for tx_id, score in binary_scores.items() if score >= policy.threshold)
    seed_set = set(seeds)
    groups = []
    for seed_id in seeds:
        seed = rows[seed_id]
        low, high = seed.occurred_at - policy.before, seed.occurred_at + policy.after
        members = {seed_id: {"SEED"}}
        limits = set()
        if low < coverage_start:
            limits.add("SNAPSHOT_START")
        if high > coverage_end:
            limits.add("SNAPSHOT_END")
        queue = deque([(seed_id, 0, "BOTH")])
        visited = {(seed_id, "BOTH")}

        def neighbours(row, direction):
            choices = defaultdict(set)
            directions = [(row.source, incoming, "UPSTREAM", lambda other: other.occurred_at < row.occurred_at),
                          (row.destination, outgoing, "DOWNSTREAM", lambda other: other.occurred_at > row.occurred_at)]
            # Peers preserve fan-in/fan-out context without using a pattern label.
            if direction == "BOTH":
                directions += [(row.source, outgoing, "SHARED_SOURCE", lambda other: True),
                               (row.destination, incoming, "SHARED_DESTINATION", lambda other: True)]
            else:
                directions = [item for item in directions if item[2] == direction]
            for account, index, reason, accepts in directions:
                activity = {r.tx_id for r in incoming[account] + outgoing[account]
                            if low <= r.occurred_at <= high}
                if len(activity) > policy.max_account_transactions:
                    limits.add("ACCOUNT_ACTIVITY")
                    continue
                for other in index[account]:
                    if other.tx_id != row.tx_id and accepts(other):
                        if low <= other.occurred_at <= high:
                            choices[other.tx_id].add(reason)
                        else:
                            limits.add("TIME_WINDOW")
            return choices

        while queue:
            tx_id, depth, direction = queue.popleft()
            choices = neighbours(rows[tx_id], direction)
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
                    next_direction = "UPSTREAM" if reason in ("UPSTREAM", "SHARED_DESTINATION") else "DOWNSTREAM"
                    state = (other_id, next_direction)
                    if state not in visited:
                        visited.add(state)
                        queue.append((other_id, depth + 1, next_direction))
        groups.append([set((seed_id,)), members, limits])

    # Candidate pairs must share actual transactions, never just an account ID.
    owners = defaultdict(list)
    pairs = set()
    for index, (_, members, _) in enumerate(groups):
        for tx_id in members:
            for other in owners[tx_id]:
                pairs.add((other, index))
            owners[tx_id].append(index)
    parents = list(range(len(groups)))

    def root(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    for left, right in sorted(pairs):
        left, right = root(left), root(right)
        if left == right:
            continue
        a, b = groups[left], groups[right]
        shared = set(a[1]) & set(b[1])
        linked_seeds = bool(a[0] & set(b[1]) or b[0] & set(a[1]))
        if not linked_seeds and len(shared - seed_set) < policy.min_shared_transactions:
            continue
        combined = set(a[1]) | set(b[1])
        times = [rows[key].occurred_at for key in combined]
        if (len(combined) > policy.max_transactions or max(times) - min(times) > policy.before + policy.after):
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
