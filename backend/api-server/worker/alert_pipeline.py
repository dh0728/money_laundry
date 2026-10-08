"""Frozen-input Alert construction and atomic, run-fenced evidence publication.

Model labels are annotations, never grouping conditions. All public account IDs
come from the frozen pseudonymous input; this module cannot read private names.
"""
from dataclasses import asdict
from datetime import datetime, timezone
from decimal import Decimal
from functools import lru_cache
from time import perf_counter
from collections import Counter, defaultdict
import hashlib
import json

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from flow_graph import (EdgeTable, FlowIndex, FlowPolicy, FlowGraph, Witness,
                        GraphBudgetExceeded, build_flow_graphs)
from frozen_input import StaleExecution
from model_publication import _lock
from result_collection import _checkpoint
from worker_transport import ProtocolError

POLICY = FlowPolicy()
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _build_graphs(rows, seeds):
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
        return build_flow_graphs(FlowIndex(edges), seeds, POLICY)
    except GraphBudgetExceeded as error:
        raise ProtocolError('Alert graph budget exceeded: ' + str(error)) from error


class AssigneeUnavailable(ProtocolError):
    pass


def _json(value):
    return json.loads(json.dumps(value, default=lambda v: str(v) if isinstance(v, (Decimal,))
                                else v.isoformat() if isinstance(v, datetime) else str(v)))


def _coverage(seeds, days):
    result = []
    for seed in seeds:
        reports = [dict(businessDate=date, **value) for date, value in sorted(days.items())]
        result.append(dict(txId=seed['txId'], days=reports))
    return result


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
        witnesses=[asdict(witness) for witness in graph.witnesses], seeds=seeds, transactions=members,
        limits=list(graph.limits), summary=dict(txCount=len(members), seedCount=len(seeds),
            totalAmountUsd=amounts, scoreMax=max(probabilities) if probabilities else None,
            firstTxAt=min(m['occurredAt'] for m in members), lastTxAt=max(m['occurredAt'] for m in members)),
        graph=dict(nodes=sorted(nodes.values(), key=lambda n: n['id']), edges=[dict(
            id=str(m['txId']), txId=m['txId'], **{'from': m['fromAccountId'], 'to': m['toAccountId']},
            amountUsd=m['amountUsd'], occurredAt=m['occurredAt'], role=m['role'],
            includedReasons=m['includedReasons']) for m in members])))


def _extend(old, additions):
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
    for evidence in additions:
        limits.update(evidence['limits'])
        witnesses.update(Witness(w['kind'], tuple(w['tx_ids'])) for w in evidence['witnesses'])
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
        tuple(sorted(witnesses, key=lambda w: (w.kind, w.tx_ids))), tuple(sorted(limits)))
    return _evidence(graph, rows, scores, seeds)


def _fingerprint(evidence):
    # Facts, scores and policy changes matter even when membership stays the same.
    # Coverage/check time and redundant rendered graph/summary are not semantic facts.
    body = {key: evidence[key] for key in
            ('policyVersion', 'policy', 'witnesses', 'seeds', 'transactions', 'limits')}
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


def _latest(connection, alert):
    return connection.execute('''SELECT v.version,v.fingerprint FROM review.alert_versions v
        JOIN analysis.runs r USING(run_id) JOIN analysis.jobs b ON b.job_id=r.job_id
        WHERE v.alert_id=%s AND r.status='COMPLETED' AND b.status='COMPLETED'
        ORDER BY v.version DESC LIMIT 1''', (alert,)).fetchone()


def _new_alert(connection, business_at, parent=None):
    row = connection.execute("SELECT u.user_id FROM core.users u JOIN core.assignable_staff s USING(user_id) ORDER BY u.last_assigned_at NULLS FIRST,u.user_id LIMIT 1 FOR UPDATE OF u").fetchone()
    if row is None:
        raise AssigneeUnavailable('Register a STAFF user before constructing Alerts')
    connection.execute('UPDATE core.users SET last_assigned_at=%s WHERE user_id=%s', (business_at,row[0]))
    return connection.execute('INSERT INTO review.alerts(assignee_id,parent_alert_id,created_at,assigned_at) VALUES(%s,%s,%s,%s) RETURNING alert_id',
                              (row[0], parent,business_at,business_at)).fetchone()[0]


def _plans(origins, graphs, rows, scores, seeds, timings=None):
    """Generate one evidence document at a time, in the original plan order."""
    by_seed = {}
    for index, graph in enumerate(graphs):
        for seed in graph.seed_ids:
            by_seed.setdefault(seed, []).append(index)
    evidence_for = lru_cache(maxsize=64)(lambda i: _evidence(graphs[i], rows, scores, seeds))
    consumed = set()
    for original, _, old in origins:
        started = perf_counter()
        indexes = sorted({index for seed in old['seeds']
                          for index in by_seed.get(seed['txId'], ())})
        evidence = _extend(old, (evidence_for(i) for i in indexes))
        consumed.update(seed['txId'] for seed in evidence['seeds'])
        if timings is not None:
            timings['evidenceBuild'] += (perf_counter() - started) * 1000
        yield original, evidence
    for index, graph in enumerate(graphs):
        if set(graph.seed_ids) - consumed:
            started = perf_counter()
            evidence = evidence_for(index)
            if timings is not None:
                timings['evidenceBuild'] += (perf_counter() - started) * 1000
            yield None, evidence


def _validate_baselines(connection, run_id):
    # Preserve ascending origin order and unpublished-before-version error priority.
    unpublished = connection.execute('''SELECT min(o.alert_id)
        FROM analysis.alert_origins o
        JOIN review.alerts a ON a.alert_id=o.alert_id OR a.parent_alert_id=o.alert_id
        JOIN review.alert_versions v ON v.alert_id=a.alert_id
        JOIN analysis.runs r ON r.run_id=v.run_id
        WHERE o.run_id=%s AND v.run_id<>%s AND r.status IN ('READY','ACTIVE')''',
        (run_id, run_id)).fetchone()[0]
    changed = connection.execute('''SELECT min(o.alert_id)
        FROM analysis.alert_origins o
        LEFT JOIN LATERAL (
            SELECT v.version FROM review.alert_versions v
            JOIN analysis.runs r USING(run_id) JOIN analysis.jobs b ON b.job_id=r.job_id
            WHERE v.alert_id=o.alert_id AND r.status='COMPLETED' AND b.status='COMPLETED'
            ORDER BY v.version DESC LIMIT 1
        ) latest ON true
        WHERE o.run_id=%s AND latest.version IS DISTINCT FROM o.version''',
        (run_id,)).fetchone()[0]
    if unpublished is not None and (changed is None or unpublished <= changed):
        raise StaleExecution('Another run has unpublished Alert evidence; resolve it and freeze new input')
    if changed is not None:
        raise ProtocolError('Alert baseline changed; a new input snapshot is required')


def _insert_members(connection, alert, version, members):
    # One SQL statement per bounded Alert, rather than a round trip for every row.
    payload = [dict({key: member[key] for key in ('txId', 'role', 'includedReasons')},
                    seed_risk=(member.get('scores') or {}).get('p_laundering')
                    if member['role'] == 'SEED' else None)
               for member in members]
    connection.execute('''INSERT INTO review.alert_transactions(alert_id,version,tx_id,role,reasons,seed_risk)
        SELECT %s,%s,m."txId",m.role,m."includedReasons",m.seed_risk
        FROM jsonb_to_recordset(%s::jsonb)
          AS m("txId" bigint,role text,"includedReasons" jsonb,seed_risk double precision)''',
        (alert, version, Jsonb(payload)))


def save_alerts(connection, execution):
    if not connection.autocommit:
        raise ProtocolError('Autocommit connection required')
    started = perf_counter()
    timings = {'evidenceBuild': 0.0}
    # Only immutable input is read during computation, without holding row locks.
    with connection.transaction(), connection.cursor(name='alert_input', row_factory=dict_row) as cursor:
        cursor.execute('SELECT * FROM analysis.input_transactions WHERE run_id=%s ORDER BY tx_id,input_role DESC', (execution.run_id,))
        cursor.itersize = 256
        rows = {r['tx_id']: r for r in cursor}
    threshold,business_at = connection.execute('SELECT threshold_value,business_at FROM analysis.jobs WHERE job_id=%s', (execution.job_id,)).fetchone()
    if threshold is None:
        raise ProtocolError('Frozen threshold is required')
    frozen_scores = connection.execute('''SELECT i.tx_id,i.scores,b.threshold_value
        FROM analysis.input_scores i JOIN analysis.runs r ON r.run_id=i.score_run_id
        JOIN analysis.jobs b ON b.job_id=r.job_id WHERE i.run_id=%s''',
        (execution.run_id,)).fetchall()
    scores = {key: score for key, score, _ in frozen_scores}
    thresholds = {key: value for key, _, value in frozen_scores}
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
    days = {day.isoformat(): dict(complete=complete, expectedBanks=expected, completeBanks=received, reports=reports)
            for day, expected, received, complete, reports in connection.execute(
                'SELECT business_date,expected_banks,complete_banks,complete,reports FROM analysis.input_coverage WHERE run_id=%s', (execution.run_id,)).fetchall()}
    timings['inputRead'] = (perf_counter() - started) * 1000
    candidate_started = perf_counter()
    if seeds and not days:
        raise ProtocolError('Frozen coverage is required')
    batch = _build_graphs(rows, seeds)
    timings['candidateBuild'] = (perf_counter() - candidate_started) * 1000
    publication_started = perf_counter()
    with connection.transaction():
        _lock(connection, execution, 'ALERTS')
        saved = connection.execute("SELECT artifact FROM analysis.stage_results WHERE run_id=%s AND stage='ALERTS' AND completed", (execution.run_id,)).fetchone()
        if saved:
            _checkpoint(connection, execution, 'ALERTS', saved[0])
            return
        baseline_started = perf_counter()
        _validate_baselines(connection, execution.run_id)
        timings['baselineCheck'] = (perf_counter() - baseline_started) * 1000
        changed, created, covered = set(), set(), set()
        with connection.cursor(name='alert_origin_evidence') as cursor:
            cursor.itersize = 1
            cursor.execute('SELECT o.alert_id,o.version,v.evidence FROM analysis.alert_origins o JOIN review.alert_versions v USING(alert_id,version) WHERE o.run_id=%s ORDER BY o.alert_id', (execution.run_id,))
            plans = _plans(cursor, batch.graphs, rows, scores, seeds, timings)
            for original, evidence in plans:
                if original is None:
                    original = _new_alert(connection,business_at)
                    created.add(original)
                covered.add(original)
                alert = original
                latest = _latest(connection, alert)
                fingerprint = _fingerprint(evidence)
                coverage = _coverage(evidence['seeds'], days)
                for item in coverage:
                    item['explorationLimits'] = evidence['limits']
                    if item['txId'] not in rows:
                        item['reason'] = 'SEED_NOT_ACTIVE_IN_SNAPSHOT'
                status = connection.execute('SELECT status FROM review.alerts WHERE alert_id=%s FOR UPDATE', (alert,)).fetchone()[0]
                if latest is not None and latest[1].strip() != fingerprint and status != 'OPEN':
                    children = connection.execute('SELECT alert_id FROM review.alerts WHERE parent_alert_id=%s ORDER BY alert_id', (original,)).fetchall()
                    existing = [(a, _latest(connection, a)) for (a,) in children]
                    same = next((a for a, v in existing if v and v[1].strip() == fingerprint), None)
                    if same is not None:
                        alert = same
                    else:
                        alert = _new_alert(connection,business_at,original)
                        created.add(alert)
                    latest = _latest(connection, alert)
                if latest is None or latest[1].strip() != fingerprint:
                    version = connection.execute('SELECT coalesce(max(version),0)+1 FROM review.alert_versions WHERE alert_id=%s', (alert,)).fetchone()[0]
                    connection.execute('INSERT INTO review.alert_versions VALUES(%s,%s,%s,%s,%s,now())',
                                       (alert, version, execution.run_id, fingerprint, Jsonb(evidence)))
                    _insert_members(connection, alert, version, evidence['transactions'])
                    changed.add(alert)
                for key in {original, alert}:
                    connection.execute('''INSERT INTO review.alert_coverage_checks
                        (alert_id,run_id,coverage,checked_at) VALUES(%s,%s,%s,clock_timestamp())
                        ON CONFLICT(alert_id,run_id) DO UPDATE SET coverage=excluded.coverage,
                        checked_at=excluded.checked_at''',
                        (key, execution.run_id, Jsonb(coverage)))
        connection.execute('UPDATE analysis.jobs SET alert_count=%s WHERE job_id=%s', (len(created), execution.job_id))
        timings['publication'] = (perf_counter() - publication_started) * 1000
        timings['totalBeforeCommit'] = (perf_counter() - started) * 1000
        _checkpoint(connection, execution, 'ALERTS', json.dumps(dict(run_id=str(execution.run_id),
                    policyVersion=POLICY.version, policyDigest=batch.policy_digest,
                    graphCount=len(batch.graphs), unassignedSeedCount=len(batch.unassigned),
                    unassignedReasons=dict(Counter(item.reason for item in batch.unassigned)),
                    rejectedRelationReasons=dict(Counter(item.reason for item in batch.rejected_relations)),
                    timingsMs={key: round(value, 3) for key, value in timings.items()},
                    createdAlertCount=len(created), updatedAlertCount=len(changed-created), checkedAlertCount=len(covered))))
