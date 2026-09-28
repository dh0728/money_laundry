import sys
import unittest
from pathlib import Path
import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_client import ApiClient, ApiError
from password_hash import encode


class SessionClientTests(unittest.TestCase):
    def test_cookie_and_rotated_csrf_reach_review_and_logout(self):
        seen = []
        def handle(request):
            seen.append(request)
            if request.url.path == '/api/auth/csrf':
                return httpx.Response(200, json={'headerName': 'X-CSRF-TOKEN', 'token': 'second' if len(seen) > 1 else 'first'}, headers={'set-cookie': 'JSESSIONID=session; Path=/; HttpOnly'})
            self.assertIn('JSESSIONID=session', request.headers['cookie'])
            if request.url.path == '/api/auth/login':
                self.assertEqual(request.headers['X-CSRF-TOKEN'], 'first')
                self.assertIn('application/x-www-form-urlencoded', request.headers['content-type'])
                return httpx.Response(200, json={'id': 1, 'role': 'STAFF'})
            self.assertEqual(request.headers['X-CSRF-TOKEN'], 'second')
            self.assertNotIn('X-Demo-User-Id', request.headers)
            return httpx.Response(204) if request.url.path.endswith('/logout') else httpx.Response(200, json={})
        client = ApiClient('http://localhost:8080', transport=httpx.MockTransport(handle))
        self.assertEqual(client.login('staff', 'test-password')['id'], 1)
        client.post('review/commands', {}, user=999)
        client.logout()
        self.assertFalse(client.cookies)
        self.assertIsNone(client.csrf)

    def test_hash_fixture_and_new_salts(self):
        self.assertEqual(encode('compatibility-test', bytes(range(16))), '000102030405060708090a0b0c0d0e0f03dc128a55290cce4ac5014aab7ffcc2aebf4300f7f2517962ac6f03615ecb0f')
        self.assertNotEqual(encode('test'), encode('test'))

    def test_login_redirect_is_not_followed_or_exposed(self):
        calls = []
        def handle(request):
            calls.append(request)
            return httpx.Response(302, text='secret', headers={'location':'https://other.example'})
        client = ApiClient('http://localhost:8080', transport=httpx.MockTransport(handle))
        with self.assertRaises(ApiError) as error:
            client.login('staff','test')
        self.assertEqual(len(calls), 1)
        self.assertNotIn('secret', str(error.exception))
