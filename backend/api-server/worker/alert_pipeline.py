"""Frozen-input flow construction and run-fenced publication plan preparation.

Model labels are annotations, never grouping conditions. All public account IDs
come from the frozen pseudonymous input; this module cannot read private names.
"""
from dataclasses import asdict
from datetime import datetime, timezone
from decimal import Decimal
from time import perf_counter
from collections import Counter, defaultdict
import hashlib
import json

from psycopg.rows import dict_row

from flow_graph import (EdgeTable, FlowIndex, FlowPolicy, FlowGraph, Witness,
                        GraphBudgetExceeded, build_flow_graphs)
from frozen_input import StaleExecution
from model_publication import _lock
from result_collection import _checkpoint
from worker_transport import ProtocolError

POLICY = FlowPolicy()
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _build_graphs(rows, seeds, seed_groups=()):
    """Translate public UUIDs to snapshot-local codes, preserving transaction IDs."""
    edges, accounts = EdgeTable(), {}
    for tx_id, row in sorted(rows.items()):
        occurred = row['occurred_at']
        if occurred.utcoffset() is None:
            raise ProtocolError('Frozen transaction time must include a timezone')
        delta = occurred.astimezone(timezone.utc) - EPOCH
        codes = []
        for side in ('from', 'to'):
            key = (row[side + '_bank_id'], str(row[side + '_account_id']))
            codes.append(accounts.setdefault(key, len(accounts) + 1))
        edges.append(tx_id, (delta.days * 86400 + delta.seconds) * 1_000_000
                     + delta.microseconds, *codes)
    try:
        return build_flow_graphs(FlowIndex(edges), seeds, POLICY, seed_groups=seed_groups)
    except GraphBudgetExceeded as error:
        raise ProtocolError('Alert graph budget exceeded: ' + str(error)) from error


def _json(value):
    return json.loads(json.dumps(value, default=lambda v: str(v) if isinstance(v, (Decimal,))
                                else v.isoformat() if isinstance(v, datetime) else str(v)))


def _coverage(seeds, days):
    # Every seed uses the same frozen calendar. Store that calendar once rather
    # than duplicating it thousands of times in large evidence versions.
    if not seeds:
        return []
    reports = [dict(businessDate=date, **value) for date, value in sorted(days.items())]
    return [dict(txIds=sorted(seed['txId'] for seed in seeds), days=reports)]


def _evidence(graph, rows, scores, seed_info):
    roles = {key: role for role, keys in (('SEED', graph.seed_ids),
             ('CONNECTION', graph.connection_ids), ('CONTEXT', graph.context_ids)) for key in keys}
    reasons = defaultdict(set)
    for witness in graph.witnesses:
        for key in witness.tx_ids:
            reasons[key].add(witness.kind)
    members, nodes = [], {}
    for tx_id, role in sorted(roles.items()):
        row = rows[tx_id]
        score = scores.get(tx_id)
        item = dict(txId=tx_id, occurredAt=row['occurred_at'].astimezone(timezone.utc).isoformat(),
                    fromAccountId=str(row['from_account_id']), toAccountId=str(row['to_account_id']),
                    fromBankId=row['from_bank_id'], toBankId=row['to_bank_id'],
                    amountReceived=str(row['amount_received']), receivingCurrency=row['receiving_currency'],
                    amountPaid=str(row['amount_paid']), paymentCurrency=row['payment_currency'],
                    amountUsd=str(row['amount_usd']), paymentFormat=row['payment_format'],
                    role=role, includedReasons=sorted(reasons[tx_id] | {role}), scores=score)
        members.append(item)
        for side in ('from', 'to'):
            key = item[side+'AccountId']
            node = nodes.setdefault(key, dict(id=key, kind='ACCOUNT', bankId=item[side+'BankId'],
                inCount=0, outCount=0, inAmountUsd=Decimal(0), outAmountUsd=Decimal(0)))
            direction = 'out' if side == 'from' else 'in'
            node[direction+'Count'] += 1
            node[direction+'AmountUsd'] += row['amount_usd']
    amounts = sum((Decimal(m['amountUsd']) for m in members), Decimal(0))
    probabilities = [s['p_laundering'] for m in members if (s := m['scores']) is not None]
    seeds = [seed_info[key] for key in graph.seed_ids]
    return _json(dict(policyVersion=POLICY.version, policy=asdict(POLICY),
        witnesses=[asdict(witness) for witness in graph.witnesses],
        boundaryWitnesses=[asdict(witness) for witness in graph.boundary_witnesses],
        seeds=seeds, transactions=members,
        limits=list(graph.limits), summary=dict(txCount=len(members), seedCount=len(seeds),
            totalAmountUsd=amounts, scoreMax=max(probabilities) if probabilities else None,
            firstTxAt=min(m['occurredAt'] for m in members), lastTxAt=max(m['occurredAt'] for m in members)),
        graph=dict(nodes=sorted(nodes.values(), key=lambda n: n['id']), edges=[dict(
            id=str(m['txId']), txId=m['txId'], **{'from': m['fromAccountId'], 'to': m['toAccountId']},
            amountUsd=m['amountUsd'], occurredAt=m['occurredAt'], role=m['role'],
            includedReasons=m['includedReasons']) for m in members])))


def _extend(old, additions, *, preserve_ids=()):
    """Compose immutable evidence versions without truncating flow witnesses.

    Case lifecycle is separate from graph construction. Existing historical
    members remain intact; oversized accumulated evidence fails atomically.
    """
    if old.get('policyVersion') != POLICY.version or 'witnesses' not in old:
        raise ProtocolError('Existing Alert evidence requires regeneration with the flow policy')
    members = {m['txId']: dict(m) for m in old['transactions']}
    seeds = {s['txId']: s for s in old['seeds']}
    limits = set(old['limits'])
    witnesses = {Witness(w['kind'], tuple(w['tx_ids'])) for w in old['witnesses']}
    boundaries = {Witness(w['kind'], tuple(w['tx_ids'])) for w in old.get('boundaryWitnesses', [])}
    for evidence in additions:
        limits.update(evidence['limits'])
        witnesses.update(Witness(w['kind'], tuple(w['tx_ids'])) for w in evidence['witnesses'])
        boundaries.update(Witness(w['kind'], tuple(w['tx_ids'])) for w in evidence.get('boundaryWitnesses', []))
        for item in evidence['transactions']:
            key = item['txId']
            if key not in members:
                members[key] = dict(item)
            else:
                previous = members[key]
                # A historical seed remains immutable until the case lifecycle
                # explicitly accepts its removal; do not pair its old seed
                # decision with a newly negative member score.
                if previous['role'] == 'SEED' and item['role'] != 'SEED':
                    continue
                roles = ('CONTEXT', 'CONNECTION', 'SEED')
                role = max((previous['role'], item['role']), key=roles.index)
                previous.update(item)
                previous['role'] = role
        seeds.update({s['txId']: s for s in evidence['seeds'] if s['txId'] in members})
    # Context is a selected view, not a mandatory extension. Retain every old
    # member; add only as much new context as fits the declared context budget.
    previous_ids = {m['txId'] for m in old['transactions']} | set(preserve_ids)
    retained_context = sum(m['role'] == 'CONTEXT' and k in previous_ids for k, m in members.items())
    context_slots = max(0, POLICY.max_context_edges - retained_context)
    for key in sorted(list(members)):
        if members[key]['role'] == 'CONTEXT' and key not in previous_ids:
            if context_slots:
                context_slots -= 1
            else:
                del members[key]
                limits.add('CONTEXT_SELECTION')
    if (sum(m['role'] != 'CONTEXT' for m in members.values()) > POLICY.max_core_edges
            or len(members) > POLICY.max_core_edges + POLICY.max_context_edges):
        raise ProtocolError('Accumulated Alert evidence exceeds graph budget')
    rows, scores = {}, {}
    for key, m in members.items():
        rows[key] = dict(occurred_at=datetime.fromisoformat(m['occurredAt']),
            from_account_id=m['fromAccountId'],to_account_id=m['toAccountId'],
            from_bank_id=m['fromBankId'],to_bank_id=m['toBankId'],amount_received=Decimal(m['amountReceived']),
            receiving_currency=m['receivingCurrency'],amount_paid=Decimal(m['amountPaid']),
            payment_currency=m['paymentCurrency'],amount_usd=Decimal(m['amountUsd']),payment_format=m['paymentFormat'])
        if m['scores'] is not None:
            scores[key] = m['scores']
    graph = FlowGraph(tuple(sorted(seeds)),
        tuple(k for k, m in sorted(members.items()) if m['role'] == 'CONNECTION'),
        tuple(k for k, m in sorted(members.items()) if m['role'] == 'CONTEXT'),
        tuple(sorted(witnesses, key=lambda w: (w.kind, w.tx_ids))), tuple(sorted(limits)),
        tuple(sorted(boundaries, key=lambda w: (w.kind, w.tx_ids))))
    return _evidence(graph, rows, scores, seeds)


def _fingerprint(evidence):
    # Facts, scores and policy changes matter even when membership stays the same.
    # Coverage/check time and redundant rendered graph/summary are not semantic facts.
    body = {key: evidence[key] for key in
            ('policyVersion', 'policy', 'witnesses', 'seeds', 'transactions', 'limits')}
    body['withdrawalReason'] = evidence.get('withdrawalReason')
    body['boundaryWitnesses'] = evidence.get('boundaryWitnesses', [])
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


def save_alerts(connection, execution):
    if not connection.autocommit:
        raise ProtocolError('Autocommit connection required')
    # Retry a successfully prepared stage without rebuilding the full ledger.
    saved = connection.execute("SELECT artifact FROM analysis.stage_results WHERE run_id=%s AND stage='ALERTS' AND completed", (execution.run_id,)).fetchone()
    if saved:
        with connection.transaction():
            _lock(connection, execution, 'ALERTS')
            saved = connection.execute("SELECT artifact FROM analysis.stage_results WHERE run_id=%s AND stage='ALERTS' AND completed", (execution.run_id,)).fetchone()
            if saved:
                connection.execute('UPDATE analysis.alert_plans SET execution_id=%s WHERE run_id=%s',
                                   (execution.execution_id, execution.run_id))
                _checkpoint(connection, execution, 'ALERTS', saved[0])
                return
    started = perf_counter()
    timings = {}
    # Only immutable input is read during computation, without holding row locks.
    with connection.transaction(), connection.cursor(name='alert_input', row_factory=dict_row) as cursor:
        cursor.execute('SELECT * FROM analysis.input_transactions WHERE run_id=%s ORDER BY tx_id,input_role DESC', (execution.run_id,))
        cursor.itersize = 256
        rows = {r['tx_id']: r for r in cursor}
    threshold,business_at = connection.execute('SELECT threshold_value,business_at FROM analysis.jobs WHERE job_id=%s', (execution.job_id,)).fetchone()
    if threshold is None:
        raise ProtocolError('Frozen threshold is required')
    scores, thresholds = {}, {}
    with connection.transaction(), connection.cursor(name='alert_scores') as cursor:
        cursor.execute('''SELECT i.tx_id,i.scores,b.threshold_value
            FROM analysis.input_scores i JOIN analysis.runs r ON r.run_id=i.score_run_id
            JOIN analysis.jobs b ON b.job_id=r.job_id WHERE i.run_id=%s''', (execution.run_id,))
        for key, score, value in cursor:
            scores[key], thresholds[key] = score, value
    current = dict(connection.execute("SELECT tx_id,to_jsonb(s)-'run_id'-'tx_id'-'job_id' FROM analysis.scores s WHERE run_id=%s", (execution.run_id,)).fetchall())
    targets = {key for key, row in rows.items() if row['input_role'] == 'TARGET'}
    if targets != set(current):
        raise ProtocolError('Every frozen TARGET requires current-run scores')
    scores.update(current)
    thresholds.update({key: threshold for key in current})
    if any(value is None for value in thresholds.values()):
        raise ProtocolError('Every frozen score requires its original threshold')
    seeds = {key: dict(txId=key,
                       occurredAt=rows[key]['occurred_at'].astimezone(timezone.utc).isoformat(),
                       score=value['p_laundering'], threshold=float(thresholds[key]))
             for key, value in scores.items() if value['p_laundering'] >= thresholds[key]}
    del current, thresholds, targets
    days = {day.isoformat(): dict(complete=complete, expectedBanks=expected, completeBanks=received, reports=reports)
            for day, expected, received, complete, reports in connection.execute(
                'SELECT business_date,expected_banks,complete_banks,complete,reports FROM analysis.input_coverage WHERE run_id=%s', (execution.run_id,)).fetchall()}
    timings['inputRead'] = (perf_counter() - started) * 1000
    candidate_started = perf_counter()
    if seeds and not days:
        raise ProtocolError('Frozen coverage is required')
    seed_groups = []
    for owned, core, members in connection.execute('''SELECT v.evidence->'seeds',
        (SELECT jsonb_agg(t->'txId') FROM jsonb_array_elements(v.evidence->'transactions') t
         WHERE t->>'role'<>'CONTEXT'),
        (SELECT jsonb_agg(t->'txId') FROM jsonb_array_elements(v.evidence->'transactions') t)
        FROM analysis.alert_origins o JOIN review.alerts a USING(alert_id)
        JOIN review.alert_versions v ON v.alert_id=o.alert_id AND v.version=o.version
        WHERE o.run_id=%s AND a.status='OPEN' AND a.merged_into_alert_id IS NULL
        ORDER BY a.alert_id''', (execution.run_id,)):
        seed_groups.append(([s['txId'] for s in owned], core or [], members or []))
    batch = _build_graphs(rows, seeds, seed_groups)
    timings['candidateBuild'] = (perf_counter() - candidate_started) * 1000
    with connection.transaction():
        _lock(connection, execution, 'ALERTS')
        saved = connection.execute("SELECT artifact FROM analysis.stage_results WHERE run_id=%s AND stage='ALERTS' AND completed", (execution.run_id,)).fetchone()
        if saved:
            connection.execute('UPDATE analysis.alert_plans SET execution_id=%s WHERE run_id=%s',
                               (execution.execution_id, execution.run_id))
            _checkpoint(connection, execution, 'ALERTS', saved[0])
            return
        from alert_plan_preparation import prepare_plans
        connection.execute('SELECT pg_advisory_xact_lock(17002001)')
        prepare_plans(connection, execution, batch, rows, scores, seeds, days,
            dict(run_id=str(execution.run_id), policyVersion=POLICY.version,
                 policyDigest=batch.policy_digest, graphCount=len(batch.graphs),
                 unassignedSeedCount=len(batch.unassigned),
                 unassignedReasons=dict(Counter(item.reason for item in batch.unassigned)),
                 rejectedRelationReasons=dict(Counter(item.reason for item in batch.rejected_relations)),
                 timingsMs={key: round(value, 3) for key, value in timings.items()}))
