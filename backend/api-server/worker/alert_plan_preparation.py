"""Prepare lifecycle operations; review data is read-only for the worker."""
import hashlib
import json
from time import perf_counter

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
    started = perf_counter()
    # Imported here because the pipeline calls this only after constructing its
    # frozen graph batch. These helpers have no persistence side effects.
    from alert_pipeline import _evidence, _extend, _fingerprint, _coverage, POLICY
    # Use a dict cursor explicitly; never depend on the caller's row factory.
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''SELECT a.*,jsonb_build_object(
              'transactions',coalesce((SELECT jsonb_agg(jsonb_build_object('txId',t->'txId','role',t->'role'))
                FROM jsonb_array_elements(v.evidence->'transactions') t),'[]'::jsonb),
              'witnesses',v.evidence->'witnesses') AS evidence,v.fingerprint,o.version
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
    by_id = {case.alert_id: case for case in cases}
    del raw_cases
    facts = dict(connection.execute('SELECT tx_id,integration_status FROM analysis.alert_fact_checks WHERE run_id=%s',
                                    (execution.run_id,)).fetchall())
    checked = frozenset(key for key, state in facts.items() if state in ('ACTIVE', 'SUPERSEDED'))
    invalid = frozenset(key for key, state in facts.items() if state == 'SUPERSEDED')
    reassessed = frozenset(key for c in cases for key in c.evidence.seed_ids
                           if key in scores and key not in seeds and key not in invalid)
    validity = Validity(checked, invalid, reassessed)
    graphs = []
    for graph in batch.graphs:
        doc = _evidence(graph, rows, scores, seeds)
        graphs.append(indexed(doc, _fingerprint(doc)))
    doc = None
    first = build_case_plans(cases, graphs, validity=validity)

    def compose(plan):
        if not plan.case_ids and len(plan.graph_ids) == 1:
            return _evidence(batch.graphs[plan.graph_ids[0]], rows, scores, seeds)
        # Retain only role/relation indexes across cases; fetch full immutable
        # documents for this operation, never all historical rendered graphs.
        sources = [connection.execute('''SELECT evidence FROM review.alert_versions
            WHERE alert_id=%s AND version=%s''', (key, by_id[key].published_version)).fetchone()[0]
            for key in plan.case_ids]
        sources.extend(_evidence(batch.graphs[i], rows, scores, seeds) for i in plan.graph_ids)
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
            return dict(policyVersion=POLICY.version, policy=sources[0]['policy'], witnesses=[],
                seeds=[], transactions=[], limits=[], withdrawalReason=plan.reason,
                summary=dict(txCount=0, seedCount=0, totalAmountUsd='0', scoreMax=None,
                             firstTxAt=None, lastTxAt=None), graph=dict(nodes=[], edges=[]))
        preserved = {tx_id for key in plan.case_ids for tx_id in by_id[key].evidence.member_ids
                     if tx_id not in invalid}
        return _extend(cleaned[0], cleaned[1:], preserve_ids=preserved)

    digests = {}
    for plan in first.plans:
        if plan.reason == 'UNCHANGED_EVIDENCE':
            digests[(plan.case_ids, plan.graph_ids)] = by_id[plan.case_ids[0]].evidence.digest
            continue
        doc = compose(plan)
        if doc is not None:
            digests[(plan.case_ids, plan.graph_ids)] = _fingerprint(doc)
    # Keep only digests between planning passes, not a second full copy of every
    # historical/new graph. Serialize one operation at a time below.
    doc = None
    result = build_case_plans(cases, graphs, validity=validity, composed_digests=digests)
    generation = connection.execute('''SELECT coalesce(max(build_generation),0)+1
        FROM analysis.alert_plans WHERE run_id=%s''', (execution.run_id,)).fetchone()[0]
    connection.execute('DELETE FROM analysis.alert_plans WHERE run_id=%s', (execution.run_id,))
    aggregate = hashlib.sha256()
    for key, plan in enumerate(result.plans):
        payload = plan.contract()
        doc = None if plan.action == 'NOOP' else compose(plan)
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
        connection.execute('''INSERT INTO analysis.alert_plans
            (run_id,plan_key,execution_id,build_generation,plan_digest,action,payload)
            VALUES(%s,%s,%s,%s,%s,%s,%s)''',
            (execution.run_id, key, execution.execution_id, generation, digest, str(plan.action), serialized))
    metadata.update(planCount=len(result.plans), planDigest=aggregate.hexdigest(),
                    buildGeneration=generation, publication='PREPARED')
    metadata.setdefault('timingsMs', {})['planPreparation'] = round((perf_counter() - started) * 1000, 3)
    _checkpoint(connection, execution, 'ALERTS', json.dumps(metadata))
