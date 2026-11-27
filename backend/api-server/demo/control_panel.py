"""Local operator controls. Sends each date's ledger file and runs the real analysis API."""
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time as day_time, timedelta, timezone
from pathlib import Path

import httpx

import ledger_upload
from api_client import ApiClient, ApiError
from ledger_upload import TRANSIENT, UploadHttpError

STAGE_NAMES = {
    'WAIT_INGEST': '원장 적재 대기', 'FREEZE_INPUT': '분석 입력 고정',
    'FEATURES': '모델 입력 준비', 'INFERENCE': '모델 추론', 'SCORES': '점수 저장',
    'ALERTS': 'Alert 구성', 'COMPLETE': 'Alert 공개',
}
MODEL_NAMES = {'BINARY': '이진', 'TYPE': '유형'}
# Reset preview and reset use planner row estimates, so they no longer scale with the data. Exact
# counts took 92 s on dev (16 days, 2026-11-28). dev nginx cuts a request at 60 s and answers 504.
RESET_TIMEOUT = 60
REMOTE_NAMES = {
    'ACCEPTED': '접수됨', 'QUEUED': '차례 대기', 'RUNNING': '계산 중', 'RETRY_WAIT': '서버 재시도 대기',
    'COMPLETED': '계산 완료', 'FAILED': '서버 실패', 'STOPPED': '중단됨', 'RECOVERY_REQUIRED': '서버 복구 필요',
}


def describe(detail):
    """One status line for an analysis job; waiting on the inference server is not a retry."""
    status, stage = detail.get('status'), detail.get('currentStage')
    failures = detail.get('consecutiveFailures') or 0
    if status in ('QUEUED', 'RUNNING', 'RETRY_WAIT') and failures:
        state = f'실패 후 재시도 대기 · 연속 실패 {failures}회'
    elif status in ('QUEUED', 'RUNNING', 'RETRY_WAIT') and stage == 'INFERENCE' and detail.get('models'):
        models = ', '.join(
            f'{MODEL_NAMES.get(m.get("modelKind"), m.get("modelKind"))} '
            f'{"결과 확인 완료" if m.get("status") == "SUCCEEDED" else REMOTE_NAMES.get(m.get("remoteStatus"), "전송 중")}'
            for m in detail['models'])
        state = f'추론 결과 대기 ({models})'
    else:
        state = {'QUEUED': '대기열', 'RUNNING': '실행 중', 'RETRY_WAIT': '다음 단계 대기',
                 'COMPLETED': '완료', 'FAILED': '실패'}.get(status, status)
    return f'{STAGE_NAMES.get(stage, stage or "")} · {state} ({status} / {stage or ""})'


def catalog(root):
    """Date folders, each with exactly one ledger_<date>.csv."""
    root = Path(root).expanduser().resolve(strict=True)
    result = {}
    for folder in sorted(root.iterdir()):
        if not folder.is_dir():
            continue
        try:
            day = date.fromisoformat(folder.name).isoformat()
        except ValueError:
            continue
        files = sorted(folder.glob('*.csv'))
        if not files:
            continue
        if len(files) != 1 or files[0].name != f'ledger_{day}.csv' or not files[0].resolve().is_relative_to(root):
            raise ValueError(f'{day} 폴더에는 ledger_{day}.csv 파일 하나만 두세요.')
        result[day] = files[0]
    if not result:
        raise ValueError('YYYY-MM-DD 폴더와 ledger_날짜.csv 파일이 필요합니다.')
    return result


MESSAGES = {
    'DATE_ALREADY_LOADED': '이 거래 기준일의 원장은 이미 적재되었습니다.',
    'DUPLICATE_FILE': '이미 처리한 동일 파일입니다. 기존 업로드 상태를 확인하세요.',
    'UPLOAD_IN_PROGRESS': '동일 파일의 업로드가 이미 진행 중입니다. 기존 업로드 상태를 확인하세요.',
    'UPLOAD_URL_EXPIRED': '업로드 URL이 만료됐습니다.',
    'UPLOAD_MISMATCH': 'S3 객체가 없거나 파일 크기·체크섬이 일치하지 않습니다.',
    'UPLOAD_SUPERSEDED': '새 업로드가 발급됐습니다. 최신 업로드 번호를 확인하세요.',
    'FILE_TOO_LARGE': '서버가 허용한 파일 크기를 초과했습니다.',
    'VALIDATION_FAILED': '업로드 요청의 파일명·기준일·체크섬 등 입력을 확인하세요.',
}


def upload_failure(error, day, stage):
    """Map known errors without disclosing response bodies, signed URLs or tokens."""
    prefix = f'{day} 원장 파일 · {stage} 실패: '
    if isinstance(error, UploadHttpError):
        if error.code in MESSAGES:
            return ApiError(prefix + f'HTTP {error.status} · {error.code} — {MESSAGES[error.code]}', error.status)
        if 300 <= error.status < 400:
            message = '다른 페이지로 이동하는 응답입니다. Cloudflare 접근 정책과 API 주소를 확인하세요.'
        elif stage == 'S3 전송' and error.status == 403:
            message = 'S3가 업로드를 거절했습니다. 서명 URL 만료·서명 헤더·저장소 권한을 확인하세요.'
        elif error.status in (401, 403):
            message = '접근이 거절됐습니다. 관리자 로그인 세션과 Cloudflare 서비스 토큰 정책을 확인하세요.'
        else:
            message = '서버가 요청을 거절했습니다. 해당 단계의 서버 상태를 확인하세요.'
        return ApiError(prefix + f'HTTP {error.status} — {message}', error.status)
    if isinstance(error, (TimeoutError, httpx.TransportError)):
        message = '연결·응답 확인에 실패했습니다. 처리 여부를 확인하기 전 재전송을 반복하지 마세요.'
    elif isinstance(error, OSError) and stage == '파일 확인':
        message = '로컬 파일을 읽을 수 없습니다. 파일 존재 여부와 읽기 권한을 확인하세요.'
    elif isinstance(error, (ValueError, KeyError, TypeError)):
        message = ('CSV가 비어 있거나 파일을 확인할 수 없습니다.' if stage == '파일 확인'
                   else '서버 응답이 예상한 업로드 계약과 다릅니다. API 응답 형식을 확인하세요.')
    else:
        message = '처리 중 내부 오류가 발생했습니다. 실패 단계와 날짜를 전달하세요.'
    return ApiError(prefix + message)


def load_estimate(size):
    """Rough rows and load-time range for a ledger file; the server reports no row progress.

    HI-Medium daily files average about 204 bytes per row. Local loads after the 2026-11-25 tuning
    took 455-582 s per million rows, so the range is an estimate, not a measurement on dev.
    """
    rows = size / 204
    return int(rows), (rows / 1e6 * 450, rows / 1e6 * 600)


NO_BACKFILL = '백필 없음'
BACKFILL_DEFAULT_DAYS = 7


def short_day(day):
    return f'{int(day[5:7])}/{int(day[8:10])}'


def split_days(days, last_backfill):
    """Days up to last_backfill are backfilled, the rest analysed; NO_BACKFILL analyses them all."""
    if last_backfill in (None, NO_BACKFILL):
        return [], list(days)
    return [day for day in days if day <= last_backfill], [day for day in days if day > last_backfill]


def span_text(days):
    if not days:
        return '없음'
    return f'{short_day(days[0])}~{short_day(days[-1])} ({len(days)}일)' if len(days) > 1 else f'{short_day(days[0])} (1일)'


def run_label(backfill_days, analysis_days):
    if backfill_days and analysis_days:
        return f'▶ 전송 → 백필 {len(backfill_days)}일 → 분석 {len(analysis_days)}일 자동 재생'
    if backfill_days:
        return f'▶ 전송 → 백필 {len(backfill_days)}일'
    return f'▶ 전송 → 분석 {len(analysis_days)}일 자동 재생'


def timeline_html(backfill_days, analysis_days, done):
    """One chip per day: blue = backfill, orange = analysis, ✓ = finished in this panel."""
    from html import escape

    def chip(day, background, color):
        mark = ' ✓' if day in done else ''
        return (f'<span style="display:inline-block;margin:2px;padding:3px 9px;border-radius:999px;'
                f'background:{background};color:{color};font-size:0.85rem;white-space:nowrap">'
                f'{escape(short_day(day))}{mark}</span>')
    chips = [chip(day, 'rgba(59,130,246,0.16)', '#3b82f6') for day in backfill_days]
    chips += [chip(day, 'rgba(234,88,12,0.16)', '#ea580c') for day in analysis_days]
    return '<div style="line-height:2">' + ''.join(chips) + '</div>'


def load_progress(state, now):
    """Progress bars for the S3 transfer (measured) and the server load (elapsed against an estimate)."""
    bars = []
    total = state.get('transferTotal')
    if total:
        sent = state.get('transferSent') or 0
        bars.append((min(sent / total, 1.0),
                     f'S3 전송 · {sent / 2**20:,.0f} / {total / 2**20:,.0f} MB ({sent / total:.0%})'))
    started = state.get('loadStarted')
    if started:
        elapsed = max(0.0, now - started)
        low, high = state.get('loadLow') or 0, state.get('loadHigh') or 0
        status = {'RECEIVED': '적재 대기', 'RUNNING': '적재 중'}.get(state.get('loadStatus'), state.get('loadStatus') or '확인 중')
        checked = state.get('loadCheckedAt')
        seen = f' · 서버 확인 {max(0, now - checked):.0f}초 전' if checked else ''
        over = ' · 예상보다 오래 걸리는 중' if high and elapsed > high else ''
        # Capped below 100%: the bar is elapsed time against an estimate, not a server row count.
        bars.append((min(elapsed / high, 0.99) if high else 0.0,
                     f'서버 {status} · 경과 {elapsed / 60:.0f}분 · 예상 {low / 60:.0f}~{high / 60:.0f}분 '
                     f'(약 {state.get("loadRows", 0):,}건 추정){seen}{over}'))
    return bars


class Controls:
    # A whole day's ledger is loaded in one worker run; the largest day took minutes, not seconds.
    LOAD_WAIT_SECONDS = 3 * 3600

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

    def get(self, path, **options):
        return self.client.get(path, **options)

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

    def post(self, path, payload=None, **options):
        return self.client.post(path, payload, **options)

    def _issue_upload(self, day, file, size, checksum, progress):
        for attempt in range(6):
            try:
                return ledger_upload.request_upload(self.client, day, file, size, checksum,
                                                    cf_headers=self.cf_headers)
            except UploadHttpError as error:
                if error.status == 409 and error.code in ('DUPLICATE_FILE', 'UPLOAD_IN_PROGRESS'):
                    if error.upload_id is None or error.upload_id <= 0:
                        raise ApiError('기존 업로드 번호를 확인할 수 없습니다. 서버의 업로드 복구 API 배포 여부를 확인하세요.', 409) from None
                    return {'uploadId': error.upload_id, 'existing': True}
                if error.status not in TRANSIENT or attempt == 5:
                    raise
            except (httpx.TransportError, TimeoutError):
                if attempt == 5:
                    raise
            delay = min(5 * 2 ** attempt, 30)
            progress(f'업로드 접수 확인 재시도 {attempt + 1}회 · {delay}초 후')
            time.sleep(delay)

    def _upload_status(self, upload, progress):
        for attempt in range(6):
            try:
                return ledger_upload.request_status(self.client, upload, cf_headers=self.cf_headers)
            except (UploadHttpError, httpx.TransportError, TimeoutError) as error:
                transient = not isinstance(error, UploadHttpError) or error.status in TRANSIENT
                if not transient or attempt == 5:
                    raise
                delay = min(5 * 2 ** attempt, 30)
                progress(f'적재 결과 조회 재시도 {attempt + 1}회 · {delay}초 후', uploadId=upload)
                time.sleep(delay)

    def upload(self, day, file, report):
        stage = '파일 확인'
        def progress(value, **values):
            nonlocal stage
            stage = value
            report(f'{day} 원장 파일: {stage}', **values)
        try:
            progress(stage, uploadId=None)
            size, checksum = ledger_upload.inspect_file(file)
            key = (day, file.name, size, checksum)
            pending = self.uploads.get(key)
            if pending is None:
                progress('업로드 URL 발급')
                target = self._issue_upload(day, file, size, checksum, progress)
                pending = {'target': target, 'uploaded': False}
                self.uploads[key] = pending
                if target.get('existing'):
                    progress('기존 업로드 상태 확인', uploadId=target['uploadId'])
                    result = self._upload_status(target['uploadId'], progress)
                else:
                    result = {'status': 'URL_ISSUED'}
            else:
                progress('기존 업로드 상태 확인', uploadId=pending['target']['uploadId'])
                result = self._upload_status(pending['target']['uploadId'], progress)
            target = pending['target']
            upload = target['uploadId']
            if target.get('existing') and (result.get('businessDate') != day or result.get('sizeBytes') != size):
                raise ApiError(f'{day} 기존 파일의 기준일·크기가 다릅니다. uploadId {upload}. 자동으로 건너뛰지 않습니다.')
            if result['status'] == 'URL_ISSUED':
                if target.get('existing'):
                    # The existing object may already be stored; completion verifies its hash and size.
                    # Forget URL-only lookup so a later retry can obtain a new URL after expiry.
                    self.uploads.pop(key, None)
                if not pending['uploaded'] and not target.get('existing'):
                    progress('S3 전송', uploadId=upload, transferSent=0, transferTotal=size)
                    ledger_upload.upload_file(
                        file, target, size,
                        on_progress=lambda sent, total: report(f'{day} 원장 파일: S3 전송',
                                                               transferSent=sent, transferTotal=total))
                    pending['uploaded'] = True
                progress('업로드 완료 통지', uploadId=upload)
                try:
                    result = ledger_upload.request_status(self.client, upload, complete=True,
                                                          cf_headers=self.cf_headers)
                except (UploadHttpError, httpx.TransportError, TimeoutError) as error:
                    if isinstance(error, UploadHttpError) and error.status not in TRANSIENT:
                        raise
                    # Reconcile a lost POST response by GET; never blindly repeat upload.
                    result = self._upload_status(upload, progress)
            rows, (low, high) = load_estimate(size)
            progress('원장 적재 결과 조회', uploadId=upload, transferTotal=None, loadStarted=time.time(),
                     loadRows=rows, loadLow=low, loadHigh=high, loadStatus=result['status'],
                     loadCheckedAt=time.time())
            deadline = time.monotonic() + self.LOAD_WAIT_SECONDS
            while result['status'] in ('RECEIVED', 'RUNNING'):
                if time.monotonic() >= deadline:
                    raise ApiError(f'{day} 원장 적재 관찰 시간 초과: uploadId {upload}. 다시 실행하면 상태 조회부터 이어갑니다.')
                time.sleep(2)
                result = self._upload_status(upload, progress)
                report(f'{day} 원장 파일: 원장 적재 결과 조회', loadStatus=result['status'],
                       loadCheckedAt=time.time())
            report(f'{day} 원장 파일: 원장 적재 결과 조회', loadStarted=None)
            if result['status'] != 'COMPLETED':
                errors = result.get('errors') or []
                reason = errors[0].get('reason') if errors and isinstance(errors[0], dict) else None
                detail = f' (첫 오류: {reason})' if isinstance(reason, str) and reason.isupper() else ''
                raise ApiError(f'{day} 원장 적재 미완료: uploadId {upload} · {result["status"]}{detail}. 업로드 상태를 확인하세요.')
            # Do not retain signed URLs after completion. Recheck server state on replay.
            self.uploads[key] = {'target': {'uploadId': upload}, 'uploaded': True}
            return upload
        except ApiError:
            raise
        except Exception as error:
            raise upload_failure(error, day, stage) from None


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

    def start(self, days, files, *, analyze=True, upload=True, interval=0, backfill=False, backfill_until=None):
        """backfill=True backfills every day; backfill_until backfills the days up to it, then analyses."""
        with self.lock:
            if self.future is not None and not self.future.done():
                raise ValueError('현재 작업이 끝날 때까지 기다리세요.')
            if backfill_until is not None and not analyze:
                raise ValueError('백필 후 분석은 분석을 포함한 재생에서만 씁니다.')
            self.pause.clear()
            days = sorted(set(days))
            self.report('시작', error=None, totalDays=len(days),
                        doneDays=sum(day in self.completed for day in days) if analyze else 0,
                        currentDay=None, fileDone=0, fileTotal=0,
                        uploadId=None, jobId=None)
            if backfill_until is not None:
                backfill = frozenset(day for day in days if day <= backfill_until)
            self.future = self.pool.submit(self._run, days, files, analyze, upload, interval, backfill)

    def _run(self, days, files, analyze, upload, interval, backfill=False):
        # backfill is True (every day) or the set of days to backfill before the analysed ones.
        backfilled = (lambda day: True) if backfill is True else (lambda day: bool(backfill) and day in backfill)
        stage = '날짜 준비'
        day = None
        try:
            for day in days:
                if self.pause.is_set():
                    break
                if analyze and day in self.completed:
                    continue
                stage = '업무 시각 준비'
                self.report(f'{day}: {stage}', currentDay=day, uploadId=None, jobId=None)
                self.controls.prepare_day(day)
                stage = '전송 파일 확인'
                key = (day, str(files[day]))
                self.report(f'{day}: 처리 시작', currentDay=day,
                            fileDone=int(key in self.sent), fileTotal=1 if upload else 0,
                            uploadId=None, jobId=None, transferTotal=None, loadStarted=None)
                if upload and key not in self.sent:
                    self.report(f'{day} 원장 파일: 전송 준비', uploadId=None)
                    stage = '원장 파일 전송·적재'
                    self.controls.upload(day, files[day], self.report)
                    self.sent.add(key)
                    self.report(f'{day} 원장 파일: 전송·적재 완료', fileDone=1)
                if analyze:
                    stage = '분석 시작 요청'
                    self.report(f'{day}: 분석 시작 요청')
                    if day not in self.jobs:
                        # A backfill day is frozen as history only: no scores, no Alerts.
                        payload = {'businessDate': day, 'backfill': True} if backfilled(day) else {'businessDate': day}
                        self.jobs[day] = self.controls.post('demo/analysis', payload)['jobId']
                    job = self.jobs[day]
                    self.report(f'{day}: 분석 대기', jobId=job, uploadId=None)
                    stage = '분석 결과 조회'
                    self.wait_job(job, day)
                    self.completed.add(day)
                with self.lock:
                    self.state['doneDays'] += 1
                    result = ('백필 완료' if backfilled(day) else '분석 완료') if analyze else '전송·적재 완료'
                    self.state['history'].append({'date': day, 'result': result})
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
            self.report('중단', error=message, transferTotal=None, loadStarted=None)

    def wait_job(self, job, day):
        deadline = time.monotonic() + 6 * 3600
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
                    jobId=job, uploadId=None)
                time.sleep(min(delay, max(0, deadline - time.monotonic())))
                continue
            failures = 0
            last_stage = describe(detail)
            self.report(f'{day}: {last_stage}', jobId=job)
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
            result = self.controls.post('demo/reset', payload, timeout=RESET_TIMEOUT)
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
        st.warning('거래·업로드·분석·Alert/Episode·조사 이력과 관련 S3 파일을 삭제합니다. PC의 CSV, 직원 계정, 환율은 보존합니다.')
        if st.button('초기화 대상 확인', disabled=running or pending):
            st.session_state.reset_preview = replay.controls.get('demo/reset/preview', timeout=RESET_TIMEOUT)
            st.session_state.reset_request = str(uuid4())
        preview = st.session_state.get('reset_preview')
        if preview:
            counts = preview['counts']
            st.caption('건수는 DB 통계의 추정값입니다.')
            st.write({f'{label} (약)': counts.get(table, 0) for label, table in (
                ('거래', 'ledger.transactions'), ('업로드', 'ingest.uploads'), ('분석 작업', 'analysis.jobs'),
                ('Alert', 'review.alerts'), ('Episode', 'review.episodes'))})
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
    st.caption('예약 시각 대기만 생략합니다. 원장 적재와 실제 분석 완료를 기다린 뒤 다음 날짜로 진행합니다.')
    import operator_session
    runtime = operator_session.runtime
    if runtime is not None:
        base, root = runtime.base, runtime.root
        st.info(f'dev 연결: {base} · ADMIN 세션 자동 갱신')
        st.caption(f'원장 파일 폴더: {root}')
    else:
        base = st.text_input('로컬 백엔드', os.getenv('AML_DEMO_API_URL', 'http://127.0.0.1:8080'))
        root = st.text_input('날짜별 원장 파일 폴더', os.getenv('AML_DEMO_DATA_DIR', ''))
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
            st.info('날짜별 원장 파일(YYYY-MM-DD/ledger_날짜.csv)의 상위 폴더를 지정하세요.')
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
        all_days = list(files)
        st.subheader('진행할 날짜')
        if len(all_days) > 1:
            start, end = st.select_slider('진행 기간 (양끝을 끌어 범위 지정)', options=all_days,
                                          value=(all_days[0], all_days[-1]), format_func=short_day)
        else:
            start = end = all_days[0]
        days = [day for day in all_days if start <= day <= end]
        default = days[BACKFILL_DEFAULT_DAYS - 1] if len(days) > BACKFILL_DEFAULT_DAYS else NO_BACKFILL
        # The key follows the range, so a stale boundary outside a new range never sticks.
        last_backfill = st.select_slider(
            '백필 / 분석 경계 (이 날짜까지 백필, 다음 날부터 분석)', options=[NO_BACKFILL, *days], value=default,
            format_func=lambda day: day if day == NO_BACKFILL else short_day(day), key=f'split:{start}:{end}',
            help='백필은 점수·Alert 없이 거래를 이력으로만 쌓습니다. 분석을 한 번이라도 한 뒤에는 서버가 백필을 거절합니다.')
        backfill_days, analysis_days = split_days(days, last_backfill)
        st.markdown(timeline_html(backfill_days, analysis_days, replay.completed), unsafe_allow_html=True)
        # Markdown reads a pair of "~" as strikethrough, so the ranges escape it.
        st.caption(f'백필 {span_text(backfill_days)} → 분석 {span_text(analysis_days)} · ✓ 이 패널에서 끝낸 날짜'
                   .replace('~', '\\~'))
        interval = st.number_input('날짜 사이 대기(초)', min_value=0, max_value=300, value=5)

        @st.fragment(run_every='1s')
        def actions():
            running = reset_pending or (replay.future is not None and not replay.future.done())
            if st.button(run_label(backfill_days, analysis_days), type='primary', disabled=running or not days,
                         use_container_width=True):
                replay.start(days, files, interval=interval,
                             backfill_until=backfill_days[-1] if backfill_days else None)
                st.rerun()
            with st.expander('하루만 따로 실행 (진행 기간을 하루로 좁힌 뒤)'):
                cols = st.columns(2)
                if cols[0].button('선택 날짜 전송만', disabled=running or len(days) != 1):
                    replay.start(days, files, analyze=False)
                    st.rerun()
                if cols[1].button('선택 날짜 분석만', disabled=running or len(days) != 1):
                    replay.start(days, files, upload=False, backfill=bool(backfill_days))
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
                                text=f'현재 날짜 원장 전송·적재 · {state["fileDone"]}/{state["fileTotal"]}개 파일 완료')
                for value, text in load_progress(state, time.time()):
                    st.progress(value, text=text)
                st.caption('날짜 진행률은 분석 완료 기준입니다. 전송만 실행하면 적재 완료 기준입니다.')
            st.write(state['message'])
            st.write({key: state[key] for key in ('uploadId', 'jobId') if state.get(key) is not None})
            if state['error']:
                st.error(state['error'])
            if state['history']:
                st.dataframe(state['history'], hide_index=True)
        actions()

        # Outside the 1-second fragment: a refresh must not drop the typed ID or the result.
        with st.form('resume_failed_job'):
            job = st.number_input('재개할 실패 작업 ID', min_value=1, step=1, value=None,
                                  placeholder='작업 ID 입력')
            if st.form_submit_button('실패 작업 재개'):
                if job is None:
                    st.session_state.resume_result = ('error', '재개할 작업 ID를 입력하세요.')
                elif reset_pending:
                    st.session_state.resume_result = ('error', '초기화 정리가 끝난 뒤 재개하세요.')
                else:
                    try:
                        replay.controls.post(f'batch-jobs/{int(job)}/resume')
                        st.session_state.resume_result = (
                            'success', f'작업 {int(job)} 재개 요청을 접수했습니다. 패널에서 진행을 보려면 같은 날짜로 '
                            '자동 재생을 다시 누르세요(이미 받은 작업을 이어서 봅니다).')
                    except ApiError as error:
                        st.session_state.resume_result = ('error', f'작업 {int(job)} 재개 실패: {error}')
        if 'resume_result' in st.session_state:
            kind, text = st.session_state.resume_result
            (st.success if kind == 'success' else st.error)(text)
    except (OSError, ValueError, ApiError) as error:
        st.error(str(error))


if __name__ == '__main__':
    render()
