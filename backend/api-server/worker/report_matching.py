"""Exact multiset matching of bank reports; plaintext never appears in repr."""

from collections import defaultdict, deque
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True, repr=False)
class Report:
    id: int
    version: int
    bank: int
    row: dict


@dataclass(frozen=True)
class MatchResult:
    matches: list
    held_versions: set
    dependency_reports: set
    reasons: dict


def key(row):
    return (row['occurredAt'], row['fromBank'], row['fromAccount'], row['toBank'],
            row['toAccount'], Decimal(str(row['amountReceived'])), row['receivingCurrency'],
            Decimal(str(row['amountPaid'])), row['paymentCurrency'])


def identity_conflicts(reports):
    claims = defaultdict(lambda: defaultdict(set))
    for report in reports:
        r = report.row
        for side in ('from', 'to'):
            for identity, value in (
                (('bank', r[side + 'Bank']), r[side + 'BankName']),
                (('owner', r[side + 'EntityId']), r[side + 'EntityName']),
                (('account', r[side + 'Bank'], r[side + 'Account']), r[side + 'EntityId']),
            ):
                claims[identity][value].add(report.version)
    return {version for values in claims.values() if len(values) > 1
            for versions in values.values() for version in versions}


def match(reports, scope, initial_held=(), invalid_banks=()):
    held = set(initial_held)
    reasons = {version: 'INVALID_SELF_OR_CONFIRMED_IDENTITY' for version in held}
    conflicts = identity_conflicts(r for r in reports if r.version not in held)
    held.update(conflicts)
    reasons.update({version: 'IDENTITY_CONFLICT' for version in conflicts})
    blocked_banks = set(invalid_banks) | {r.bank for r in reports if r.version in held}
    groups = defaultdict(list)
    for report in sorted(reports, key=lambda r: r.id):
        if report.version not in held:
            groups[key(report.row)].append(report)
    candidates, unmatched = [], []
    dependencies = set()
    for group in groups.values():
        row = group[0].row
        if (row['fromBank'] == row['toBank'] or row['fromBank'] not in scope
                or row['toBank'] not in scope):
            candidates.extend((report, None) for report in group)
            continue
        receivers = defaultdict(deque)
        for report in group:
            if report.bank == row['toBank']:
                receivers[report.row['paymentFormat']].append(report)
        send = []
        for report in group:
            if report.bank == row['fromBank']:
                queue = receivers[report.row['paymentFormat']]
                if queue:
                    candidates.append((report, queue.popleft()))
                else:
                    send.append(report)
        receive = [report for queue in receivers.values() for report in queue]
        if send and receive:
            for report in send + receive:
                held.add(report.version)
                reasons[report.version] = 'PAYMENT_FORMAT_CONFLICT'
        else:
            unmatched.extend(send or receive)
    blocked_banks.update(r.bank for r in reports if r.version in held)
    for report in unmatched:
        other = report.row['toBank'] if report.bank == report.row['fromBank'] else report.row['fromBank']
        if other in blocked_banks:
            dependencies.add(report.id)
        else:
            held.add(report.version)
            reasons[report.version] = 'COUNTERPART_MISSING'
    accepted = []
    for first, second in candidates:
        if first.version in held or second is not None and second.version in held:
            dependencies.update(r.id for r in (first, second) if r is not None and r.version not in held)
        else:
            accepted.append((first, second))
    dependencies.difference_update(r.id for r in reports if r.version in held)
    return MatchResult(accepted, held, dependencies, reasons)
