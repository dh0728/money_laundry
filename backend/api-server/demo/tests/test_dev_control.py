import sys
import io
import json
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_client import ApiClient, ApiError
from control_panel import Controls, Replay
from operator_session import AdminClient, cloudflare_headers
import dev_control
import operator_session


class DevControlTests(unittest.TestCase):
    def test_clock_conflict_shows_known_cause_only(self):
        reasons = {
            '시연 시각이 변경됐습니다. 다시 조회하세요.': '다른 요청',
            '진행 중 또는 복구가 필요한 작업이 있습니다.': '실패한 분석',
            '과거로 이동하려면 시연 데이터를 초기화하세요.': '과거로 이동',
            '기존 분석 시연은 초기화 후 업무 시각을 설정하세요.': '최초 설정',
        }
        for detail, expected in reasons.items():
            with self.subTest(detail=detail):
                client = ApiClient('https://dev.example', transport=httpx.MockTransport(
                    lambda _: httpx.Response(409, json={'code': 'INVALID_TRANSITION', 'detail': detail})))
                with self.assertRaisesRegex(ApiError, expected):
                    client.post('demo/clock', {'businessAt': '2023-09-01T09:00:00+09:00', 'revision': 1})

    def test_clock_unknown_response_remains_redacted(self):
        for problem in [{'code': 'INVALID_TRANSITION', 'detail': 'secret-url'},
                        {'code': 'INVALID_TRANSITION', 'detail': ['secret-url']}, ['secret-url']]:
            client = ApiClient('https://dev.example', transport=httpx.MockTransport(
                lambda _: httpx.Response(409, json=problem)))
            with self.assertRaises(ApiError) as error:
                client.post('demo/clock', {})
            self.assertNotIn('secret-url', str(error.exception))
            self.assertEqual(error.exception.status, 409)

    def client(self, responses, *, role='ADMIN', me_status=401, cf_headers=None):
        seen = []
        replies = iter(responses)

        def handle(request):
            seen.append(request)
            path = request.url.path
            if path.endswith('/csrf'):
                return httpx.Response(200, json={'headerName': 'X-CSRF-TOKEN', 'token': 'token'},
                                      headers={'set-cookie': 'JSESSIONID=session; Secure; Path=/'})
            if path.endswith('/login'):
                return httpx.Response(200, json={'id': 1, 'role': role})
            if path.endswith('/logout'):
                return httpx.Response(204)
            if path == '/api/me':
                return httpx.Response(me_status, json={'role': role})
            self.assertEqual(request.headers.get('cookie'), 'JSESSIONID=session')
            if request.method == 'POST':
                self.assertEqual(request.headers.get('X-CSRF-TOKEN'), 'token')
            reply = next(replies)
            if isinstance(reply, Exception):
                raise reply
            return httpx.Response(reply, json={'jobId': 4})

        client = AdminClient('https://dev.example', 'admin', 'secret-password',
                             transport=httpx.MockTransport(handle), cf_headers=cf_headers)
        return client, seen

    def test_expired_get_and_post_reauthenticate_once(self):
        for method, rejection in [('get', 401), ('post', 401), ('post', 403)]:
            with self.subTest(method=method, rejection=rejection):
                client, seen = self.client([rejection, 200])
                client.connect()
                if method == 'get':
                    self.assertEqual(client.get('demo/clock')['jobId'], 4)
                else:
                    self.assertEqual(client.post('demo/analysis', {'businessDate': '2023-09-01'})['jobId'], 4)
                    writes = [r for r in seen if r.url.path.endswith('/analysis')]
                    self.assertEqual(writes[0].content, writes[1].content)
                self.assertEqual(sum(r.url.path.endswith('/login') for r in seen), 2)
                client.close()
                self.assertIsNone(client._password)

    def test_no_retry_for_forbidden_conflict_server_error_or_timeout(self):
        for response in [403, 409, 500, httpx.ReadTimeout('secret-url')]:
            with self.subTest(response=type(response).__name__):
                client, seen = self.client([response], me_status=200)
                client.connect()
                with self.assertRaises(ApiError) as error:
                    client.post('demo/analysis', {'businessDate': '2023-09-01'})
                self.assertNotIn('secret-url', str(error.exception))
                self.assertEqual(sum(r.url.path.endswith('/analysis') for r in seen), 1)
                self.assertEqual(sum(r.url.path.endswith('/login') for r in seen), 1)
                client.close()

    def test_reauthentication_does_not_loop(self):
        client, seen = self.client([401, 401])
        client.connect()
        with self.assertRaises(ApiError):
            client.get('demo/clock')
        self.assertEqual(sum(r.url.path.endswith('/login') for r in seen), 2)
        client.close()

    def test_staff_rejected_and_credentials_cleared(self):
        client, seen = self.client([], role='STAFF')
        with self.assertRaisesRegex(ApiError, 'ADMIN'):
            client.connect()
        self.assertIsNone(client._password)
        self.assertFalse(client._client.cookies)
        self.assertTrue(any(r.url.path.endswith('/logout') for r in seen))

    def test_remote_requires_explicit_https_and_matching_client(self):
        for url in ['http://dev.example', 'https://dev.example/api', 'https://admin:secret@dev.example']:
            with self.assertRaises(ApiError):
                AdminClient(url, 'admin', 'secret')
        with self.assertRaises(ValueError):
            Controls('https://dev.example')
        with self.assertRaises(ValueError):
            Controls('https://dev.example', Mock(base_url='https://other.example'), allow_remote=True)
        self.assertEqual(Controls('https://dev.example', allow_remote=True).base, 'https://dev.example')

    def test_shared_replay_rejects_second_start(self):
        entered, release = threading.Event(), threading.Event()
        controls = Mock()
        controls.prepare_day.side_effect = lambda _: (entered.set(), release.wait(5))
        replay = Replay(controls)
        try:
            replay.start(['2023-09-01'], {'2023-09-01': []}, analyze=False)
            self.assertTrue(entered.wait(3))
            with self.assertRaises(ValueError):
                replay.start(['2023-09-01'], {'2023-09-01': []})
        finally:
            release.set()
            replay.future.result(timeout=5)
            replay.close()

    def test_dev_render_uses_shared_runtime_without_login_form(self):
        from streamlit.testing.v1 import AppTest
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root) / '2023-09-01'
            folder.mkdir()
            (folder / 'bank_12.csv').write_text('header')
            controls = Mock(base='https://dev.example')
            controls.get.return_value = {'businessAt': '2023-09-02T09:00:00+09:00', 'configured': True, 'revision': 1}
            replay = Replay(controls)
            runtime = SimpleNamespace(base=controls.base, root=root, replay=replay)
            try:
                with patch.object(operator_session, 'runtime', runtime), patch('api_client.login_panel') as login:
                    app = AppTest.from_file(str(Path(__file__).resolve().parents[1] / 'control_panel.py')).run(timeout=15)
                    self.assertFalse(app.exception)
                    self.assertFalse(app.error)
                    self.assertEqual(len(app.text_input), 0)
                    login.assert_not_called()
                    controls.post.assert_not_called()
                    controls.upload.assert_not_called()
                    self.assertIn('전송 → 분석 자동 재생', [b.label for b in app.button])
            finally:
                replay.close()

    def test_launcher_loopback_configuration_and_cleanup(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root) / '2023-09-01'
            folder.mkdir()
            (folder / 'bank_12.csv').write_text('header')
            client = Mock(base_url='https://dev.example')
            client.get.return_value = {'businessAt': '2023-09-02T09:00:00+09:00'}
            with patch.object(sys, 'argv', ['dev_control.py', '--api-url', client.base_url, '--data-dir', root]), \
                    patch('builtins.input', return_value='admin'), \
                    patch('getpass.getpass', return_value='secret-password'), \
                    patch.object(dev_control, 'AdminClient', return_value=client), \
                    patch('streamlit.web.bootstrap.load_config_options') as load, \
                    patch('streamlit.web.bootstrap.run') as run:
                self.assertEqual(dev_control.main(), 0)
                options = run.call_args.args[3]
                self.assertEqual(options['server.address'], '127.0.0.1')
                self.assertEqual(options['server.port'], 8502)
                self.assertTrue(options.get('server.enableXsrfProtection', True))
                load.assert_called_once_with(options)
                self.assertNotIn('secret-password', str(run.call_args))
                client.close.assert_called_once()
                self.assertIsNone(operator_session.runtime)

    def test_launcher_auth_failure_never_opens_panel(self):
        client = Mock()
        client.connect.side_effect = ApiError('로그인 거절', 401)
        with patch.object(sys, 'argv', ['dev_control.py', '--data-dir', 'unused']), \
                patch.object(dev_control, 'catalog'), \
                patch('builtins.input', return_value='admin'), \
                patch('getpass.getpass', return_value='secret-password'), \
                patch.object(dev_control, 'AdminClient', return_value=client), \
                patch('streamlit.web.bootstrap.run') as run:
            self.assertEqual(dev_control.main(), 1)
            run.assert_not_called()
            client.get.assert_not_called()
            client.close.assert_called_once()
            self.assertIsNone(operator_session.runtime)

    def test_cloudflare_headers_on_auth_renewal_and_api(self):
        headers = cloudflare_headers('test-id', 'test-secret')
        client, seen = self.client([401, 200], cf_headers=headers)
        client.connect()
        client.post('demo/analysis', {'businessDate': '2023-09-01'})
        client.close()
        for request in seen:
            self.assertEqual(request.headers['CF-Access-Client-Id'], 'test-id')
            self.assertEqual(request.headers['CF-Access-Client-Secret'], 'test-secret')
            self.assertEqual(request.url.host, 'dev.example')
        self.assertFalse(client._client.headers)
        self.assertEqual(headers['CF-Access-Client-Id'], 'test-id')

    def test_invalid_cloudflare_tokens_rejected_without_echo(self):
        self.assertEqual(cloudflare_headers(), {})
        for pair in [('id', ''), ('', 'secret'), ('id', 'secret\r\ninjected'), ('id', '한글'), ('id', ' ')]:
            with self.assertRaises(ApiError) as error:
                cloudflare_headers(*pair)
            self.assertNotIn('injected', str(error.exception))

    def test_cloudflare_redirect_is_not_followed_and_login_password_not_sent(self):
        seen = []
        def handle(request):
            seen.append(request)
            return httpx.Response(302, headers={'location': 'https://access.example/login?secret=hidden'})
        client = AdminClient('https://dev.example', 'admin', 'password', transport=httpx.MockTransport(handle))
        with self.assertRaisesRegex(ApiError, 'Cloudflare') as error:
            client.connect()
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0].url.path, '/api/auth/csrf')
        self.assertNotIn('hidden', str(error.exception))
        self.assertNotIn(b'password', seen[0].content)

    def test_bank_api_gets_cloudflare_headers_but_s3_does_not(self):
        seen = []
        def handle(request, **kwargs):
            seen.append(request)
            if request.full_url.endswith('/uploads'):
                body = json.loads(request.data)
                result, status = {'uploadId': 1, 'bankId': 12, 'method': 'PUT',
                                  'url': 'https://bucket.s3.example/input.csv',
                                  'expiresAt': '2026-09-29T18:00:00+09:00',
                                  'headers': {'Content-Type': 'text/csv',
                                              'x-amz-checksum-sha256': body['checksumSha256']}}, 201
            elif request.get_method() == 'PUT':
                result, status = {}, 200
                self.assertEqual(request.data.read(), b'header\nrow\n')
            else:
                result = {'uploadId': 1, 'bankId': 12,
                          'status': 'RUNNING' if request.get_method() == 'POST' else 'COMPLETED'}
                status = 202 if request.get_method() == 'POST' else 200
            response = io.BytesIO(json.dumps(result).encode())
            response.status = status
            return response
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'bank_12.csv'
            source.write_bytes(b'header\nrow\n')
            controls = Controls('https://dev.example', allow_remote=True,
                                cf_headers=cloudflare_headers('test-id', 'test-secret'))
            with patch('control_panel.build_opener', return_value=Mock(open=handle)), patch('time.sleep'):
                self.assertEqual(controls.upload('2023-09-01', 12, source, Mock()), 1)
        self.assertEqual(len(seen), 4)
        for request in seen:
            headers = {k.lower(): v for k, v in request.header_items()}
            if request.get_method() == 'PUT':
                self.assertFalse(any(k in headers for k in ['cf-access-client-id', 'cf-access-client-secret', 'cookie', 'authorization', 'x-bank-id']))
            else:
                self.assertEqual(headers['cf-access-client-secret'], 'test-secret')

    def test_launcher_hidden_cloudflare_input(self):
        client = Mock(base_url='https://dev.example')
        client.get.return_value = {'businessAt': '2023-09-02T09:00:00+09:00'}
        with patch.object(sys, 'argv', ['dev_control.py', '--api-url', client.base_url, '--data-dir', 'unused', '--cloudflare']), \
                patch.object(dev_control, 'catalog'), patch('builtins.input', return_value='admin'), \
                patch('getpass.getpass', side_effect=['test-id', 'test-secret', 'test-password']), \
                patch.object(dev_control, 'AdminClient', return_value=client) as constructor, \
                patch('streamlit.web.bootstrap.load_config_options'), \
                patch('streamlit.web.bootstrap.run') as run:
            captured = []
            constructor.side_effect = lambda *a, **kw: (captured.append(dict(kw['cf_headers'])), client)[1]
            self.assertEqual(dev_control.main(), 0)
            self.assertEqual(captured, [cloudflare_headers('test-id', 'test-secret')])
            self.assertNotIn('test-secret', str(run.call_args))


if __name__ == '__main__':
    unittest.main()
