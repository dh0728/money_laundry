"""Process-local dev operator session. Never persists administrator credentials."""
import threading
from urllib.parse import urlsplit

from api_client import ApiClient, ApiError


runtime = None


class AdminClient:
    def __init__(self, base, username, password, *, transport=None):
        url = urlsplit(base)
        if url.scheme != 'https' or url.path not in ('', '/'):
            raise ApiError('dev 주소는 경로 없는 HTTPS 기본 주소여야 합니다.')
        self._client = ApiClient(base, transport=transport)
        self.base_url = self._client.base_url
        self._username = username
        self._password = password
        self._lock = threading.RLock()
        self.user = None

    def connect(self):
        with self._lock:
            self._client.cookies.clear()
            self._client.csrf = None
            user = self._client.login(self._username, self._password)
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
                self.user = None
