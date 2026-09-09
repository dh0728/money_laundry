"""은행의 하루치 CSV를 Presigned URL로 S3에 전송한다."""

import argparse
import base64
from datetime import date, datetime
import hashlib
from http.client import HTTPException
import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        # 잘못 입력한 인자에 API 키나 서명 URL이 있어도 노출하지 않는다.
        self.print_usage(sys.stderr)
        self.exit(2, "입력 오류: 필수 옵션과 형식을 --help에서 확인하세요.\n")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def parse_args(argv=None):
    parser = SafeArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--api-url", required=True, help="API 서버 주소")
    parser.add_argument("--file", type=Path, required=True, help="하루치 거래 CSV")
    parser.add_argument("--business-date", required=True, help="거래 기준일 YYYY-MM-DD")
    args = parser.parse_args(argv)
    try:
        if date.fromisoformat(args.business_date).isoformat() != args.business_date:
            raise ValueError()
        address = urlsplit(args.api_url)
        if (address.scheme not in ("http", "https") or not address.hostname
                or address.username or address.password or address.query or address.fragment):
            raise ValueError()
        address.port
    except ValueError:
        parser.error("invalid input")
    args.api_key = os.environ.get("BANK_API_KEY", "")
    if not args.api_key.strip() or "\r" in args.api_key or "\n" in args.api_key:
        parser.exit(2, "입력 오류: BANK_API_KEY 환경변수가 필요합니다.\n")
    return args


def inspect_file(source):
    with source.open("rb") as stream:
        size = os.fstat(stream.fileno()).st_size
        if size == 0:
            raise ValueError("empty file")
        digest = hashlib.file_digest(stream, "sha256").digest()
    return size, base64.b64encode(digest).decode("ascii")


def request_upload(opener, args, size, checksum):
    payload = {"fileName": args.file.name, "businessDate": args.business_date,
               "sizeBytes": size, "checksumSha256": checksum}
    request = Request(args.api_url.rstrip("/") + "/api/v1/bank/uploads",
                      data=json.dumps(payload).encode("utf-8"), method="POST",
                      headers={"X-Api-Key": args.api_key, "Content-Type": "application/json"})
    with opener.open(request, timeout=30) as response:
        if response.status != 201:
            raise ValueError(f"예상하지 못한 HTTP {response.status}")
        target = json.load(response)
    if (type(target["uploadId"]) is not int or type(target["bankId"]) is not int
            or target["method"] != "PUT"):
        raise ValueError("invalid response")
    if not isinstance(target["url"], str):
        raise ValueError("invalid upload URL")
    url = urlsplit(target["url"])
    if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password:
        raise ValueError("invalid upload URL")
    expiry = datetime.fromisoformat(target["expiresAt"])
    if expiry.tzinfo is None:
        raise ValueError("invalid expiry")
    headers = target["headers"]
    if not isinstance(headers, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in headers.items()):
        raise ValueError("invalid headers")
    normalized = {k.lower(): v for k, v in headers.items()}
    if (normalized.get("content-type") != "text/csv"
            or normalized.get("x-amz-checksum-sha256") != checksum
            or "x-api-key" in normalized):
        raise ValueError("invalid signed headers")
    return target


def upload_file(opener, source, target, size):
    headers = dict(target["headers"])
    headers["Content-Length"] = str(size)
    with source.open("rb") as stream:
        request = Request(target["url"], data=stream, method="PUT", headers=headers)
        with opener.open(request, timeout=30) as response:
            if not 200 <= response.status < 300:
                raise ValueError(f"예상하지 못한 HTTP {response.status}")


def main(argv=None):
    args = parse_args(argv)
    try:
        size, checksum = inspect_file(args.file)
    except (OSError, ValueError):
        print("파일 확인 실패: 읽을 수 있는 비어 있지 않은 파일을 지정하세요.", file=sys.stderr)
        return 2
    # 출력에 사용자 경로/서버 응답 전체 대신 필요한 식별 정보만 쓴다.
    file_name = args.file.name.replace(args.api_key, "[REDACTED]")
    print(f"[1/3] 파일 확인 완료: {file_name}\n"
          f"      기준일: {args.business_date} / 크기: {size:,} bytes")
    opener = build_opener(NoRedirect())
    stage = "URL 발급"
    upload_id = None
    try:
        target = request_upload(opener, args, size, checksum)
        upload_id = target["uploadId"]
        print(f"[2/3] 업로드 URL 발급 완료: 은행 {target['bankId']} / uploadId {upload_id}")
        stage = "S3 업로드"
        upload_file(opener, args.file, target, size)
        print("[3/3] S3 업로드 성공\n결과: 성공 — 거래내역 CSV 전송 완료")
        return 0
    except HTTPError as error:
        # 응답 본문/예외 문자열에는 키나 서명 URL이 포함될 수 있다.
        detail = f"HTTP {error.code} 응답으로 요청이 거절되었습니다."
        error.close()
    except (OSError, HTTPException):
        detail = ("결과 불명: 저장 여부를 확인할 수 없습니다. 자동 재전송하지 마세요."
                  if stage == "S3 업로드" else "통신 실패: URL 발급 응답을 받지 못했습니다.")
    except (ValueError, KeyError, TypeError):
        detail = "응답 형식 또는 전송 조건이 계약과 일치하지 않습니다."
    job = f" (uploadId {upload_id})" if upload_id is not None else ""
    print(f"{stage} 실패{job}: {detail}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
