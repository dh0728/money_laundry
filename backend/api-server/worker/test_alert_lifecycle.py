"""Business-policy examples independent of the database and publication code."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import hashlib
import itertools
import random
import unittest

from alert_lifecycle import (Action, CaseSnapshot, Evidence, PlanningError,
                             Validity, build_case_plans)
from flow_graph import EdgeTable, FlowIndex, FlowPolicy, Witness, build_flow_graphs


NOW = datetime(2023, 9, 1, tzinfo=timezone.utc)


def evidence(seeds, connections=(), context=(), *, witnesses=None, facts='initial'):
    seeds, connections, context = map(frozenset, (seeds, connections, context))
    relations = (tuple(witnesses) if witnesses is not None else
                 (Witness('FLOW', tuple(sorted(seeds | connections))),))
    digest = hashlib.sha256(repr((sorted(seeds), sorted(connections), sorted(context),
                                 relations, facts)).encode()).hexdigest()
    return Evidence(digest, seeds, connections, context, relations)


def case(key, ev, *, owner=7, status='OPEN', started=False, age=0, **changes):
    return CaseSnapshot(key, 1, 0, owner, NOW + timedelta(hours=age), status,
                        NOW if started else None, ev, **changes)


class LifecycleTests(unittest.TestCase):
    def test_boundary_connection_does_not_merge_partitioned_alerts_on_replay(self):
        edges = EdgeTable()
        for key in range(1, 19):
            edges.append(key, key * 1000, key, key + 1)
        policy = replace(FlowPolicy(), max_core_edges=5)
        first = build_flow_graphs(FlowIndex(edges), range(1, 19), policy)
        cases = [case(i + 1, Evidence.from_graph(g, hashlib.sha256(str(i).encode()).hexdigest()))
                 for i, g in enumerate(first.graphs)]
        groups = [(g.seed_ids, g.seed_ids + g.connection_ids,
                   g.seed_ids + g.connection_ids + g.context_ids) for g in first.graphs]
        second = build_flow_graphs(FlowIndex(edges), range(1, 19), policy, seed_groups=groups)
        graphs = [Evidence.from_graph(g, hashlib.sha256(str(i).encode()).hexdigest())
                  for i, g in enumerate(second.graphs)]
        plans = self.plans(cases, graphs)
        self.assertEqual(len(plans), len(cases))
        self.assertTrue(all(len(p.case_ids) == 1 for p in plans))
        self.assertFalse(any(p.action == Action.MERGE for p in plans))

    def plans(self, cases, graphs, **options):
        return build_case_plans(cases, graphs, **options).plans

    def test_first_flow_is_new_and_needs_assignment_by_publisher(self):
        plan, = self.plans([], [evidence([1], [2])])
        self.assertEqual(plan.action, Action.NEW)
        self.assertIsNone(plan.target_alert_id)
        self.assertEqual(plan.case_ids, ())
        self.assertEqual(plan.recipient_ids, ())

    def test_exact_evidence_is_noop_even_after_investigation_start(self):
        old = evidence([1], [2])
        for started in (False, True):
            plan, = self.plans([case(8, old, started=started)], [old])
            self.assertEqual(plan.action, Action.NOOP)
            self.assertEqual(plan.recipient_ids, ())

    def test_scores_and_facts_change_without_membership_change(self):
        old = evidence([1], [2])
        new = evidence([1], [2], facts='amount or selected score changed')
        for started, action in ((False, Action.UPDATE), (True, Action.PROPOSE)):
            plan, = self.plans([case(8, old, started=started)], [new])
            self.assertEqual(plan.action, action)

    def test_new_evidence_updates_one_unstarted_case(self):
        plan, = self.plans([case(8, evidence([1], [2]))], [evidence([1], [2, 3])])
        self.assertEqual(plan.action, Action.UPDATE)
        self.assertEqual(plan.target_alert_id, 8)

    def test_new_evidence_automatically_updates_investigated_case(self):
        plan, = self.plans([case(8, evidence([1], [2]), started=True)],
                          [evidence([1], [2, 3])])
        self.assertEqual(plan.action, Action.UPDATE)
        self.assertEqual(plan.recipient_ids, (7,))

    def test_corrected_fact_removal_still_requires_investigator_approval(self):
        plan, = self.plans([case(8, evidence([1], [2], [3]), started=True)],
                          [evidence([1], [2])],
                          validity=Validity(frozenset({3}), frozenset({3})))
        self.assertEqual(plan.action, Action.PROPOSE)
        self.assertEqual(plan.reason, 'REPORT_CORRECTED')

    def test_merge_keeps_earliest_creation_not_smallest_id_and_both_owners(self):
        left = case(10, evidence([1], [2]), owner=7, age=2)
        right = case(20, evidence([3], [4]), owner=9, age=1)
        plan, = self.plans([left, right], [evidence([1, 3], [2, 4])])
        self.assertEqual(plan.action, Action.MERGE)
        self.assertEqual(plan.target_alert_id, 20)
        self.assertEqual(plan.case_ids, (10, 20))
        self.assertEqual(plan.recipient_ids, (7, 9))
        self.assertEqual([c.assignee_id for c in plan.baselines], [7, 9])

    def test_creation_tie_uses_id_and_same_assignee_notified_once(self):
        plan, = self.plans([case(20, evidence([3], [4])), case(10, evidence([1], [2]))],
                           [evidence([1, 3], [2, 4])])
        self.assertEqual(plan.target_alert_id, 10)
        self.assertEqual(plan.recipient_ids, (7,))

    def test_one_investigation_protects_entire_component_from_copying(self):
        plan, = self.plans([case(1, evidence([1], [2]), started=True),
                            case(2, evidence([3], [4]))], [evidence([1, 3], [2, 4])])
        self.assertEqual(plan.action, Action.PROPOSE)
        self.assertEqual(plan.case_ids, (1, 2))

    def test_split_graphs_touching_one_case_produce_one_operation(self):
        old = case(1, evidence([1, 3], [2, 4]))
        plan, = self.plans([old], [evidence([1], [2, 5]), evidence([3], [4, 6])])
        self.assertEqual(plan.action, Action.UPDATE)
        self.assertEqual(plan.case_ids, (1,))
        self.assertEqual(plan.graph_ids, (0, 1))

    def test_transitive_component_touches_every_case_once(self):
        cases = [case(1, evidence([1], [2])), case(2, evidence([3, 5], [4, 6])),
                 case(3, evidence([7], [8]))]
        graphs = [evidence([1, 3], [2, 4]), evidence([5, 7], [6, 8])]
        plan, = self.plans(cases, graphs)
        self.assertEqual(plan.case_ids, (1, 2, 3))
        self.assertEqual(plan.graph_ids, (0, 1))
        self.assertEqual(plan.action, Action.MERGE)

    def test_context_overlap_does_not_merge(self):
        old = case(1, evidence([1], [2], [30]))
        plans = self.plans([old], [evidence([3], [4], [30, 1])])
        self.assertEqual([p.action for p in plans], [Action.NOOP, Action.NEW])

    def test_adopted_witness_can_match_old_seed_now_in_connection_role(self):
        plan, = self.plans([case(1, evidence([1], [2]))], [evidence([3], [1, 2])])
        self.assertEqual(plan.action, Action.UPDATE)
        self.assertEqual(plan.case_ids, (1,))

    def test_staff_exclusion_is_not_a_new_case_and_is_preserved(self):
        old = case(1, evidence([1], [2]), started=True, excluded_tx_ids=frozenset({1}))
        plan, = self.plans([old], [evidence([1], [2, 3])])
        self.assertEqual(plan.action, Action.UPDATE)
        self.assertEqual(plan.excluded_tx_ids, frozenset({1}))

    def test_merge_alias_routes_to_survivor_without_second_vote(self):
        alias = case(1, evidence([1], [2]), owner=99, merged_into_alert_id=2)
        survivor = case(2, evidence([1, 3], [2, 4]))
        plan, = self.plans([alias, survivor], [evidence([1], [2, 5])])
        self.assertEqual(plan.case_ids, (2,))
        self.assertEqual(plan.target_alert_id, 2)
        self.assertEqual(plan.recipient_ids, (7,))

    def test_closed_case_rediscovery_and_context_or_numeric_changes_are_noop(self):
        old = evidence([1], [2])
        for graph in (old, evidence([1], [2], [3]), evidence([1], [2], facts='new score')):
            plan, = self.plans([case(1, old, status='CLOSED')], [graph])
            self.assertEqual(plan.action, Action.NOOP)
            self.assertEqual(plan.reason, 'NO_NEW_CORE_OR_WITNESS')
            self.assertEqual(plan.reference_ids, (1,))
            self.assertEqual(plan.case_ids, ())

    def test_closed_case_new_core_creates_followup_with_immutable_reference(self):
        plan, = self.plans([case(1, evidence([1], [2]), status='CLOSED')],
                           [evidence([1], [2, 3])])
        self.assertEqual(plan.action, Action.FOLLOWUP)
        self.assertEqual(plan.reference_ids, (1,))
        self.assertEqual(plan.case_ids, ())

    def test_new_witness_among_previous_core_also_qualifies_as_followup(self):
        old = evidence([1, 2], witnesses=[Witness('FAN_OUT', (1, 2))])
        new = evidence([1, 2], witnesses=[Witness('REPEAT', (1, 2))])
        plan, = self.plans([case(1, old, status='CLOSED')], [new])
        self.assertEqual(plan.action, Action.FOLLOWUP)

    def test_existing_open_followup_is_updated_instead_of_reissued(self):
        parent = case(1, evidence([1], [2]), status='CLOSED', owner=99)
        child = case(2, evidence([1], [2, 3]), ancestor_ids=frozenset({1}))
        plan, = self.plans([parent, child], [evidence([1], [2, 3, 4])])
        self.assertEqual(plan.action, Action.UPDATE)
        self.assertEqual(plan.case_ids, (2,))
        self.assertEqual(plan.reference_ids, (1,))
        self.assertEqual(plan.recipient_ids, (7,))

    def test_shared_closed_parent_does_not_merge_unrelated_followups(self):
        parent = case(1, evidence([1], [2]), status='CLOSED')
        graphs = [evidence([3], [1, 2]), evidence([4], [1, 2])]
        plans = self.plans([parent], graphs)
        self.assertEqual([p.action for p in plans], [Action.FOLLOWUP, Action.FOLLOWUP])
        self.assertEqual([p.graph_ids for p in plans], [(0,), (1,)])
        self.assertTrue(all(p.reference_ids == (1,) for p in plans))

    def test_existing_followup_does_not_capture_unrelated_parent_branch(self):
        parent = case(1, evidence([1], [2]), status='CLOSED')
        child = case(2, evidence([3], [1, 2]), ancestor_ids=frozenset({1}))
        plans = self.plans([parent, child], [evidence([4], [1, 2])])
        self.assertEqual([p.action for p in plans], [Action.NOOP, Action.FOLLOWUP])
        self.assertEqual(plans[1].reference_ids, (1,))

    def test_closed_followup_cannot_reissue_same_evidence(self):
        parent = case(1, evidence([1], [2]), status='CLOSED')
        child = case(2, evidence([3], [1, 2]), status='CLOSED', ancestor_ids=frozenset({1}))
        plan, = self.plans([parent, child], [child.evidence])
        self.assertEqual(plan.action, Action.NOOP)
        self.assertEqual(plan.reference_ids, (1, 2))

    def test_missing_graph_is_not_evidence_withdrawal(self):
        plan, = self.plans([case(1, evidence([1], [2]))], [])
        self.assertEqual(plan.action, Action.NOOP)
        self.assertEqual(plan.invalid_tx_ids, frozenset())

    def test_complete_correction_withdraws_unstarted_and_proposes_started(self):
        validity = Validity(frozenset({1, 2}), frozenset({2}))
        for started, expected in ((False, Action.WITHDRAW), (True, Action.PROPOSE)):
            plan, = self.plans([case(1, evidence([1], [2]), started=started)], [], validity=validity)
            self.assertEqual(plan.action, expected)
            self.assertEqual(plan.reason, 'EVIDENCE_WITHDRAWN')

    def test_incomplete_core_checks_cannot_auto_withdraw(self):
        plan, = self.plans([case(1, evidence([1], [2]))], [],
                           validity=Validity(frozenset({2}), frozenset({2})))
        self.assertEqual(plan.action, Action.NOOP)
        self.assertEqual(plan.reason, 'INCOMPLETE_VALIDITY')

    def test_score_decline_is_proposal_not_report_withdrawal_even_unstarted(self):
        plan, = self.plans([case(1, evidence([1], [2]))], [],
                           validity=Validity(reassessment_ids=frozenset({1})))
        self.assertEqual(plan.action, Action.PROPOSE)
        self.assertEqual(plan.reason, 'SCORE_OR_POLICY_REASSESSMENT')

    def test_partial_correction_with_remaining_relation_updates_without_split(self):
        old = evidence([1, 3], [2, 4], witnesses=[Witness('FLOW', (1, 2)), Witness('FLOW', (3, 4))])
        plan, = self.plans([case(1, old)], [],
                           validity=Validity(frozenset({1, 2, 3, 4}), frozenset({2})))
        self.assertEqual(plan.action, Action.UPDATE)
        self.assertEqual(plan.reason, 'REPORT_CORRECTED')

    def test_invalid_context_is_removed_without_withdrawing_valid_core(self):
        plan, = self.plans([case(1, evidence([1], [2], [3]))], [],
                           validity=Validity(frozenset({3}), frozenset({3})))
        self.assertEqual(plan.action, Action.UPDATE)
        self.assertEqual(plan.invalid_tx_ids, frozenset({3}))

    def test_complete_composed_digest_suppresses_false_updates_from_split(self):
        old = case(1, evidence([1, 3], [2, 4]))
        graphs = [evidence([1], [2]), evidence([3], [4])]
        plan, = self.plans([old], graphs, composed_digests={((1,), (0, 1)): old.evidence.digest})
        self.assertEqual(plan.action, Action.NOOP)

    def test_plan_digest_tracks_business_baseline_but_evidence_digest_does_not(self):
        old = case(1, evidence([1], [2]))
        graph = evidence([1], [2, 3])
        original = build_case_plans([old], [graph])
        for updated in (replace(old, revision=1), replace(old, assignee_id=8),
                        replace(old, published_version=2), replace(old, review_started_at=NOW)):
            actual = build_case_plans([updated], [graph])
            self.assertNotEqual(original.digest, actual.digest)
            self.assertEqual(old.evidence.digest, updated.evidence.digest)

    def test_case_input_order_does_not_change_plan_or_digest(self):
        cases = [case(1, evidence([1], [2])), case(2, evidence([3], [4])),
                 case(3, evidence([5], [6]), status='CLOSED')]
        graphs = [evidence([1, 3, 5], [2, 4, 6])]
        expected = build_case_plans(cases, graphs)
        for permutation in itertools.permutations(cases):
            self.assertEqual(build_case_plans(permutation, graphs), expected)

    def test_seed_index_avoids_cartesian_comparison(self):
        count = 3000
        cases = [case(i + 1, evidence([2*i + 1], [2*i + 2])) for i in range(count)]
        result = build_case_plans(cases, [c.evidence for c in cases])
        self.assertEqual(result.match_checks, count)
        self.assertEqual(len(result.plans), count)
        self.assertTrue(all(p.action == Action.NOOP for p in result.plans))

    def test_budget_overflow_never_returns_partial_plan(self):
        cases = [case(1, evidence([1], [2])), case(2, evidence([3], [4]))]
        with self.assertRaisesRegex(PlanningError, 'budget exceeded'):
            build_case_plans(cases, [evidence([1, 3], [2, 4])], max_match_checks=1)

    def test_random_disconnected_components_keep_one_operation_per_case(self):
        rng = random.Random(239)
        for _ in range(50):
            cases = [case(i + 1, evidence([2*i + 1], [2*i + 2])) for i in range(20)]
            groups, remaining = [], list(range(20))
            rng.shuffle(remaining)
            while remaining:
                size = rng.randint(1, min(5, len(remaining)))
                group, remaining = remaining[:size], remaining[size:]
                groups.append(evidence([2*i + 1 for i in group], [2*i + 2 for i in group]))
            plans = self.plans(cases, groups)
            self.assertEqual(sorted(key for p in plans for key in p.case_ids), list(range(1, 21)))
            self.assertEqual(len(plans), len(groups))

    def test_real_flow_kernel_output_is_accepted_by_planner(self):
        rows = EdgeTable()
        rows.append(1, 0, 1, 2)
        rows.append(2, 1_000_000, 2, 3)
        rows.append(3, 2_000_000, 3, 4)
        batch = build_flow_graphs(FlowIndex(rows), [1, 3], FlowPolicy())
        graphs = [Evidence.from_graph(g, 'a'*64) for g in batch.graphs]
        plan, = self.plans([], graphs)
        self.assertEqual(plan.action, Action.NEW)

    def test_invalid_contracts_fail_before_returning_operations(self):
        old = case(1, evidence([1], [2]))
        graph = evidence([1], [2])
        invalid_cases = [
            ([old, old], [graph], {}),
            ([replace(old, created_at=NOW.replace(tzinfo=None))], [graph], {}),
            ([replace(old, excluded_tx_ids=frozenset({1}))], [graph], {}),
            ([replace(old, merged_into_alert_id=1)], [graph], {}),
            ([replace(old, merged_into_alert_id=2)], [graph], {}),
            ([replace(old, ancestor_ids=frozenset({1}))], [graph], {}),
            ([replace(old, ancestor_ids=frozenset({2}))], [graph], {}),
            ([old], [graph, graph], {}),
            ([old], [replace(graph, digest='invalid')], {}),
            ([old], [replace(graph, context_ids=frozenset({1}))], {}),
            ([old], [replace(graph, witnesses=())], {}),
            ([old], [replace(graph, witnesses=(Witness('FLOW', (1, 3)),))], {}),
            ([old], [graph], {'validity': Validity(invalid_ids=frozenset({2}))}),
            ([old], [graph], {'validity': Validity(frozenset({2}), frozenset({2}))}),
            ([old], [], {'validity': Validity(frozenset({1}), frozenset({1}), frozenset({1}))}),
        ]
        for cases, graphs, options in invalid_cases:
            with self.subTest(cases=cases, graphs=graphs, options=options):
                with self.assertRaises(PlanningError):
                    self.plans(cases, graphs, **options)


if __name__ == '__main__':
    unittest.main()
