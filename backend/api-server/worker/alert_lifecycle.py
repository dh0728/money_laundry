"""Pure planning of flow evidence against a frozen business snapshot.

This module performs no database writes. A publisher must validate every returned
baseline and apply the entire plan atomically. Closed cases are references, not
vertices that join otherwise unrelated new flows. Evidence construction and the
database publisher remain separate from these lifecycle decisions.
"""
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum
import hashlib
import json

from flow_graph import FlowGraph, Witness


class PlanningError(ValueError):
    """Invalid or incomplete planning contract; never publish a partial result."""


class Action(StrEnum):
    NEW = 'NEW'
    UPDATE = 'UPDATE'
    MERGE = 'MERGE'
    PROPOSE = 'PROPOSE'
    FOLLOWUP = 'FOLLOWUP'
    WITHDRAW = 'WITHDRAW'
    NOOP = 'NOOP'


@dataclass(frozen=True)
class Evidence:
    """Semantic identity and relation indexes of an immutable evidence version.

    The digest covers the complete evidence, including facts and selected scores;
    membership alone is insufficient. ``witnesses`` contains adopted relations,
    never context adjacency or rejected relations.
    """
    digest: str
    seed_ids: frozenset[int]
    connection_ids: frozenset[int]
    context_ids: frozenset[int]
    witnesses: tuple[Witness, ...]

    @property
    def core_ids(self):
        return self.seed_ids | self.connection_ids

    @property
    def member_ids(self):
        return self.core_ids | self.context_ids

    @classmethod
    def from_graph(cls, graph: FlowGraph, digest: str):
        return cls(digest, frozenset(graph.seed_ids), frozenset(graph.connection_ids),
                   frozenset(graph.context_ids), graph.witnesses)


@dataclass(frozen=True)
class CaseSnapshot:
    alert_id: int
    published_version: int
    revision: int
    assignee_id: int
    created_at: datetime
    status: str
    review_started_at: datetime | None
    evidence: Evidence
    merged_into_alert_id: int | None = None
    # Transitive FOLLOWUP_OF ancestors, resolved by the snapshot reader.
    ancestor_ids: frozenset[int] = frozenset()
    # A staff-excluded transaction is still an identity match. It must not cause
    # the generator to issue an alternative Alert that bypasses the exclusion.
    excluded_tx_ids: frozenset[int] = frozenset()

    def baseline(self):
        return dict(alertId=self.alert_id, publishedVersion=self.published_version,
                    revision=self.revision, assigneeId=self.assignee_id,
                    status=self.status,
                    reviewStartedAt=_instant(self.review_started_at),
                    mergedIntoAlertId=self.merged_into_alert_id)


@dataclass(frozen=True)
class Validity:
    """Explicit facts from the frozen input; absence is never invalidation.

    ``checked_ids`` must cover a case's complete former core before automatic
    withdrawal. Only report-correction invalidation belongs in ``invalid_ids``.
    Score/policy changes use ``reassessment_ids`` and always require a proposal.
    """
    checked_ids: frozenset[int] = frozenset()
    invalid_ids: frozenset[int] = frozenset()
    reassessment_ids: frozenset[int] = frozenset()


@dataclass(frozen=True)
class Plan:
    action: Action
    target_alert_id: int | None
    case_ids: tuple[int, ...]
    graph_ids: tuple[int, ...]
    reference_ids: tuple[int, ...]
    recipient_ids: tuple[int, ...]
    reason: str
    baselines: tuple[CaseSnapshot, ...]
    # Existing explicit staff exclusions survive both automatic publication and
    # proposal acceptance. The publisher preserves other staff states as well.
    excluded_tx_ids: frozenset[int]
    invalid_tx_ids: frozenset[int]

    def contract(self):
        return dict(action=str(self.action), targetAlertId=self.target_alert_id,
                    caseIds=list(self.case_ids), graphIds=list(self.graph_ids),
                    referenceIds=list(self.reference_ids),
                    recipientIds=list(self.recipient_ids), reason=self.reason,
                    baselines=[case.baseline() for case in self.baselines],
                    excludedTxIds=sorted(self.excluded_tx_ids),
                    invalidTxIds=sorted(self.invalid_tx_ids))


@dataclass(frozen=True)
class PlanBatch:
    plans: tuple[Plan, ...]
    digest: str
    match_checks: int


def _instant(value):
    if value is None:
        return None
    if value.utcoffset() is None:
        raise PlanningError('Business snapshot times require a timezone')
    return value.astimezone(timezone.utc).isoformat(timespec='microseconds')


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def _validate_evidence(evidence, *, allow_empty=False):
    core_ids = evidence.core_ids
    if (len(evidence.digest) != 64
            or any(c not in '0123456789abcdef' for c in evidence.digest)):
        raise PlanningError('Evidence requires a SHA-256 semantic digest')
    if (evidence.seed_ids & evidence.connection_ids
            or core_ids & evidence.context_ids):
        raise PlanningError('Evidence roles must be disjoint')
    if any(type(key) is not int or key <= 0 for key in evidence.member_ids):
        raise PlanningError('Transaction IDs must be positive integers')
    if allow_empty and not evidence.member_ids and not evidence.witnesses:
        return
    if not evidence.seed_ids or not evidence.witnesses:
        raise PlanningError('Published flow evidence requires seeds and adopted witnesses')
    if len(set(evidence.witnesses)) != len(evidence.witnesses):
        raise PlanningError('Duplicate adopted witness')
    covered = set()
    for witness in evidence.witnesses:
        keys = set(witness.tx_ids)
        if (not witness.kind or len(keys) < 2 or len(keys) != len(witness.tx_ids)
                or not keys <= core_ids or not keys & evidence.seed_ids):
            raise PlanningError('Witness must connect a seed using only distinct core transactions')
        covered.update(keys)
    if not core_ids <= covered:
        raise PlanningError('Every core transaction requires an adopted witness')


def _validate(cases, graphs, validity):
    by_id = {case.alert_id: case for case in cases}
    if len(by_id) != len(cases):
        raise PlanningError('Duplicate Alert in business snapshot')
    if not validity.invalid_ids <= validity.checked_ids:
        raise PlanningError('Invalidated facts must have explicit validity checks')
    if validity.invalid_ids & validity.reassessment_ids:
        raise PlanningError('Report invalidation and score reassessment are distinct')
    for case in cases:
        if (case.alert_id <= 0 or case.published_version <= 0 or case.revision < 0
                or case.assignee_id <= 0 or case.status not in ('OPEN', 'CLOSED')):
            raise PlanningError('Invalid case baseline')
        _instant(case.created_at)
        _instant(case.review_started_at)
        if not case.excluded_tx_ids <= case.evidence.member_ids:
            raise PlanningError('Excluded transactions must belong to the case evidence')
        if case.excluded_tx_ids and case.review_started_at is None:
            raise PlanningError('Staff exclusions require a recorded investigation start')
        if case.alert_id in case.ancestor_ids or not case.ancestor_ids <= by_id.keys():
            raise PlanningError('Incomplete or cyclic follow-up ancestry')
        for ancestor in case.ancestor_ids:
            if not by_id[ancestor].ancestor_ids <= case.ancestor_ids:
                raise PlanningError('Follow-up ancestry must be transitively complete')
            if by_id[ancestor].status != 'CLOSED':
                raise PlanningError('A follow-up ancestor must have an immutable closed outcome')
        _validate_evidence(case.evidence, allow_empty=case.status == 'CLOSED')
    canonical = {}
    for case in cases:
        path, current = set(), case.alert_id
        while by_id[current].merged_into_alert_id is not None:
            if current in path:
                raise PlanningError('Cyclic merge alias')
            path.add(current)
            current = by_id[current].merged_into_alert_id
            if current not in by_id:
                raise PlanningError('Missing canonical Alert')
        canonical[case.alert_id] = current
    assigned_seeds = set()
    for graph in graphs:
        _validate_evidence(graph)
        if assigned_seeds & graph.seed_ids:
            raise PlanningError('A seed occurs in more than one new graph')
        assigned_seeds.update(graph.seed_ids)
        if graph.member_ids & validity.invalid_ids:
            raise PlanningError('A new graph contains an invalidated transaction')
    return by_id, canonical


def _matches(case, graph, by_id):
    old = case.evidence
    shared_seed = bool(old.seed_ids & graph.seed_ids)
    direct = shared_seed or any(not w.kind.startswith('BOUNDARY_')
                 and set(w.tx_ids) & old.seed_ids and set(w.tx_ids) & graph.seed_ids
                 for w in graph.witnesses)
    if not shared_seed and not direct:
        return False
    if not case.ancestor_ids:
        return True
    # Inherited parent seeds alone must not join independent follow-up flows.
    inherited_core, inherited_witnesses = set(), set()
    for ancestor in case.ancestor_ids:
        inherited_core.update(by_id[ancestor].evidence.core_ids)
        inherited_witnesses.update(by_id[ancestor].evidence.witnesses)
    own_core = old.core_ids - inherited_core
    own_witnesses = set(old.witnesses) - inherited_witnesses
    return bool(graph.core_ids & own_core or set(graph.witnesses) & own_witnesses)


def _remaining_relation(case, validity):
    return any(not set(w.tx_ids) & validity.invalid_ids
               and set(w.tx_ids) & (case.evidence.seed_ids - validity.invalid_ids)
               for w in case.evidence.witnesses)


def _novel(graph, references, validity):
    old_core, old_witnesses = set(), set()
    for case in references:
        old_core.update(case.evidence.core_ids - validity.invalid_ids)
        old_witnesses.update(case.evidence.witnesses)
    return bool(graph.core_ids - old_core or set(graph.witnesses) - old_witnesses)


def build_case_plans(cases, graphs, *, validity=Validity(),
                     composed_digests=None, max_match_checks=1_000_000):
    """Return deterministic operations, each affecting an open case at most once.

    Graph IDs are positions in the input tuple. ``composed_digests`` maps a
    component's sorted open case IDs and graph IDs to the digest of its composed
    immutable evidence. The materializer supplies it after retaining history and
    removing explicitly invalid facts. Without it, equality is only established
    for an exact one-graph/one-case match or a case with no changes. This avoids
    mistaking equal membership for equal scores/facts.

    Matching uses a seed index instead of a full cases x graphs scan. The explicit
    work budget fails the whole computation; it never returns truncated plans.
    """
    cases, graphs = tuple(cases), tuple(graphs)
    if type(max_match_checks) is not int or max_match_checks < 1:
        raise PlanningError('Matching budget must be positive')
    by_id, canonical = _validate(cases, graphs, validity)
    canonical_cases = {key: case for key, case in by_id.items() if canonical[key] == key}
    # Aliases contribute identity matches to their survivor, but never receive a
    # second operation or a second owner vote.
    seed_index = defaultdict(set)
    for case in cases:
        for seed in case.evidence.seed_ids:
            seed_index[seed].add(case.alert_id)
    parent = list(range(len(graphs)))

    def root(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def join(left, right):
        left, right = root(left), root(right)
        if left != right:
            parent[max(left, right)] = min(left, right)

    open_matches, closed_matches = [], []
    first_graph_for_case, checks = {}, 0
    for index, graph in enumerate(graphs):
        candidate_ids = set()
        for key in graph.core_ids:
            candidate_ids.update(seed_index.get(key, ()))
        opened, closed = set(), set()
        for key in sorted(candidate_ids):
            checks += 1
            if checks > max_match_checks:
                raise PlanningError('Case matching budget exceeded')
            case = by_id[key]
            if not _matches(case, graph, by_id):
                continue
            current = canonical_cases[canonical[key]]
            (opened if current.status == 'OPEN' else closed).add(current.alert_id)
        for key in opened:
            if key in first_graph_for_case:
                join(index, first_graph_for_case[key])
            else:
                first_graph_for_case[key] = index
        open_matches.append(opened)
        closed_matches.append(closed)

    components = defaultdict(list)
    for index in range(len(graphs)):
        components[root(index)].append(index)
    # An unchanged or explicitly invalidated old case still needs a coverage /
    # withdrawal / reassessment decision even when no new graph matched it.
    isolated = sorted(key for key, case in canonical_cases.items()
                      if case.status == 'OPEN' and key not in first_graph_for_case)
    components_to_plan = [(tuple(indexes), set().union(*(open_matches[i] for i in indexes)),
                           set().union(*(closed_matches[i] for i in indexes)))
                          for indexes in components.values()]
    components_to_plan.extend(((), {key}, set()) for key in isolated)
    plans = []
    for indexes, affected, referenced in components_to_plan:
        active = [canonical_cases[key] for key in sorted(affected)]
        # Include all closed ancestors for novelty and concurrency validation,
        # but do not notify or request approval from their former owners.
        for case in active:
            referenced.update(canonical[key] for key in case.ancestor_ids)
        references = [canonical_cases[key] for key in sorted(referenced)]
        case_ids = tuple(case.alert_id for case in active)
        target = min(active, key=lambda c: (c.created_at, c.alert_id)) if active else None
        reason = 'FLOW_EVIDENCE'
        if not active:
            action = Action.FOLLOWUP if references else Action.NEW
            if references and not any(_novel(graphs[i], references, validity) for i in indexes):
                action, reason = Action.NOOP, 'NO_NEW_CORE_OR_WITNESS'
        else:
            invalid = set().union(*(c.evidence.member_ids for c in active)) & validity.invalid_ids
            reassess = any(c.evidence.member_ids & validity.reassessment_ids for c in active)
            withdrawn = (not indexes and bool(invalid)
                         and all(c.evidence.core_ids <= validity.checked_ids
                                 and not _remaining_relation(c, validity) for c in active))
            composed = (composed_digests or {}).get((case_ids, indexes))
            if composed is not None and (len(composed) != 64
                    or any(c not in '0123456789abcdef' for c in composed)):
                raise PlanningError('Invalid composed semantic digest')
            unchanged = (len(active) == 1 and not invalid and not reassess
                         and (composed == target.evidence.digest
                              or (composed is None and (not indexes
                                  or (len(indexes) == 1
                                      and graphs[indexes[0]].digest == target.evidence.digest)))))
            if unchanged:
                action, reason = Action.NOOP, 'UNCHANGED_EVIDENCE'
            elif withdrawn:
                action, reason = Action.WITHDRAW, 'EVIDENCE_WITHDRAWN'
            elif (invalid and not indexes and not reassess
                  and not any(_remaining_relation(c, validity) for c in active)):
                action, reason = Action.NOOP, 'INCOMPLETE_VALIDITY'
            elif reassess:
                action, reason = Action.PROPOSE, 'SCORE_OR_POLICY_REASSESSMENT'
            elif len(active) > 1:
                action = Action.MERGE
            else:
                action = Action.UPDATE
            # New evidence joins an existing investigation automatically. Staff
            # judgments/exclusions are preserved by the publisher. Merging cases
            # or removing corrected facts still changes the existing scope and
            # requires the affected investigators' approval.
            added_members = any(graphs[i].member_ids - target.evidence.member_ids for i in indexes)
            additive_update = action == Action.UPDATE and not invalid and added_members
            if action not in (Action.NOOP, Action.PROPOSE) and not additive_update and any(
                    c.review_started_at is not None for c in active):
                action = Action.PROPOSE
            if invalid and reason == 'FLOW_EVIDENCE':
                reason = 'REPORT_CORRECTED'
        baselines = tuple(sorted(active + references, key=lambda c: c.alert_id))
        exclusions = frozenset().union(*(c.excluded_tx_ids for c in active))
        invalid_ids = frozenset().union(*(c.evidence.member_ids for c in active)) & validity.invalid_ids
        recipients = () if action == Action.NOOP else tuple(sorted({c.assignee_id for c in active}))
        plans.append(Plan(action, target.alert_id if target else None, case_ids, indexes,
                          tuple(sorted(referenced)), recipients, reason, baselines,
                          exclusions, invalid_ids))
    plans.sort(key=lambda p: (p.target_alert_id is None, p.target_alert_id or 0, p.graph_ids))
    affected_ids = [key for plan in plans for key in plan.case_ids]
    if len(affected_ids) != len(set(affected_ids)):
        raise PlanningError('A case occurs in more than one operation')
    contract = dict(plans=[plan.contract() for plan in plans],
                    graphDigests=[graph.digest for graph in graphs],
                    caseEvidence=[(key, canonical_cases[key].evidence.digest)
                                  for key in sorted(canonical_cases)],
                    composedDigests=[(list(key[0]), list(key[1]), value)
                                     for key, value in sorted((composed_digests or {}).items())])
    return PlanBatch(tuple(plans), _digest(contract), checks)
