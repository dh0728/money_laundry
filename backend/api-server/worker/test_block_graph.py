"""Contract regressions for the block generator (block-pin-1 stages, block-pin-2 locality)."""
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

    def test_frozen_group_keeps_its_seeds_out_of_new_blocks(self):
        rows = fan("A", 3)
        group = ((100, 101), (100, 101), (100, 101), (Witness("STAR_OUT", (100, 101)),))
        batch = self.build(rows, [100, 101, 102], [group])
        self.assertEqual([g.seed_ids for g in batch.graphs], [(100, 101, 102)])
        frozen = self.build(rows, [100, 101, 102], [group + (True,)])
        self.assertEqual(frozen.graphs, ())
        self.assertEqual({u.tx_id: u.reason for u in frozen.unassigned},
                         {100: "FROZEN_LEGACY", 101: "FROZEN_LEGACY", 102: "LINK_ONLY"})

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

    def test_full_block_steps_aside_so_the_other_spokes_form_their_star(self):
        # Chain F->Q->...->P fills the cap (6) and holds spoke F->Q of the out face of F.
        # Planned first, it leaves no room, and its single spoke is no fan: the star must
        # then form from the other spokes, as a re-run forms it beside the pinned chain (I10).
        chain_rows = chain(["F", "Q", "D", "M", "N", "O", "P"], step=30.0)
        rows = chain_rows + [(300, 50, "F", "R1", 1000.0), (301, 56, "F", "R2", 1000.0)]
        seeds = [row[0] for row in rows]
        first = self.build(rows, seeds, core_max=6)
        self.assertEqual([g.seed_ids for g in first.graphs], [(100, 101, 102, 103, 104, 105), (300, 301)])
        self.assertEqual(first.graphs[1].witnesses, (Witness("STAR_OUT", (300, 301)),))
        self.assertNotIn("CORE_CAP", first.graphs[1].limits)   # the discarded plan leaves no mark
        self.assertEqual(first.graphs[1].boundary_witnesses, (Witness("BOUNDARY_SAME_FOCAL", (100, 300)),))
        self.assertEqual(first.unassigned, ())
        groups = [(g.seed_ids, g.core_ids, g.core_ids, g.witnesses) for g in first.graphs]
        second = self.build(rows, seeds, groups, core_max=6)
        self.assertEqual([(g.seed_ids, g.witnesses, g.limits) for g in second.graphs],
                         [(g.seed_ids, g.witnesses, g.limits) for g in first.graphs])
        # A weak star then attaches the next established block that fits: the short
        # chain F->Q2->D2 takes the slot the full chain could not use.
        rows = chain_rows + [(200, 50, "F", "Q2", 1000.0), (201, 80, "Q2", "D2", 1000.0),
                             (300, 56, "F", "R1", 1000.0)]
        seeds = [row[0] for row in rows]
        first = self.build(rows, seeds, core_max=6)
        self.assertEqual([g.seed_ids for g in first.graphs], [(100, 101, 102, 103, 104, 105), (200, 201, 300)])
        self.assertEqual(self.kinds(first.graphs[1]), ["PASS", "STAR_OUT"])
        groups = [(g.seed_ids, g.core_ids, g.core_ids, g.witnesses) for g in first.graphs]
        second = self.build(rows, seeds, groups, core_max=6)
        self.assertEqual([(g.seed_ids, g.witnesses) for g in second.graphs],
                         [(g.seed_ids, g.witnesses) for g in first.graphs])
        self.assertEqual(second.unassigned, first.unassigned)

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

    def test_path_joins_seeds_through_non_seed_hops(self):
        one_hop = [(1, 0, "A", "Y", 1000.0), (2, 10, "Y", "Z", 980.0), (3, 20, "Z", "C", 990.0)]
        graph, = self.build(one_hop, [1, 3]).graphs
        self.assertEqual((graph.seed_ids, graph.connection_ids), ((1, 3), (2,)))
        self.assertEqual(graph.witnesses, (Witness("PATH", (1, 2, 3)),))
        self.assertEqual(self.build(one_hop, [1, 3], path_gap_max=0).graphs, ())
        two_hops = one_hop[:2] + [(3, 20, "Z", "W", 990.0), (4, 30, "W", "C", 1000.0)]
        graph, = self.build(two_hops, [1, 4]).graphs
        self.assertEqual((graph.seed_ids, graph.connection_ids), ((1, 4), (2, 3)))
        self.assertEqual(self.build(two_hops, [1, 4], path_gap_max=1).graphs, ())
        # A seed met on the way ends the walk: the chain is PASS evidence, never a PATH.
        blocked = one_hop[:1] + [(2, 10, "Y", "Z", 1100.0)] + one_hop[2:]
        self.assertEqual(self.kinds(self.build(blocked, [1, 2, 3]).graphs[0]), ["PASS"])

    def test_bridge_needs_two_intermediaries_and_ignores_time_order(self):
        rows = [(1, 0, "S", "M1", 1000.0), (2, 5, "M1", "T", 990.0),
                (3, 2, "S", "M2", 1000.0), (4, -3, "M2", "T", 1010.0)]  # M2 forwards before it receives
        graph, = self.build(rows, [1, 3]).graphs
        self.assertEqual((graph.seed_ids, graph.connection_ids), ((1, 3), (2, 4)))
        self.assertIn("BRIDGE", self.kinds(graph))
        single = self.build(rows[:2] + [(3, 2, "S", "M3", 1000.0)], [1, 3])
        self.assertNotIn("BRIDGE", self.kinds(single.graphs[0]))
        # The second leg may be the seed and the first leg a normal transaction.
        reverse = [(1, 0, "S", "M1", 1000.0), (2, 5, "M1", "T", 990.0),
                   (3, 2, "S", "M2", 1000.0), (4, 6, "M2", "T", 1010.0)]
        graph, = self.build(reverse, [2, 4]).graphs
        self.assertEqual((graph.seed_ids, graph.connection_ids), ((2, 4), (1, 3)))

    def test_closure_walks_back_into_the_block(self):
        rows = [(1, 0, "A", "B", 1000.0), (2, 5, "B", "C", 1000.0), (3, 9, "C", "A", 980.0)]
        graph, = self.build(rows, [1, 2]).graphs
        self.assertEqual((graph.seed_ids, graph.connection_ids), ((1, 2), (3,)))
        self.assertEqual(self.kinds(graph), ["CLOSURE", "PASS"])
        # Backward: a head seed whose sender received the money from inside the block.
        rows = [(1, 0, "C", "A", 980.0), (2, 5, "A", "B", 1000.0), (3, 9, "B", "C", 1000.0)]
        graph, = self.build(rows, [2, 3]).graphs
        self.assertEqual((graph.seed_ids, graph.connection_ids), ((2, 3), (1,)))
        self.assertEqual(self.build(rows, [2, 3], core_max=2).graphs[0].connection_ids, ())

    def test_single_seed_shapes_are_on_by_default(self):
        cycle = [(1, 0, "A", "B", 1000.0), (2, 5, "B", "C", 990.0), (3, 9, "C", "A", 980.0)]
        self.assertEqual(self.build(cycle, [1], single_seed_shapes=False).graphs, ())
        graph, = self.build(cycle, [1]).graphs
        self.assertEqual((graph.seed_ids, graph.connection_ids), ((1,), (2, 3)))
        self.assertEqual(graph.witnesses, (Witness("SHAPE_CYCLE", (1, 2, 3)),))
        self.assertIn("SINGLE_SEED_SHAPE", graph.limits)
        round_trip = [(1, 0, "A", "B", 1000.0), (2, 5, "B", "A", 990.0)]
        self.assertEqual(self.build(round_trip, [1]).graphs, ())
        bridge = [(1, 0, "S", "M1", 1000.0), (2, 5, "M1", "T", 990.0),
                  (3, 1, "S", "M2", 1000.0), (4, 6, "M2", "T", 1000.0),
                  (5, 2, "S", "M3", 1000.0), (6, 7, "M3", "T", 1000.0)]
        self.assertEqual(self.build(bridge, [1], single_seed_shapes=False).graphs, ())
        graph, = self.build(bridge, [1]).graphs
        self.assertEqual((graph.seed_ids, graph.connection_ids), ((1,), (2, 3, 4, 5, 6)))
        self.assertEqual(graph.witnesses[0].kind, "SHAPE_BRIDGE")
        self.assertEqual(self.build(bridge[:4], [1]).graphs, ())
        # Publishing a shape and re-running reproduces it.
        for rows in (cycle, bridge):
            first = self.build(rows, [1])
            groups = [(g.seed_ids, g.core_ids, g.core_ids, g.witnesses) for g in first.graphs]
            second = self.build(rows, [1], groups)
            self.assertEqual([(g.seed_ids, g.connection_ids, g.witnesses, g.pinned_group) for g in second.graphs],
                             [(g.seed_ids, g.connection_ids, g.witnesses, 0) for g in first.graphs])

    def test_ablation_switches(self):
        rows = fan("A", 5) + [(200, 8, "AR0", "Z", 1000.0)]
        self.assertEqual(len(self.build(rows, [100, 101, 102, 103, 104, 200]).graphs), 1)
        self.assertEqual(len(self.build(rows, [100, 101, 102, 103, 104, 200], absorb_dangling=False).graphs), 2)
        # Seed 1 passes through F (PASS 1→6). By default F's fan-in owns it even though it
        # cannot absorb its chain, so X1's own fan-out {1, 8} never forms.
        rows = [(1, 0, "X1", "F", 1000.0), (2, 1, "X2", "F", 300.0), (3, 2, "X3", "F", 300.0),
                (4, 3, "X4", "F", 300.0), (5, 4, "X5", "F", 300.0), (6, 10, "F", "Y", 1000.0),
                (8, 2, "X1", "Q", 1000.0)]
        seeds = [1, 2, 3, 4, 5, 6, 8]
        default = self.build(rows, seeds)
        self.assertEqual([g.seed_ids for g in default.graphs], [(1, 6), (2, 3, 4, 5)])
        self.assertIn(8, {u.tx_id for u in default.unassigned})
        excluded = self.build(rows, seeds, star_exclude_passthrough=True)
        self.assertEqual([g.seed_ids for g in excluded.graphs], [(1, 6, 8), (2, 3, 4, 5)])
        # Seed 1 is a contested PASS bridge at F (1 and 2 both match 3 within the margin), and
        # its chain {5, 1} is established; F's fan-in may absorb it only without the rule.
        contested = [(5, -5, "Z", "A", 990.0), (1, 0, "A", "F", 1000.0), (2, 1, "B", "F", 1002.0),
                     (3, 10, "F", "C", 1000.0)]
        self.assertEqual([g.seed_ids for g in self.build(contested, [1, 2, 3, 5], contested_check=True).graphs],
                         [(1, 5)])
        self.assertEqual([g.seed_ids for g in self.build(contested, [1, 2, 3, 5]).graphs], [(1, 2, 5)])

    def test_fixed_point_holds_with_connections(self):
        rows = ([(1, 0, "A", "Y", 1000.0), (2, 10, "Y", "Z", 980.0), (3, 20, "Z", "C", 990.0),
                 (4, 30, "C", "A", 985.0)]
                + [(11, 0, "S", "M1", 1000.0), (12, 5, "M1", "T", 990.0),
                   (13, 2, "S", "M2", 1000.0), (14, 6, "M2", "T", 1010.0)])
        seeds = [1, 3, 11, 13]
        first = self.build(rows, seeds)
        self.assertEqual([(g.seed_ids, g.connection_ids) for g in first.graphs],
                         [((1, 3), (2, 4)), ((11, 13), (12, 14))])
        groups = [(g.seed_ids, g.core_ids, g.core_ids, g.witnesses) for g in first.graphs]
        second = self.build(rows, seeds, groups)
        self.assertEqual([(g.seed_ids, g.connection_ids, g.witnesses) for g in second.graphs],
                         [(g.seed_ids, g.connection_ids, g.witnesses) for g in first.graphs])
        planned = [Evidence.from_graph(g.flow_graph(), "b" * 64) for g in first.graphs]
        self.assertEqual({p.action for p in build_case_plans([], planned).plans}, {Action.NEW})

    # ----- block-pin-2: every decision stays within the policy's time limits -----
    def test_bridge_offers_of_one_pair_form_one_bridge_per_time_cluster(self):
        # Two S→m→T episodes 300h apart. block-pin-1 picked one bridge for the whole history
        # from the oldest offer, leaving the later seeds unassigned.
        rows = [(1, 0, "S", "M1", 1000.0), (2, 5, "M1", "T", 1000.0),
                (3, 2, "S", "M2", 1000.0), (4, 6, "M2", "T", 1000.0),
                (11, 300, "S", "M3", 1000.0), (12, 305, "M3", "T", 1000.0),
                (13, 302, "S", "M4", 1000.0), (14, 306, "M4", "T", 1000.0)]
        batch = self.build(rows, [1, 4, 11, 14])
        self.assertEqual([g.seed_ids for g in batch.graphs], [(1, 4), (11, 14)])
        self.assertEqual([self.kinds(g) for g in batch.graphs], [["BRIDGE"], ["BRIDGE"]])
        self.assertEqual(batch.unassigned, ())

    def test_closure_walk_stops_at_the_block_span_without_marking(self):
        # A PASS pair at hours 0-5 whose money returns to A only at hour 280.
        rows = [(1, 0, "A", "B", 1000.0), (2, 5, "B", "C", 1000.0),
                (3, 95, "C", "D", 1000.0), (4, 190, "D", "E", 1000.0), (5, 280, "E", "A", 1000.0)]
        graph, = self.build(rows, [1, 2]).graphs
        self.assertEqual(self.kinds(graph), ["PASS"])
        self.assertNotIn("COMPONENT_SPAN", graph.limits)  # block-pin-1 marked the distant walk
        inside = rows[:3] + [(4, 100, "D", "E", 1000.0), (5, 150, "E", "A", 1000.0)]
        graph, = self.build(inside, [1, 2]).graphs
        self.assertEqual(self.kinds(graph), ["CLOSURE", "PASS"])

    def test_single_seed_cycle_beyond_span_is_not_a_block(self):
        # Each hop is within hop_lag, the whole cycle is not within span_max (I6).
        rows = [(1, 0, "A", "B", 1000.0), (2, 90, "B", "C", 1000.0),
                (3, 180, "C", "D", 1000.0), (4, 270, "D", "A", 1000.0)]
        self.assertEqual(self.build(rows, [1]).graphs, ())
        short = [(1, 0, "A", "B", 1000.0), (2, 90, "B", "C", 1000.0),
                 (3, 180, "C", "D", 1000.0), (4, 230, "D", "A", 1000.0)]
        graph, = self.build(short, [1]).graphs
        self.assertEqual(graph.witnesses, (Witness("SHAPE_CYCLE", (1, 2, 3, 4)),))

    def test_single_seed_bridge_beyond_span_is_not_a_block(self):
        # Spokes ±90h around the seed and second legs another 90h out: 366h wide.
        rows = [(1, 0, "S", "M1", 1000.0), (2, 5, "M1", "T", 1000.0),
                (3, 90, "S", "M2", 1000.0), (4, 180, "M2", "T", 1000.0),
                (5, -90, "S", "M3", 1000.0), (6, -180, "M3", "T", 1000.0)]
        self.assertEqual(self.build(rows, [1]).graphs, ())

    def test_single_seed_bridge_ties_go_to_the_smallest_transaction_ids(self):
        # Two destinations reached through three intermediaries each. block-pin-1 took the
        # destination with the smaller snapshot account code (T1); ids decide now (T2).
        rows = [(1, 0, "S", "M1", 1000.0),
                (60, 4, "M1", "T1", 1000.0), (61, 1, "S", "M2", 1000.0), (62, 5, "M2", "T1", 1000.0),
                (63, 2, "S", "M3", 1000.0), (64, 6, "M3", "T1", 1000.0),
                (20, 4, "M1", "T2", 1000.0), (21, 1, "S", "M4", 1000.0), (22, 5, "M4", "T2", 1000.0),
                (23, 2, "S", "M5", 1000.0), (24, 6, "M5", "T2", 1000.0)]
        graph, = self.build(rows, [1]).graphs
        self.assertEqual(graph.witnesses, (Witness("SHAPE_BRIDGE", (1, 20, 21, 22, 23, 24)),))

    def test_no_block_exceeds_span_on_a_random_ledger(self):
        rng = random.Random(20261014)
        accounts = [f"A{i}" for i in range(12)]
        rows, hours = [], {}
        for tx_id in range(1, 401):
            sender, receiver = rng.sample(accounts, 2)
            hour = rng.uniform(0, 720)
            rows.append((tx_id, hour, sender, receiver, rng.choice((900.0, 1000.0, 1100.0))))
            hours[tx_id] = hour
        seeds = [row[0] for row in rows if rng.random() < 0.3]
        batch = self.build(rows, seeds, hub_min_activity=10_000)
        self.assertTrue(batch.graphs)
        for graph in batch.graphs:
            core = graph.seed_ids + graph.connection_ids
            self.assertLessEqual(max(hours[k] for k in core) - min(hours[k] for k in core), 240.0)

    def test_real_output_is_accepted_by_the_lifecycle_planner(self):
        rows = fan("A", 3) + [(200, 8, "AR0", "Z", 1000.0)]
        batch = self.build(rows, [100, 101, 102, 200])
        graphs = [Evidence.from_graph(g.flow_graph(), "a" * 64) for g in batch.graphs]
        plan, = build_case_plans([], graphs).plans
        self.assertEqual(plan.action, Action.NEW)

    def test_policy_validation_and_digest(self):
        for options in (dict(relay_mode="SOFT"), dict(ratio_num=5, ratio_den=5), dict(star_max=1),
                        dict(star_width_us=HOUR_US), dict(core_max=1), dict(path_gap_max=-1),
                        dict(bridge_min_mids=1), dict(absorb_dangling=1)):
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
