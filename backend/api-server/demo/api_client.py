"""Read-only HTTP boundary for the Streamlit demonstration."""
from urllib.parse import urlsplit

import httpx


class ApiError(Exception):
    """A safe message that never contains a response body or credentials."""


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

    def get(self, path, params=None, *, page=False):
        try:
            with httpx.Client(timeout=15, follow_redirects=False, headers=self.headers,
                              transport=self.transport) as client:
                response = client.get(self.base_url + '/api/v1/' + path, params=params)
            if 300 <= response.status_code < 400:
                raise ApiError('인증 페이지로 이동하는 응답입니다. API 접근 인증 설정을 확인하세요.')
            if response.status_code != 200:
                messages = {401: '인증이 필요합니다.', 403: '조회 권한이 없습니다.',
                            404: '해당 API 또는 완료된 결과를 찾을 수 없습니다.'}
                raise ApiError(messages.get(response.status_code, 'API 요청이 실패했습니다.')
                               + f' (HTTP {response.status_code})')
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
