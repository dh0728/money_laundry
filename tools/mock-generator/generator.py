#!/usr/bin/env python3
"""IBM AML 거래 CSV를 은행 API처럼 재생하는 목업 거래 생성기.

수신 관문(POST /api/transactions)에 거래를 1건씩 전송한다. 백엔드 입장에서
이 생성기와 실제 은행 API는 구분되지 않는다 — 나중에 원천만 바뀐다.

원본 CSV는 읽기 전용('rb')으로만 열며 중간 파일을 만들지 않는다.
"""

import argparse
import csv
import http.client
import json
import os
import sys
import time
from datetime import datetime, timedelta
from urllib.parse import urlparse

TS_FMT = "%Y/%m/%d %H:%M"

# 원본 CSV의 열 순서. 헤더에 'Account'가 두 번 나오므로 이름이 아닌 위치로 읽는다.
FIELDS = [
    "timestamp",
    "from_bank",
    "from_account",
    "to_bank",
    "to_account",
    "amount_received",
    "receiving_currency",
    "amount_paid",
    "payment_currency",
    "payment_format",
]
# 11번째 열 'Is Laundering'은 정답 라벨이라 읽지도 보내지도 않는다.

_ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
DEFAULT_CSV = os.path.join(_ROOT, "data", "HI-Small_Trans.csv")


def build_index(path, date):
    """대상 거래의 (정렬키, 원본행번호, 바이트오프셋)을 시각순으로 정렬해 반환한다.

    원본은 시각순이 아니다(인접 행 역전율 약 48%). 발생 순서대로 보내려면
    전체를 훑어 정렬해야 하므로 시작할 때 한 번 인덱스를 만든다.
    """
    want = None if date == "all" else date.encode()
    index = []
    offset = 0
    with open(path, "rb") as f:
        for row_no, raw in enumerate(f):
            start = offset
            offset += len(raw)
            if row_no == 0:  # 헤더
                continue
            if want is not None and raw[:10] != want:
                continue
            ts = raw[:16].decode("ascii")
            key = (
                (((int(ts[0:4]) - 2000) * 12 + int(ts[5:7])) * 31 + int(ts[8:10])) * 1440
                + int(ts[11:13]) * 60
                + int(ts[14:16])
            )
            index.append((key, row_no, start))
    index.sort()
    return index


def read_row(f, offset):
    """오프셋 위치의 한 행을 읽어 열 목록으로 돌려준다."""
    f.seek(offset)
    line = f.readline().decode("utf-8").rstrip("\r\n")
    return next(csv.reader([line]))


def build_payload(cols, row_no, prefix, sent_dt):
    """전송할 JSON을 만든다. 값은 원문 문자열 그대로 둔다.

    은행 코드에 선행 0이 있어(010, 03208) 숫자로 바꾸면 값이 깨지고,
    금액도 원문을 보존해야 수신 관문의 payload_hash가 안정적이다.
    """
    payload = {"transaction_id": "%s-%09d" % (prefix, row_no)}
    payload.update(zip(FIELDS, cols[:10]))
    payload["timestamp"] = sent_dt.strftime(TS_FMT)  # 현재 시각축으로 시프트
    return payload


class Sender:
    """keep-alive 연결 하나를 재사용해 거래를 1건씩 POST한다."""

    def __init__(self, url, timeout):
        u = urlparse(url)
        self.https = u.scheme == "https"
        self.host = u.hostname
        self.port = u.port
        self.path = u.path or "/"
        self.timeout = timeout
        self.conn = None

    def _conn(self):
        if self.conn is None:
            cls = http.client.HTTPSConnection if self.https else http.client.HTTPConnection
            self.conn = cls(self.host, self.port, timeout=self.timeout)
        return self.conn

    def reset(self):
        if self.conn is not None:
            try:
                self.conn.close()
            except OSError:
                pass
            self.conn = None

    def post(self, payload):
        body = json.dumps(payload).encode("utf-8")
        conn = self._conn()
        conn.request("POST", self.path, body, {"Content-Type": "application/json"})
        resp = conn.getresponse()
        resp.read()
        return resp.status

    def send(self, payload, tries=3):
        """(status, error)를 돌려준다. 4xx는 재시도하지 않는다 — 재전송해도 같은 결과다."""
        delay = 0.5
        for attempt in range(tries):
            try:
                status = self.post(payload)
            except Exception as exc:  # 연결 끊김·타임아웃
                self.reset()
                if attempt == tries - 1:
                    return None, str(exc)
                time.sleep(delay)
                delay *= 2
                continue
            if status < 500:
                return status, None
            if attempt == tries - 1:
                return status, None
            time.sleep(delay)
            delay *= 2
        return None, "unreachable"


def parse_epoch(value):
    if value == "now":
        return datetime.now().replace(second=0, microsecond=0)
    return datetime.strptime(value, "%Y-%m-%dT%H:%M")


def main():
    ap = argparse.ArgumentParser(description="IBM AML 거래 CSV를 은행 API처럼 재생한다.")
    ap.add_argument("--csv", default=DEFAULT_CSV, help="원본 거래 CSV (읽기 전용)")
    ap.add_argument("--url", default="http://127.0.0.1:8080/api/transactions", help="수신 관문 URL")
    ap.add_argument("--date", default="2022/09/01", help="재생할 날짜(YYYY/MM/DD) 또는 all")
    ap.add_argument("--speed", type=float, default=60.0, help="시간 배속 (1=실시간)")
    ap.add_argument("--max-rate", type=float, default=200.0, help="초당 전송 상한")
    ap.add_argument("--limit", type=int, default=0, help="최대 전송 건수 (0=제한 없음)")
    ap.add_argument("--epoch", default="now", help="재생 시작 시각 YYYY-MM-DDTHH:MM 또는 now")
    ap.add_argument("--timeout", type=float, default=10.0, help="HTTP 타임아웃(초)")
    ap.add_argument("--dry-run", action="store_true", help="전송하지 않고 페이로드만 출력 (대기 없음)")
    args = ap.parse_args()

    epoch = parse_epoch(args.epoch)
    prefix = os.path.basename(args.csv).split("_")[0]

    t0 = time.monotonic()
    index = build_index(args.csv, args.date)
    scan_sec = time.monotonic() - t0
    if not index:
        print("대상 거래가 없습니다: --date %s" % args.date, file=sys.stderr)
        return 1
    if args.limit:
        index = index[: args.limit]
    print("인덱스 %s건 / 스캔·정렬 %.1fs / epoch %s" % (
        format(len(index), ","), scan_sec, epoch.strftime("%Y-%m-%d %H:%M")), file=sys.stderr)

    sender = None if args.dry_run else Sender(args.url, args.timeout)
    ok = rejected = failed = 0
    max_lag = 0.0
    next_allowed = 0.0

    with open(args.csv, "rb") as f:
        base = datetime.strptime(read_row(f, index[0][2])[0], TS_FMT)
        start = time.monotonic()
        for _, row_no, offset in index:
            cols = read_row(f, offset)
            elapsed = (datetime.strptime(cols[0], TS_FMT) - base).total_seconds() / args.speed
            sent_dt = epoch + timedelta(seconds=elapsed)
            payload = build_payload(cols, row_no, prefix, sent_dt)

            if args.dry_run:
                print(json.dumps(payload, ensure_ascii=False))
                ok += 1
                continue

            now = time.monotonic() - start
            due = max(elapsed, next_allowed)
            if due > now:
                time.sleep(due - now)
                now = due
            next_allowed = now + 1.0 / args.max_rate
            lag = now - elapsed
            if lag > max_lag:
                max_lag = lag

            status, error = sender.send(payload)
            if error is not None or status is None:
                failed += 1
            elif status < 400:
                ok += 1
            elif status < 500:
                rejected += 1
            else:
                failed += 1

    if sender is not None:
        sender.reset()

    took = time.monotonic() - start
    print("", file=sys.stderr)
    if args.dry_run:
        print("dry-run 출력 %s건 (전송하지 않음) / 소요 %.1fs" % (format(ok, ","), took), file=sys.stderr)
        return 0

    total = ok + rejected + failed
    print("전송 시도 %s건 / 소요 %.1fs / 실효 %.1f건/초" % (
        format(total, ","), took, total / took if took else 0), file=sys.stderr)
    print("  202 성공 %s / 4xx 거절 %s / 실패 %s" % (
        format(ok, ","), format(rejected, ","), format(failed, ",")), file=sys.stderr)
    print("  최대 지연 %.1fs (상한 %.0f건/초에 걸린 누적)" % (max_lag, args.max_rate), file=sys.stderr)
    print("  재현하려면: --epoch %s" % epoch.strftime("%Y-%m-%dT%H:%M"), file=sys.stderr)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
