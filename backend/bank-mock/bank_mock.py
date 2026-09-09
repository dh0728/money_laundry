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
import re
import time
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
    parser.add_argument("--file", type=Path, help="하루치 거래 CSV")
    parser.add_argument("--business-date", help="거래 기준일 YYYY-MM-DD")
    parser.add_argument("--upload-id", type=int, help="기존 업로드 결과 재조회")
    args = parser.parse_args(argv)
    if args.upload_id is not None:
        if args.upload_id <= 0 or args.file is not None or args.business_date is not None:
            parser.error("invalid lookup mode")
    elif args.file is None or args.business_date is None:
        parser.error("missing upload inputs")
    try:
        if args.business_date is not None and date.fromisoformat(args.business_date).isoformat() != args.business_date:
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


def safe_text(value, api_key):
    if value is None:
        return "확인되지 않음"
    if not isinstance(value, (str, int)):
        raise ValueError("invalid output field")
    text = str(value).replace(api_key, "[REDACTED]")
    text = re.sub(r"https?://[^\s]+", "[URL REDACTED]", text)
    return " ".join(text.split())[:500]


def request_status(opener, args, upload_id, complete=False):
    url = args.api_url.rstrip("/") + f"/api/v1/bank/uploads/{upload_id}"
    request = Request(url + ("/complete" if complete else ""),
                      data=b"" if complete else None, method="POST" if complete else "GET",
                      headers={"X-Api-Key": args.api_key})
    with opener.open(request, timeout=30) as response:
        if response.status != (202 if complete else 200):
            raise ValueError("invalid status response")
        result = json.load(response)
    if type(result.get("uploadId")) is not int or result["uploadId"] != upload_id:
        raise ValueError("invalid upload id")
    return result


class ResultWaitTimeout(TimeoutError):
    pass


def wait_result(opener, args, upload_id, result):
    started = time.monotonic()
    while result["status"] in ("URL_ISSUED", "RECEIVED", "RUNNING"):
        if time.monotonic() - started >= 1800:
            raise ResultWaitTimeout("result wait expired")
        time.sleep(2)
        result = request_status(opener, args, upload_id)
    if result["status"] not in ("COMPLETED", "VALIDATION_FAILED", "FAILED"):
        raise ValueError("invalid status")
    return result


def show_result(result, api_key):
    def field(name):
        return safe_text(result.get(name), api_key)
    print(f"파일명: {field('fileName')} / 기준일: {field('businessDate')}\n"
          f"업로드 시각: {field('receivedAt')} / 처리 완료 시각: {field('finishedAt')}\n"
          f"파일 행 수: {field('rowCount')} / 적재 행 수: {field('insertedCount')}")
    if result["status"] == "COMPLETED":
        print("결과: 원장 적재 완료")
        return 0
    if result["status"] == "VALIDATION_FAILED":
        print("결과: 파일 검증 실패 — 아래 오류를 수정하고 재업로드하세요.")
        for error in result.get("errors", [])[:100]:
            print(f"행 {safe_text(error.get('row'), api_key)} / "
                  f"{safe_text(error.get('column'), api_key)}: {safe_text(error.get('reason'), api_key)}")
    else:
        print("결과: 서버 처리 오류 — uploadId로 관리자에게 처리 상태 확인을 요청하세요.")
    return 1


def main(argv=None):
    args = parse_args(argv)
    opener = build_opener(NoRedirect())
    upload_id = args.upload_id
    stage = "결과 조회" if upload_id is not None else "파일 확인"
    try:
        if upload_id is None:
            try:
                size, checksum = inspect_file(args.file)
            except (OSError, ValueError):
                print("파일 확인 실패: 읽을 수 있는 비어 있지 않은 파일을 지정하세요.", file=sys.stderr)
                return 2
            print(f"[1/4] 파일 확인 완료: {safe_text(args.file.name, args.api_key)}\n"
                  f"      기준일: {args.business_date} / 크기: {size:,} bytes")
            stage = "URL 발급"
            target = request_upload(opener, args, size, checksum)
            upload_id = target["uploadId"]
            print(f"[2/4] 업로드 URL 발급 완료: 은행 {target['bankId']} / uploadId {upload_id}")
            stage = "S3 업로드"
            upload_file(opener, args.file, target, size)
            print("[3/4] S3 업로드 성공")
            stage = "완료 통지"
            result = request_status(opener, args, upload_id, complete=True)
        else:
            result = request_status(opener, args, upload_id)
        stage = "결과 조회"
        print(f"[4/4] 처리 결과 확인: uploadId {upload_id}")
        return show_result(wait_result(opener, args, upload_id, result), args.api_key)
    except HTTPError as error:
        detail = f"HTTP {error.code} 응답으로 요청이 거절되었습니다."
        if stage == "URL 발급" and error.code == 409:
            try:
                body = json.load(error)
                if body.get("code") == "DUPLICATE_FILE":
                    detail = ("이미 처리된 파일입니다. 파일명: " + safe_text(body.get("fileName"), args.api_key)
                              + " / 업로드 시각: " + safe_text(body.get("uploadedAt"), args.api_key))
                elif body.get("code") == "UPLOAD_IN_PROGRESS":
                    detail = "같은 파일의 업로드가 진행 중입니다. 기존 uploadId로 결과를 확인하세요."
            except (ValueError, TypeError, AttributeError):
                pass
        error.close()
    except ResultWaitTimeout:
        detail = "결과 확인 시간 초과: 서버 작업 실패를 의미하지 않습니다."
    except (OSError, HTTPException):
        detail = "결과 불명: 저장 또는 처리 여부를 확인할 수 없습니다."
    except (ValueError, KeyError, TypeError, AttributeError):
        detail = "응답 형식 또는 전송 조건이 계약과 일치하지 않습니다."
    job = f" (uploadId {upload_id}; --upload-id {upload_id}로 재조회)" if upload_id is not None else ""
    print(f"{stage} 실패{job}: {detail}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
