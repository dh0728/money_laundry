"""Frozen-input Alert construction and atomic, run-fenced evidence publication.

Model labels are annotations, never grouping conditions. All public account IDs
come from the frozen pseudonymous input; this module cannot read private names.
"""
from datetime import datetime, timedelta
from decimal import Decimal
import hashlib
import json
from zoneinfo import ZoneInfo

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from alert_builder import Candidate, Membership, Policy, Transaction, build_candidates
from frozen_input import StaleExecution
from model_publication import _lock
from result_collection import _checkpoint
from worker_transport import ProtocolError

SEOUL = ZoneInfo('Asia/Seoul')
POLICY = Policy('daily-seed-link-v2', 1, timedelta(hours=24), timedelta(hours=24), 2, 100, 100)


class AssigneeUnavailable(ProtocolError):
    pass


def _json(value):
    return json.loads(json.dumps(value, default=lambda v: str(v) if isinstance(v, (Decimal,))
                                else v.isoformat() if isinstance(v, datetime) else str(v)))


def _coverage(seeds, days):
    result = []
    for seed in seeds:
        time = datetime.fromisoformat(seed['occurredAt'])
        low, high = time - POLICY.before, time + POLICY.after
        date, last = low.astimezone(SEOUL).date(), high.astimezone(SEOUL).date()
        reports = []
        while date <= last:
            reports.append(dict(businessDate=date.isoformat(), **days.get(date.isoformat(),
                dict(complete=False, expectedBanks=0, completeBanks=0, reports=[]))))
            date += timedelta(days=1)
        forward = [d for d in reports if d['businessDate'] >= time.astimezone(SEOUL).date().isoformat()]
        result.append(dict(txId=seed['txId'], windowStart=low.isoformat(), windowEnd=high.isoformat(),
                           days=reports, forwardComplete=all(d['complete'] for d in forward)))
    return result


def _evidence(candidate, rows, scores, seed_info):
    members, nodes = [], {}
    for member in candidate.transactions:
        row = rows[member.tx_id]
        score = scores.get(member.tx_id)
        item = dict(txId=member.tx_id, occurredAt=row['occurred_at'].isoformat(),
                    fromAccountId=str(row['from_account_id']), toAccountId=str(row['to_account_id']),
                    fromBankId=row['from_bank_id'], toBankId=row['to_bank_id'],
                    amountReceived=str(row['amount_received']), receivingCurrency=row['receiving_currency'],
                    amountPaid=str(row['amount_paid']), paymentCurrency=row['payment_currency'],
                    amountUsd=str(row['amount_usd']), paymentFormat=row['payment_format'],
                    role=member.role, includedReasons=list(member.reasons), scores=score)
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
    seeds = [seed_info[key] for key in candidate.seed_ids]
    return _json(dict(policyVersion=candidate.policy_version, seeds=seeds, transactions=members,
        limits=list(candidate.limits), summary=dict(txCount=len(members), seedCount=len(seeds),
            totalAmountUsd=amounts, scoreMax=max(probabilities) if probabilities else None,
            firstTxAt=min(m['occurredAt'] for m in members), lastTxAt=max(m['occurredAt'] for m in members)),
        graph=dict(nodes=sorted(nodes.values(), key=lambda n: n['id']), edges=[dict(
            id=str(m['txId']), txId=m['txId'], **{'from': m['fromAccountId'], 'to': m['toAccountId']},
            amountUsd=m['amountUsd'], occurredAt=m['occurredAt'], role=m['role'],
            includedReasons=m['includedReasons']) for m in members])))


def _extend(old, additions):
    """Retain investigated facts; one origin produces at most one version per run.

    Existing cases are not merged. New rows compete only for remaining capacity;
    a new seed that does not fit remains eligible for its own initial candidate.
    """
    members = {m['txId']: dict(m) for m in old['transactions']}
    seeds = {s['txId']: s for s in old['seeds']}
    limits = set(old['limits'])
    for evidence in additions:
        limits.update(evidence['limits'])
        for item in evidence['transactions']:
            key = item['txId']
            if key not in members:
                times = [datetime.fromisoformat(m['occurredAt']) for m in members.values()]
                times.append(datetime.fromisoformat(item['occurredAt']))
                if max(times)-min(times) > POLICY.before+POLICY.after:
                    limits.add('MERGE_LIMIT')
                    continue
                if len(members) >= POLICY.max_transactions:
                    limits.add('TRANSACTION_COUNT')
                    continue
                members[key] = dict(item)
            else:
                previous = members[key]
                if previous['scores'] is None and item['scores'] is not None:
                    previous['scores'] = item['scores']
                previous['includedReasons'] = sorted(set(previous['includedReasons']) | set(item['includedReasons']))
                roles = ('CONTEXT', 'CONNECTION', 'SEED')
                previous['role'] = max((previous['role'], item['role']), key=roles.index)
        seeds.update({s['txId']: s for s in evidence['seeds'] if s['txId'] in members})
    rows, scores = {}, {}
    for key, m in members.items():
        rows[key] = dict(occurred_at=datetime.fromisoformat(m['occurredAt']),
            from_account_id=m['fromAccountId'],to_account_id=m['toAccountId'],
            from_bank_id=m['fromBankId'],to_bank_id=m['toBankId'],amount_received=Decimal(m['amountReceived']),
            receiving_currency=m['receivingCurrency'],amount_paid=Decimal(m['amountPaid']),
            payment_currency=m['paymentCurrency'],amount_usd=Decimal(m['amountUsd']),payment_format=m['paymentFormat'])
        if m['scores'] is not None:
            scores[key] = m['scores']
    candidate = Candidate(tuple(sorted(seeds)), tuple(Membership(k, m['role'], tuple(m['includedReasons']))
        for k,m in sorted(members.items())), tuple(sorted(limits)), old['policyVersion'])
    return _evidence(candidate, rows, scores, seeds)


def _fingerprint(evidence):
    # Coverage changes do not create evidence versions. Membership, seeds and
    # directional inclusion reasons do; probabilities never dictate grouping.
    body = dict(seeds=sorted(s['txId'] for s in evidence['seeds']),
                members=[(m['txId'], m['role'], m['includedReasons']) for m in evidence['transactions']])
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


def _latest(connection, alert):
    return connection.execute('''SELECT v.version,v.fingerprint,v.evidence FROM alert_versions v
        JOIN analysis_runs r USING(run_id) JOIN batch_jobs b ON b.job_id=r.job_id
        WHERE v.alert_id=%s AND r.status='COMPLETED' AND b.status='COMPLETED'
        ORDER BY v.version DESC LIMIT 1''', (alert,)).fetchone()


def _new_alert(connection, parent=None):
    row = connection.execute("SELECT user_id FROM users WHERE role='L1' ORDER BY last_assigned_at NULLS FIRST,user_id LIMIT 1 FOR UPDATE").fetchone()
    if row is None:
        raise AssigneeUnavailable('Register an L1 user before constructing Alerts')
    connection.execute('UPDATE users SET last_assigned_at=clock_timestamp() WHERE user_id=%s', (row[0],))
    return connection.execute('INSERT INTO alerts(assignee_id,parent_alert_id) VALUES(%s,%s) RETURNING alert_id',
                              (row[0], parent)).fetchone()[0]


def save_alerts(connection, execution):
    if not connection.autocommit:
        raise ProtocolError('Autocommit connection required')
    # Only immutable input is read during computation, without holding row locks.
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('SELECT * FROM analysis.input_transactions WHERE run_id=%s ORDER BY tx_id,input_role DESC', (execution.run_id,))
        rows = {r['tx_id']: r for r in cursor.fetchall()}
    threshold = connection.execute('SELECT threshold_value FROM batch_jobs WHERE job_id=%s', (execution.job_id,)).fetchone()[0]
    if threshold is None:
        raise ProtocolError('Frozen threshold is required')
    scores = dict(connection.execute('SELECT tx_id,scores FROM analysis.input_scores WHERE run_id=%s', (execution.run_id,)).fetchall())
    current = dict(connection.execute("SELECT tx_id,to_jsonb(s)-'run_id'-'tx_id'-'job_id' FROM inference_results s WHERE run_id=%s", (execution.run_id,)).fetchall())
    targets = {key for key, row in rows.items() if row['input_role'] == 'TARGET'}
    if targets != set(current):
        raise ProtocolError('Every frozen TARGET requires current-run scores')
    scores.update(current)
    seeds = {key: dict(txId=key, occurredAt=rows[key]['occurred_at'].isoformat(),
                       score=value['p_laundering'], threshold=float(threshold))
             for key, value in current.items() if value['p_laundering'] >= threshold}
    origins = connection.execute('SELECT alert_id,version,evidence FROM analysis.alert_origins WHERE run_id=%s ORDER BY alert_id', (execution.run_id,)).fetchall()
    for _, _, evidence in origins:
        for seed in evidence['seeds']:
            if seed['txId'] in rows:
                seeds.setdefault(seed['txId'], seed)
    days = {day.isoformat(): dict(complete=complete, expectedBanks=expected, completeBanks=received, reports=reports)
            for day, expected, received, complete, reports in connection.execute(
                'SELECT business_date,expected_banks,complete_banks,complete,reports FROM analysis.input_coverage WHERE run_id=%s', (execution.run_id,)).fetchall()}
    candidates = []
    if seeds:
        if not days:
            raise ProtocolError('Frozen coverage is required')
        low = datetime.fromisoformat(min(days)).replace(tzinfo=SEOUL)
        high = datetime.fromisoformat(max(days)).replace(tzinfo=SEOUL) + timedelta(days=1) - timedelta(microseconds=1)
        candidates = build_candidates([Transaction(k, r['occurred_at'], str(r['from_account_id']), str(r['to_account_id']))
            for k, r in rows.items()], {k: 1.0 for k in seeds}, POLICY, coverage_start=low, coverage_end=high)
    evidence_items = [_evidence(c, rows, scores, seeds) for c in candidates]
    with connection.transaction():
        _lock(connection, execution, 'ALERTS')
        saved = connection.execute("SELECT artifact FROM analysis_run_stage_results WHERE run_id=%s AND stage='ALERTS' AND completed", (execution.run_id,)).fetchone()
        if saved:
            _checkpoint(connection, execution, 'ALERTS', saved[0])
            return
        # A freeze based on older visible evidence must never replace newer work.
        for alert, version, _ in origins:
            if connection.execute('''SELECT EXISTS(SELECT 1 FROM alert_versions v
                JOIN alerts a USING(alert_id) JOIN analysis_runs r USING(run_id)
                WHERE (a.alert_id=%s OR a.parent_alert_id=%s) AND v.run_id<>%s
                  AND r.status IN ('READY','ACTIVE'))''',
                (alert, alert, execution.run_id)).fetchone()[0]:
                raise StaleExecution('Another run has unpublished Alert evidence; resolve it and freeze new input')
            latest = _latest(connection, alert)
            if latest is None or latest[0] != version:
                raise ProtocolError('Alert baseline changed; a new input snapshot is required')
        changed, created, covered = set(), set(), set()
        plans, consumed = [], set()
        for original, _, old in origins:
            old_ids = {s['txId'] for s in old['seeds']}
            additions = [e for e in evidence_items if old_ids & {s['txId'] for s in e['seeds']}]
            evidence = _extend(old, additions)
            consumed.update(s['txId'] for s in evidence['seeds'])
            plans.append((original, evidence))
        for evidence in evidence_items:
            if {s['txId'] for s in evidence['seeds']} - consumed:
                plans.append((None, evidence))
        for original, evidence in plans:
            if original is None:
                original = _new_alert(connection)
                created.add(original)
            covered.add(original)
            alert = original
            latest = _latest(connection, alert)
            fingerprint = _fingerprint(evidence)
            coverage = _coverage(evidence['seeds'], days)
            for item in coverage:
                item['explorationLimits'] = evidence['limits']
                if item['txId'] not in rows:
                    item['forwardComplete'] = False
                    item['reason'] = 'SEED_NOT_ACTIVE_IN_SNAPSHOT'
            status = connection.execute('SELECT status FROM alerts WHERE alert_id=%s FOR UPDATE', (alert,)).fetchone()[0]
            if latest is not None and latest[1].strip() != fingerprint and status != 'OPEN':
                children = connection.execute('SELECT alert_id FROM alerts WHERE parent_alert_id=%s ORDER BY alert_id', (original,)).fetchall()
                existing = [(a, _latest(connection, a)) for (a,) in children]
                same = next((a for a, v in existing if v and v[1].strip() == fingerprint), None)
                if same is not None:
                    alert = same
                else:
                    alert = _new_alert(connection, original)
                    created.add(alert)
                latest = _latest(connection, alert)
            if latest is None or latest[1].strip() != fingerprint:
                version = connection.execute('SELECT coalesce(max(version),0)+1 FROM alert_versions WHERE alert_id=%s', (alert,)).fetchone()[0]
                connection.execute('INSERT INTO alert_versions VALUES(%s,%s,%s,%s,%s,now())',
                                   (alert, version, execution.run_id, fingerprint, Jsonb(evidence)))
                for member in evidence['transactions']:
                    connection.execute('INSERT INTO alert_transactions VALUES(%s,%s,%s,%s,%s)',
                        (alert, version, member['txId'], member['role'], Jsonb(member['includedReasons'])))
                changed.add(alert)
            for key in {original, alert}:
                connection.execute('''INSERT INTO alert_coverage_checks VALUES(%s,%s,%s,%s)
                    ON CONFLICT(alert_id,run_id) DO UPDATE SET coverage=excluded.coverage,forward_complete=excluded.forward_complete''',
                    (key, execution.run_id, Jsonb(coverage), all(c['forwardComplete'] for c in coverage)))
        connection.execute('UPDATE batch_jobs SET alert_count=%s WHERE job_id=%s', (len(created), execution.job_id))
        _checkpoint(connection, execution, 'ALERTS', json.dumps(dict(run_id=str(execution.run_id),
                    createdAlertCount=len(created), updatedAlertCount=len(changed-created), checkedAlertCount=len(covered))))
