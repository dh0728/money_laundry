#!/usr/bin/env python3
"""생성기 검증용 스텁 수신기.

수신 관문(Spring Boot)이 아직 없는 동안 같은 계약으로 응답한다.
POST -> 202 Accepted + {"ingest_id": UUID}
"""

import argparse
import json
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# 전송돼서는 안 되는 정답 라벨. 들어오면 즉시 눈에 띄게 표시한다.
LABEL_KEYS = ("is_laundering", "Is Laundering", "isLaundering")


class Handler(BaseHTTPRequestHandler):
    # 기본값 HTTP/1.0은 응답마다 연결을 끊는다. 생성기의 keep-alive 재사용을
    # 실제로 시험하려면 1.1이어야 한다(Content-Length를 항상 보내므로 안전).
    protocol_version = "HTTP/1.1"

    count = 0
    leaks = 0
    quiet = False

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            return

        Handler.count += 1
        leaked = [k for k in LABEL_KEYS if k in payload]
        if leaked:
            Handler.leaks += 1

        if not Handler.quiet:
            # 10필드를 모두 찍는다. 계좌와 금액 모두 '보낸 쪽 -> 받은 쪽' 순서다.
            print("%6d  %s  %s  %s/%s -> %s/%s  %s %s -> %s %s  %s%s" % (
                Handler.count,
                payload.get("transaction_id"),
                payload.get("timestamp"),
                payload.get("from_bank"),
                payload.get("from_account"),
                payload.get("to_bank"),
                payload.get("to_account"),
                payload.get("amount_paid"),
                payload.get("payment_currency"),
                payload.get("amount_received"),
                payload.get("receiving_currency"),
                payload.get("payment_format"),
                "  [라벨 유출: %s]" % leaked if leaked else "",
            ), flush=True)
        elif Handler.count % 500 == 0:
            print("%d건 수신 (라벨 유출 %d)" % (Handler.count, Handler.leaks), flush=True)

        body = json.dumps({"ingest_id": str(uuid.uuid4())}).encode("utf-8")
        self.send_response(202)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # 기본 액세스 로그 억제


class Server(ThreadingHTTPServer):
    # 기본값(1)이면 Windows에서 이미 점유된 포트에도 조용히 겹쳐 바인딩되고,
    # 두 서버가 트래픽을 나눠 갖게 된다. 겹치면 즉시 실패하도록 끈다.
    allow_reuse_address = False


def main():
    ap = argparse.ArgumentParser(description="생성기 검증용 스텁 수신기")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--quiet", action="store_true", help="건별 출력 없이 500건마다 집계만")
    args = ap.parse_args()

    Handler.quiet = args.quiet
    try:
        server = Server(("127.0.0.1", args.port), Handler)
    except OSError as exc:
        print("포트 %d를 열 수 없습니다: %s" % (args.port, exc))
        print("이미 다른 스텁이 떠 있는지 확인하세요 (netstat -ano | findstr :%d)" % args.port)
        raise SystemExit(1)
    print("스텁 수신기 대기 중: http://127.0.0.1:%d/api/transactions" % args.port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        print("\n총 %d건 수신 / 라벨 유출 %d건" % (Handler.count, Handler.leaks), flush=True)


if __name__ == "__main__":
    main()
