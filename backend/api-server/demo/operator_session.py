"""Process-local dev operator session. Never persists administrator credentials."""
import threading
from urllib.parse import urlsplit

from api_client import ApiClient, ApiError


runtime = None


def cloudflare_headers(client_id='', client_secret=''):
    if bool(client_id) != bool(client_secret):
        raise ApiError('CF_ACCESS_CLIENT_ID와 CF_ACCESS_CLIENT_SECRET을 함께 설정하세요.')
    for value in (client_id, client_secret):
        if value and (not value.isascii() or not value.strip()
                      or any(ord(char) < 33 or ord(char) == 127 for char in value)):
            raise ApiError('Cloudflare 서비스 토큰의 헤더 형식을 확인하세요.')
    return {'CF-Access-Client-Id': client_id, 'CF-Access-Client-Secret': client_secret} if client_id else {}


class AdminClient:
    def __init__(self, base, username, password, *, transport=None, cf_headers=None):
        url = urlsplit(base)
        if url.scheme != 'https' or url.path not in ('', '/'):
            raise ApiError('dev 주소는 경로 없는 HTTPS 기본 주소여야 합니다.')
        self._client = ApiClient(base, headers=dict(cf_headers or {}), transport=transport)
        self.base_url = self._client.base_url
        self._username = username
        self._password = password
        self._lock = threading.RLock()
        self.user = None

    def connect(self):
        with self._lock:
            self._client.cookies.clear()
            self._client.csrf = None
            try:
                user = self._client.login(self._username, self._password)
            except ApiError as error:
                if error.status in (301, 302, 303, 307, 308):
                    raise ApiError('인증 API가 다른 페이지로 이동합니다. Cloudflare Access 서비스 토큰과 접근 정책을 확인하세요.',
                                   error.status) from None
                raise
            if user.get('role') != 'ADMIN':
                self.close()
                raise ApiError('dev 조작패널에는 ADMIN 계정이 필요합니다.')
            self.user = user
            return user

    def _request(self, method, *args, **kwargs):
        with self._lock:
            try:
                return getattr(self._client, method)(*args, **kwargs)
            except ApiError as error:
                expired = error.status == 401
                if error.status == 403:
                    # CSRF may reject an expired session before authentication does.
                    try:
                        self._client.me()
                    except ApiError as probe:
                        expired = probe.status == 401
                if not expired:
                    raise
                self.connect()
                # Retry once only after an explicit authentication rejection.
                return getattr(self._client, method)(*args, **kwargs)

    def get(self, path, params=None, *, page=False):
        return self._request('get', path, params, page=page)

    def post(self, path, payload=None):
        return self._request('post', path, payload)

    def close(self):
        with self._lock:
            try:
                self._client.logout()
            except ApiError:
                pass
            finally:
                self._username = self._password = None
                self._client.headers.clear()
                self.user = None
