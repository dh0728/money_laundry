"""PostgreSQL Alert evidence tests. Expectations are manually specified flows."""
from datetime import datetime
import json
import os
import unittest
from uuid import uuid4

from psycopg.types.json import Jsonb
from alert_pipeline import save_alerts, POLICY
from frozen_input import InputExecution, StaleExecution
import test_frozen_input_postgres as fixtures


@unittest.skipUnless(os.environ.get("AML_TEST_DOCKER"), "AML_TEST_DOCKER is required")
class AlertPostgresTests(unittest.TestCase):
    docker = classmethod(fixtures.FrozenInputPostgresTests.docker.__func__)
    setUpClass = classmethod(fixtures.FrozenInputPostgresTests.setUpClass.__func__)

    def setUp(self):
        fixtures.FrozenInputPostgresTests.setUp(self)
        self.admin.execute("TRUNCATE review.alerts CASCADE")
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

    def plans(self):
        return [json.loads(payload) for payload, in self.admin.execute(
            'SELECT payload FROM analysis.alert_plans WHERE run_id=%s ORDER BY plan_key', (self.run,))]

    def test_restricted_worker_prepares_without_modifying_business_state(self):
        before = self.admin.execute('SELECT user_id,last_assigned_at FROM core.users ORDER BY user_id').fetchall()
        with self.psycopg.connect(**dict(self.connect_args,user=self.worker_user,password=self.worker_password)) as writer:
            save_alerts(writer,self.execution)
            for statement in ("UPDATE core.users SET last_assigned_at=now()", "DELETE FROM review.alerts", "DELETE FROM review.alert_versions", "DELETE FROM review.events"):
                with self.assertRaises(self.psycopg.errors.InsufficientPrivilege): writer.execute(statement)
        plan, = self.plans()
        self.assertEqual(plan['action'],'NEW')
        self.assertEqual(plan['evidence']['policyVersion'],'flow-evidence-2')
        self.assertEqual(self.admin.execute('SELECT count(*) FROM review.alerts').fetchone()[0],0)
        self.assertEqual(before,self.admin.execute('SELECT user_id,last_assigned_at FROM core.users ORDER BY user_id').fetchall())

    def test_payload_checksum_and_manifest_cover_every_operation(self):
        import hashlib
        save_alerts(self.admin,self.execution)
        aggregate = hashlib.sha256()
        for key, checksum, payload in self.admin.execute('SELECT plan_key,plan_digest,payload FROM analysis.alert_plans WHERE run_id=%s ORDER BY plan_key',(self.run,)):
            self.assertEqual(checksum,hashlib.sha256(payload.encode()).hexdigest())
            aggregate.update(f'{key}:{checksum}\n'.encode())
        artifact = json.loads(self.admin.execute("SELECT artifact FROM analysis.stage_results WHERE run_id=%s AND stage='ALERTS'",(self.run,)).fetchone()[0])
        self.assertEqual(artifact['planDigest'],aggregate.hexdigest())
        self.assertEqual(artifact['publication'],'PREPARED')

    def test_retry_preserves_plan_and_updates_execution_fence(self):
        save_alerts(self.admin,self.execution)
        before = self.plans()
        execution = InputExecution(self.job,self.run,uuid4())
        self.admin.execute('UPDATE analysis.jobs SET execution_id=%s WHERE job_id=%s',(execution.execution_id,self.job))
        from unittest.mock import patch
        with patch('alert_pipeline._build_graphs', side_effect=AssertionError('Retry rebuilt the ledger')):
            save_alerts(self.admin,execution)
        self.assertEqual(self.plans(),before)
        self.assertEqual(self.admin.execute('SELECT execution_id,build_generation FROM analysis.alert_plans WHERE run_id=%s',(self.run,)).fetchone(),(execution.execution_id,1))

    def test_fenced_run_cannot_prepare(self):
        self.admin.execute('UPDATE analysis.jobs SET execution_id=%s WHERE job_id=%s',(uuid4(),self.job))
        with self.assertRaises(StaleExecution): save_alerts(self.admin,self.execution)
        self.assertEqual(self.plans(),[])

    def test_checkpoint_failure_rolls_back_all_plans(self):
        self.admin.execute("CREATE FUNCTION fail_alert_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.stage='ALERTS' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$")
        self.admin.execute('CREATE TRIGGER fail_alert_checkpoint BEFORE INSERT ON analysis.stage_results FOR EACH ROW EXECUTE FUNCTION fail_alert_checkpoint()')
        try:
            with self.assertRaises(self.psycopg.Error): save_alerts(self.admin,self.execution)
        finally:
            self.admin.execute('DROP TRIGGER fail_alert_checkpoint ON analysis.stage_results')
            self.admin.execute('DROP FUNCTION fail_alert_checkpoint()')
        self.assertEqual(self.plans(),[])

    def test_concurrent_duplicate_delivery_prepares_once(self):
        from concurrent.futures import ThreadPoolExecutor
        def invoke(_):
            with self.psycopg.connect(**self.connect_args) as db: save_alerts(db,self.execution)
        with ThreadPoolExecutor(max_workers=2) as pool: list(pool.map(invoke,range(2)))
        self.assertEqual(len(self.plans()),1)

    def test_no_relation_retains_unassigned_seed(self):
        self.admin.execute('UPDATE analysis.input_transactions SET from_account_id=%s,to_account_id=%s WHERE run_id=%s AND tx_id=%s',(uuid4(),uuid4(),self.run,self.ids[2]))
        save_alerts(self.admin,self.execution)
        self.assertEqual(self.plans(),[])
        artifact = json.loads(self.admin.execute("SELECT artifact FROM analysis.stage_results WHERE run_id=%s AND stage='ALERTS'",(self.run,)).fetchone()[0])
        self.assertEqual(artifact['unassignedSeedCount'],1)

    def test_rebuild_increments_generation(self):
        save_alerts(self.admin,self.execution)
        self.admin.execute("DELETE FROM analysis.stage_results WHERE run_id=%s AND stage='ALERTS'",(self.run,))
        save_alerts(self.admin,self.execution)
        self.assertEqual(self.admin.execute('SELECT build_generation FROM analysis.alert_plans WHERE run_id=%s',(self.run,)).fetchone()[0],2)

    def test_budget_failure_prepares_nothing(self):
        from dataclasses import replace
        from unittest.mock import patch
        from worker_transport import ProtocolError
        with patch('alert_pipeline.POLICY',replace(POLICY,max_core_edges=1)):
            with self.assertRaisesRegex(ProtocolError,'budget exceeded'): save_alerts(self.admin,self.execution)
        self.assertEqual(self.plans(),[])


class AlertExtensionTests(unittest.TestCase):
    def test_coverage_calendar_is_not_repeated_for_every_seed(self):
        from alert_pipeline import _coverage
        result = _coverage([dict(txId=key) for key in range(4096)], {'2023-09-01': dict(complete=True)})
        self.assertEqual(len(result), 1)
        self.assertEqual(len(result[0]['txIds']), 4096)
        self.assertEqual(result[0]['days'], [dict(businessDate='2023-09-01', complete=True)])

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
