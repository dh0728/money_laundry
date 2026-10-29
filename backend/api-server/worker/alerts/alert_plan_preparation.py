"""Prepare lifecycle operations; review data is read-only for the worker."""
from collections import Counter
import gc
import hashlib
import json
from time import perf_counter

from psycopg.rows import dict_row

from alerts.alert_lifecycle import CaseSnapshot, Evidence, Validity, build_case_plans
from alerts.flow_graph import Witness
from common.frozen_input import StaleExecution
from common.run_fence import save_checkpoint

# Plans stored per COPY; bounds the serialized payloads held at once.
PLAN_BATCH = 256


def indexed(evidence, fingerprint):
    roles = {role: frozenset(m['txId'] for m in evidence['transactions'] if m['role'] == role)
             for role in ('SEED', 'CONNECTION', 'CONTEXT')}
    return Evidence(fingerprint, roles['SEED'], roles['CONNECTION'], roles['CONTEXT'],
                    tuple(Witness(w['kind'], tuple(w['tx_ids'])) for w in evidence['witnesses']))


class _Steps:
    """Exclusive wall time (ms) and call counts of the planning steps.

    Each ``lap`` charges the time since the previous lap to one step, so the steps
    add up to the whole preparation. Garbage-collector pauses are measured
    separately and are already included in the step that triggered them.
    """
    def __init__(self):
        self.ms, self.counts, self.gc_counts = Counter(), Counter(), Counter()
        self.gc_ms = 0.0
        self._mark = self._gc_started = perf_counter()

    def lap(self, step, count=0):
        now = perf_counter()
        self.ms[step] += (now - self._mark) * 1000
        self._mark = now
        if count:
            self.counts[step] += count

    def _on_gc(self, phase, info):
        if phase == 'start':
            self._gc_started = perf_counter()
        else:
            self.gc_ms += (perf_counter() - self._gc_started) * 1000
            self.gc_counts[f"gen{info['generation']}"] += 1

    def __enter__(self):
        gc.callbacks.append(self._on_gc)
        return self

    def __exit__(self, *_):
        gc.callbacks.remove(self._on_gc)


def prepare_plans(connection, execution, batch, rows, scores, seeds, days, metadata, *, case_ids=None, positive=None):
    """Plan the run's graphs against the published Alerts in case_ids (every Alert when None).

    ``positive`` are the scored transactions at or above their threshold; a case seed scored
    below it is reassessed. Without it the run's seeds stand in (every positive was a seed).
    """
    with _Steps() as steps:
        _prepare_plans(connection, execution, batch, rows, scores, seeds, days, metadata, steps,
                       sorted(case_ids) if case_ids is not None else None,
                       frozenset(seeds) if positive is None else positive)


def _prepare_plans(connection, execution, batch, rows, scores, seeds, days, metadata, steps, case_ids, positive):
    started = perf_counter()
    # Imported here because the pipeline calls this only after constructing its
    # frozen graph batch. These helpers have no persistence side effects.
    from alerts.alert_pipeline import _evidence, _extend, _fingerprint, _member_digest, _coverage, POLICY
    # Use a dict cursor explicitly; never depend on the caller's row factory.
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''SELECT a.*,jsonb_build_object(
              'transactions',coalesce((SELECT jsonb_agg(jsonb_build_object('txId',t->'txId','role',t->'role'))
                FROM jsonb_array_elements(v.evidence->'transactions') t),'[]'::jsonb),
              'witnesses',v.evidence->'witnesses') AS evidence,v.fingerprint,o.version,
              v.evidence->>'policyVersion' AS policy_version
            FROM analysis.run_alert_origins o JOIN review.alerts a USING(alert_id)
            JOIN review.alert_versions v ON v.alert_id=o.alert_id AND v.version=o.version
            WHERE o.run_id=%s AND (%s::bigint[] IS NULL OR o.alert_id=ANY(%s)) ORDER BY a.alert_id''',
            (execution.run_id, case_ids, case_ids))
        raw_cases = cursor.fetchall()
    steps.lap('caseRead', len(raw_cases))
    if any(c['version'] != c['published_version'] for c in raw_cases):
        raise StaleExecution('Published input changed; freeze a new input snapshot')
    if connection.execute('''SELECT EXISTS(SELECT 1 FROM review.alerts a
        WHERE published_version IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM analysis.run_alert_origins o WHERE o.run_id=%s AND o.alert_id=a.alert_id))''',
        (execution.run_id,)).fetchone()[0]:
        raise StaleExecution('Newer Alert publication is outside this frozen input')
    ancestors = {}
    for source, target in connection.execute('''WITH RECURSIVE ancestry(source,target) AS (
        SELECT source_alert_id,target_alert_id FROM review.alert_lineage WHERE kind='FOLLOWUP_OF'
          AND (%s::bigint[] IS NULL OR source_alert_id=ANY(%s))
        UNION SELECT a.source,l.target_alert_id FROM ancestry a JOIN review.alert_lineage l
          ON l.source_alert_id=a.target AND l.kind='FOLLOWUP_OF') SELECT source,target FROM ancestry''',
            (case_ids, case_ids)):
        ancestors.setdefault(source, set()).add(target)
    excluded = {}
    for alert, key in connection.execute('''SELECT alert_id,tx_id FROM review.alert_members WHERE state='EXCLUDED'
            AND (%s::bigint[] IS NULL OR alert_id=ANY(%s))''', (case_ids, case_ids)):
        excluded.setdefault(alert, set()).add(key)
    steps.lap('lineageRead')
    cases = [CaseSnapshot(c['alert_id'], c['version'], c['revision'], c['assignee_id'],
              c['created_at'], c['status'], c['review_started_at'], indexed(c['evidence'], c['fingerprint'].strip()),
              c['merged_into_alert_id'], frozenset(ancestors.get(c['alert_id'], ())),
              frozenset(excluded.get(c['alert_id'], ())) &
              frozenset(m['txId'] for m in c['evidence']['transactions']),
              policy_version=c['policy_version']) for c in raw_cases]
    by_id = {case.alert_id: case for case in cases}
    del raw_cases
    steps.lap('caseIndex')
    members = None if case_ids is None else sorted({key for c in cases for key in c.evidence.member_ids})
    facts = dict(connection.execute('''SELECT tx_id,integration_status FROM analysis.run_fact_checks
        WHERE run_id=%s AND (%s::bigint[] IS NULL OR tx_id=ANY(%s))''', (execution.run_id, members, members)).fetchall())
    checked = frozenset(key for key, state in facts.items() if state in ('ACTIVE', 'SUPERSEDED'))
    invalid = frozenset(key for key, state in facts.items() if state == 'SUPERSEDED')
    reassessed = frozenset(key for c in cases for key in c.evidence.seed_ids
                           if key in scores and key not in positive and key not in invalid)
    validity = Validity(checked, invalid, reassessed)
    steps.lap('factRead', len(facts))
    graphs = []
    for graph in batch.graphs:
        # Digests read only the semantic keys; the full document is rendered for payloads.
        doc = _evidence(graph, rows, scores, seeds, batch.account_keys, light=True)
        steps.lap('graphRender', 1)
        graphs.append(indexed(doc, _fingerprint(doc)))
        steps.lap('graphFingerprint', 1)
    doc = None
    first = build_case_plans(cases, graphs, validity=validity, policy_version=POLICY.version)
    steps.lap('firstPass', len(first.plans))

    def published_doc(key):
        # Composition re-renders graph and summary from the members; never ship them.
        return connection.execute('''SELECT evidence-'graph'-'summary' FROM review.alert_versions
            WHERE alert_id=%s AND version=%s''', (key, by_id[key].published_version)).fetchone()[0]

    def compose(plan, step, light=False, member_digests=None):
        # Steps are charged per caller ('digest' before, 'payload' after the second pass).
        if not plan.case_ids and len(plan.graph_ids) == 1:
            doc = _evidence(batch.graphs[plan.graph_ids[0]], rows, scores, seeds, batch.account_keys,
                            light=light)
            steps.lap(step + 'Render', 1)
            return doc
        # Retain only role/relation indexes across cases; fetch full immutable
        # documents for this operation, never all historical rendered graphs.
        sources = [published_doc(key) for key in plan.case_ids]
        steps.lap(step + 'Fetch', len(plan.case_ids))
        if member_digests is not None:
            # Taken before the cleaning below edits the published documents in place.
            member_digests.extend(_member_digest(source) for source in sources)
            steps.lap('memberDigest', len(sources))
        sources.extend(_evidence(batch.graphs[i], rows, scores, seeds, batch.account_keys, light=light)
                       for i in plan.graph_ids)
        steps.lap(step + 'Render', len(plan.graph_ids))
        if not sources:
            return None
        cleaned = []
        for source in sources:
            source['transactions'] = [m for m in source['transactions'] if m['txId'] not in invalid]
            source['seeds'] = [s for s in source['seeds'] if s['txId'] not in invalid | reassessed]
            live_seeds = {s['txId'] for s in source['seeds']}
            source['witnesses'] = [w for w in source['witnesses']
                if not set(w['tx_ids']) & invalid and set(w['tx_ids']) & live_seeds]
            source['boundaryWitnesses'] = [w for w in source.get('boundaryWitnesses', [])
                if not set(w['tx_ids']) & invalid]
            core = {key for w in source['witnesses'] for key in w['tx_ids']}
            source['seeds'] = [s for s in source['seeds'] if s['txId'] in core]
            for member in source['transactions']:
                key = member['txId']
                if key not in core:
                    member['role'] = 'CONTEXT'
                elif key not in live_seeds:
                    member['role'] = 'CONNECTION'
                if key in reassessed:
                    member['scores'] = scores[key]
            if source['seeds']:
                cleaned.append(source)
        if not cleaned:
            doc = dict(policyVersion=POLICY.version, policy=sources[0]['policy'], witnesses=[],
                seeds=[], transactions=[], limits=[], withdrawalReason=plan.reason,
                summary=dict(txCount=0, seedCount=0, totalAmountUsd='0', scoreMax=None,
                             firstTxAt=None, lastTxAt=None), graph=dict(nodes=[], edges=[]))
        else:
            doc = _extend(cleaned[0], cleaned[1:], light=light)
        steps.lap(step + 'Extend', 1)
        return doc

    digests, unchanged = {}, set()
    for plan in first.plans:
        key = (plan.case_ids, plan.graph_ids)
        if plan.reason in ('UNCHANGED_EVIDENCE', 'FROZEN_LEGACY'):
            # A frozen legacy case is never composed: its evidence predates this policy.
            digests[key] = by_id[plan.case_ids[0]].evidence.digest
            continue
        # The same members and facts described by other relations: no new version (N7).
        # The published side is digested from the document fetched for composition.
        published = [] if len(plan.case_ids) == 1 and plan.graph_ids else None
        doc = compose(plan, 'digest', light=True, member_digests=published)
        if doc is None:
            continue
        digests[key] = _fingerprint(doc)
        steps.lap('digestFingerprint', 1)
        if published is not None and _member_digest(doc) == published[0]:
            unchanged.add(key)
        steps.lap('memberDigest')
    # Keep only digests between planning passes, not a second full copy of every
    # historical/new graph. Serialize one operation at a time below.
    doc = None
    result = build_case_plans(cases, graphs, validity=validity, composed_digests=digests,
                              unchanged_members=frozenset(unchanged), policy_version=POLICY.version)
    steps.lap('secondPass', len(result.plans))
    generation = connection.execute('''SELECT coalesce(max(build_generation),0)+1
        FROM analysis.alert_plans WHERE run_id=%s''', (execution.run_id,)).fetchone()[0]
    connection.execute('DELETE FROM analysis.alert_plans WHERE run_id=%s', (execution.run_id,))
    steps.lap('delete')
    aggregate, pending = hashlib.sha256(), []

    def store():
        # One COPY per bounded batch; composition needs the connection between batches.
        with connection.cursor() as cursor, cursor.copy('''COPY analysis.alert_plans
                (run_id,plan_key,execution_id,build_generation,plan_digest,action,payload) FROM STDIN''') as copy:
            for row in pending:
                copy.write_row(row)
        steps.lap('insert', len(pending))
        pending.clear()

    for key, plan in enumerate(result.plans):
        payload = plan.contract()
        doc = None if plan.action == 'NOOP' else compose(plan, 'payload')
        payload['evidence'] = doc
        payload['fingerprint'] = digests.get((plan.case_ids, plan.graph_ids))
        coverage_seeds = (doc['seeds'] if doc else
            [dict(txId=key) for key in sorted(set().union(
                *(by_id[key].evidence.seed_ids for key in plan.case_ids),
                *(graphs[i].seed_ids for i in plan.graph_ids)))])
        payload['coverage'] = _coverage(coverage_seeds, days)
        serialized = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
        digest = hashlib.sha256(serialized.encode()).hexdigest()
        aggregate.update(f'{key}:{digest}\n'.encode())
        steps.lap('payloadSerialize', 1)
        pending.append((execution.run_id, key, execution.execution_id, generation, digest, str(plan.action),
                        serialized))
        if len(pending) == PLAN_BATCH:
            store()
    if pending:
        store()
    metadata.update(planCount=len(result.plans), planDigest=aggregate.hexdigest(),
                    buildGeneration=generation, publication='PREPARED')
    # Step names are prefixed so they never collide with the stage-level timings.
    timings = metadata.setdefault('timingsMs', {})
    timings.update({'plan' + step[0].upper() + step[1:]: round(value, 3) for step, value in steps.ms.items()})
    timings['planGcPause'] = round(steps.gc_ms, 3)
    timings['planPreparation'] = round((perf_counter() - started) * 1000, 3)
    metadata.update(planActions=dict(sorted(Counter(str(plan.action) for plan in result.plans).items())),
                    planStepCounts=dict(sorted(steps.counts.items())),
                    planGcCollections=dict(sorted(steps.gc_counts.items())))
    save_checkpoint(connection, execution, 'ALERTS', json.dumps(metadata))
