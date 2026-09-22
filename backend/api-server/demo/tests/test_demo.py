import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from streamlit.testing.v1 import AppTest

DEMO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEMO))
from api_client import ApiClient, ApiError, model_label


def page(rows):
    return dict(content=rows, page=0, totalElements=len(rows), totalPages=int(bool(rows)))


class ClientTests(unittest.TestCase):
    def test_filters_and_read_only_request(self):
        def respond(request):
            self.assertEqual(request.method, 'GET')
            self.assertEqual(request.url.path, '/api/v1/alerts')
            self.assertEqual(request.url.params['jobId'], '7')
            return httpx.Response(200, json=page([]))
        client = ApiClient('http://localhost:8080', transport=httpx.MockTransport(respond))
        self.assertEqual(client.get('alerts', {'jobId': 7}, page=True)['content'], [])

    def test_errors_never_expose_body_or_follow_redirect(self):
        for status in (302, 401, 403, 404, 500):
            calls = []
            def respond(request):
                calls.append(request)
                return httpx.Response(status, text='PRIVATE_SECRET', headers={'location': 'https://other.example'})
            with self.subTest(status=status):
                client = ApiClient('https://api.example', transport=httpx.MockTransport(respond))
                with self.assertRaises(ApiError) as result:
                    client.get('alerts')
                self.assertNotIn('PRIVATE_SECRET', str(result.exception))
                self.assertEqual(len(calls), 1)

    def test_invalid_json_page_and_timeout(self):
        for response in (httpx.Response(200, text='<html>login</html>'),
                         httpx.Response(200, json={'content': []})):
            client = ApiClient('https://api.example', transport=httpx.MockTransport(lambda _: response))
            with self.assertRaises(ApiError):
                client.get('alerts', page=True)
        def timeout(request):
            raise httpx.ReadTimeout('PRIVATE_SECRET', request=request)
        with self.assertRaises(ApiError) as result:
            ApiClient('https://api.example', transport=httpx.MockTransport(timeout)).get('alerts')
        self.assertNotIn('PRIVATE_SECRET', str(result.exception))

    def test_url_and_model_provenance(self):
        for url in ('http://remote.example', 'https://user:secret@api.example', 'https://api.example?token=x'):
            with self.assertRaises(ApiError):
                ApiClient(url)
        self.assertIn('더미', model_label({'modelVersionBinary': 'demo-v1'}))
        self.assertIn('확인 필요', model_label({}))


class ScreenTests(unittest.TestCase):
    def run_app(self):
        return AppTest.from_file(str(DEMO / 'app.py')).run(timeout=15)

    def test_empty_and_connection_failure(self):
        with patch('api_client.ApiClient.get', return_value=page([])):
            app = self.run_app()
            self.assertFalse(app.exception)
            self.assertTrue(any('분석 작업이 없습니다' in x.value for x in app.info))
        with patch('api_client.ApiClient.get', side_effect=ApiError('연결 실패')):
            app = self.run_app()
            self.assertFalse(app.exception)
            self.assertEqual(app.error[0].value, '연결 실패')

    def test_pending_job_does_not_read_results(self):
        with patch('api_client.ApiClient.get', side_effect=[page([{'jobId': 7}]), {'status': 'RUNNING'}]) as get:
            app = self.run_app()
            self.assertFalse(app.exception)
            self.assertEqual(get.call_count, 2)
            self.assertEqual(len(app.metric), 0)

    def test_completed_graph_and_version_selection(self):
        calls = []
        def get(path, params=None, **kwargs):
            calls.append((path, params))
            if path == 'batch-jobs':
                return page([{'jobId': 7}])
            if path == 'batch-jobs/7':
                return {'status': 'COMPLETED', 'modelVersionBinary': 'demo-v1', 'counters': {'alertCount': 1}}
            if path == 'suspicious-transactions':
                self.assertEqual(params['jobId'], 7)
                return page([])
            if path == 'alerts':
                self.assertEqual(params['jobId'], 7)
                return page([{'alertId': 9}])
            if path.endswith('/versions'):
                return [{'version': 2}, {'version': 1}]
            return {'alertId': 9, 'version': (params or {}).get('version', 2), 'status': 'OPEN',
                    'graph': {'nodes': [{'id': 'a'}, {'id': 'b'}],
                              'edges': [{'from': 'a', 'to': 'b', 'txId': 1}]},
                    'transactions': [{'txId': 1, 'role': 'SEED'}]}
        with patch('api_client.ApiClient.get', side_effect=get):
            app = self.run_app()
            self.assertFalse(app.exception)
            self.assertEqual(len(app.metric), 2)
            app.selectbox[2].select(1).run()
            self.assertFalse(app.exception)
            self.assertIn(('alerts/9', {'version': 1}), calls)

    def test_credentials_cannot_follow_edited_url(self):
        with patch.dict('os.environ', {'AML_DEMO_API_URL': 'https://api.example', 'CF_ACCESS_CLIENT_SECRET': 'secret'}):
            with patch('api_client.ApiClient.get', return_value=page([])) as get:
                app = self.run_app()
                before = get.call_count
                app.text_input[0].set_value('https://other.example').run()
                self.assertEqual(get.call_count, before)
                self.assertIn('지정한 주소만', app.error[0].value)


if __name__ == '__main__':
    unittest.main()
