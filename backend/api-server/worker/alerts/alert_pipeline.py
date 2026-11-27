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

from alerts.alert_scope import INPUT_ROWS, WINDOW_SCORES, Scope
from alerts.block_graph import BlockPolicy, build_block_graphs
from alerts.flow_graph import EdgeTable, FlowIndex, FlowGraph, Witness, GraphBudgetExceeded
from alerts.seed_promotion import promote
from common.run_fence import lock_stage, save_checkpoint
from common.worker_transport import ProtocolError

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


def _build_graphs(rows, seeds, seed_groups=(), context_eligible=None):
    """Translate public UUIDs to snapshot-local codes, preserving transaction IDs.

    ``rows`` is the streamed _EdgeInput, or a mapping tx_id -> row for small inputs.
    ``context_eligible``: tx_id -> score of the transactions that may become CONTEXT members (None = all).
    """
    source = rows
    if not isinstance(rows, _EdgeInput):
        source = _EdgeInput()
        for tx_id, row in sorted(rows.items()):
            source.add(tx_id, row['occurred_at'], row['from_bank_id'], row['from_account_id'],
                       row['to_bank_id'], row['to_account_id'], row.get('amount_usd'))
    try:
        batch = build_block_graphs(FlowIndex(source.edges), seeds, POLICY, seed_groups=seed_groups,
                                   context_eligible=context_eligible)
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
    """Model scores of the frozen input, without holding every score or every scored ID.

    Membership is a scored transaction of the window (occurred at or after ``start``), as the
    window's score read defines it. It is looked up in the database on first use and kept, so
    the run never holds the window's scored IDs (2026-11-27: 17M of them reached the memory
    limit). Documents are loaded for the evidence members up front and on demand otherwise.
    The current run's score wins over a copied earlier one, as in the input itself.
    """

    def __init__(self, connection, run_id, start):
        self.connection, self.run_id, self.start = connection, run_id, start
        self.loaded, self.missing = {}, set()

    def __contains__(self, key):
        self.load((key,))
        return key in self.loaded

    def __getitem__(self, key):
        if key not in self:
            raise KeyError(key)
        return self.loaded[key]

    def get(self, key, default=None):
        return self.loaded[key] if key in self else default

    def load(self, keys):
        for chunk in _chunks({key for key in keys if key not in self.loaded and key not in self.missing}):
            found = {}
            window = [key for key, in self.connection.execute(
                'SELECT tx_id FROM ledger.transactions WHERE tx_id=ANY(%s) AND occurred_at>=%s',
                (chunk, self.start))]
            if window:
                for sql in ('SELECT tx_id,scores FROM analysis.run_scores WHERE run_id=%s AND tx_id=ANY(%s)',
                            "SELECT tx_id,to_jsonb(s)-'run_id'-'tx_id'-'job_id' FROM analysis.scores s"
                            " WHERE run_id=%s AND tx_id=ANY(%s)"):
                    for key, score in self.connection.execute(sql, (self.run_id, window)):
                        found[key] = score
            self.loaded.update(found)
            self.missing.update(key for key in chunk if key not in found)


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
    """Focal-account query condition kept beside the stored CONTEXT members.

    The window is the core's time span padded by the policy; focal accounts are
    the block's own fan centres. The CONTEXT members themselves are the scored
    transactions of every core account in the same window (block_graph _Build.context).
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


def _promotion_values(connection, execution):
    """(low, floor) of seed promotion from the bound binary model's spec; (None, None) without them."""
    from features.prepare_features import versions_for_run
    from models import registry
    spec = registry.require(*versions_for_run(connection, execution)['BINARY']).spec
    return getattr(spec, 'ALERT_SEED_LOW', None), getattr(spec, 'ALERT_CHAIN_FLOOR', None)


def _promotion_floor(connection, execution):
    """Lowest score seed promotion reads (promote() visits nothing below min(low, floor)); None = none."""
    low, floor = _promotion_values(connection, execution)
    return None if low is None or floor is None else float(min(low, floor))


def _promote_seeds(connection, execution, edges, decisions, positive, times):
    """Add the seeds alerts/seed_promotion.py promotes (when the bound binary model defines its values)."""
    low, floor = _promotion_values(connection, execution)
    if low is None or floor is None or not positive:
        return 0
    # decisions may reach below the promotion floor (context_score_min); promotion sees only its own range.
    bottom = float(min(low, floor))
    probability = {key: decision[0] for key, decision in decisions.items() if decision[0] >= bottom}
    positions = promote(edges, probability, positive, low, floor)
    for i in positions:
        key = edges.tx_ids[i]
        occurred = EPOCH + timedelta(microseconds=edges.occurred_us[i])
        positive[key] = dict(txId=key, occurredAt=occurred.isoformat(),
                             score=decisions[key][0], threshold=float(decisions[key][1]))
        times[key] = occurred
    return len(positions)


def run(connection, execution, context):
    """Stage entry: ⑧ Alert 구성 (ALERTS)."""
    save_alerts(connection, execution)


def save_alerts(connection, execution):
    if not connection.autocommit:
        raise ProtocolError('Autocommit connection required')
    # Retry a successfully prepared stage without rebuilding the full ledger.
    saved = connection.execute("SELECT artifact FROM analysis.stage_results WHERE run_id=%s AND stage='ALERTS' AND completed", (execution.run_id,)).fetchone()
    if saved:
        with connection.transaction():
            lock_stage(connection, execution, 'ALERTS')
            saved = connection.execute("SELECT artifact FROM analysis.stage_results WHERE run_id=%s AND stage='ALERTS' AND completed", (execution.run_id,)).fetchone()
            if saved:
                connection.execute('UPDATE analysis.alert_plans SET execution_id=%s WHERE run_id=%s',
                                   (execution.execution_id, execution.run_id))
                save_checkpoint(connection, execution, 'ALERTS', saved[0])
                return
    started = perf_counter()
    timings = {}
    threshold,business_at = connection.execute('SELECT threshold_value,business_at FROM analysis.jobs WHERE job_id=%s', (execution.job_id,)).fetchone()
    if threshold is None:
        raise ProtocolError('Frozen threshold is required')
    scope = Scope(connection, execution.run_id)
    # Only the decisions a seed, seed promotion or CONTEXT member can use are held: scores at or
    # above their own threshold, or at or above the lower of the promotion floor and
    # context_score_min. Lower scores decide nothing here and are fetched on demand through
    # _Scores when evidence shows them.
    # CONTEXT members need every score at or above context_score_min as well.
    cut = _promotion_floor(connection, execution)
    cut = POLICY.context_score_min if cut is None else min(cut, POLICY.context_score_min)
    decisions = {}
    with connection.transaction(), connection.cursor(name='alert_scores') as cursor:
        cursor.execute(WINDOW_SCORES, dict(scope.arguments(), floor=cut))
        for key, probability, value in cursor:
            decisions[key] = (probability, value)
    with connection.transaction(), connection.cursor(name='alert_current') as cursor:
        cursor.execute("SELECT tx_id,to_jsonb(s)->'p_laundering' FROM analysis.scores s"
                       " WHERE run_id=%s AND s.p_laundering>=least(%s::float8,%s::float8)",
                       (execution.run_id, threshold, cut))
        for key, probability in cursor:
            decisions[key] = (probability, threshold)
    if any(value is None for _, value in decisions.values()):
        raise ProtocolError('Every frozen score requires its original threshold')
    # Every TARGET has a current-run score and every current-run score is a TARGET; checked in
    # the database rather than by holding both ID sets.
    unscored, stray = connection.execute('''SELECT
          (SELECT count(*) FROM analysis.input_transactions i WHERE i.run_id=%(run)s AND i.input_role='TARGET'
             AND i.occurred_at>=%(start)s
             AND NOT EXISTS(SELECT 1 FROM analysis.scores s WHERE s.run_id=i.run_id AND s.tx_id=i.tx_id)),
          (SELECT count(*) FROM analysis.scores s WHERE s.run_id=%(run)s
             AND NOT EXISTS(SELECT 1 FROM analysis.input_transactions i WHERE i.run_id=s.run_id
                            AND i.tx_id=s.tx_id AND i.input_role='TARGET' AND i.occurred_at>=%(start)s))''',
        scope.arguments()).fetchone()
    if unscored or stray:
        raise ProtocolError('Every frozen TARGET requires current-run scores')
    # Only immutable input is read during computation, without holding row locks.
    # Generator columns are streamed into arrays; no row dictionary is kept.
    edges, positive, times = _EdgeInput(), {}, {}
    with connection.transaction(), connection.cursor(name='alert_input') as cursor:
        cursor.itersize = 2048
        cursor.execute(INPUT_ROWS, scope.arguments())
        for key, role, occurred, from_bank, from_account, to_bank, to_account, usd in cursor:
            edges.add(key, occurred, from_bank, from_account, to_bank, to_account, usd)
            decision = decisions.get(key)
            if decision is not None and decision[0] >= decision[1]:
                positive[key] = dict(txId=key, occurredAt=occurred.astimezone(timezone.utc).isoformat(),
                                     score=decision[0], threshold=float(decision[1]))
                times[key] = occurred
    scores = _Scores(connection, execution.run_id, scope.start)
    days = {day.isoformat(): dict(complete=complete, rowCount=rows)
            for day, complete, rows in connection.execute(
                "SELECT business_date,complete,row_count FROM analysis.input_coverage"
                " WHERE run_id=%s AND business_date>=(%s::timestamptz AT TIME ZONE 'Asia/Seoul')::date",
                (execution.run_id, scope.start)).fetchall()}
    timings['inputRead'] = (perf_counter() - started) * 1000
    promotion_started = perf_counter()
    promoted = _promote_seeds(connection, execution, edges.edges, decisions, positive, times)
    context_eligible = {key: float(probability) for key, (probability, _) in decisions.items()
                        if probability >= POLICY.context_score_min}
    del decisions
    timings['seedPromotion'] = (perf_counter() - promotion_started) * 1000
    candidate_started = perf_counter()
    if positive and not days:
        raise ProtocolError('Frozen coverage is required')
    seed_groups, owned_seen, duplicates, pinned_ids = [], set(), 0, []
    for alert, owned, core, members, witnesses, version in scope.pinned(connection):
        # Published relations pin the block (I10); a block of another policy is frozen.
        # A seed owned by two OPEN Alerts (an anomaly the generator never creates) stays
        # with the earliest Alert; the lifecycle then merges the other.
        pinned_ids.append(alert)
        keys = [s['txId'] for s in owned if s['txId'] in positive]
        fresh = [key for key in keys if key not in owned_seen]
        duplicates += len(keys) - len(fresh)
        owned_seen.update(fresh)
        if not fresh:
            continue
        seed_groups.append((fresh, core or [], members or [],
                            [(w['kind'], tuple(w['tx_ids'])) for w in witnesses],
                            version != POLICY.version))
    # New seeds start Alerts: earlier ones join only within the seed range, and a seed an
    # OPEN Alert outside that range owns stays there (alert_new_seed_design_20261022.md §3.1).
    candidates = {key for key, at in times.items() if at >= scope.seed_start}
    candidates -= scope.owned_elsewhere(connection, candidates, pinned_ids)
    seeds = {key: positive[key] for key in candidates | owned_seen}
    batch = _build_graphs(edges, seeds, seed_groups, context_eligible)
    del edges, context_eligible
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
        lock_stage(connection, execution, 'ALERTS')
        saved = connection.execute("SELECT artifact FROM analysis.stage_results WHERE run_id=%s AND stage='ALERTS' AND completed", (execution.run_id,)).fetchone()
        if saved:
            connection.execute('UPDATE analysis.alert_plans SET execution_id=%s WHERE run_id=%s',
                               (execution.execution_id, execution.run_id))
            save_checkpoint(connection, execution, 'ALERTS', saved[0])
            return
        from alerts.alert_plan_preparation import prepare_plans
        connection.execute('SELECT pg_advisory_xact_lock(17002001)')
        core_ids = {key for graph in batch.graphs for key in (*graph.seed_ids, *graph.connection_ids)}
        planned = scope.planned(connection, pinned_ids, core_ids)
        prepare_plans(connection, execution, batch, rows, scores, seeds, days,
            dict(run_id=str(execution.run_id), policyVersion=POLICY.version,
                 inputWindowStart=scope.start.isoformat(), seedRangeStart=scope.seed_start.isoformat(),
                 pinnedAlertCount=len(pinned_ids), plannedAlertCount=len(planned),
                 policyDigest=batch.policy_digest, graphCount=len(batch.graphs),
                 unassignedSeedCount=len(batch.unassigned), promotedSeedCount=promoted,
                 frozenLegacyCount=sum(1 for group in seed_groups if group[4]),
                 duplicateOwnedSeedCount=duplicates,
                 unassignedReasons=dict(Counter(item.reason for item in batch.unassigned)),
                 rejectedRelationReasons=dict(Counter(item.reason for item in batch.rejected_relations)),
                 timingsMs={key: round(value, 3) for key, value in timings.items()}),
            case_ids=planned, positive=frozenset(positive))
