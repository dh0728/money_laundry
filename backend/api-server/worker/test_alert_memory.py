"""Compatibility and bounded-memory regressions for Alert construction."""
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from zoneinfo import ZoneInfo
from decimal import Decimal
import random
import tracemalloc
import unittest
from unittest.mock import Mock, patch

from alert_builder import Candidate, Membership, Policy, Transaction, build_candidates, _overlapping_pairs
from alert_pipeline import _evidence, _extend, _plans, _validate_baselines
from frozen_input import StaleExecution
from worker_transport import ProtocolError


def eager_pairs(member_groups):
    owners, pairs = {}, set()
    for index, members in enumerate(member_groups):
        for tx_id in members:
            for other in owners.get(tx_id, ()):
                pairs.add((other, index))
            owners.setdefault(tx_id, []).append(index)
    return iter(sorted(pairs))


class LinearNeighbours:
    """Independent full-scan reference for the former neighbour selection."""
    def __init__(self, rows, policy):
        self.rows, self.policy = rows, policy

    def choices(self, tx_id, direction):
        row = self.rows[tx_id]
        day = row.occurred_at.astimezone(ZoneInfo('Asia/Seoul')).replace(
            hour=0, minute=0, second=0, microsecond=0)
        low = day - timedelta(days=self.policy.day_radius)
        high = day + timedelta(days=self.policy.day_radius + 1)
        choices, limits = defaultdict(set), set()
        rules = [(row.source, 'destination', 'UPSTREAM'),
                 (row.destination, 'source', 'DOWNSTREAM')]
        if direction == 'BOTH':
            rules += [(row.source, 'source', 'SHARED_SOURCE'),
                      (row.destination, 'destination', 'SHARED_DESTINATION')]
        else:
            rules = [rule for rule in rules if rule[2] == direction]
        for account, attribute, reason in rules:
            count = sum(low <= r.occurred_at < high and account in (r.source, r.destination)
                        for r in self.rows.values())
            if count > self.policy.max_account_transactions:
                limits.add('ACCOUNT_ACTIVITY')
                continue
            for other in self.rows.values():
                if other.tx_id == tx_id or getattr(other, attribute) != account:
                    continue
                if reason == 'UPSTREAM' and other.occurred_at >= row.occurred_at:
                    continue
                if reason == 'DOWNSTREAM' and other.occurred_at <= row.occurred_at:
                    continue
                if not low <= other.occurred_at < high:
                    limits.add('TIME_WINDOW')
                    continue
                choices[other.tx_id].add(reason)
        return choices, limits


class AlertMemoryTests(unittest.TestCase):
    def test_time_index_matches_linear_scan_including_limits(self):
        rng = random.Random(618)
        start = datetime(2023, 9, 1, tzinfo=ZoneInfo('Asia/Seoul'))
        for trial in range(100):
            rows = [Transaction(i, start + timedelta(hours=rng.randrange(240)),
                                str(rng.randrange(5)), str(rng.randrange(5)))
                    for i in range(1, 41)]
            policy = Policy('test', .4, trial % 3, 2, 5 + trial % 20, 4 + trial % 30)
            scores = {r.tx_id: rng.random() for r in rows}
            args = dict(coverage_start=start, coverage_end=start + timedelta(days=10))
            actual = build_candidates(rows, scores, policy, **args)
            with patch('alert_builder._NeighbourIndex', LinearNeighbours):
                expected = build_candidates(rows, scores, policy, **args)
            self.assertEqual(actual, expected, f'trial={trial}')

    def test_baseline_conflicts_preserve_origin_and_error_priority(self):
        for unpublished, changed, expected in ((None, None, None), (1, None, StaleExecution),
                (None, 2, ProtocolError), (1, 2, StaleExecution), (2, 1, ProtocolError),
                (2, 2, StaleExecution)):
            connection = Mock()
            connection.execute.return_value.fetchone.side_effect = [(unpublished,), (changed,)]
            if expected is None:
                _validate_baselines(connection, 'run')
            else:
                with self.assertRaises(expected):
                    _validate_baselines(connection, 'run')
            self.assertEqual(connection.execute.call_count, 2)

    def test_pair_order_matches_old_algorithm_with_duplicate_overlaps(self):
        rng = random.Random(9146)
        for _ in range(100):
            groups = [rng.sample(range(20), rng.randrange(1, 12)) for _ in range(30)]
            self.assertEqual(list(_overlapping_pairs(groups)), list(eager_pairs(groups)))

    def test_merge_results_match_old_pair_algorithm(self):
        rng = random.Random(541)
        start = datetime(2023, 9, 1, tzinfo=timezone.utc)
        for trial in range(100):
            rows = [Transaction(i, start + timedelta(minutes=rng.randrange(300)),
                                str(rng.randrange(8)), str(rng.randrange(8)))
                    for i in range(1, 31)]
            scores = {i: rng.random() for i in range(1, 31)}
            policy = Policy('test', .4, 2, 2, 5 + trial % 16, 100)
            args = dict(coverage_start=start, coverage_end=start + timedelta(days=1))
            actual = build_candidates(rows, scores, policy, **args)
            with patch('alert_builder._overlapping_pairs', eager_pairs):
                expected = build_candidates(rows, scores, policy, **args)
            self.assertEqual(actual, expected)

    def test_initial_memberships_are_not_changed_by_merges(self):
        groups = [{1}, {1, 2}, {2}, {3}]
        iterator = _overlapping_pairs(groups)
        self.assertEqual(next(iterator), (0, 1))
        groups[0].update({2, 3})
        self.assertEqual(list(iterator), [(1, 2)])

    def test_dense_overlap_does_not_materialize_quadratic_pairs(self):
        groups = [(1, 2)] * 2000
        tracemalloc.start()
        try:
            iterator = _overlapping_pairs(groups)
            self.assertEqual(next(iterator), (0, 1))
            _, peak = tracemalloc.get_traced_memory()
            iterator.close()
        finally:
            tracemalloc.stop()
        self.assertLess(peak, 4 * 1024 * 1024)

    def test_evidence_plans_match_original_and_are_lazy(self):
        start = datetime(2023, 9, 1, tzinfo=timezone.utc)
        rows = {i: dict(occurred_at=start, from_account_id=str(i), to_account_id=str(i+1),
                       from_bank_id=1, to_bank_id=2, amount_received=Decimal(1),
                       receiving_currency='USD', amount_paid=Decimal(1), payment_currency='USD',
                       amount_usd=Decimal(1), payment_format='ACH') for i in range(1, 6)}
        seeds = {i: dict(txId=i, occurredAt=start.isoformat(), score=.9, threshold=.7)
                 for i in range(1, 5)}
        candidates = [Candidate((i,), (Membership(i, 'SEED', ('SEED',)),
                                      Membership(i+1, 'CONNECTION', ('DOWNSTREAM',))), (), 'test')
                      for i in range(1, 5)]
        evidences = [_evidence(c, rows, {}, seeds) for c in candidates]
        origins = [(10, 1, evidences[0]), (20, 2, evidences[2])]
        expected, consumed = [], set()
        for original, _, old in origins:
            old_ids = {s['txId'] for s in old['seeds']}
            additions = [e for e in evidences if old_ids & {s['txId'] for s in e['seeds']}]
            evidence = _extend(old, additions)
            consumed.update(s['txId'] for s in evidence['seeds'])
            expected.append((original, evidence))
        expected.extend((None, e) for e in evidences if {s['txId'] for s in e['seeds']} - consumed)
        with patch('alert_pipeline._evidence', wraps=_evidence) as generate:
            plans = _plans(iter(origins), candidates, rows, {}, seeds)
            self.assertEqual(generate.call_count, 0)
            first = next(plans)
            # One addition and one extended document, not every candidate/origin.
            self.assertEqual(generate.call_count, 2)
            actual = [first, *plans]
        self.assertEqual(actual, expected)


if __name__ == '__main__':
    unittest.main()
