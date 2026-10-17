"""Frozen-input flow construction and run-fenced publication plan preparation.

Model labels are annotations, never grouping conditions. All public account IDs
come from the frozen pseudonymous input; this module cannot read private names.
"""
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from time import perf_counter
from collections import Counter, defaultdict
import hashlib
import json

from psycopg.rows import dict_row

from block_graph import BlockPolicy, build_block_graphs
from flow_graph import EdgeTable, FlowIndex, FlowGraph, Witness, GraphBudgetExceeded
from model_publication import _lock
from result_collection import _checkpoint
from worker_transport import ProtocolError

POLICY = BlockPolicy()
USD_MICROS = 1_000_000
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


@dataclass(frozen=True)
class GraphBatch:
    """Generator output for one frozen input plus the snapshot's account map.

    ``account_keys`` maps a snapshot-local account code back to its public
    (bank_id, account_id) pair so that focal accounts can be rendered into the
    evidence as a context query condition.
    """
    graphs: tuple
    unassigned: tuple
    rejected_relations: tuple
    policy_digest: str
    account_keys: dict


class _EdgeInput:
    """Generator columns of the frozen input, appended in tx_id order into arrays.

    The full input never becomes row dictionaries; only evidence members are read
    back in full after the graphs are built (see _member_rows).
    """

    def __init__(self):
        self.edges, self.accounts = EdgeTable(), {}

    def add(self, tx_id, occurred, from_bank, from_account, to_bank, to_account, usd):
        if occurred.utcoffset() is None:
            raise ProtocolError('Frozen transaction time must include a timezone')
        delta = occurred.astimezone(timezone.utc) - EPOCH
        codes = [self.accounts.setdefault(key, len(self.accounts) + 1)
                 for key in ((from_bank, str(from_account)), (to_bank, str(to_account)))]
        self.edges.append(tx_id, (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds,
                          *codes, None if usd is None else int((Decimal(usd) * USD_MICROS).to_integral_value()))


def _build_graphs(rows, seeds, seed_groups=()):
    """Translate public UUIDs to snapshot-local codes, preserving transaction IDs.

    ``rows`` is the streamed _EdgeInput, or a mapping tx_id -> row for small inputs.
    """
    source = rows
    if not isinstance(rows, _EdgeInput):
        source = _EdgeInput()
        for tx_id, row in sorted(rows.items()):
            source.add(tx_id, row['occurred_at'], row['from_bank_id'], row['from_account_id'],
                       row['to_bank_id'], row['to_account_id'], row.get('amount_usd'))
    try:
        batch = build_block_graphs(FlowIndex(source.edges), seeds, POLICY, seed_groups=seed_groups)
    except GraphBudgetExceeded as error:
        raise ProtocolError('Alert graph budget exceeded: ' + str(error)) from error
    return GraphBatch(batch.graphs, batch.unassigned, batch.rejected_relations, batch.policy_digest,
                      {code: key for key, code in source.accounts.items()})


# Transaction ids per member/score query; bounds the query parameter size.
MEMBER_CHUNK = 10_000


def _chunks(keys):
    keys = sorted(keys)
    for start in range(0, len(keys), MEMBER_CHUNK):
        yield keys[start:start + MEMBER_CHUNK]


def _member_rows(connection, run_id, keys):
    """Full frozen rows, only for the transactions that evidence renders."""
    rows = {}
    with connection.cursor(row_factory=dict_row) as cursor:
        for chunk in _chunks(keys):
            cursor.execute('SELECT * FROM analysis.run_inputs WHERE run_id=%s AND tx_id=ANY(%s)',
                           (run_id, chunk))
            rows.update((row['tx_id'], row) for row in cursor)
    return rows


class _Scores:
    """Model scores of the frozen input, without holding every score document.

    Membership covers every scored input transaction; documents are loaded for the
    evidence members up front and on demand for anything else (e.g. reassessment).
    The current run's score wins over a copied earlier one, as in the input itself.
    """

    def __init__(self, connection, run_id, scored):
        self.connection, self.run_id, self.scored, self.loaded = connection, run_id, scored, {}

    def __contains__(self, key):
        return key in self.scored

    def __getitem__(self, key):
        if key not in self.scored:
            raise KeyError(key)
        if key not in self.loaded:
            self.load((key,))
        return self.loaded[key]

    def get(self, key, default=None):
        return self[key] if key in self.scored else default

    def load(self, keys):
        for chunk in _chunks({key for key in keys if key in self.scored and key not in self.loaded}):
            for sql in ('SELECT tx_id,scores FROM analysis.run_scores WHERE run_id=%s AND tx_id=ANY(%s)',
                        "SELECT tx_id,to_jsonb(s)-'run_id'-'tx_id'-'job_id' FROM analysis.scores s"
                        " WHERE run_id=%s AND tx_id=ANY(%s)"):
                for key, score in self.connection.execute(sql, (self.run_id, chunk)):
                    self.loaded[key] = score


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


def _context_query(members, focal):
    """Context is a query condition, not stored members (block-pin-1).

    The window is the core's time span padded by the policy; focal accounts are
    the block's own fan centres whose other transactions a viewer may fetch.
    """
    times = [datetime.fromisoformat(m['occurredAt']) for m in members]
    pad = timedelta(microseconds=POLICY.context_pad_us)
    unique = {(item['bankId'], item['accountId']): item for item in focal}
    return dict(firstAt=(min(times) - pad).isoformat(), lastAt=(max(times) + pad).isoformat(),
                focalAccounts=[unique[key] for key in sorted(unique)])


def _evidence(graph, rows, scores, seed_info, account_keys=None, focal=(), light=False):
    """Render an evidence version. ``light`` keeps only the keys that the semantic
    and member digests read (no graph, summary or context query)."""
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
        if light:
            continue
        for side in ('from', 'to'):
            key = item[side+'AccountId']
            node = nodes.setdefault(key, dict(id=key, kind='ACCOUNT', bankId=item[side+'BankId'],
                inCount=0, outCount=0, inAmountUsd=Decimal(0), outAmountUsd=Decimal(0)))
            direction = 'out' if side == 'from' else 'in'
            node[direction+'Count'] += 1
            node[direction+'AmountUsd'] += row['amount_usd']
    seeds = [seed_info[key] for key in graph.seed_ids]
    if light:
        return _json(dict(policyVersion=POLICY.version, policy=asdict(POLICY),
            witnesses=[asdict(witness) for witness in graph.witnesses],
            boundaryWitnesses=[asdict(witness) for witness in graph.boundary_witnesses],
            seeds=seeds, transactions=members, limits=list(graph.limits)))
    amounts = sum((Decimal(m['amountUsd']) for m in members), Decimal(0))
    probabilities = [s['p_laundering'] for m in members if (s := m['scores']) is not None]
    focal_accounts = list(focal)
    if account_keys is not None:
        for code in getattr(graph, 'focal_accounts', ()):
            bank, account = account_keys[code]
            focal_accounts.append(dict(bankId=bank, accountId=account))
    return _json(dict(policyVersion=POLICY.version, policy=asdict(POLICY),
        witnesses=[asdict(witness) for witness in graph.witnesses],
        boundaryWitnesses=[asdict(witness) for witness in graph.boundary_witnesses],
        seeds=seeds, transactions=members, limits=list(graph.limits),
        contextQuery=_context_query(members, focal_accounts),
        summary=dict(txCount=len(members), seedCount=len(seeds),
            totalAmountUsd=amounts, scoreMax=max(probabilities) if probabilities else None,
            firstTxAt=min(m['occurredAt'] for m in members), lastTxAt=max(m['occurredAt'] for m in members)),
        graph=dict(nodes=sorted(nodes.values(), key=lambda n: n['id']), edges=[dict(
            id=str(m['txId']), txId=m['txId'], **{'from': m['fromAccountId'], 'to': m['toAccountId']},
            amountUsd=m['amountUsd'], occurredAt=m['occurredAt'], role=m['role'],
            includedReasons=m['includedReasons']) for m in members])))


def _extend(old, additions, light=False):
    """Compose immutable evidence versions without truncating relation witnesses.

    Case lifecycle is separate from graph construction. Existing historical
    members remain intact and keep their relation witnesses; links describe the
    current run and replace the old ones (N2 (d)); oversized accumulated
    evidence fails atomically. ``light`` renders as in ``_evidence``.
    """
    if old.get('policyVersion') != POLICY.version or 'witnesses' not in old:
        raise ProtocolError('Existing Alert evidence requires regeneration with the block policy')
    members = {m['txId']: dict(m) for m in old['transactions']}
    seeds = {s['txId']: s for s in old['seeds']}
    limits = set(old['limits'])
    witnesses = {Witness(w['kind'], tuple(w['tx_ids'])) for w in old['witnesses']}
    boundaries = {Witness(w['kind'], tuple(w['tx_ids'])) for w in old.get('boundaryWitnesses', [])}
    focal = list((old.get('contextQuery') or {}).get('focalAccounts', []))
    if additions:
        boundaries = set()
    for evidence in additions:
        limits.update(evidence['limits'])
        witnesses.update(Witness(w['kind'], tuple(w['tx_ids'])) for w in evidence['witnesses'])
        boundaries.update(Witness(w['kind'], tuple(w['tx_ids'])) for w in evidence.get('boundaryWitnesses', []))
        focal.extend((evidence.get('contextQuery') or {}).get('focalAccounts', []))
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
    if sum(m['role'] != 'CONTEXT' for m in members.values()) > POLICY.core_max:
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
    return _evidence(graph, rows, scores, seeds, focal=focal, light=light)


def _digest_of(body):
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


def _fingerprint(evidence):
    # Facts, scores, policy and relation witnesses matter even when membership stays
    # the same. Links, the context query, coverage/check time and the rendered
    # graph/summary are not semantic facts of the block (N2 (d)).
    body = {key: evidence[key] for key in
            ('policyVersion', 'policy', 'witnesses', 'seeds', 'transactions', 'limits')}
    body['withdrawalReason'] = evidence.get('withdrawalReason')
    return _digest_of(body)


def _member_digest(evidence):
    """Identity of the block's members and their facts, ignoring relation evidence.

    A later run may describe the same core with other witnesses (a PASS partner
    changes, a star chunk is cut elsewhere); that alone is no new version (N7 (a)).
    """
    body = dict(policyVersion=evidence.get('policyVersion'), policy=evidence.get('policy'),
                seeds=evidence.get('seeds', []),
                transactions=[{k: v for k, v in m.items() if k != 'includedReasons'}
                              for m in evidence.get('transactions', [])],
                withdrawalReason=evidence.get('withdrawalReason'))
    return _digest_of(body)


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
    threshold,business_at = connection.execute('SELECT threshold_value,business_at FROM analysis.jobs WHERE job_id=%s', (execution.job_id,)).fetchone()
    if threshold is None:
        raise ProtocolError('Frozen threshold is required')
    # Only the seed decision is held per scored transaction: the stored probability
    # value (jsonb, so 1 stays 1) and its original threshold. Documents load later.
    decisions = {}
    with connection.transaction(), connection.cursor(name='alert_scores') as cursor:
        cursor.execute('''SELECT i.tx_id,i.p_laundering,b.threshold_value
            FROM analysis.run_scores i JOIN analysis.runs r ON r.run_id=i.score_run_id
            JOIN analysis.jobs b ON b.job_id=r.job_id WHERE i.run_id=%s''', (execution.run_id,))
        for key, probability, value in cursor:
            decisions[key] = (probability, value)
    current = set()
    with connection.transaction(), connection.cursor(name='alert_current') as cursor:
        cursor.execute("SELECT tx_id,to_jsonb(s)->'p_laundering' FROM analysis.scores s WHERE run_id=%s",
                       (execution.run_id,))
        for key, probability in cursor:
            current.add(key)
            decisions[key] = (probability, threshold)
    if any(value is None for _, value in decisions.values()):
        raise ProtocolError('Every frozen score requires its original threshold')
    # Only immutable input is read during computation, without holding row locks.
    # Generator columns are streamed into arrays; no row dictionary is kept.
    edges, targets, seeds = _EdgeInput(), set(), {}
    with connection.transaction(), connection.cursor(name='alert_input') as cursor:
        cursor.itersize = 2048
        cursor.execute('''SELECT tx_id,input_role,occurred_at,from_bank_id,from_account_id,to_bank_id,
            to_account_id,amount_usd FROM analysis.run_inputs WHERE run_id=%s ORDER BY tx_id''',
            (execution.run_id,))
        for key, role, occurred, from_bank, from_account, to_bank, to_account, usd in cursor:
            edges.add(key, occurred, from_bank, from_account, to_bank, to_account, usd)
            if role == 'TARGET':
                targets.add(key)
            decision = decisions.get(key)
            if decision is not None and decision[0] >= decision[1]:
                seeds[key] = dict(txId=key, occurredAt=occurred.astimezone(timezone.utc).isoformat(),
                                  score=decision[0], threshold=float(decision[1]))
    if targets != current:
        raise ProtocolError('Every frozen TARGET requires current-run scores')
    scores = _Scores(connection, execution.run_id, frozenset(decisions))
    del current, decisions, targets
    days = {day.isoformat(): dict(complete=complete, expectedBanks=expected, completeBanks=received, reports=reports)
            for day, expected, received, complete, reports in connection.execute(
                'SELECT business_date,expected_banks,complete_banks,complete,reports FROM analysis.input_coverage WHERE run_id=%s', (execution.run_id,)).fetchall()}
    timings['inputRead'] = (perf_counter() - started) * 1000
    candidate_started = perf_counter()
    if seeds and not days:
        raise ProtocolError('Frozen coverage is required')
    seed_groups, owned_seen, duplicates = [], set(), 0
    for owned, core, members, witnesses, version in connection.execute('''SELECT v.evidence->'seeds',
        (SELECT jsonb_agg(t->'txId') FROM jsonb_array_elements(v.evidence->'transactions') t
         WHERE t->>'role'<>'CONTEXT'),
        (SELECT jsonb_agg(t->'txId') FROM jsonb_array_elements(v.evidence->'transactions') t),
        coalesce(v.evidence->'witnesses','[]'::jsonb), v.evidence->>'policyVersion'
        FROM analysis.run_alert_origins o JOIN review.alerts a USING(alert_id)
        JOIN review.alert_versions v ON v.alert_id=o.alert_id AND v.version=o.version
        WHERE o.run_id=%s AND a.status='OPEN' AND a.merged_into_alert_id IS NULL
        ORDER BY a.alert_id''', (execution.run_id,)):
        # Published relations pin the block (I10); a block of another policy is frozen.
        # A seed owned by two OPEN Alerts (an anomaly the generator never creates) stays
        # with the earliest Alert; the lifecycle then merges or proposes for the other.
        keys = [s['txId'] for s in owned]
        fresh = [key for key in keys if key not in owned_seen]
        duplicates += len(keys) - len(fresh)
        owned_seen.update(fresh)
        if not fresh:
            continue
        seed_groups.append((fresh, core or [], members or [],
                            [(w['kind'], tuple(w['tx_ids'])) for w in witnesses],
                            version != POLICY.version))
    batch = _build_graphs(edges, seeds, seed_groups)
    del edges
    timings['candidateBuild'] = (perf_counter() - candidate_started) * 1000
    member_started = perf_counter()
    # Evidence renders only this run's graph members: read their full rows and scores.
    members = {key for graph in batch.graphs
               for key in (*graph.seed_ids, *graph.connection_ids, *graph.context_ids)}
    rows = _member_rows(connection, execution.run_id, members)
    scores.load(members)
    del members
    timings['memberRead'] = (perf_counter() - member_started) * 1000
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
                 frozenLegacyCount=sum(1 for group in seed_groups if group[4]),
                 duplicateOwnedSeedCount=duplicates,
                 unassignedReasons=dict(Counter(item.reason for item in batch.unassigned)),
                 rejectedRelationReasons=dict(Counter(item.reason for item in batch.rejected_relations)),
                 timingsMs={key: round(value, 3) for key, value in timings.items()}))
