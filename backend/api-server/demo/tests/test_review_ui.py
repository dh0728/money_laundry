import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from streamlit.testing.v1 import AppTest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_client import ApiClient, ApiError
import httpx

DEMO = Path(__file__).resolve().parents[1]
USERS = [{'id': 1, 'name': 'L1 A', 'role': 'L1'}, {'id': 3, 'name': 'L2 A', 'role': 'L2'}]
CLOCK = {'businessAt': '2023-09-02T09:00:00+09:00', 'revision': 1, 'configured': True}


def response(path, params=None, **kwargs):
    if path == 'demo/users': return USERS
    if path == 'demo/clock': return CLOCK
    if path == 'dashboard':
        return {'businessAt': CLOCK['businessAt'], 'personal': dict(pending=0, aged=0, closed=0),
                'institution': dict(alerts=0, episodes=0, aged=0, today=0, yesterday=0),
                'detection': dict(received=10, analyzed=5, suspicious=2), 'deliveryDate': '2023-09-01',
                'episodeWork': dict(asOf=CLOCK['businessAt'], current=dict(open=2, created_today=1, closed_today=0, aged=1, unreviewed=1), firstReview=dict(samples=0, average_seconds=None), completion=dict(samples=1, average_seconds=7200), oldestOpen=[]),
                'daily': [], 'agreements': [], 'types': [], 'activities': [], 'priority': []}
    if path == 'review/payment-formats': return ['ACH', 'Cash']
    return dict(content=[], page=0, size=20, totalElements=0, totalPages=0)


class ReviewScreens(unittest.TestCase):
    def test_login_dashboard_and_four_navigation_pages(self):
        with patch.object(ApiClient, 'get', side_effect=response):
            app = AppTest.from_file(str(DEMO / 'app.py')).run(timeout=20)
            self.assertFalse(app.exception)
            self.assertEqual([b.label for b in app.button], ['L1 · Alert 검토', 'L2 · Episode 조사'])
            app.button[0].click().run(timeout=20)
            self.assertFalse(app.exception)
            self.assertTrue(any('최종 결과' in x.value for x in app.info))
            self.assertTrue(any(m.label == '오늘 탐지 의심 거래' and '20.0%' in m.delta for m in app.metric))
            self.assertTrue(any(m.label == '현재 열린 Episode' and m.value == '2' for m in app.metric))
            self.assertTrue(any(m.label == '배정 → 첫 검토 평균' and m.value == '—' for m in app.metric))
            for name in ['Transactions', 'Alerts', 'Episodes']:
                next(r for r in app.radio if r.label == '화면').set_value(name).run(timeout=20)
                self.assertFalse(app.exception, name)

    def test_money_metrics_null_ratio_and_scope_update(self):
        data = dict(available=True, complete=True, selectedAccounts=['a'], candidateAccounts=['a', 'b'],
                    delayMinutes=180, start='2023-09-01T00:00:00Z', endExclusive='2023-09-02T00:00:00Z', ledgerCount=2,
                    external=[dict(currency='USD', **{'in': 100, 'out': 80, 'net': 20})],
                    accounts=[dict(accountId='a', currency='USD', eligibleIn=0, matchedIn=0, excludedIn=100,
                                   rapidOutflowPercent=None, concentrationPercent=None, net=0, **{'in': 100, 'out': 100})])
        code = "from review_ui import money_overview\nfrom api_client import ApiClient\nmoney_overview(ApiClient('http://localhost:8080'), {'id': 1}, {'caseId': 1, 'revision': 3, 'status': 'OPEN', 'assigneeId': 1})"
        with patch.object(ApiClient, 'get', return_value=data), patch.object(ApiClient, 'post', return_value={}) as post:
            app = AppTest.from_string(code).run(timeout=20)
            self.assertFalse(app.exception)
            self.assertTrue(any('산출 불가' in str(frame.value) for frame in app.dataframe))
            app.multiselect[0].set_value(['b']).run()
            next(t for t in app.text_input if t.label == '계좌 범위 변경 의견').set_value('수취 계좌 조사').run()
            next(b for b in app.button if b.label == '조사 계좌 적용').click().run()
            self.assertFalse(app.exception)
            self.assertEqual(post.call_args.args[0], 'review/cases/1/money-scope')
            self.assertEqual(post.call_args.args[1]['accounts'], ['b'])
            self.assertEqual(post.call_args.args[1]['revision'], 3)

    def test_write_failure_is_safe_and_redirect_is_not_followed(self):
        for status in (302, 403, 409, 500):
            calls = []
            def handler(request):
                calls.append(request)
                return httpx.Response(status, text='SECRET', headers={'location': 'https://elsewhere.example'})
            client = ApiClient('http://localhost:8080', transport=httpx.MockTransport(handler))
            with self.assertRaises(ApiError) as caught:
                client.post('review/commands', {'action': 'CLOSE'}, user=1)
            self.assertNotIn('SECRET', str(caught.exception))
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0].headers['X-Demo-User-Id'], '1')

    def test_case_tabs_and_explicit_decision_confirmation(self):
        t = dict(txId=10, occurredAt='2023-09-01T01:00:00Z', fromAccountId='a', toAccountId='b',
                 amountPaid=10, amountReceived=10, paymentCurrency='USD', receivingCurrency='USD',
                 role='SEED', paymentFormat='ACH', scores={'p_laundering': .9}, includedReasons=['SEED'])
        member = dict(txId=10, transaction=t, state='PENDING', reviewRole='SUBJECT', decision=None)
        summary = dict(txCount=1, seedCount=1, riskScore=.9, amountsByCurrency={'USD': 10},
                       netFlows={'a|USD': -10, 'b|USD': 10}, topReceiverShare={'USD': 1}, topSenders=[],
                       paymentFormats={'ACH': 1}, dailySuspiciousCount={'2023-09-01': 1},
                       dailySuspiciousAmount={'2023-09-01|USD': 10}, primaryType='Fan-out', typeShare=1,
                       firstTxAt=t['occurredAt'], lastTxAt=t['occurredAt'])
        detail = dict(caseId=1, alertId=1, kind='ALERT', status='OPEN', revision=1, assigneeId=1,
                      assigneeName='L1 A', createdAt=t['occurredAt'], assignedAt=t['occurredAt'], ageDays=1,
                      groups=[dict(groupId=1, label='Alert 1', members=[member])], summary=summary,
                      sourceAlertIds=[1], primaryTypes=['Fan-out'], pendingCount=1, history=[], relatedDecisions=[])
        def get(path, *args, **kwargs):
            if path.endswith('/money'): return dict(available=False, reason='WAITING_RECEIPTS', selectedAccounts=['a'], candidateAccounts=['a', 'b'], delayMinutes=180)
            if path == 'review/account-nodes': return [dict(id='a', ownerId='owner-a', bankId=1), dict(id='b', ownerId='owner-b', bankId=2)]
            return detail
        code = "from review_ui import case_detail\nfrom api_client import ApiClient\ncase_detail(ApiClient('http://localhost:8080'), {'id': 1, 'role': 'L1'}, 1)"
        with patch.object(ApiClient, 'get', side_effect=get), patch.object(ApiClient, 'post', return_value={'caseIds': [1]}) as post:
            for tab in ['개요', '자금 흐름', '거래', '검토 의견']:
                app = AppTest.from_string(code)
                app.session_state['tab_1'] = tab
                app.run(timeout=20)
                self.assertFalse(app.exception, tab)
                if tab == '자금 흐름':
                    app.radio[0].set_value('소유주').run(timeout=20)
                    self.assertFalse(app.exception)
            app.multiselect[0].set_value([10]).run()
            app.text_area[0].set_value('확인된 거래 범위를 검토했습니다.').run()
            save = next(b for b in app.button if b.label == '처리 저장')
            self.assertTrue(save.disabled)
            next(c for c in app.checkbox if c.label == '선택 범위와 처리 결과를 확인했습니다.').check().run()
            next(b for b in app.button if b.label == '처리 저장').click().run()
            self.assertFalse(app.exception)
            post.assert_called_once()
            payload = post.call_args.args[1]
            self.assertEqual(payload['action'], 'DECIDE')
            self.assertEqual(payload['selections'][0]['txIds'], [10])


if __name__ == '__main__':
    unittest.main()
