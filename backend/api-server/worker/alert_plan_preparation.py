"""Prepare lifecycle operations; review data is read-only for the worker."""
from copy import deepcopy
import hashlib
import json

from psycopg.rows import dict_row

from alert_lifecycle import CaseSnapshot, Evidence, Validity, build_case_plans
from flow_graph import Witness
from frozen_input import StaleExecution
from result_collection import _checkpoint


def indexed(evidence, fingerprint):
    roles = {role: frozenset(m['txId'] for m in evidence['transactions'] if m['role'] == role)
             for role in ('SEED', 'CONNECTION', 'CONTEXT')}
    return Evidence(fingerprint, roles['SEED'], roles['CONNECTION'], roles['CONTEXT'],
                    tuple(Witness(w['kind'], tuple(w['tx_ids'])) for w in evidence['witnesses']))


def prepare_plans(connection, execution, batch, rows, scores, seeds, days, metadata):
    # Imported here because the pipeline calls this only after constructing its
    # frozen graph batch. These helpers have no persistence side effects.
    from alert_pipeline import _evidence, _extend, _fingerprint, _coverage, POLICY
    # Use a dict cursor explicitly; never depend on the caller's row factory.
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''SELECT a.*,v.evidence,v.fingerprint,o.version
            FROM analysis.alert_origins o JOIN review.alerts a USING(alert_id)
            JOIN review.alert_versions v ON v.alert_id=o.alert_id AND v.version=o.version
            WHERE o.run_id=%s ORDER BY a.alert_id''', (execution.run_id,))
        raw_cases = cursor.fetchall()
    if any(c['version'] != c['published_version'] for c in raw_cases):
        raise StaleExecution('Published input changed; freeze a new input snapshot')
    if connection.execute('''SELECT EXISTS(SELECT 1 FROM review.alerts a
        WHERE published_version IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM analysis.alert_origins o WHERE o.run_id=%s AND o.alert_id=a.alert_id))''',
        (execution.run_id,)).fetchone()[0]:
        raise StaleExecution('Newer Alert publication is outside this frozen input')
    ancestors = {}
    for source, target in connection.execute('''WITH RECURSIVE ancestry(source,target) AS (
        SELECT source_alert_id,target_alert_id FROM review.alert_lineage WHERE kind='FOLLOWUP_OF'
        UNION SELECT a.source,l.target_alert_id FROM ancestry a JOIN review.alert_lineage l
          ON l.source_alert_id=a.target AND l.kind='FOLLOWUP_OF') SELECT source,target FROM ancestry'''):
        ancestors.setdefault(source, set()).add(target)
    excluded = {}
    for alert, key in connection.execute("SELECT alert_id,tx_id FROM review.alert_members WHERE state='EXCLUDED'"):
        excluded.setdefault(alert, set()).add(key)
    cases = [CaseSnapshot(c['alert_id'], c['version'], c['revision'], c['assignee_id'],
              c['created_at'], c['status'], c['review_started_at'], indexed(c['evidence'], c['fingerprint'].strip()),
              c['merged_into_alert_id'], frozenset(ancestors.get(c['alert_id'], ())),
              frozenset(excluded.get(c['alert_id'], ())) &
              frozenset(m['txId'] for m in c['evidence']['transactions'])) for c in raw_cases]
    old = {c['alert_id']: c['evidence'] for c in raw_cases}
    facts = dict(connection.execute('SELECT tx_id,integration_status FROM analysis.alert_fact_checks WHERE run_id=%s',
                                    (execution.run_id,)).fetchall())
    checked = frozenset(key for key, state in facts.items() if state in ('ACTIVE', 'SUPERSEDED'))
    invalid = frozenset(key for key, state in facts.items() if state == 'SUPERSEDED')
    reassessed = frozenset(key for c in cases for key in c.evidence.seed_ids
                           if key in scores and key not in seeds and key not in invalid)
    validity = Validity(checked, invalid, reassessed)
    documents = [_evidence(graph, rows, scores, seeds) for graph in batch.graphs]
    graphs = [indexed(doc, _fingerprint(doc)) for doc in documents]
    first = build_case_plans(cases, graphs, validity=validity)

    def compose(plan):
        sources = [deepcopy(old[key]) for key in plan.case_ids]
        sources.extend(documents[i] for i in plan.graph_ids)
        if not sources:
            return None
        cleaned = []
        for source in sources:
            source = deepcopy(source)
            source['transactions'] = [m for m in source['transactions'] if m['txId'] not in invalid]
            source['seeds'] = [s for s in source['seeds'] if s['txId'] not in invalid | reassessed]
            live_seeds = {s['txId'] for s in source['seeds']}
            source['witnesses'] = [w for w in source['witnesses']
                if not set(w['tx_ids']) & invalid and set(w['tx_ids']) & live_seeds]
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
            return dict(policyVersion=POLICY.version, policy=sources[0]['policy'], witnesses=[],
                seeds=[], transactions=[], limits=[], withdrawalReason=plan.reason,
                summary=dict(txCount=0, seedCount=0, totalAmountUsd='0', scoreMax=None,
                             firstTxAt=None, lastTxAt=None), graph=dict(nodes=[], edges=[]))
        return _extend(cleaned[0], cleaned[1:])

    composed = {(plan.case_ids, plan.graph_ids): compose(plan) for plan in first.plans}
    digests = {key: _fingerprint(doc) for key, doc in composed.items() if doc is not None}
    result = build_case_plans(cases, graphs, validity=validity, composed_digests=digests)
    generation = connection.execute('''SELECT coalesce(max(build_generation),0)+1
        FROM analysis.alert_plans WHERE run_id=%s''', (execution.run_id,)).fetchone()[0]
    connection.execute('DELETE FROM analysis.alert_plans WHERE run_id=%s', (execution.run_id,))
    aggregate = hashlib.sha256()
    for key, plan in enumerate(result.plans):
        payload = plan.contract()
        doc = composed[(plan.case_ids, plan.graph_ids)]
        payload['evidence'] = doc
        payload['fingerprint'] = _fingerprint(doc) if doc else None
        payload['coverage'] = _coverage(doc['seeds'] if doc else [], days)
        serialized = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
        digest = hashlib.sha256(serialized.encode()).hexdigest()
        aggregate.update(f'{key}:{digest}\n'.encode())
        connection.execute('''INSERT INTO analysis.alert_plans
            (run_id,plan_key,execution_id,build_generation,plan_digest,action,payload)
            VALUES(%s,%s,%s,%s,%s,%s,%s)''',
            (execution.run_id, key, execution.execution_id, generation, digest, str(plan.action), serialized))
    metadata.update(planCount=len(result.plans), planDigest=aggregate.hexdigest(),
                    buildGeneration=generation, publication='PREPARED')
    _checkpoint(connection, execution, 'ALERTS', json.dumps(metadata))
