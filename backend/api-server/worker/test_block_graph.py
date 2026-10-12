"""Contract regressions for the block-pin-1 generator, stage 1 (faces, PASS, assembly)."""
from dataclasses import replace
import random
import unittest

from alert_lifecycle import Action, Evidence, build_case_plans
from block_graph import BlockInputError, BlockPolicy, build_block_graphs
from flow_graph import EdgeTable, FlowIndex, GraphBudgetExceeded, HOUR_US, Witness

USD = 1_000_000


def table(rows):
    """rows: (tx_id, hour, sender, receiver[, usd]); usd None marks an unknown amount."""
    edges = EdgeTable()
    # Account codes follow sorted names so that shuffling rows cannot change them.
    names = sorted({name for row in rows for name in row[2:4]})
    accounts = {name: code for code, name in enumerate(names, 1)}
    for row in rows:
        tx_id, hour, sender, receiver = row[:4]
        usd = row[4] if len(row) > 4 else 1000.0
        edges.append(tx_id, int(hour * HOUR_US), accounts[sender], accounts[receiver],
                     None if usd is None else round(usd * USD))
    return edges


def fan(sender, count, start_hour=0, step=6.0, first_id=100, usd=1000.0):
    return [(first_id + i, start_hour + i * step, sender, f"{sender}R{i}", usd) for i in range(count)]


def chain(accounts, start_hour=0, step=4.0, first_id=100, usd=1000.0):
    return [(first_id + i, start_hour + i * step, accounts[i], accounts[i + 1], usd)
            for i in range(len(accounts) - 1)]


class BlockGraphTests(unittest.TestCase):
    def build(self, rows, seeds, groups=(), **options):
        return build_block_graphs(FlowIndex(table(rows)), seeds, replace(BlockPolicy(), **options),
                                  seed_groups=groups)

    def kinds(self, graph):
        return sorted({w.kind for w in graph.witnesses})

    def test_isolated_seed_is_not_a_block(self):
        batch = self.build([(10, 0, "A", "B")], [10])
        self.assertEqual(batch.graphs, ())
        self.assertEqual(batch.unassigned[0].reason, "NO_STRUCTURE")

    def test_two_spokes_make_a_star_with_no_context(self):
        batch = self.build(fan("A", 2), [100, 101])
        graph, = batch.graphs
        self.assertEqual(graph.seed_ids, (100, 101))
        self.assertEqual(graph.connection_ids, ())
        self.assertEqual(graph.context_ids, ())
        self.assertEqual(graph.witnesses, (Witness("STAR_OUT", (100, 101)),))
        self.assertEqual(graph.focal_accounts, (1,))
        self.assertEqual(batch.flow_batch().graphs[0].seed_ids, (100, 101))

    def test_star_gap_and_width_cut_intervals(self):
        self.assertEqual(self.build(fan("A", 2, step=96.0), [100, 101]).graphs[0].seed_ids, (100, 101))
        self.assertEqual(self.build(fan("A", 2, step=96.5), [100, 101]).graphs, ())
        wide = fan("A", 4, step=60.0)  # 0, 60, 120, 180 within gap but 180 < 192
        self.assertEqual(len(self.build(wide, [100, 101, 102, 103]).graphs[0].seed_ids), 4)
        wider = fan("A", 5, step=60.0)  # 240 exceeds width 192 → second interval of one seed
        batch = self.build(wider, [100, 101, 102, 103, 104])
        self.assertEqual(batch.graphs[0].seed_ids, (100, 101, 102, 103))
        self.assertEqual(batch.unassigned[0].tx_id, 104)

    def test_seed_belongs_to_one_star_only(self):
        rows = fan("A", 3) + [(200, 1, "X", "AR0", 1000.0)]  # AR0 also receives from X
        batch = self.build(rows, [100, 101, 102, 200])
        self.assertEqual([g.seed_ids for g in batch.graphs], [(100, 101, 102)])
        self.assertEqual(batch.unassigned[0].tx_id, 200)

    def test_star_chunks_at_star_max_and_links_neighbours(self):
        batch = self.build(fan("A", 5, step=1.0), [100, 101, 102, 103, 104], star_max=3)
        self.assertEqual([g.seed_ids for g in batch.graphs], [(100, 101, 102), (103, 104)])
        self.assertIn("STAR_CHUNKED", batch.graphs[0].limits)
        self.assertEqual(batch.graphs[0].boundary_witnesses, (Witness("BOUNDARY_STAR_CHUNK", (102, 103)),))

    def test_pass_requires_order_lag_band_and_distinct_accounts(self):
        rows = [(1, 0, "A", "Y", 1000.0), (2, 10, "Y", "C", 950.0)]
        graph, = self.build(rows, [1, 2]).graphs
        self.assertEqual(graph.witnesses, (Witness("PASS", (1, 2)),))
        self.assertEqual(self.build([(1, 0, "A", "Y", 1000.0), (2, 10, "Y", "C", 700.0)], [1, 2]).graphs, ())
        self.assertEqual(self.build([(1, 0, "A", "Y", 1000.0), (2, 97, "Y", "C", 1000.0)], [1, 2]).graphs, ())
        self.assertEqual(self.build([(1, 10, "A", "Y", 1000.0), (2, 0, "Y", "C", 1000.0)], [1, 2]).graphs, ())
        self.assertEqual(self.build([(1, 0, "A", "Y", 1000.0), (2, 1, "Y", "Y", 1000.0)], [1, 2]).graphs, ())
        tight = [(1, 0, "A", "Y", 1000.0), (2, 1, "Y", "C", 1200.0)]
        self.assertEqual(len(self.build(tight, [1, 2]).graphs), 1)
        self.assertEqual(self.build(tight, [1, 2], ratio_num=9, ratio_den=10).graphs, ())

    def test_pass_matches_one_to_one_and_needs_a_margin(self):
        rows = [(1, 0, "A", "Y", 1000.0), (2, 1, "B", "Y", 1200.0), (3, 10, "Y", "C", 1000.0)]
        batch = self.build(rows, [1, 2, 3])
        self.assertEqual(batch.graphs[0].witnesses, (Witness("PASS", (1, 3)),))
        self.assertEqual(batch.unassigned[0].reason, "LINK_ONLY")
        contested = [(1, 0, "A", "Y", 1000.0), (2, 1, "B", "Y", 1002.0), (3, 10, "Y", "C", 1000.0)]
        batch = self.build(contested, [1, 2, 3])
        # No PASS survives the margin; the two inbound seeds still form a fan-in star.
        self.assertEqual(batch.graphs[0].witnesses, (Witness("STAR_IN", (1, 2)),))
        self.assertEqual({r.reason for r in batch.rejected_relations}, {"PASS_CONTESTED"})
        self.assertEqual(batch.unassigned, (type(batch.unassigned[0])(3, "LINK_ONLY"),))
        self.assertEqual(self.build(contested, [1, 2, 3], pass_margin=1).graphs[0].witnesses,
                         (Witness("PASS", (1, 3)),))

    def test_unknown_amount_never_passes(self):
        batch = self.build([(1, 0, "A", "Y", None), (2, 10, "Y", "C", 1000.0)], [1, 2])
        self.assertEqual(batch.graphs, ())
        self.assertEqual(batch.unassigned[0].reason, "NO_STRUCTURE")

    def test_strong_star_absorbs_a_dangling_chain(self):
        rows = fan("A", 5) + [(200, 8, "AR0", "Z", 1000.0)]  # spoke AR0 forwards the money
        batch = self.build(rows, [100, 101, 102, 103, 104, 200])
        graph, = batch.graphs
        self.assertEqual(graph.seed_ids, (100, 101, 102, 103, 104, 200))
        self.assertEqual(self.kinds(graph), ["PASS", "STAR_OUT"])

    def test_weak_star_joins_one_established_block_only(self):
        rows = ([(1, 0, "A", "P", 1000.0), (2, 4, "P", "Q", 1000.0),      # block one: PASS chain
                 (3, 0, "A", "R", 1000.0), (4, 4, "R", "S", 1000.0)])     # block two: PASS chain
        batch = self.build(rows, [1, 2, 3, 4])
        self.assertEqual([g.seed_ids for g in batch.graphs], [(1, 2), (3, 4)])
        self.assertEqual(batch.graphs[0].boundary_witnesses, (Witness("BOUNDARY_SAME_FOCAL", (1, 3)),))
        strong = self.build(rows, [1, 2, 3, 4], star_strong=2)
        self.assertEqual([g.seed_ids for g in strong.graphs], [(1, 2, 3, 4)])

    def test_core_cap_splits_with_link_and_limit(self):
        accounts = [f"N{i}" for i in range(70)]
        rows = chain(accounts, step=1.0)
        seeds = [row[0] for row in rows]
        batch = self.build(rows, seeds)
        self.assertEqual([len(g.seed_ids) for g in batch.graphs], [64, 5])
        self.assertIn("CORE_CAP", batch.graphs[0].limits)
        self.assertEqual(batch.graphs[0].boundary_witnesses[0].kind, "BOUNDARY_CAP")
        self.assertTrue(all(len(w.tx_ids) == 2 for w in batch.graphs[0].witnesses))

    def test_component_span_splits(self):
        rows = chain([f"N{i}" for i in range(7)], step=60.0)  # six hops at 0..300h
        batch = self.build(rows, [row[0] for row in rows])
        self.assertEqual([g.seed_ids for g in batch.graphs], [(100, 101, 102, 103, 104)])
        self.assertIn("COMPONENT_SPAN", batch.graphs[0].limits)

    def test_pinned_groups_are_never_joined(self):
        # A fans out to AR0/AR1; AR1 forwards (PASS) and fans out itself.
        rows = fan("A", 2, first_id=10) + [(20, 10, "AR1", "BR0", 1000.0), (21, 16, "AR1", "BR1", 300.0)]
        free = self.build(rows, [10, 11, 20, 21])
        self.assertEqual([g.seed_ids for g in free.graphs], [(10, 11, 20)])
        groups = [((10, 11), (10, 11), (10, 11), (Witness("STAR_OUT", (10, 11)),)),
                  ((20, 21), (20, 21), (20, 21), (Witness("STAR_OUT", (20, 21)),))]
        batch = self.build(rows, [10, 11, 20, 21], groups)
        self.assertEqual([(g.seed_ids, g.pinned_group) for g in batch.graphs],
                         [((10, 11), 0), ((20, 21), 1)])
        self.assertEqual(batch.graphs[1].boundary_witnesses, (Witness("BOUNDARY_OPEN_PAIR", (11, 20)),))
        # Without its published witnesses a pinned block cannot re-form its star; the
        # lifecycle keeps the old case and nothing is fabricated as new evidence.
        legacy = self.build(rows, [10, 11, 20, 21], [group[:3] for group in groups])
        self.assertEqual(legacy.graphs, ())

    def test_pinned_star_extends_on_its_own_face(self):
        rows = fan("A", 3)
        groups = [((100, 101), (100, 101), (100, 101), (Witness("STAR_OUT", (100, 101)),))]
        batch = self.build(rows, [100, 101, 102], groups)
        graph, = batch.graphs
        self.assertEqual((graph.seed_ids, graph.pinned_group), ((100, 101, 102), 0))

    def test_reserved_history_counts_toward_the_cap_and_freezes_legacy(self):
        rows = [(1, 0, "A", "Y", 1000.0), (2, 10, "Y", "C", 1000.0)]
        held = tuple(range(1000, 1063))  # 63 held transactions absent from this input
        batch = self.build(rows, [1, 2], [((1,), held + (1,), held + (1,))])
        self.assertEqual(batch.graphs, ())
        self.assertEqual({u.reason for u in batch.unassigned}, {"CORE_CAP"})
        frozen = self.build(rows, [1, 2], [((1,), tuple(range(1000, 1065)) + (1,), ())])
        self.assertEqual(frozen.graphs, ())
        self.assertEqual([u.reason for u in frozen.unassigned], ["FROZEN_LEGACY", "LINK_ONLY"])

    def test_overlapping_groups_are_rejected(self):
        with self.assertRaises(BlockInputError):
            self.build(fan("A", 2), [100, 101], [((100,), (100,), (100,)), ((100, 101), (), ())])

    def test_relay_modes(self):
        rows = ([(1, 0, "P", "F", 900.0), (2, 5, "Q", "F", 900.0), (3, 9, "R", "F", 900.0),
                 (4, 30, "F", "X", 500.0), (5, 40, "F", "Y", 2000.0)])
        batch = self.build(rows, [1, 2, 3, 4, 5])
        graph, = batch.graphs
        self.assertEqual(self.kinds(graph), ["RELAY", "STAR_IN", "STAR_OUT"])
        link_only = self.build(rows, [1, 2, 3, 4, 5], relay_mode="LINK_ONLY")
        self.assertEqual([g.seed_ids for g in link_only.graphs], [(1, 2, 3), (4, 5)])
        self.assertEqual(link_only.graphs[0].boundary_witnesses[0].kind, "BOUNDARY_SAME_FOCAL")
        late = self.build([(1, 0, "P", "F"), (2, 5, "Q", "F"), (4, 130, "F", "X"), (5, 140, "F", "Y")],
                          [1, 2, 4, 5])
        self.assertEqual(len(late.graphs), 2)

    def test_weak_relay_does_not_glue_two_structured_blocks(self):
        rows = ([(1, 0, "P", "F", 900.0), (2, 5, "Q", "F", 900.0), (3, 30, "F", "X", 500.0),
                 (4, 40, "F", "Y", 2000.0),
                 (5, -10, "U", "P", 900.0),   # in-side chain U→P→F
                 (6, 50, "X", "V", 500.0)])   # out-side chain F→X→V
        batch = self.build(rows, [1, 2, 3, 4, 5, 6])
        self.assertEqual(len(batch.graphs), 2)
        self.assertIn("BOUNDARY_SAME_FOCAL", {w.kind for w in batch.graphs[0].boundary_witnesses})
        strong = self.build(rows, [1, 2, 3, 4, 5, 6], relay_mode="STRONG")
        self.assertEqual(len(strong.graphs), 1)

    def test_hub_faces_and_passes_are_suppressed(self):
        rows = [(1000 + i, i * 0.1, "H", f"T{i}", 1000.0) for i in range(600)]
        rows += [(1, 20, "A", "H", 1000.0), (2, 30, "H", "B", 1000.0), (3, 31, "H", "C", 1000.0)]
        batch = self.build(rows, [1, 2, 3])
        self.assertEqual(batch.graphs, ())
        self.assertEqual({u.reason for u in batch.unassigned}, {"AMBIGUOUS_HUB"})
        self.assertEqual({r.reason for r in batch.rejected_relations}, {"AMBIGUOUS_HUB"})

    def test_self_transfer_seed_is_reported(self):
        batch = self.build([(1, 0, "A", "A"), (2, 1, "A", "B"), (3, 2, "A", "C")], [1, 2, 3])
        self.assertEqual(batch.graphs[0].seed_ids, (2, 3))
        self.assertEqual(batch.unassigned, (type(batch.unassigned[0])(1, "SELF_TRANSFER"),))

    def test_budget_failure_is_fatal(self):
        with self.assertRaises(GraphBudgetExceeded):
            self.build(chain(["A", "B", "C", "D"]), [100, 101, 102], max_edge_visits=1)

    def test_output_is_independent_of_input_order(self):
        rows = (fan("A", 6, step=5.0) + chain(["B", "C", "D", "E"], first_id=200)
                + [(300, 2, "AR1", "Q", 1000.0), (301, 7, "AR2", "C", 1000.0)])
        seeds = [row[0] for row in rows]
        groups = [((200, 201), (200, 201), (200, 201), (Witness("PASS", (200, 201)),))]
        reference = self.build(rows, seeds, groups)
        rng = random.Random(7)
        for _ in range(5):
            shuffled_rows = rows[:]
            rng.shuffle(shuffled_rows)
            shuffled_seeds = seeds[:]
            rng.shuffle(shuffled_seeds)
            batch = self.build(shuffled_rows, shuffled_seeds, groups)
            self.assertEqual(batch.graphs, reference.graphs)
            self.assertEqual(batch.unassigned, reference.unassigned)
            self.assertEqual(batch.rejected_relations, reference.rejected_relations)

    def test_publication_is_a_fixed_point(self):
        rows = (fan("A", 6, step=5.0) + chain(["B", "C", "D", "E"], first_id=200)
                + [(300, 2, "AR1", "Q", 1000.0), (301, 7, "AR2", "C", 1000.0),
                   (400, 0, "P", "F", 900.0), (401, 5, "Q2", "F", 900.0), (402, 30, "F", "X", 500.0),
                   (403, 40, "F", "Y", 2000.0)])
        seeds = [row[0] for row in rows]
        first = self.build(rows, seeds)
        groups = [(g.seed_ids, g.core_ids, g.core_ids, g.witnesses) for g in first.graphs]
        second = self.build(rows, seeds, groups)
        self.assertEqual([(g.seed_ids, g.witnesses) for g in second.graphs],
                         [(g.seed_ids, g.witnesses) for g in first.graphs])
        self.assertEqual([g.pinned_group for g in second.graphs], list(range(len(first.graphs))))
        self.assertEqual(second.unassigned, first.unassigned)

    def test_repeated_pair_is_not_a_star(self):
        rows = [(1, 0, "A", "B", 1000.0), (2, 5, "A", "B", 1200.0), (3, 9, "A", "C", 900.0)]
        self.assertEqual(self.build(rows, [1, 2]).graphs, ())
        self.assertEqual(self.build(rows, [1, 2], star_min_counterparties=1).graphs[0].seed_ids, (1, 2))
        self.assertEqual(self.build(rows, [1, 2, 3]).graphs[0].seed_ids, (1, 2, 3))
        # The rule applies to the adopted spokes, not only to the chunk: when the only
        # spoke with another counterparty cannot be absorbed, no star is formed.
        rows += [(4, 20, "C", "A", 900.0)]  # C sends back to A: C's chain is not dangling
        batch = self.build(rows, [1, 2, 3, 4])
        self.assertEqual([g.witnesses for g in batch.graphs], [(Witness("PASS", (3, 4)),)])
        self.assertEqual({u.tx_id for u in batch.unassigned}, {1, 2})

    def test_weak_star_rerun_keeps_its_single_established_slot(self):
        # Star A{1,2,3}: seeds 2 and 3 each head a dangling PASS chain; the weak star may
        # absorb only one (tie on bridges at A → the smaller root id, seed 2 wins).
        rows = [(1, 0, "A", "P", 1000.0), (2, 1, "A", "Q", 1000.0), (3, 2, "A", "R", 1000.0),
                (4, 10, "Q", "Q2", 1000.0), (5, 10, "R", "R2", 1000.0), (6, 20, "R2", "R3", 1000.0)]
        seeds = [1, 2, 3, 4, 5, 6]
        first = self.build(rows, seeds)
        self.assertEqual([g.seed_ids for g in first.graphs], [(1, 2, 4), (3, 5, 6)])
        self.assertEqual(first.graphs[0].boundary_witnesses, (Witness("BOUNDARY_SAME_FOCAL", (2, 3)),))
        groups = [(g.seed_ids, g.core_ids, g.core_ids, g.witnesses) for g in first.graphs]
        second = self.build(rows, seeds, groups)
        self.assertEqual([(g.seed_ids, g.witnesses) for g in second.graphs],
                         [(g.seed_ids, g.witnesses) for g in first.graphs])

    def test_pinned_block_contributes_only_published_spokes(self):
        # Star A{1,2,3}: seed 3 sits in a chain that is not absorbable (money leaves A
        # through it), so the star is (1,2). Seed 3's chain later joins the same block via
        # the strong star at R. The re-run must keep STAR_OUT(1,2), not add seed 3.
        rows = [(1, 0, "A", "P", 1000.0), (2, 1, "A", "Q", 1000.0), (3, 2, "A", "R", 1000.0),
                (4, 10, "R", "A", 1000.0),   # R sends back to A: not dangling for A's out face
                (5, 11, "R", "S1", 1000.0), (6, 12, "R", "S2", 1000.0), (7, 13, "R", "S3", 1000.0),
                (8, 14, "R", "S4", 1000.0), (9, 20, "P", "R", 1000.0)]
        seeds = list(range(1, 10))
        first = self.build(rows, seeds)
        groups = [(g.seed_ids, g.core_ids, g.core_ids, g.witnesses) for g in first.graphs]
        second = self.build(rows, seeds, groups)
        self.assertEqual([(g.seed_ids, g.witnesses) for g in second.graphs],
                         [(g.seed_ids, g.witnesses) for g in first.graphs])

    def test_real_output_is_accepted_by_the_lifecycle_planner(self):
        rows = fan("A", 3) + [(200, 8, "AR0", "Z", 1000.0)]
        batch = self.build(rows, [100, 101, 102, 200])
        graphs = [Evidence.from_graph(g.flow_graph(), "a" * 64) for g in batch.graphs]
        plan, = build_case_plans([], graphs).plans
        self.assertEqual(plan.action, Action.NEW)

    def test_policy_validation_and_digest(self):
        for options in (dict(relay_mode="SOFT"), dict(ratio_num=5, ratio_den=5), dict(star_max=1),
                        dict(star_width_us=HOUR_US), dict(core_max=1)):
            with self.assertRaises(ValueError):
                replace(BlockPolicy(), **options).validate()
        one = self.build(fan("A", 2), [100, 101])
        other = self.build(fan("A", 2), [100, 101], star_strong=3)
        self.assertNotEqual(one.policy_digest, other.policy_digest)
        self.assertEqual(one.stats["graphs"], 1)

    def test_edge_table_amount_column_is_optional(self):
        edges = EdgeTable()
        edges.append(1, 0, 1, 2)
        edges.append(2, 1, 2, 3, 5)
        edges.freeze()
        self.assertEqual(list(edges.amount_usd_micros), [-1, 5])
        with self.assertRaises(ValueError):
            EdgeTable().append(3, 0, 1, 2, -2)
        with self.assertRaises(BlockInputError):
            index = FlowIndex(table([(1, 0, "A", "B")]))
            del index.edges.amount_usd_micros
            build_block_graphs(index, [1], BlockPolicy())


if __name__ == "__main__":
    unittest.main()
