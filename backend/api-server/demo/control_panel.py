"""Local operator controls. Uses the bank mock and the real analysis API."""
import importlib.util
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from urllib.request import build_opener

import httpx

from api_client import ApiClient, ApiError


def catalog(root):
    root = Path(root).expanduser().resolve(strict=True)
    result = {}
    for folder in sorted(root.iterdir()):
        if not folder.is_dir():
            continue
        try:
            day = date.fromisoformat(folder.name).isoformat()
        except ValueError:
            continue
        files = []
        for file in sorted(folder.glob('*.csv')):
            match = re.fullmatch(r'bank_(\d+)(?:_' + re.escape(day) + r')?\.csv', file.name)
            if not match or not file.resolve().is_relative_to(root):
                raise ValueError('날짜 폴더의 은행 파일명 또는 경로를 확인하세요.')
            files.append((int(match[1]), file))
        if len({bank for bank, _ in files}) != len(files):
            raise ValueError('한 날짜에 같은 은행 파일이 여러 개 있습니다.')
        if files:
            result[day] = files
    if not result:
        raise ValueError('YYYY-MM-DD 폴더와 bank_은행번호_날짜.csv 파일이 필요합니다.')
    return result


def bank_module():
    source = Path(__file__).resolve().parents[2] / 'bank-mock/bank_mock.py'
    spec = importlib.util.spec_from_file_location('aml_panel_bank_mock', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Controls:
    def __init__(self, base):
        ApiClient(base)  # Apply the existing URL rules before any request.
        from urllib.parse import urlsplit
        if urlsplit(base).hostname not in ('localhost', '127.0.0.1', '::1'):
            raise ValueError('조작패널은 로컬 백엔드 주소만 사용합니다.')
        self.base = base.rstrip('/')

    def get(self, path):
        return ApiClient(self.base).get(path)

    def post(self, path, payload=None):
        try:
            with httpx.Client(timeout=30, follow_redirects=False) as client:
                response = client.post(self.base + '/api/v1/' + path, json=payload)
            if response.status_code != 202:
                try:
                    code = response.json().get('code', '')
                except ValueError:
                    code = ''
                code = code if re.fullmatch(r'[A-Z_]{1,80}', str(code)) else ''
                raise ApiError(f'실행 요청 거절: HTTP {response.status_code} {code}')
            return response.json()
        except httpx.HTTPError:
            raise ApiError('실행 응답을 확인하지 못했습니다. 작업 목록 확인 후 재개하세요.') from None

    def upload(self, day, bank, file, report):
        mock = bank_module()
        args = SimpleNamespace(api_url=self.base, bank_id=bank, file=file,
                               business_date=day, correction_request_id=None, cf_headers={})
        opener = build_opener(mock.NoRedirect())
        size, checksum = mock.inspect_file(file)
        target = mock.request_upload(opener, args, size, checksum)
        upload = target['uploadId']
        report(f'{day} 은행 {bank}: 전송 중', uploadId=upload, bankId=bank)
        mock.upload_file(opener, file, target, size)
        result = mock.request_status(opener, args, upload, complete=True)
        result = mock.wait_result(opener, args, upload, result)
        if result['status'] != 'COMPLETED':
            raise ApiError(f'은행 {bank} 검수 실패: uploadId {upload}. 업로드 상태를 확인하세요.')
        return upload


class Replay:
    """One in-flight operation per panel; pausing never cancels a running day."""
    def __init__(self, controls):
        self.controls = controls
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='aml-demo')
        self.lock = threading.Lock()
        self.pause = threading.Event()
        self.future = None
        self.state = {'message': '대기', 'history': [], 'error': None}
        self.sent = set()
        self.jobs = {}
        self.completed = set()

    def report(self, message, **values):
        with self.lock:
            self.state.update(message=message, **values)

    def snapshot(self):
        with self.lock:
            return dict(self.state, history=list(self.state['history']))

    def start(self, days, files, *, analyze=True, upload=True, interval=0):
        if self.future is not None and not self.future.done():
            raise ValueError('현재 작업이 끝날 때까지 기다리세요.')
        self.pause.clear()
        self.report('시작', error=None)
        self.future = self.pool.submit(self._run, list(days), files, analyze, upload, interval)

    def _run(self, days, files, analyze, upload, interval):
        try:
            for day in days:
                if self.pause.is_set():
                    break
                if analyze and day in self.completed:
                    continue
                if upload:
                    for bank, file in files[day]:
                        key = (day, bank, str(file))
                        if key in self.sent:
                            continue
                        self.report(f'{day} 은행 {bank}: 전송 준비')
                        self.controls.upload(day, bank, file, self.report)
                        self.sent.add(key)
                if analyze:
                    self.report(f'{day}: 분석 시작 요청')
                    if day not in self.jobs:
                        self.jobs[day] = self.controls.post('demo/analysis', {'businessDate': day})['jobId']
                    job = self.jobs[day]
                    self.report(f'{day}: 분석 대기', jobId=job)
                    self.wait_job(job, day)
                    self.completed.add(day)
                with self.lock:
                    self.state['history'].append({'date': day, 'result': '분석 완료' if analyze else '전송·검수 완료'})
                if self.pause.wait(interval):
                    break
            self.report('일시정지' if self.pause.is_set() else '선택한 작업 완료')
        except Exception as error:
            # Never display signed URLs, raw HTTP responses or file contents.
            message = str(error) if isinstance(error, ApiError) else '전송 또는 처리 확인 실패. 표시된 ID와 백엔드 작업 목록을 확인하세요.'
            self.report('중단', error=message)

    def wait_job(self, job, day):
        deadline = time.monotonic() + 3600
        while time.monotonic() < deadline:
            detail = self.controls.get(f'batch-jobs/{job}')
            self.report(f'{day}: {detail["status"]} / {detail.get("currentStage", "")}', jobId=job)
            if detail['status'] == 'COMPLETED':
                return
            if detail['status'] == 'FAILED':
                raise ApiError(f'분석 실패: jobId {job}. 원인 확인 후 실패 작업 재개를 사용하세요.')
            time.sleep(2)
        raise ApiError(f'관찰 시간 초과: jobId {job}. 서버 작업은 취소되지 않았습니다.')

    def close(self):
        self.pause.set()
        self.pool.shutdown(wait=False)


def render():
    import os
    import streamlit as st
    st.set_page_config(page_title='AML 시연 조작패널', layout='wide')
    st.title('시연 조작패널')
    st.caption('예약 시각 대기만 생략합니다. 파일 검수와 실제 분석 완료를 기다린 뒤 다음 날짜로 진행합니다.')
    base = st.text_input('로컬 백엔드', os.getenv('AML_DEMO_API_URL', 'http://127.0.0.1:8080'))
    root = st.text_input('날짜별 은행 파일 폴더', os.getenv('AML_DEMO_DATA_DIR', ''))
    try:
        files = catalog(root) if root else {}
        if not files:
            st.info('준비된 날짜별 은행 파일의 상위 폴더를 지정하세요.')
            return
        if 'replay' not in st.session_state:
            st.session_state.replay = Replay(Controls(base))
        replay = st.session_state.replay
        if replay.controls.base != base.rstrip('/'):
            st.info('진행 중 작업의 서버를 바꿀 수 없습니다. 새 패널 세션에서 접속하세요.')
            return
        days = st.multiselect('진행할 날짜 (날짜순)', list(files), default=[next(iter(files))])
        st.write({day: f'은행 파일 {len(files[day])}개' for day in sorted(days)})
        interval = st.number_input('날짜 사이 대기(초)', min_value=0, max_value=300, value=5)

        @st.fragment(run_every='1s')
        def actions():
            running = replay.future is not None and not replay.future.done()
            cols = st.columns(3)
            if cols[0].button('선택 날짜 전송', disabled=running or len(days) != 1):
                replay.start(sorted(days), files, analyze=False)
                st.rerun()
            if cols[1].button('분석 트리거', disabled=running or len(days) != 1):
                replay.start(days, files, upload=False)
                st.rerun()
            if cols[2].button('전송 → 분석 자동 재생', disabled=running or not days):
                replay.start(sorted(days), files, interval=interval)
                st.rerun()
            if st.button('현재 날짜 완료 후 일시정지', disabled=not running):
                replay.pause.set()
            state = replay.snapshot()
            st.write(state['message'])
            st.write({key: state[key] for key in ('bankId', 'uploadId', 'jobId') if key in state})
            if state['error']:
                st.error(state['error'])
            if state['history']:
                st.dataframe(state['history'], hide_index=True)
            job = st.number_input('재개할 실패 작업 ID', min_value=1, step=1)
            if st.button('실패 작업 재개', disabled=running):
                try:
                    replay.controls.post(f'batch-jobs/{job}/resume')
                    st.success('재개 요청을 접수했습니다. 결과 화면에서 진행 상태를 확인하세요.')
                except ApiError as error:
                    st.error(str(error))
        actions()
    except (OSError, ValueError, ApiError) as error:
        st.error(str(error))


if __name__ == '__main__':
    render()
