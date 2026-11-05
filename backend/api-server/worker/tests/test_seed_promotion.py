"""Seed promotion before the block generator (dual threshold + amount-ratio chaining)."""
import unittest

from alerts.seed_promotion import CHAIN_DEPTH, promote
from tests.test_block_graph import table

LOW, FLOOR = 0.1, 0.01


def promoted(rows, scores, seeds):
    edges = table(rows)
    return sorted(edges.tx_ids[i] for i in promote(edges, scores, set(seeds), LOW, FLOOR))


class SeedPromotionTests(unittest.TestCase):
    def test_dual_threshold_needs_a_shared_account_and_the_low_score(self):
        rows = [(1, 0, "A", "B"), (2, 50, "C", "D"),   # seed, unrelated seed
                (3, 100, "X", "A", 1.0),              # shares A, scored at low: promoted
                (4, 100, "Y", "A", 1.0),              # shares A, below low: not promoted
                (5, 100, "X", "Z", 1.0)]              # scored, but no seed account
        scores = {1: 0.9, 2: 0.9, 3: 0.1, 4: 0.09, 5: 0.5}
        self.assertEqual(promoted(rows, scores, {1, 2}), [3])

    def test_chain_follows_amount_ratio_forward_and_backward(self):
        rows = [(1, 0, "S", "A", 1000.0),             # earlier deposit into the seed sender
                (2, 10, "A", "B", 1000.0),            # seed
                (3, 20, "B", "C", 950.0),             # 0.95x onward: promoted
                (4, 30, "C", "D", 940.0),             # chain continues from 3
                (5, 40, "C", "E", 400.0),             # 0.42x: outside the band
                (6, 30, "B", "F", 1060.0)]            # 1.06x: outside the band
        scores = {1: 0.02, 2: 0.9, 3: 0.02, 4: 0.02, 5: 0.02, 6: 0.02}
        self.assertEqual(promoted(rows, scores, {2}), [1, 3, 4])

    def test_chain_skips_unscored_low_unknown_and_late_transactions(self):
        rows = [(1, 0, "A", "B", 1000.0),             # seed
                (2, 1, "B", "C", 990.0),              # below the floor
                (3, 2, "B", "D", None),               # unknown amount
                (4, 3, "B", "E", 980.0),              # not scored
                (5, 7 * 24 + 1, "B", "F", 970.0),     # more than 7 days later
                (6, 7 * 24, "B", "G", 960.0)]         # exactly 7 days later: still in
        scores = {1: 0.9, 2: 0.005, 3: 0.05, 5: 0.05, 6: 0.02}
        self.assertEqual(promoted(rows, scores, {1}), [6])

    def test_chain_stops_after_the_depth_limit(self):
        names = [f"N{i}" for i in range(CHAIN_DEPTH + 3)]
        rows = [(i + 1, i, names[i], names[i + 1], 1000.0) for i in range(len(names) - 1)]
        scores = {row[0]: 0.02 for row in rows} | {1: 0.9}
        self.assertEqual(promoted(rows, scores, {1}), list(range(2, CHAIN_DEPTH + 2)))

    def test_dual_promotions_also_start_chains(self):
        rows = [(1, 0, "A", "B", 10.0),               # seed
                (2, 5, "X", "A", 500.0),              # dual promotion through account A
                (3, 10, "A", "Y", 490.0)]             # 0.98x of 2, onward from A
        scores = {1: 0.9, 2: 0.2, 3: 0.02}
        self.assertEqual(promoted(rows, scores, {1}), [2, 3])

    def test_no_seed_no_promotion(self):
        rows = [(1, 0, "A", "B"), (2, 1, "B", "C")]
        self.assertEqual(promoted(rows, {1: 0.3, 2: 0.3}, set()), [])


if __name__ == "__main__":
    unittest.main()
