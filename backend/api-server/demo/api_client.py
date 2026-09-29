"""Read-only HTTP boundary for the Streamlit demonstration."""
from urllib.parse import urlsplit

import httpx


class ApiError(Exception):
    """A safe message that never contains a response body or credentials."""

    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


def clock_conflict(response):
    """Expose only known clock errors, never arbitrary server response text."""
    try:
        problem = response.json()
    except ValueError:
        return None
    if not isinstance(problem, dict) or problem.get('code') != 'INVALID_TRANSITION':
        return None
    messages = {
        '시연 시각이 변경됐습니다. 다시 조회하세요.':
            '다른 요청에서 업무 시각을 변경했습니다. 화면을 새로고침한 뒤 다시 적용하세요.',
        '진행 중 또는 복구가 필요한 작업이 있습니다.':
            '진행 중·예약·재시도 대기 작업 또는 실패한 분석 작업이 있어 업무 시각을 변경할 수 없습니다. 분석 작업 상태를 확인하세요.',
        '과거로 이동하려면 시연 데이터를 초기화하세요.':
            '이미 설정된 업무 시각보다 과거로 이동할 수 없습니다. 현재 시각을 확인하세요. 과거부터 다시 시연하려면 별도의 데이터 초기화가 필요합니다.',
        '기존 분석 시연은 초기화 후 업무 시각을 설정하세요.':
            '업무 시각을 최초 설정하기 전에 생성된 분석 이력이 있어 변경이 차단됐습니다. 기존 데이터 확인 후 시연 초기화 여부를 결정해야 합니다.',
    }
    detail = problem.get('detail')
    return messages.get(detail) if isinstance(detail, str) else None


class ApiClient:
    def __init__(self, base_url, headers=None, transport=None):
        url = urlsplit(base_url)
        if (not url.hostname or url.username or url.password or url.query or url.fragment
                or (url.scheme != 'https' and not (
                    url.scheme == 'http' and url.hostname in ('localhost', '127.0.0.1', '::1')))):
            raise ApiError('API 주소는 HTTPS 또는 로컬 HTTP 주소여야 합니다.')
        self.base_url = base_url.rstrip('/')
        self.headers = headers or {}
        self.transport = transport
        self.cookies = httpx.Cookies()
        self.csrf = None

    def auth(self, method, path, data=None):
        headers = dict(self.headers)
        if self.csrf:
            headers[self.csrf['headerName']] = self.csrf['token']
        try:
            with httpx.Client(timeout=15, follow_redirects=False, headers=headers,
                              cookies=self.cookies, transport=self.transport) as client:
                response = client.request(method, self.base_url + '/api/' + path, data=data)
                self.cookies.update(client.cookies)
            if response.status_code not in (200, 204):
                raise ApiError('로그인 정보 또는 세션을 확인하세요. (HTTP %s)' % response.status_code,
                               response.status_code)
            return response.json() if response.status_code != 204 else None
        except (httpx.HTTPError, ValueError):
            raise ApiError('인증 서버 응답을 확인하지 못했습니다.') from None

    def login(self, username, password):
        self.csrf = self.auth('GET', 'auth/csrf')
        user = self.auth('POST', 'auth/login', {'username': username, 'password': password})
        self.csrf = self.auth('GET', 'auth/csrf')
        return user

    def me(self):
        return self.auth('GET', 'me')

    def logout(self):
        try:
            self.auth('POST', 'auth/logout')
        finally:
            self.cookies.clear()
            self.csrf = None

    def post(self, path, payload, user=None):
        headers = dict(self.headers)
        if self.csrf:
            headers[self.csrf['headerName']] = self.csrf['token']
        try:
            with httpx.Client(timeout=30, follow_redirects=False, headers=headers,
                              transport=self.transport, cookies=self.cookies) as client:
                response = client.post(self.base_url + '/api/v1/' + path, json=payload)
                self.cookies.update(client.cookies)
            if response.status_code not in (200, 201, 202):
                messages = {400: '선택 범위와 입력을 확인하세요.', 403: '담당자 또는 실행 환경 권한이 없습니다.',
                            404: '대상이 없습니다.', 409: '상태가 변경됐거나 처리 조건이 충족되지 않았습니다. 새로 조회하세요.'}
                specific = clock_conflict(response) if path == 'demo/clock' and response.status_code == 409 else None
                raise ApiError((specific or messages.get(response.status_code, '요청이 처리되지 않았습니다.'))
                               + f' (HTTP {response.status_code})', response.status_code)
            return response.json()
        except httpx.HTTPError:
            raise ApiError('응답을 확인하지 못했습니다. 같은 요청으로 재시도하거나 처리 이력을 확인하세요.') from None
        except ValueError:
            raise ApiError('JSON 응답을 확인하지 못했습니다.') from None

    def get(self, path, params=None, *, page=False):
        try:
            with httpx.Client(timeout=15, follow_redirects=False, headers=self.headers,
                              transport=self.transport, cookies=self.cookies) as client:
                response = client.get(self.base_url + '/api/v1/' + path, params=params)
                self.cookies.update(client.cookies)
            if 300 <= response.status_code < 400:
                raise ApiError('인증 페이지로 이동하는 응답입니다. API 접근 인증 설정을 확인하세요.')
            if response.status_code != 200:
                messages = {401: '인증이 필요합니다.', 403: '조회 권한이 없습니다.',
                            404: '해당 API 또는 완료된 결과를 찾을 수 없습니다.'}
                raise ApiError(messages.get(response.status_code, 'API 요청이 실패했습니다.')
                               + f' (HTTP {response.status_code})', response.status_code)
            data = response.json()
        except httpx.TimeoutException:
            raise ApiError('API 응답 시간이 초과됐습니다. 다시 조회하세요.') from None
        except httpx.HTTPError:
            raise ApiError('API에 연결하지 못했습니다. 주소와 서버 상태를 확인하세요.') from None
        except ValueError:
            raise ApiError('JSON API 응답이 아닙니다. API 주소와 인증 설정을 확인하세요.') from None
        if page:
            if (not isinstance(data, dict) or not isinstance(data.get('content'), list)
                    or not all(isinstance(x, dict) for x in data['content'])
                    or any(type(data.get(k)) is not int or data[k] < 0
                           for k in ('page', 'totalElements', 'totalPages'))):
                raise ApiError('목록 응답 형식이 맞지 않습니다.')
        elif not isinstance(data, (dict, list)):
            raise ApiError('상세 응답 형식이 맞지 않습니다.')
        return data


def model_label(job):
    versions = [job.get('modelVersionBinary'), job.get('modelVersionType')]
    if any('demo' in str(v).lower() for v in versions if v):
        return '시연용 더미 모델 결과 — 탐지 성능 평가용이 아닙니다.'
    return '모델 출처 확인 필요 — 버전 이름만으로 실제 모델 검증 여부를 보장하지 않습니다.'


def login_panel(base, key='staff_client'):
    """Keep only the session cookie in this browser session, never the password."""
    import streamlit as st
    client = st.session_state.get(key)
    if client is not None and client.base_url != base.rstrip('/'):
        st.error('로그아웃 후 서버 주소를 변경하세요.')
        return None
    if client is not None:
        try:
            return client, client.me()
        except ApiError:
            st.session_state.pop(key, None)
            st.warning('세션이 만료됐거나 서버에 연결할 수 없습니다. 다시 로그인하세요.')
    with st.form(key + '_login', clear_on_submit=True):
        username = st.text_input('아이디')
        password = st.text_input('비밀번호', type='password')
        submit = st.form_submit_button('로그인')
    if submit:
        try:
            client = ApiClient(base)
            client.login(username, password)
            st.session_state[key] = client
            st.rerun()
        except ApiError as error:
            st.error(str(error))
    return None
