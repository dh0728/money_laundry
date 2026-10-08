"""Contract regressions for the replacement's pure graph stage."""
from dataclasses import replace
import random
import unittest
from unittest.mock import patch
from flow_graph import EdgeTable, FlowIndex, FlowPolicy, GraphBudgetExceeded, HOUR_US, build_flow_graphs
from evaluate_flow_graph import load_dataset, metric, Dataset, choose_seeds


def table(rows):
    edges = EdgeTable()
    accounts = {}
    for tx_id, hour, sender, receiver in rows:
        for account in (sender, receiver):
            accounts.setdefault(account, len(accounts) + 1)
        edges.append(tx_id, int(hour * HOUR_US), accounts[sender], accounts[receiver])
    return edges


class FlowGraphTests(unittest.TestCase):
    def build(self, rows, seeds, **options):
        return build_flow_graphs(FlowIndex(table(rows)), seeds, replace(FlowPolicy(), **options))

    def members(self, graph):
        return set(graph.seed_ids + graph.connection_ids + graph.context_ids)

    def test_isolated_is_not_an_alert(self):
        result = self.build([(10, 0, "A", "B")], [10])
        self.assertEqual(result.graphs, ())
        self.assertEqual(result.ungrouped_seed_ids, (10,))

    def test_observed_two_edge_flow_can_include_one_missed_seed(self):
        result = self.build([(10, 0, "A", "B"), (20, 1, "B", "C")], [10])
        self.assertEqual(result.graphs[0].seed_ids, (10,))
        self.assertEqual(result.graphs[0].connection_ids, (20,))

    def test_unscored_branch_and_actual_repeat_are_evidence(self):
        for other in (("A", "C"), ("A", "B"), ("C", "B")):
            with self.subTest(other=other):
                result = self.build([(1, 0, "A", "B"), (2, 0, *other)], [1])
                self.assertEqual(self.members(result.graphs[0]), {1, 2})

    def test_same_time_and_reverse_flow_are_not_causality(self):
        for hour in (0, -1):
            result = self.build([(1, 0, "A", "B"), (2, hour, "B", "C")], [1])
            self.assertFalse(result.graphs)

    def test_subsecond_forward_flow_and_exact_window(self):
        for hour in (1 / 3_600_000_000, 72):
            self.assertEqual(len(self.build([(1, 0, "A", "B"), (2, hour, "B", "C")], [1]).graphs), 1)
        self.assertFalse(self.build([(1, 0, "A", "B"), (2, 73, "B", "C")], [1]).graphs)

    def test_normal_bridge_merges_two_seeds_with_no_context_budget(self):
        result = self.build([(1, 0, "A", "B"), (2, 1, "B", "C"), (3, 2, "C", "D")],
                            [1, 3], context_per_seed=0)
        self.assertEqual(len(result.graphs), 1)
        self.assertEqual(result.graphs[0].seed_ids, (1, 3))
        self.assertEqual(result.graphs[0].connection_ids, (2,))

    def test_context_overlap_does_not_merge_seeds(self):
        rows = [(1, 0, "A", "X"), (2, 0, "B", "Y"), (3, 1, "X", "Z"),
                (4, 1, "Y", "Z"), (5, 2, "Z", "Q")]
        result = self.build(rows, [1, 2])
        self.assertEqual([graph.seed_ids for graph in result.graphs], [(1,), (2,)])
        self.assertTrue(all(5 in self.members(graph) for graph in result.graphs))

    def test_peer_is_leaf_and_direction_does_not_reverse(self):
        rows = [(1, 1, "A", "B"), (2, 2, "A", "C"), (3, 3, "C", "D"),
                (4, 2, "B", "E"), (5, 1.5, "Z", "E")]
        result = self.build(rows, [1])
        self.assertNotIn(3, self.members(result.graphs[0]))
        self.assertNotIn(5, self.members(result.graphs[0]))

    def test_reorder_noncontiguous_ids_and_duplicate_seed_input(self):
        rows = [(90, 1, "A", "B"), (5, 2, "B", "C"), (70, 3, "C", "D")]
        first = self.build(rows, [90, 70])
        self.assertEqual(first, self.build(list(reversed(rows)), [70, 90, 90]))

    def test_same_content_different_occurrences_preserved(self):
        result = self.build([(91, 0, "A", "B"), (92, 0, "A", "B")], [91, 92])
        self.assertEqual(result.graphs[0].seed_ids, (91, 92))
        self.assertEqual(self.members(result.graphs[0]), {91, 92})
        self.assertEqual([witness.kind for witness in result.graphs[0].witnesses], ["REPEAT"])

    def test_late_normal_bridge_reconsiders_unassigned_old_seeds(self):
        rows = [(1, 0, "A", "B"), (3, 2, "C", "D")]
        self.assertEqual(self.build(rows, [1, 3]).ungrouped_seed_ids, (1, 3))
        self.assertEqual(self.build(rows + [(2, 1, "B", "C")], [1, 3]).graphs[0].seed_ids, (1, 3))

    def test_component_span_does_not_chain_forever(self):
        rows = [(i + 1, i * 60, str(i), str(i + 1)) for i in range(7)]
        result = self.build(rows, range(1, 8))
        self.assertGreater(result.rejected_span_relations, 0)
        at = {tx_id: hour for tx_id, hour, _, _ in rows}
        for graph in result.graphs:
            core = graph.seed_ids + graph.connection_ids
            self.assertLessEqual(max(at[tx_id] for tx_id in core) - min(at[tx_id] for tx_id in core), 240)

    def test_hub_seed_hyperedge_not_skipped_or_clique_expanded(self):
        rows = [(i, 0, "H", str(i)) for i in range(1, 302)]
        result = self.build(rows, range(1, 302), neighbors_per_step=2, max_relations=2)
        self.assertEqual(len(result.graphs), 1)
        self.assertEqual(len(result.graphs[0].seed_ids), 301)
        self.assertGreater(result.selected_neighbor_windows, 0)

    def test_budget_failure_cannot_masquerade_as_empty_success(self):
        rows = [(1, 0, "A", "B"), (2, 1, "B", "C")]
        with self.assertRaisesRegex(GraphBudgetExceeded, "EDGE_VISITS"):
            self.build(rows, [1], max_edge_visits=1)
        with self.assertRaisesRegex(GraphBudgetExceeded, "CORE_SIZE"):
            self.build(rows, [1], max_core_edges=1)

    def test_duplicate_ids_invalid_seeds_and_immutable_append(self):
        with self.assertRaises(ValueError):
            self.build([(1, 0, "A", "B"), (1, 0, "B", "C")], [1])
        for seeds in ([True], [2], [0], ["1"]):
            with self.subTest(seeds=seeds), self.assertRaises(ValueError):
                self.build([(1, 0, "A", "B")], seeds)
        edges = table([(1, 0, "A", "B")]).freeze()
        with self.assertRaises(ValueError):
            edges.append(2, 1, 1, 2)
        with self.assertRaises(TypeError):
            edges.tx_ids[0] = 9

    def test_empty_and_no_seed(self):
        self.assertFalse(self.build([], []).graphs)
        self.assertFalse(self.build([(1, 0, "A", "B")], []).graphs)

    def test_self_transfer_does_not_establish_single_seed_flow(self):
        self.assertFalse(self.build([(1, 0, "A", "A"), (2, 1, "A", "B")], [1]).graphs)

    def test_membership_roles_are_disjoint_and_witnesses_are_in_core(self):
        rows = [(1, 0, "A", "B"), (2, 1, "B", "C"), (3, 2, "C", "D"),
                (4, 1, "A", "Z")]
        graph = self.build(rows, [1, 3]).graphs[0]
        s, b, c = set(graph.seed_ids), set(graph.connection_ids), set(graph.context_ids)
        self.assertFalse(s & b or s & c or b & c)
        for witness in graph.witnesses:
            self.assertTrue(set(witness.tx_ids) <= s | b)

    def test_no_seed_lost_in_normal_neighbor_selection(self):
        rows = [(1, 0, "A", "H"), (100, 2, "H", "Z")]
        rows += [(i, 1, "H", str(i)) for i in range(2, 20)]
        result = self.build(rows, [1, 100], neighbors_per_step=1)
        self.assertEqual(result.graphs[0].seed_ids, (1, 100))

    def test_index_selection_matches_full_scan_with_large_time_ties(self):
        rng = random.Random(8462)
        rows = [(i + 1, rng.randrange(8), "H", str(i)) for i in range(600)]
        index = FlowIndex(table(rows))
        edges = index.edges
        positions = index.outgoing[1]
        for trial in range(100):
            anchor = rng.randrange(10) * HOUR_US
            begin = rng.randrange(200)
            end = rng.randrange(400, 601)
            limit = rng.randrange(1, 65)
            exclude = rng.choice(positions) if trial % 2 else None
            selected, examined, count = index.nearest(positions, begin, end, anchor, limit, exclude)
            full = [pos for pos in positions[begin:end] if pos != exclude]
            expected = sorted(full, key=lambda pos: (
                abs(edges.occurred_us[pos] - anchor), edges.occurred_us[pos], edges.tx_ids[pos]))[:limit]
            self.assertEqual(selected, expected)
            self.assertEqual(count, len(full))
            self.assertLessEqual(examined, 3 * (limit + 1))

    def test_context_total_is_bounded_but_core_is_not_cut(self):
        rows = [(i, i, "H", str(i)) for i in range(1, 31)]
        result = self.build(rows, [1, 10, 20], max_context_edges=3)
        self.assertEqual(len(result.graphs), 1)
        graph = result.graphs[0]
        self.assertEqual(graph.seed_ids, (1, 10, 20))
        self.assertLessEqual(len(graph.context_ids), 3)
        self.assertIn("CONTEXT_SELECTION", graph.limits)

    def test_branch_seed_chain_is_bounded_by_component_span(self):
        rows = [(i, i * 60, "H", str(i)) for i in range(1, 8)]
        result = self.build(rows, range(1, 8))
        self.assertEqual([graph.seed_ids for graph in result.graphs], [(1, 2, 3, 4, 5), (6, 7)])

    def test_policy_and_rejected_witnesses_are_auditable(self):
        rows = [(i + 1, i * 60, str(i), str(i + 1)) for i in range(7)]
        result = self.build(rows, range(1, 8))
        self.assertTrue(result.rejected_relations)
        self.assertTrue(all(item.witness.tx_ids and item.reason == "COMPONENT_SPAN"
                            for item in result.rejected_relations))
        changed = self.build(rows, range(1, 8), context_per_seed=3)
        self.assertNotEqual(result.policy_digest, changed.policy_digest)

    def test_one_span_conflict_does_not_veto_entire_branch(self):
        # Seed 1 has an earlier flow root; joining it with all later H seeds
        # exceeds 240h, but the remaining branch is still valid on its own.
        rows = [(1, 0, "A", "B"), (2, 60, "B", "C"), (3, 120, "C", "H"),
                (4, 180, "H", "D"), (5, 241, "H", "E"), (6, 250, "H", "F")]
        result = self.build(rows, range(1, 7))
        self.assertGreater(result.rejected_span_relations, 0)
        self.assertTrue(any({5, 6} <= set(graph.seed_ids) for graph in result.graphs))

    def test_same_account_text_in_different_banks_stays_distinct(self):
        first = ["2022/09/01 00:00", "1", "A", "2", "B", "1", "USD",
                 "1", "USD", "ACH", "1"]
        second = ["2022/09/01 01:00", "9", "B", "3", "C", "1", "USD",
                  "1", "USD", "ACH", "0"]
        with patch("evaluate_flow_graph.read_patterns", return_value=({}, {})), \
                patch("evaluate_flow_graph.source_rows", return_value=iter([first, second])):
            data = load_dataset(None, None, None)
        self.assertNotEqual(data.edges.to_accounts[0], data.edges.from_accounts[1])
        self.assertFalse(build_flow_graphs(FlowIndex(data.edges), [1], FlowPolicy()).graphs)

    def test_ungrouped_is_not_silently_classified_as_normal(self):
        result = self.build([(1, 0, "A", "B"), (2, 0, "C", "C")], [1, 2])
        self.assertEqual([(item.tx_id, item.reason) for item in result.unassigned],
                         [(1, "NO_RELATION_WITHIN_POLICY"), (2, "SELF_TRANSFER_NO_WITNESS")])

    def test_low_seed_share_hub_is_not_one_automatic_case(self):
        rows = [(i, 0, "H", str(i)) for i in range(1, 1001)]
        result = self.build(rows, [1, 2])
        self.assertEqual([graph.seed_ids for graph in result.graphs], [(1,), (2,)])
        self.assertTrue(all("AMBIGUOUS_HUB" in graph.limits for graph in result.graphs))
        self.assertTrue(all(len(graph.context_ids) <= 16 for graph in result.graphs))
        self.assertTrue(any(item.reason == "AMBIGUOUS_HUB" for item in result.rejected_relations))

    def test_dense_supported_seed_branch_is_not_blindly_skipped(self):
        rows = [(i, 0, "H", str(i)) for i in range(1, 601)]
        result = self.build(rows, range(1, 601))
        self.assertEqual(len(result.graphs), 1)
        self.assertEqual(len(result.graphs[0].seed_ids), 600)
        self.assertNotIn("AMBIGUOUS_HUB", result.graphs[0].limits)

    def test_rejected_hub_evidence_is_deterministic_with_recoded_accounts(self):
        rows = [(i, 0, "H1", str(i)) for i in range(1, 601)]
        rows += [(i, 0, "H2", str(i)) for i in range(1001, 1601)]
        self.assertEqual(self.build(rows, [1, 2, 1001, 1002]),
                         self.build(list(reversed(rows)), [1002, 1, 1001, 2]))


class FlowEvaluationTests(unittest.TestCase):
    def test_ground_truth_is_not_needed_by_graph_builder(self):
        row = ["2022/09/01 00:00", "1", "A", "2", "B", "1", "USD",
               "1", "USD", "ACH", "1"]
        second = ["2022/09/01 01:00", "2", "B", "3", "C", "1", "USD",
                  "1", "USD", "ACH", "0"]
        results = []
        for label in ("0", "1"):
            changed = row[:-1] + [label]
            with patch("evaluate_flow_graph.read_patterns", return_value=({}, {})), \
                    patch("evaluate_flow_graph.source_rows", return_value=iter([changed, second])):
                data = load_dataset(None, None, None)
            results.append(build_flow_graphs(FlowIndex(data.edges), [1], FlowPolicy()))
        self.assertEqual(results[0], results[1])

    def test_cutoff_preserves_source_occurrence_ids(self):
        from evaluate_flow_graph import KST
        from datetime import datetime
        base = ["2022/09/02 00:00", "1", "A", "2", "B", "1", "USD",
                "1", "USD", "ACH", "1"]
        earlier = ["2022/09/01 00:00"] + base[1:]
        cutoff = int(datetime(2022, 9, 2, tzinfo=KST).timestamp()) * 1_000_000
        with patch("evaluate_flow_graph.read_patterns", return_value=({}, {})), \
                patch("evaluate_flow_graph.source_rows", return_value=iter([base, earlier])):
            data = load_dataset(None, None, None, end_day=cutoff)
        self.assertEqual(list(data.edges.tx_ids), [2])
        self.assertEqual(data.edges.position(2), 0)

    @staticmethod
    def build_result(rows):
        return build_flow_graphs(FlowIndex(table(rows)), [10], FlowPolicy())

    def test_occurrence_ambiguity_is_not_assigned_by_row_order(self):
        from evaluate_flow_graph import transaction_key
        row = ["2022/09/01 00:00", "1", "A", "2", "B", "1.00", "USD",
               "1", "USD", "ACH", "1"]
        key = transaction_key(row)
        metadata = {0: {"kind": "FAN-OUT", "original_count": 1},
                    1: {"kind": "FAN-IN", "original_count": 1}}
        with patch("evaluate_flow_graph.read_patterns", return_value=({key: [0, 1]}, metadata)), \
                patch("evaluate_flow_graph.source_rows", return_value=iter([row, row])):
            data = load_dataset(None, None, None)
        self.assertEqual(len(data.edges), 2)
        self.assertEqual(data.audit["ambiguous_pattern_rows"], 2)
        self.assertEqual(data.truth, {})

    def test_zero_seed_blocks_remain_in_denominator_audit(self):
        edges = table([(1, 0, "A", "B"), (2, 1, "B", "C")]).freeze()
        data = Dataset(edges, {1, 2}, {0: {1, 2}},
                       {0: {"kind": "CHAIN", "original_count": 2}}, {1: 0, 2: 0}, {})
        report = metric([], data, set())
        self.assertEqual((report["observed_multi_blocks"], report["eligible_blocks"],
                          report["seed_zero_blocks"]), (1, 0, 1))

    def test_normal_injection_never_removes_real_positive_seed(self):
        edges = table([(i, i, "A", str(i)) for i in range(1, 8)]).freeze()
        data = Dataset(edges, {1, 2}, {}, {}, {}, {})
        self.assertEqual(len(choose_seeds(data, "fp")), 4)
        self.assertTrue({1, 2} <= choose_seeds(data, "fp"))


if __name__ == "__main__":
    unittest.main()

