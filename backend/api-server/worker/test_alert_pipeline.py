"""PostgreSQL Alert evidence tests. Expectations are manually specified flows."""
from datetime import datetime
import json
import os
import unittest
from uuid import uuid4

from psycopg.types.json import Jsonb
from alert_pipeline import save_alerts, AssigneeUnavailable, POLICY
from frozen_input import InputExecution, StaleExecution
import test_frozen_input_postgres as fixtures


@unittest.skipUnless(os.environ.get("AML_TEST_DOCKER"), "AML_TEST_DOCKER is required")
class AlertPostgresTests(unittest.TestCase):
    docker = classmethod(fixtures.FrozenInputPostgresTests.docker.__func__)
    setUpClass = classmethod(fixtures.FrozenInputPostgresTests.setUpClass.__func__)

    def setUp(self):
        fixtures.FrozenInputPostgresTests.setUp(self)
        self.admin.execute("INSERT INTO core.users(username,name,role,password_hash) VALUES(%s,'Test L1','STAFF','test-hash')", (uuid4().hex,))
        self.admin.execute("UPDATE analysis.jobs SET current_stage='ALERTS',threshold_value=.7,analysis_cutoff_at='2022-09-03 09:00+09' WHERE job_id=%s", (self.job,))
        self.context = self.admin.execute("SELECT tx_id FROM analysis.input_transactions WHERE run_id=%s AND input_role='CONTEXT'", (self.run,)).fetchone()[0]
        self.a,self.b,self.c,self.d,self.e = [uuid4() for _ in range(5)]
        for key,source,dest,time in ((self.ids[0],self.a,self.b,'2022-09-02 23:30+09'),
                                    (self.ids[1],self.c,self.d,'2022-09-02 10:00+09'),
                                    (self.ids[2],self.e,self.a,'2022-09-02 22:00+09'),
                                    (self.context,self.b,self.e,'2022-09-03 00:15+09')):
            self.admin.execute("UPDATE analysis.input_transactions SET from_account_id=%s,to_account_id=%s,occurred_at=%s,business_date=%s::timestamptz AT TIME ZONE 'Asia/Seoul' WHERE run_id=%s AND tx_id=%s",
                               (source,dest,time,time,self.run,key))
        self.template = self.admin.execute("SELECT to_jsonb(i) FROM analysis.input_transactions i WHERE run_id=%s AND tx_id=%s",(self.run,self.context)).fetchone()[0]
        self.admin.execute("DELETE FROM analysis.input_transactions WHERE run_id=%s AND tx_id=%s",(self.run,self.context))
        for key,score in zip(self.ids,(.9,.1,.2)):
            self.admin.execute("INSERT INTO analysis.scores(type_class,tx_id,p_laundering,p_0,p_1,p_2,p_3,p_4,p_5,p_6,p_7,p_8,run_id) VALUES(%s,%s,%s,1,0,0,0,0,0,0,0,0,%s)", (0,key,score,self.run))
        self.coverage(self.run,False)

    def coverage(self,run,complete):
        for day in ('2022-09-01','2022-09-02','2022-09-03','2022-09-04'):
            ok = day=='2022-09-02' or (day=='2022-09-03' and complete)
            self.admin.execute("INSERT INTO analysis.input_coverage VALUES(%s,%s,2,%s,%s,'[]') ON CONFLICT(run_id,business_date) DO UPDATE SET complete=excluded.complete,complete_banks=excluded.complete_banks",(run,day,2 if ok else 0,ok))

    def complete(self, execution):
        self.admin.execute("UPDATE analysis.jobs SET status='COMPLETED' WHERE job_id=%s",(execution.job_id,))
        self.admin.execute("UPDATE analysis.runs SET status='COMPLETED' WHERE run_id=%s",(execution.run_id,))

    def first(self):
        save_alerts(self.admin,self.execution)
        alert = self.admin.execute("SELECT alert_id FROM review.alert_versions WHERE run_id=%s",(self.run,)).fetchone()[0]
        self.complete(self.execution)
        return alert

    def test_restricted_worker_persists_relational_seed_risk(self):
        args = dict(self.connect_args, user=self.worker_user, password=self.worker_password)
        with self.psycopg.connect(**args) as writer:
            save_alerts(writer,self.execution)
        self.assertEqual(self.admin.execute('''SELECT m.seed_risk
            FROM review.alert_transactions m JOIN review.alert_versions v USING(alert_id,version)
            WHERE v.run_id=%s AND m.role='SEED' ''', (self.run,)).fetchall(), [(.9,)])

    def following(self,alert,extra=True,complete=True):
        run,token=uuid4(),uuid4()
        job=self.admin.execute("INSERT INTO analysis.jobs(analysis_date,business_at,status,current_stage,execution_owner,execution_id,threshold_value,analysis_cutoff_at) VALUES(date '2100-01-01'+nextval('core.work_id')::int,now(),'RUNNING','ALERTS',gen_random_uuid(),%s,.7,'2022-09-04 09:00+09') RETURNING job_id",(token,)).fetchone()[0]
        self.admin.execute("INSERT INTO analysis.runs(run_id,job_id,status) VALUES(%s,%s,'READY')",(run,job))
        self.admin.execute("UPDATE analysis.jobs SET current_run_id=%s WHERE job_id=%s",(run,job))
        # All earlier targets are CONTEXT now: no old model inference is repeated.
        self.admin.execute("INSERT INTO analysis.input_transactions SELECT %s,tx_id,'CONTEXT',occurred_at,business_date,from_bank_id,to_bank_id,from_account_id,to_account_id,from_owner_id,to_owner_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version FROM analysis.input_transactions WHERE run_id=%s",(run,self.run))
        if extra:
            row=dict(self.template,run_id=str(run))
            self.admin.execute("INSERT INTO analysis.input_transactions SELECT * FROM jsonb_populate_record(null::analysis.input_transactions,%s)",(Jsonb(row),))
        self.admin.execute("INSERT INTO analysis.input_scores SELECT %s,tx_id,run_id,to_jsonb(s)-'run_id'-'tx_id' FROM analysis.scores s WHERE run_id=%s",(run,self.run))
        self.admin.execute("INSERT INTO analysis.alert_origins SELECT %s,alert_id,version FROM review.alert_versions WHERE alert_id=%s ORDER BY version DESC LIMIT 1",(run,alert))
        self.coverage(run,complete)
        return InputExecution(job,run,token)

    def test_daily_boundary_and_immutable_scores_and_empty_target(self):
        alert=self.first()
        old=self.admin.execute("SELECT evidence FROM review.alert_versions WHERE alert_id=%s",(alert,)).fetchone()[0]
        self.assertEqual(old['policyVersion'], 'flow-evidence-1')
        self.assertEqual({m['txId'] for m in old['transactions']},{self.ids[0], self.ids[2]})
        follow=self.following(alert)
        save_alerts(self.admin,follow)
        versions=self.admin.execute("SELECT evidence FROM review.alert_versions WHERE alert_id=%s ORDER BY version",(alert,)).fetchall()
        self.assertEqual(len(versions),2)
        self.assertEqual(self.admin.execute('''SELECT version,seed_risk FROM review.alert_transactions
            WHERE alert_id=%s AND tx_id=%s ORDER BY version''',
            (alert,self.ids[0])).fetchall(), [(1,.9),(2,.9)])
        self.assertEqual(versions[0][0],old)
        self.assertEqual({m['txId'] for m in versions[1][0]['transactions']},{self.ids[0],self.ids[2],self.context})
        self.assertIsNone(next(m for m in versions[1][0]['transactions'] if m['txId']==self.context)['scores'])
        self.assertEqual(self.admin.execute("SELECT count(*) FROM analysis.scores WHERE run_id=%s",(follow.run_id,)).fetchone()[0],0)
        self.assertNotIn("forwardComplete", self.admin.execute("SELECT coverage FROM review.alert_coverage_checks WHERE alert_id=%s AND run_id=%s",(alert,follow.run_id)).fetchone()[0][0])
        # Retry after lost response must not create another evidence version.
        checked=self.admin.execute("SELECT checked_at FROM review.alert_coverage_checks WHERE alert_id=%s AND run_id=%s",(alert,follow.run_id)).fetchone()[0]
        self.assertIsNotNone(checked)
        save_alerts(self.admin,follow)
        self.assertEqual(self.admin.execute("SELECT checked_at FROM review.alert_coverage_checks WHERE alert_id=%s AND run_id=%s",(alert,follow.run_id)).fetchone()[0],checked)
        self.assertEqual(self.admin.execute("SELECT count(*) FROM review.alert_versions WHERE alert_id=%s",(alert,)).fetchone()[0],2)

    def test_bulk_members_match_evidence_and_timing_survives_retry(self):
        self.admin.execute("UPDATE analysis.scores SET p_laundering=.9 WHERE run_id=%s", (self.run,))
        save_alerts(self.admin, self.execution)
        versions = self.admin.execute("SELECT alert_id,version,evidence FROM review.alert_versions WHERE run_id=%s", (self.run,)).fetchall()
        for alert, version, evidence in versions:
            actual = self.admin.execute("SELECT tx_id,role,reasons FROM review.alert_transactions WHERE alert_id=%s AND version=%s ORDER BY tx_id", (alert, version)).fetchall()
            expected = [(m['txId'], m['role'], m['includedReasons']) for m in evidence['transactions']]
            self.assertEqual(actual, expected)
        query = "SELECT artifact FROM analysis.stage_results WHERE run_id=%s AND stage='ALERTS'"
        before = self.admin.execute(query, (self.run,)).fetchone()[0]
        artifact = json.loads(before) if isinstance(before, str) else before
        for key in ('inputRead', 'candidateBuild', 'evidenceBuild', 'baselineCheck', 'publication', 'totalBeforeCommit'):
            self.assertGreaterEqual(artifact['timingsMs'][key], 0)
        save_alerts(self.admin, self.execution)
        self.assertEqual(self.admin.execute(query, (self.run,)).fetchone()[0], before)

    def test_ten_and_twenty_three_seed_candidates_merge(self):
        self.admin.execute("UPDATE analysis.input_transactions SET occurred_at='2022-09-02 10:00+09' WHERE run_id=%s AND tx_id=%s",(self.run,self.ids[0]))
        self.admin.execute("UPDATE analysis.input_transactions SET occurred_at='2022-09-02 23:00+09',from_account_id=%s,to_account_id=%s WHERE run_id=%s AND tx_id=%s",(self.b,self.c,self.run,self.ids[1]))
        self.admin.execute("UPDATE analysis.scores SET p_laundering=.8 WHERE run_id=%s AND tx_id=%s",(self.run,self.ids[1]))
        save_alerts(self.admin,self.execution)
        evidence=self.admin.execute("SELECT evidence FROM review.alert_versions WHERE run_id=%s",(self.run,)).fetchall()
        self.assertEqual(len(evidence),1)
        self.assertEqual({s['txId'] for s in evidence[0][0]['seeds']},set(self.ids[:2]))

    def test_closed_case_keeps_evidence_and_linked_followup_no_duplicate(self):
        alert=self.first()
        self.admin.execute("UPDATE review.alerts SET status='CLOSED',outcome='NORMAL',closed_at=now() WHERE alert_id=%s",(alert,))
        follow=self.following(alert)
        save_alerts(self.admin,follow)
        self.assertEqual(self.admin.execute("SELECT count(*) FROM review.alert_versions WHERE alert_id=%s",(alert,)).fetchone()[0],1)
        child=self.admin.execute("SELECT alert_id FROM review.alerts WHERE parent_alert_id=%s",(alert,)).fetchone()[0]
        self.assertNotEqual(child,alert)
        # Shared old seed belongs to both cases, with independent status.
        self.assertEqual(self.admin.execute("SELECT count(distinct alert_id) FROM review.alert_transactions WHERE tx_id=%s",(self.ids[0],)).fetchone()[0],2)
        self.complete(follow)
        again=self.following(alert)
        save_alerts(self.admin,again)
        self.assertEqual(self.admin.execute("SELECT count(*) FROM review.alerts WHERE parent_alert_id=%s",(alert,)).fetchone()[0],1)

    def test_no_links_updates_coverage_only_and_missing_bank_stays_pending(self):
        alert=self.first()
        follow=self.following(alert,extra=False,complete=False)
        save_alerts(self.admin,follow)
        coverage=self.admin.execute("SELECT coverage FROM review.alert_coverage_checks WHERE alert_id=%s AND run_id=%s",(alert,follow.run_id)).fetchone()[0]
        self.assertTrue(any(not d['complete'] for item in coverage for d in item['days']))
        self.assertEqual(self.admin.execute("SELECT count(*) FROM review.alert_versions WHERE alert_id=%s",(alert,)).fetchone()[0],1)

    def test_fenced_run_cannot_save_and_missing_l1_rolls_back(self):
        self.admin.execute("UPDATE analysis.jobs SET execution_id=%s WHERE job_id=%s",(uuid4(),self.job))
        with self.assertRaises(StaleExecution): save_alerts(self.admin,self.execution)
        self.assertEqual(self.admin.execute("SELECT count(*) FROM review.alert_versions WHERE run_id=%s",(self.run,)).fetchone()[0],0)
        self.admin.execute("UPDATE analysis.jobs SET execution_id=%s WHERE job_id=%s",(self.token,self.job))
        self.admin.execute("UPDATE core.users SET role='ADMIN' WHERE role='STAFF'")
        try:
            with self.assertRaises(AssigneeUnavailable): save_alerts(self.admin,self.execution)
        finally:
            self.admin.execute("UPDATE core.users SET role='STAFF' WHERE name='Test L1'")
        self.assertEqual(self.admin.execute("SELECT count(*) FROM review.alert_versions WHERE run_id=%s",(self.run,)).fetchone()[0],0)

    def test_escalated_case_preserves_previous_version(self):
        alert=self.first()
        old=self.admin.execute("SELECT evidence FROM review.alert_versions WHERE alert_id=%s",(alert,)).fetchone()[0]
        self.admin.execute("UPDATE review.alerts SET status='CLOSED',outcome='TRANSFERRED',closed_at=now() WHERE alert_id=%s",(alert,))
        follow=self.following(alert)
        save_alerts(self.admin,follow)
        self.assertEqual(self.admin.execute("SELECT evidence FROM review.alert_versions WHERE alert_id=%s",(alert,)).fetchall(),[(old,)])
        self.assertEqual(self.admin.execute("SELECT count(*) FROM review.alerts WHERE parent_alert_id=%s",(alert,)).fetchone()[0],1)

    def test_failure_at_checkpoint_rolls_back_every_alert_and_assignment_write(self):
        before=self.admin.execute("SELECT user_id,last_assigned_at FROM core.users ORDER BY user_id").fetchall()
        self.admin.execute("CREATE FUNCTION fail_alert_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.stage='ALERTS' THEN RAISE EXCEPTION 'injected checkpoint failure'; END IF; RETURN NEW; END $$")
        self.admin.execute("CREATE TRIGGER fail_alert_checkpoint BEFORE INSERT ON analysis.stage_results FOR EACH ROW EXECUTE FUNCTION fail_alert_checkpoint()")
        try:
            with self.assertRaises(self.psycopg.Error): save_alerts(self.admin,self.execution)
        finally:
            self.admin.execute("DROP TRIGGER fail_alert_checkpoint ON analysis.stage_results")
            self.admin.execute("DROP FUNCTION fail_alert_checkpoint()")
        self.assertEqual(self.admin.execute("SELECT count(*) FROM review.alert_versions WHERE run_id=%s",(self.run,)).fetchone()[0],0)
        self.assertEqual(self.admin.execute("SELECT user_id,last_assigned_at FROM core.users ORDER BY user_id").fetchall(),before)
        save_alerts(self.admin,self.execution)
        self.assertEqual(self.admin.execute("SELECT count(*) FROM review.alert_versions WHERE run_id=%s",(self.run,)).fetchone()[0],1)

    def test_concurrent_duplicate_delivery_stores_once(self):
        from concurrent.futures import ThreadPoolExecutor
        def invoke():
            with self.psycopg.connect(**self.connect_args) as db:
                save_alerts(db,self.execution)
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda _:invoke(),range(2)))
        self.assertEqual(self.admin.execute("SELECT count(*) FROM review.alert_versions WHERE run_id=%s",(self.run,)).fetchone()[0],1)

    def test_competing_frozen_runs_cannot_replace_unpublished_or_changed_baseline(self):
        from worker_transport import ProtocolError
        alert=self.first()
        left=self.following(alert)
        right=self.following(alert)
        save_alerts(self.admin,left)
        with self.assertRaises(StaleExecution): save_alerts(self.admin,right)
        self.assertEqual(self.admin.execute("SELECT count(*) FROM review.alert_versions WHERE run_id=%s",(right.run_id,)).fetchone()[0],0)
        self.complete(left)
        with self.assertRaises(ProtocolError): save_alerts(self.admin,right)
        self.assertEqual(self.admin.execute("SELECT count(*) FROM review.alert_versions WHERE alert_id=%s",(alert,)).fetchone()[0],2)

    def test_zero_seeds_completes_without_l1(self):
        self.admin.execute("UPDATE analysis.scores SET p_laundering=.1 WHERE run_id=%s",(self.run,))
        save_alerts(self.admin,self.execution)
        self.assertTrue(self.admin.execute("SELECT completed FROM analysis.stage_results WHERE run_id=%s AND stage='ALERTS'",(self.run,)).fetchone()[0])
        self.assertEqual(self.admin.execute("SELECT alert_count FROM analysis.jobs WHERE job_id=%s",(self.job,)).fetchone()[0],0)

    def test_isolated_seed_waits_in_scores_then_normal_context_creates_first_alert(self):
        self.admin.execute("UPDATE analysis.input_transactions SET from_account_id=%s,to_account_id=%s WHERE run_id=%s AND tx_id=%s",
                           (uuid4(), uuid4(), self.run, self.ids[2]))
        save_alerts(self.admin, self.execution)
        self.assertEqual(self.admin.execute('SELECT count(*) FROM review.alert_versions WHERE run_id=%s',
                         (self.run,)).fetchone()[0], 0)
        artifact = json.loads(self.admin.execute("SELECT artifact FROM analysis.stage_results WHERE run_id=%s AND stage='ALERTS'",
                              (self.run,)).fetchone()[0])
        self.assertEqual(artifact['unassignedSeedCount'], 1)
        self.complete(self.execution)
        follow = self.following(-1)
        # A changed job threshold cannot turn an earlier positive into a negative.
        self.admin.execute('UPDATE analysis.jobs SET threshold_value=.99 WHERE job_id=%s', (follow.job_id,))
        save_alerts(self.admin, follow)
        evidence = self.admin.execute('SELECT evidence FROM review.alert_versions WHERE run_id=%s',
                                     (follow.run_id,)).fetchone()[0]
        self.assertEqual([s['txId'] for s in evidence['seeds']], [self.ids[0]])
        self.assertEqual(evidence['seeds'][0]['threshold'], .7)
        self.assertEqual({m['txId'] for m in evidence['transactions']}, {self.ids[0], self.context})
        self.assertTrue(evidence['witnesses'])

    def test_budget_failure_publishes_no_partial_graphs_or_assignment(self):
        from dataclasses import replace
        from unittest.mock import patch
        from worker_transport import ProtocolError
        before = self.admin.execute('SELECT user_id,last_assigned_at FROM core.users ORDER BY user_id').fetchall()
        with patch('alert_pipeline.POLICY', replace(POLICY, max_core_edges=1)):
            with self.assertRaisesRegex(ProtocolError, 'budget exceeded'):
                save_alerts(self.admin, self.execution)
        self.assertEqual(self.admin.execute('SELECT count(*) FROM review.alert_versions WHERE run_id=%s',
                         (self.run,)).fetchone()[0], 0)
        self.assertEqual(self.admin.execute('SELECT user_id,last_assigned_at FROM core.users ORDER BY user_id').fetchall(), before)

    def test_existing_evidence_from_removed_policy_is_rejected_without_writes(self):
        from worker_transport import ProtocolError
        alert = self.first()
        self.admin.execute("UPDATE review.alert_versions SET evidence=jsonb_set(evidence,'{policyVersion}','\"retired-policy\"') WHERE alert_id=%s", (alert,))
        follow = self.following(alert)
        with self.assertRaisesRegex(ProtocolError, 'requires regeneration'):
            save_alerts(self.admin, follow)
        self.assertEqual(self.admin.execute('SELECT count(*) FROM review.alert_versions WHERE run_id=%s',
                         (follow.run_id,)).fetchone()[0], 0)


class AlertExtensionTests(unittest.TestCase):
    def evidence(self, ids, seeds, times=None):
        from alert_pipeline import _evidence
        from flow_graph import FlowGraph, Witness
        from decimal import Decimal
        rows={key:dict(occurred_at=datetime.fromisoformat((times or {}).get(key,'2022-09-02T10:00:00+09:00')),
            from_account_id='a',to_account_id='b',from_bank_id=12,to_bank_id=70,
            amount_received=Decimal(1),receiving_currency='USD',amount_paid=Decimal(1),
            payment_currency='USD',amount_usd=Decimal(1),payment_format='ACH') for key in ids}
        seed_info={key:dict(txId=key,occurredAt=rows[key]['occurred_at'].isoformat(),score=.9,threshold=.7) for key in seeds}
        witnesses = (Witness('REPEAT', tuple(ids)),)
        return _evidence(FlowGraph(tuple(seeds), tuple(k for k in ids if k not in seeds), (), witnesses, ()), rows,
            {key:dict(p_laundering=.9) for key in seeds}, seed_info)


    def test_split_candidates_extend_one_existing_case_and_keep_prior_members(self):
        from alert_pipeline import _extend
        old=self.evidence([1,2,3],[1,2])
        new=_extend(old,[self.evidence([1,4],[1]),self.evidence([2,5],[2])])
        self.assertEqual([m['txId'] for m in new['transactions']],[1,2,3,4,5])
        self.assertEqual([s['txId'] for s in new['seeds']],[1,2])
        self.assertEqual(len(old['transactions']),3)

    def test_flow_evidence_is_not_truncated_at_old_hundred_member_cap(self):
        from alert_pipeline import _extend
        old=self.evidence(list(range(1,101)),[1])
        result=_extend(old,[self.evidence([1,101],[1,101])])
        self.assertEqual(len(result['transactions']),101)
        self.assertEqual([s['txId'] for s in result['seeds']],[1,101])
        self.assertNotIn('TRANSACTION_COUNT',result['limits'])
        old=self.evidence([1,2],[1],{1:'2022-09-01T00:00:00+09:00',2:'2022-09-02T00:00:00+09:00'})
        result=_extend(old,[self.evidence([2,3],[2],{2:'2022-09-02T00:00:00+09:00',3:'2022-09-03T00:01:00+09:00'})])
        self.assertEqual([m['txId'] for m in result['transactions']],[1,2,3])
        self.assertNotIn('MERGE_LIMIT',result['limits'])

    def test_connection_promoted_to_seed_gets_new_score_only_in_new_version(self):
        from alert_pipeline import _extend
        old=self.evidence([1,2],[1])
        result=_extend(old,[self.evidence([1,2],[1,2])])
        self.assertIsNone(old['transactions'][1]['scores'])
        self.assertEqual(result['transactions'][1]['role'],'SEED')
        self.assertEqual(result['transactions'][1]['scores']['p_laundering'],.9)

    def test_semantic_fingerprint_tracks_scores_facts_policy_and_witnesses(self):
        from alert_pipeline import _fingerprint
        from copy import deepcopy
        old = self.evidence([1, 2], [1])
        for section, key, value in [('policy', 'window_us', 1),
                                     ('transactions', 'amountUsd', '2'),
                                     ('seeds', 'score', .95),
                                     ('witnesses', 'kind', 'FLOW')]:
            changed = deepcopy(old)
            target = changed[section]
            (target[0] if isinstance(target, list) else target)[key] = value
            self.assertNotEqual(_fingerprint(old), _fingerprint(changed))

    def test_new_version_updates_facts_without_mutating_previous_document(self):
        from alert_pipeline import _extend
        old = self.evidence([1, 2], [1])
        addition = self.evidence([1, 2], [1])
        addition['transactions'][1]['amountUsd'] = '7'
        result = _extend(old, [addition])
        self.assertEqual(old['transactions'][1]['amountUsd'], '1')
        self.assertEqual(result['transactions'][1]['amountUsd'], '7')
        self.assertEqual(result['summary']['totalAmountUsd'], '8')

    def test_historical_seed_score_and_role_stay_consistent_when_new_graph_has_it_as_connection(self):
        from alert_pipeline import _extend
        old = self.evidence([1, 2], [1])
        addition = self.evidence([1, 2], [2])
        result = _extend(old, [addition])
        self.assertEqual(result['transactions'][0]['scores']['p_laundering'], .9)
        self.assertEqual(result['seeds'][0]['score'], .9)

    def test_database_adapter_preserves_microseconds_and_public_account_identity(self):
        from alert_pipeline import _build_graphs
        from decimal import Decimal
        rows = {101: dict(occurred_at=datetime.fromisoformat('2022-09-02T10:00:00.000001+09:00'),
                         from_bank_id=1, to_bank_id=2, from_account_id='a', to_account_id='b'),
                209: dict(occurred_at=datetime.fromisoformat('2022-09-02T10:00:00.000002+09:00'),
                         from_bank_id=2, to_bank_id=3, from_account_id='b', to_account_id='c')}
        batch = _build_graphs(rows, [101])
        self.assertEqual(batch.graphs[0].connection_ids, (209,))
        self.assertEqual(batch.graphs[0].witnesses[0].tx_ids, (101, 209))
        rows[209]['from_bank_id'] = 7
        self.assertFalse(_build_graphs(rows, [101]).graphs)


if __name__=='__main__': unittest.main()
