"""Local operator controls. Uses the bank mock and the real analysis API."""
import importlib.util
import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time as day_time, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.request import build_opener
from urllib.error import HTTPError, URLError

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


def upload_failure(error, bank, stage):
    """Map known errors without disclosing response bodies, signed URLs or tokens."""
    prefix = f'은행 {bank} · {stage} 실패: '
    if isinstance(error, HTTPError):
        messages = {
            'REPORTING_NOT_REGISTERED': '해당 은행·거래 기준일·AML17 양식의 사전 등록이 없습니다.',
            'DUPLICATE_FILE': '이미 처리한 동일 파일입니다. 기존 업로드 상태를 확인하세요.',
            'UPLOAD_IN_PROGRESS': '동일 파일의 업로드가 이미 진행 중입니다. 기존 업로드 상태를 확인하세요.',
            'UPLOAD_URL_EXPIRED': '업로드 URL이 만료됐습니다.',
            'UPLOAD_MISMATCH': 'S3 객체가 없거나 파일 크기·체크섬이 일치하지 않습니다.',
            'UPLOAD_SUPERSEDED': '새 업로드가 발급됐습니다. 최신 업로드 번호를 확인하세요.',
            'FILE_TOO_LARGE': '서버가 허용한 파일 크기를 초과했습니다.',
            'VALIDATION_FAILED': '업로드 요청의 파일명·기준일·체크섬 등 입력을 확인하세요.',
            'BANK_IDENTITY_DISABLED': '현재 서버 환경에서 목업 은행 식별을 허용하지 않습니다.',
        }
        code = None
        try:
            body = json.loads(error.read(8192))
            candidate = body.get('code') if isinstance(body, dict) else None
            if isinstance(candidate, str) and candidate in messages:
                code = candidate
        except (ValueError, OSError):
            pass
        finally:
            error.close()
        if code:
            return ApiError(prefix + f'HTTP {error.code} · {code} — {messages[code]}', error.code)
        if 300 <= error.code < 400:
            message = '다른 페이지로 이동하는 응답입니다. Cloudflare 접근 정책과 API 주소를 확인하세요.'
        elif stage == 'S3 전송' and error.code == 403:
            message = 'S3가 업로드를 거절했습니다. 서명 URL 만료·서명 헤더·저장소 권한을 확인하세요.'
        elif error.code in (401, 403):
            message = '접근이 거절됐습니다. 이 요청 경로의 Cloudflare 서비스 토큰 정책과 서버 권한을 확인하세요.'
        else:
            message = '서버가 요청을 거절했습니다. 해당 단계의 서버 상태를 확인하세요.'
        return ApiError(prefix + f'HTTP {error.code} — {message}', error.code)
    if isinstance(error, (TimeoutError, URLError)):
        message = '연결·응답 확인에 실패했습니다. 처리 여부를 확인하기 전 재전송을 반복하지 마세요.'
    elif isinstance(error, OSError) and stage in ('목업 모듈 준비', '파일 확인'):
        message = '로컬 파일을 읽을 수 없습니다. 파일 존재 여부와 읽기 권한을 확인하세요.'
    elif isinstance(error, (ValueError, KeyError, TypeError)):
        message = ('CSV가 비어 있거나 파일을 확인할 수 없습니다.' if stage == '파일 확인'
                   else '서버 응답이 예상한 업로드 계약과 다릅니다. API 응답 형식을 확인하세요.')
    else:
        message = '처리 중 내부 오류가 발생했습니다. 실패 단계와 은행 번호를 전달하세요.'
    return ApiError(prefix + message)


class Controls:
    def __init__(self, base, client=None, *, allow_remote=False, cf_headers=None):
        ApiClient(base)  # Apply the existing URL rules before any request.
        from urllib.parse import urlsplit
        if not allow_remote and urlsplit(base).hostname not in ('localhost', '127.0.0.1', '::1'):
            raise ValueError('조작패널은 로컬 백엔드 주소만 사용합니다.')
        if allow_remote and (urlsplit(base).scheme != 'https' or urlsplit(base).path not in ('', '/')):
            raise ValueError('dev 주소는 경로 없는 HTTPS 기본 주소여야 합니다.')
        if client is not None and client.base_url != base.rstrip('/'):
            raise ValueError('인증 서버와 조작 대상 서버가 다릅니다.')
        self.base = base.rstrip('/')
        self.client = client or ApiClient(base)
        self.cf_headers = dict(cf_headers or {})
        self.uploads = {}

    def get(self, path):
        return self.client.get(path)

    def set_clock(self, value):
        clock = self.get('demo/clock')
        return self.client.post('demo/clock', {'businessAt': value, 'revision': clock['revision']})

    def prepare_day(self, day):
        clock = self.get('demo/clock')
        target = datetime.combine(date.fromisoformat(day) + timedelta(days=1), day_time(9),
                                  timezone(timedelta(hours=9)))
        if clock['configured'] and datetime.fromisoformat(clock['businessAt']) >= target:
            return
        self.set_clock(target.isoformat())

    def post(self, path, payload=None):
        return self.client.post(path, payload)

    def _issue_upload(self, mock, opener, args, size, checksum, progress):
        for attempt in range(6):
            try:
                return mock.request_upload(opener, args, size, checksum)
            except HTTPError as error:
                if error.code == 409:
                    try:
                        body = json.loads(error.read(8192))
                    except (ValueError, OSError):
                        body = {}
                    finally:
                        error.close()
                    if (isinstance(body, dict)
                            and body.get('code') in ('DUPLICATE_FILE', 'UPLOAD_IN_PROGRESS')
                            and type(body.get('uploadId')) is int and body['uploadId'] > 0):
                        return {'uploadId': body['uploadId'], 'existing': True}
                    raise ApiError('기존 업로드 번호를 확인할 수 없습니다. 서버의 업로드 복구 API 배포 여부를 확인하세요.', 409) from None
                if error.code not in (408, 429, 500, 502, 503, 504, 520, 522, 524) or attempt == 5:
                    raise
                error.close()
            except (URLError, TimeoutError):
                if attempt == 5:
                    raise
            delay = min(5 * 2 ** attempt, 30)
            progress(f'업로드 접수 확인 재시도 {attempt + 1}회 · {delay}초 후')
            time.sleep(delay)

    def _upload_status(self, mock, opener, args, upload, progress):
        for attempt in range(6):
            try:
                return mock.request_status(opener, args, upload)
            except (HTTPError, URLError, TimeoutError) as error:
                transient = not isinstance(error, HTTPError) or error.code in (408, 429, 500, 502, 503, 504, 520, 522, 524)
                if not transient or attempt == 5:
                    raise
                if isinstance(error, HTTPError):
                    error.close()
                delay = min(5 * 2 ** attempt, 30)
                progress(f'검수 결과 조회 재시도 {attempt + 1}회 · {delay}초 후', uploadId=upload)
                time.sleep(delay)

    def upload(self, day, bank, file, report):
        stage = '목업 모듈 준비'
        def progress(value, **values):
            nonlocal stage
            stage = value
            report(f'{day} 은행 {bank}: {stage}', bankId=bank, **values)
        try:
            progress(stage, uploadId=None)
            mock = bank_module()
            args = SimpleNamespace(api_url=self.base, bank_id=bank, file=file,
                                   business_date=day, correction_request_id=None, cf_headers=self.cf_headers)
            opener = build_opener(mock.NoRedirect())
            progress('파일 확인')
            size, checksum = mock.inspect_file(file)
            key = (day, bank, file.name, size, checksum)
            pending = self.uploads.get(key)
            if pending is None:
                progress('업로드 URL 발급')
                target = self._issue_upload(mock, opener, args, size, checksum, progress)
                pending = {'target': target, 'uploaded': False}
                self.uploads[key] = pending
                if target.get('existing'):
                    progress('기존 업로드 상태 확인', uploadId=target['uploadId'])
                    result = self._upload_status(mock, opener, args, target['uploadId'], progress)
                else:
                    result = {'status': 'URL_ISSUED'}
            else:
                progress('기존 업로드 상태 확인', uploadId=pending['target']['uploadId'])
                result = self._upload_status(mock, opener, args, pending['target']['uploadId'], progress)
            target = pending['target']
            upload = target['uploadId']
            if target.get('existing') and (result.get('businessDate') != day or result.get('sizeBytes') != size):
                raise ApiError(f'은행 {bank} 기존 파일의 기준일·크기가 다릅니다. uploadId {upload}. 자동으로 건너뛰지 않습니다.')
            if result['status'] == 'URL_ISSUED':
                if target.get('existing'):
                    # The existing object may already be stored; completion verifies its hash and size.
                    # Forget URL-only lookup so a later retry can obtain a new URL after expiry.
                    self.uploads.pop(key, None)
                if not pending['uploaded'] and not target.get('existing'):
                    progress('S3 전송', uploadId=upload)
                    mock.upload_file(opener, file, target, size)
                    pending['uploaded'] = True
                progress('업로드 완료 통지', uploadId=upload)
                try:
                    result = mock.request_status(opener, args, upload, complete=True)
                except (HTTPError, URLError, TimeoutError) as error:
                    if isinstance(error, HTTPError) and error.code not in (408, 429, 500, 502, 503, 504, 520, 522, 524):
                        raise
                    if isinstance(error, HTTPError):
                        error.close()
                    # Reconcile a lost POST response by GET; never blindly repeat upload.
                    result = self._upload_status(mock, opener, args, upload, progress)
            progress('검수 결과 조회', uploadId=upload)
            deadline = time.monotonic() + 1800
            while result['status'] in ('RECEIVED', 'RUNNING'):
                if time.monotonic() >= deadline:
                    raise ApiError(f'은행 {bank} 검수 관찰 시간 초과: uploadId {upload}. 다시 실행하면 상태 조회부터 이어갑니다.')
                time.sleep(2)
                result = self._upload_status(mock, opener, args, upload, progress)
            if result['status'] != 'COMPLETED':
                raise ApiError(f'은행 {bank} 검수 미완료: uploadId {upload}. 업로드 상태를 확인하세요.')
            # Do not retain signed URLs after completion. Recheck server state on replay.
            self.uploads[key] = {'target': {'uploadId': upload}, 'uploaded': True}
            return upload
        except ApiError:
            raise
        except Exception as error:
            raise upload_failure(error, bank, stage) from None


class Replay:
    """One in-flight operation per panel; pausing never cancels a running day."""
    def __init__(self, controls):
        self.controls = controls
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='aml-demo')
        self.lock = threading.RLock()
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
        with self.lock:
            if self.future is not None and not self.future.done():
                raise ValueError('현재 작업이 끝날 때까지 기다리세요.')
            self.pause.clear()
            days = sorted(set(days))
            self.report('시작', error=None, totalDays=len(days),
                        doneDays=sum(day in self.completed for day in days) if analyze else 0,
                        currentDay=None, fileDone=0, fileTotal=0,
                        bankId=None, uploadId=None, jobId=None)
            self.future = self.pool.submit(self._run, days, files, analyze, upload, interval)

    def _run(self, days, files, analyze, upload, interval):
        stage = '날짜 준비'
        day = None
        try:
            for day in days:
                if self.pause.is_set():
                    break
                if analyze and day in self.completed:
                    continue
                stage = '업무 시각 준비'
                self.report(f'{day}: {stage}', currentDay=day, bankId=None, uploadId=None, jobId=None)
                self.controls.prepare_day(day)
                stage = '전송 파일 목록 확인'
                file_done = sum((day, bank, str(file)) in self.sent for bank, file in files[day])
                self.report(f'{day}: 처리 시작', currentDay=day,
                            fileDone=file_done, fileTotal=len(files[day]) if upload else 0,
                            bankId=None, uploadId=None, jobId=None)
                if upload:
                    for bank, file in files[day]:
                        key = (day, bank, str(file))
                        if key in self.sent:
                            continue
                        self.report(f'{day} 은행 {bank}: 전송 준비', bankId=bank, uploadId=None)
                        stage = '은행 파일 전송·검수'
                        self.controls.upload(day, bank, file, self.report)
                        self.sent.add(key)
                        file_done += 1
                        self.report(f'{day} 은행 {bank}: 전송·검수 완료', fileDone=file_done)
                if analyze:
                    stage = '분석 시작 요청'
                    self.report(f'{day}: 분석 시작 요청')
                    if day not in self.jobs:
                        self.jobs[day] = self.controls.post('demo/analysis', {'businessDate': day})['jobId']
                    job = self.jobs[day]
                    self.report(f'{day}: 분석 대기', jobId=job, bankId=None, uploadId=None)
                    stage = '분석 결과 조회'
                    self.wait_job(job, day)
                    self.completed.add(day)
                with self.lock:
                    self.state['doneDays'] += 1
                    self.state['history'].append({'date': day, 'result': '분석 완료' if analyze else '전송·검수 완료'})
                if self.pause.wait(interval):
                    break
            self.report('일시정지' if self.pause.is_set() else '선택한 작업 완료')
        except Exception as error:
            # Never display signed URLs, raw HTTP responses or file contents.
            if isinstance(error, ApiError):
                message = str(error)
            else:
                # A fixed type label is diagnostic; exception text can contain credentials.
                kind = next((cls.__name__ for cls in (KeyError, TypeError, ValueError, OSError, RuntimeError)
                             if isinstance(error, cls)), '내부 오류')
                message = f'{day or "날짜 미확인"} · {stage} 실패 ({kind}). 패널 코드 버전과 API 응답 형식을 확인하세요.'
            self.report('중단', error=message)

    def wait_job(self, job, day):
        deadline = time.monotonic() + 3600
        failures = 0
        last_stage = '아직 확인하지 못함'
        while time.monotonic() < deadline:
            try:
                detail = self.controls.get(f'batch-jobs/{job}')
            except ApiError as error:
                if not error.retryable:
                    raise
                failures += 1
                delay = min(5 * 2 ** min(failures - 1, 3), 30)
                self.report(
                    f'{day}: 분석 상태 확인 대기 · 마지막 확인 {last_stage} · '
                    f'조회 재시도 {failures}회 · {delay}초 후 다시 확인 (서버 작업 취소 아님)',
                    jobId=job, bankId=None, uploadId=None)
                time.sleep(min(delay, max(0, deadline - time.monotonic())))
                continue
            failures = 0
            last_stage = f'{detail["status"]} / {detail.get("currentStage", "")}'
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

    def reset_demo(self, payload):
        with self.lock:
            if self.future is not None and not self.future.done():
                raise ApiError('현재 날짜 처리가 끝난 뒤 초기화하세요.')
            result = self.controls.post('demo/reset', payload)
            self.clear_after_reset(result['resetId'])
            return result

    def clear_after_reset(self, reset_id):
        with self.lock:
            if self.state.get('resetId') == reset_id:
                return
            if self.future is not None and not self.future.done():
                raise ApiError('재생 중 초기화 이력이 변경됐습니다. 현재 작업 종료 후 다시 조회하세요.')
            self.controls.uploads.clear()
            self.sent.clear()
            self.jobs.clear()
            self.completed.clear()
            self.state = {'message': 'DB 초기화 완료', 'history': [], 'error': None, 'resetId': reset_id}


def render_reset(replay):
    import streamlit as st
    from uuid import uuid4
    try:
        latest = replay.controls.get('demo/reset/latest')
    except ApiError as error:
        if error.status == 404:
            st.caption('초기화 기능은 해당 API가 포함된 백엔드 배포 후 사용할 수 있습니다.')
            return False
        raise
    if latest.get('resetId'):
        replay.clear_after_reset(latest['resetId'])
    pending = latest.get('status', 'NONE') in ('FILES_PENDING', 'FILES_FAILED')
    running = replay.future is not None and not replay.future.done()
    with st.expander('시연 데이터 초기화'):
        st.warning('거래·업로드·분석·Alert/Episode·조사 이력과 관련 S3 파일을 삭제합니다. PC의 CSV, 직원 계정, 은행 등록, 환율은 보존합니다.')
        if st.button('초기화 대상 확인', disabled=running or pending):
            st.session_state.reset_preview = replay.controls.get('demo/reset/preview')
            st.session_state.reset_request = str(uuid4())
        preview = st.session_state.get('reset_preview')
        if preview:
            counts = preview['counts']
            st.write({label: counts.get(table, 0) for label, table in (
                ('거래', 'ledger.transactions'), ('업로드', 'ingest.uploads'), ('분석 작업', 'analysis.jobs'),
                ('Alert', 'review.alerts'), ('Episode', 'review.episodes'), ('은행 보고', 'ingest.report_versions'))})
            confirmation = st.text_input('확인 문구: 시연 데이터 초기화', key='reset_confirmation')
            if st.button('DB 및 관련 파일 초기화', disabled=running or pending or confirmation != '시연 데이터 초기화'):
                result = replay.reset_demo({'requestId': st.session_state.reset_request,
                                            'snapshot': preview['snapshot'], 'confirmation': confirmation})
                st.session_state.cleanup_reset = result['resetId']
                st.session_state.pop('reset_preview', None)
                st.session_state.pop('reset_confirmation', None)
                st.rerun()

        @st.fragment(run_every='2s')
        def cleanup_progress():
            current = replay.controls.get('demo/reset/latest')
            status = current.get('status', 'NONE')
            if status == 'NONE':
                return
            if status == 'COMPLETED':
                st.success('DB 및 관련 파일 초기화 완료. 업무 시각을 먼저 설정한 뒤 전송하세요.')
                return
            total, remaining = current['totalTargets'], current['remainingTargets']
            st.progress((total - remaining) / total if total else 1.0,
                        text=f'DB 초기화 완료 · 파일 정리 대상 {total - remaining}/{total}개 완료')
            if status == 'FILES_FAILED':
                st.session_state.pop('cleanup_reset', None)
                st.error('DB 초기화 완료 / 파일 정리 실패. S3 삭제 권한·저장소 설정을 확인하고 파일 정리만 재시도하세요.')
            if st.button('파일 정리 계속/재시도'):
                st.session_state.cleanup_reset = current['resetId']
            if st.session_state.get('cleanup_reset') == current['resetId']:
                try:
                    result = replay.controls.post(f'demo/reset/{current["resetId"]}/cleanup')
                    if result['status'] in ('COMPLETED', 'FILES_FAILED'):
                        st.session_state.pop('cleanup_reset', None)
                        st.rerun()
                except ApiError as error:
                    st.session_state.pop('cleanup_reset', None)
                    st.error(str(error))
        cleanup_progress()
    return pending


def render():
    import os
    import streamlit as st
    st.set_page_config(page_title='AML 시연 조작패널', layout='wide')
    st.title('시연 조작패널')
    st.caption('예약 시각 대기만 생략합니다. 파일 검수와 실제 분석 완료를 기다린 뒤 다음 날짜로 진행합니다.')
    import operator_session
    runtime = operator_session.runtime
    if runtime is not None:
        base, root = runtime.base, runtime.root
        st.info(f'dev 연결: {base} · ADMIN 세션 자동 갱신')
        st.caption(f'은행 파일 폴더: {root}')
    else:
        base = st.text_input('로컬 백엔드', os.getenv('AML_DEMO_API_URL', 'http://127.0.0.1:8080'))
        root = st.text_input('날짜별 은행 파일 폴더', os.getenv('AML_DEMO_DATA_DIR', ''))
    try:
        if runtime is not None:
            replay = runtime.replay
        else:
            from api_client import login_panel
            authenticated = login_panel(base, 'control_client')
            if authenticated is None:
                return
            client, user = authenticated
            if user['role'] != 'ADMIN':
                st.error('조작패널은 관리자 계정으로 로그인하세요.')
                if st.button('로그아웃'):
                    client.logout()
                    st.session_state.pop('control_client', None)
                    st.rerun()
                return
            if 'replay' not in st.session_state:
                st.session_state.replay = Replay(Controls(base, client))
            replay = st.session_state.replay
            if replay.controls.base != base.rstrip('/'):
                st.info('진행 중 작업의 서버를 바꿀 수 없습니다. 새 패널 세션에서 접속하세요.')
                return
            if replay.future is None or replay.future.done():
                replay.controls.client = client
        files = catalog(root) if root else {}
        if not files:
            st.info('준비된 날짜별 은행 파일의 상위 폴더를 지정하세요.')
            return
        clock = replay.controls.get('demo/clock')
        st.metric('시연 업무 시각 (KST)', clock['businessAt'])
        reset_pending = render_reset(replay)
        with st.expander('시연 업무 시각 설정'):
            st.caption('선택 날짜 전송·자동 재생을 시작할 때 거래 기준일 다음 날 09:00 KST로 자동 설정합니다. 수동 설정이 더 미래이면 유지하며, 실제 통신 시각은 변경하지 않습니다.')
            current = datetime.fromisoformat(clock['businessAt'])
            picked = st.date_input('업무 날짜', current.date())
            picked_time = st.time_input('업무 시간', day_time(9))
            busy = reset_pending or (replay.future is not None and not replay.future.done())
            if st.button('시각 적용', disabled=busy):
                replay.controls.set_clock(datetime.combine(picked, picked_time, timezone(timedelta(hours=9))).isoformat())
                st.rerun()
            if st.button('다음 날로 이동', disabled=busy or not clock['configured']):
                replay.controls.set_clock((current + timedelta(days=1)).isoformat())
                st.rerun()
        days = st.multiselect('진행할 날짜 (날짜순)', list(files), default=[next(iter(files))])
        st.write({day: f'은행 파일 {len(files[day])}개' for day in sorted(days)})
        interval = st.number_input('날짜 사이 대기(초)', min_value=0, max_value=300, value=5)

        @st.fragment(run_every='1s')
        def actions():
            running = reset_pending or (replay.future is not None and not replay.future.done())
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
            if state.get('totalDays'):
                done, total = state['doneDays'], state['totalDays']
                st.progress(done / total, text=f'전체 날짜 진행률 · {done}/{total}일 완료')
                if state.get('currentDay'):
                    st.caption(f'현재 처리 날짜: {state["currentDay"]}')
                if state.get('fileTotal'):
                    st.progress(state['fileDone'] / state['fileTotal'],
                                text=f'현재 날짜 전송·검수 · {state["fileDone"]}/{state["fileTotal"]}개 파일 완료')
                st.caption('날짜 진행률은 분석 완료 기준입니다. 전송만 실행하면 검수 완료 기준입니다.')
            st.write(state['message'])
            st.write({key: state[key] for key in ('bankId', 'uploadId', 'jobId') if state.get(key) is not None})
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
