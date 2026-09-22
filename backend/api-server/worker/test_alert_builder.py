from dataclasses import replace
from datetime import datetime, timedelta, timezone
import unittest

from alert_builder import Transaction, Policy, build_candidates


class AlertBuilderTests(unittest.TestCase):
    def setUp(self):
        self.start = datetime(2026, 9, 20, 0, tzinfo=timezone.utc)
        self.policy = Policy("test-only-v2", .7, timedelta(hours=12), timedelta(hours=12), 4, 20, 20)

    def tx(self, number, hour, source, destination):
        return Transaction(number, self.start + timedelta(hours=hour), source, destination)

    def build(self, rows, scores, policy=None):
        return build_candidates(rows, scores, policy or self.policy,
                                coverage_start=self.start - timedelta(days=1),
                                coverage_end=self.start + timedelta(days=2))

    def ids(self, candidate):
        return {row.tx_id for row in candidate.transactions}

    def test_unscored_and_low_score_context_surround_seed(self):
        rows = [self.tx(1, 1, "A", "B"), self.tx(2, 2, "B", "C"), self.tx(3, 3, "C", "D")]
        result = self.build(rows, {2: .9, 3: .1})
        self.assertEqual(len(result), 1)
        self.assertEqual(self.ids(result[0]), {1, 2, 3})
        self.assertEqual([r.role for r in result[0].transactions], ["CONNECTION", "SEED", "CONNECTION"])

    def test_branches_are_included_without_pattern_predictions(self):
        rows = [self.tx(1, 1, "A", "B"), self.tx(2, 2, "A", "C"), self.tx(3, 3, "D", "B")]
        result = self.build(rows, {1: .9})[0]
        self.assertEqual(self.ids(result), {1, 2, 3})
        self.assertEqual(result.transactions[1].role, "CONTEXT")
        self.assertIn("SHARED_DESTINATION", result.transactions[2].reasons)

    def test_direction_does_not_reverse_at_downstream_intersection(self):
        rows = [self.tx(1, 1, "A", "B"), self.tx(2, 2, "B", "C"), self.tx(3, 1.5, "X", "B")]
        self.assertEqual(self.ids(self.build(rows, {1: .9})[0]), {1, 2, 3})
        # A later convergence after following the seed must not expand backwards.
        rows.append(self.tx(4, 1.5, "Z", "C"))
        self.assertNotIn(4, self.ids(self.build(rows, {1: .9})[0]))

    def test_time_order_and_window_restrict_flow(self):
        rows = [self.tx(1, 2, "A", "B"), self.tx(2, 1, "B", "C"), self.tx(3, 20, "B", "D")]
        result = self.build(rows, {1: .9})[0]
        self.assertEqual(self.ids(result), {1})
        self.assertIn("TIME_WINDOW", result.limits)

    def test_actual_flow_merges_seeds(self):
        rows = [self.tx(1, 1, "A", "B"), self.tx(2, 2, "B", "C"), self.tx(3, 3, "C", "D")]
        result = self.build(rows, {1: .8, 3: .9})
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].seed_ids, (1, 3))

    def test_shared_nonseed_flow_is_preserved_without_merging_seeds(self):
        rows = [self.tx(1, 1, "A", "X"), self.tx(2, 1, "B", "Y"),
                self.tx(3, 2, "X", "Z"), self.tx(4, 2, "Y", "Z")]
        rows += [self.tx(i, 3, "Z", f"D{i}") for i in range(5, 8)]
        result = self.build(rows, {1: .9, 2: .9, 5: .1})
        self.assertEqual([c.seed_ids for c in result], [(1,), (2,)])
        self.assertEqual(self.ids(result[0]), {1, 3, 5, 6, 7})
        self.assertEqual(self.ids(result[1]), {2, 4, 5, 6, 7})
        self.assertTrue(all(r.role == "CONNECTION" for c in result
                            for r in c.transactions if r.tx_id in (5, 6, 7)))
        self.assertEqual(result, self.build(list(reversed(rows)), {2: .9, 1: .9, 5: .1}))

    def test_hub_does_not_merge_unrelated_seeds(self):
        rows = [self.tx(i, i / 10, f"A{i}", "EXCHANGE") for i in range(1, 7)]
        result = self.build(rows, {1: .9, 2: .9}, replace(self.policy, max_account_transactions=3))
        self.assertEqual(len(result), 2)
        self.assertTrue(all(len(c.transactions) == 1 and "ACCOUNT_ACTIVITY" in c.limits for c in result))

    def test_merge_cannot_exceed_size_limit(self):
        rows = [self.tx(i, i, str(i), str(i + 1)) for i in range(1, 7)]
        result = self.build(rows, {1: .9, 3: .9, 6: .9}, replace(self.policy, max_transactions=3))
        self.assertTrue(all(len(c.transactions) <= 3 for c in result))
        self.assertTrue(any("MERGE_LIMIT" in c.limits for c in result))

    def test_depth_size_and_snapshot_boundaries_are_explicit(self):
        rows = [self.tx(i, i, str(i), str(i + 1)) for i in range(1, 7)]
        shallow = self.build(rows, {1: .9}, replace(self.policy, max_depth=1))[0]
        self.assertIn("DEPTH", shallow.limits)
        limited = self.build(rows, {1: .9}, replace(self.policy, max_transactions=1))[0]
        self.assertIn("TRANSACTION_COUNT", limited.limits)
        result = build_candidates(rows, {1: .9}, self.policy,
                                  coverage_start=self.start, coverage_end=self.start + timedelta(hours=7))
        self.assertIn("SNAPSHOT_START", result[0].limits)
        self.assertIn("SNAPSHOT_END", result[0].limits)

    def test_deterministic_with_reordered_input_and_duplicate_occurrences_preserved(self):
        rows = [self.tx(1, 1, "A", "B"), self.tx(2, 1, "A", "B"), self.tx(3, 2, "B", "C")]
        result = self.build(rows, {1: .9})
        self.assertEqual(result, self.build(list(reversed(rows)), {1: .9}))
        self.assertEqual(self.ids(result[0]), {1, 2, 3})

    def test_no_seed_no_candidate_and_invalid_inputs_fail(self):
        rows = [self.tx(1, 1, "A", "B")]
        self.assertEqual(self.build(rows, {1: .1}), [])
        for scores in ({1: float("nan")}, {2: .9}, {1: True}):
            with self.assertRaises(ValueError):
                self.build(rows, scores)
        with self.assertRaises(ValueError):
            self.build(rows + rows, {1: .9})
        with self.assertRaises(ValueError):
            self.build(rows, {1: .9}, replace(self.policy, max_depth=0))


if __name__ == "__main__":
    unittest.main()
