"""은행 CSV 업로드 3단계 클라이언트. API.md §1.1 계약을 따른다."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, url2pathname


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # API 키 또는 업로드 내용을 다른 주소로 자동 재전송하지 않는다.
        return None


def post_json(opener, url, api_key, payload, expected_status):
    data = json.dumps(payload).encode("utf-8") if payload is not None else b""
    request = Request(url, data=data, method="POST", headers={
        "X-Api-Key": api_key, "Content-Type": "application/json",
    })
    with opener.open(request, timeout=30) as response:
        if response.status != expected_status:
            raise ValueError(f"예상하지 못한 HTTP 상태: {response.status}")
        return json.load(response)


def transfer(opener, source, target, size):
    if target["method"] != "PUT":
        raise ValueError("업로드 응답의 method가 PUT이 아닙니다")
    url = urlsplit(target["url"])
    if url.scheme == "file":
        if url.netloc not in ("", "localhost"):
            raise ValueError("file: 업로드는 같은 컴퓨터의 로컬 경로만 지원합니다")
        shutil.copyfile(source, Path(url2pathname(url.path)))
    elif url.scheme in ("http", "https"):
        headers = dict(target["headers"])
        headers["Content-Length"] = str(size)
        # API 키는 발급/완료 API에만 사용하며 저장소 PUT에는 넣지 않는다.
        with source.open("rb") as stream:
            request = Request(target["url"], data=stream, method="PUT", headers=headers)
            with opener.open(request, timeout=30) as response:
                if not 200 <= response.status < 300:
                    raise ValueError(f"파일 PUT 실패: HTTP {response.status}")
    else:
        raise ValueError("업로드 URL은 file:, http:, https:만 지원합니다")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bank", type=int, required=True, help="표기용 은행 코드(은행 식별은 API 키)")
    parser.add_argument("--file", type=Path, required=True, help="전송할 CSV 파일")
    parser.add_argument("--api-url", default="http://localhost:8080", help="API 서버 주소")
    parser.add_argument("--api-key", default=os.environ.get("BANK_API_KEY"),
                        help="은행 API 키(기본: BANK_API_KEY 환경변수)")
    args = parser.parse_args(argv)
    if not args.api_key or not args.api_key.strip():
        parser.error("--api-key 또는 BANK_API_KEY 환경변수가 필요합니다")
    if urlsplit(args.api_url).scheme not in ("http", "https"):
        parser.error("--api-url은 http 또는 https 주소여야 합니다")

    stage = "파일 확인"
    upload_id = None
    try:
        with args.file.open("rb") as stream:
            size = os.fstat(stream.fileno()).st_size
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if size == 0:
            raise ValueError("빈 파일은 업로드할 수 없습니다")
        opener = build_opener(NoRedirect())
        base_url = args.api_url.rstrip("/")
        stage = "URL 발급"
        target = post_json(opener, base_url + "/api/bank/uploads", args.api_key, {
            "fileName": args.file.name, "sizeBytes": size, "sha256": digest,
        }, 201)
        upload_id = int(target["uploadId"])
        stage = "파일 전송"
        transfer(opener, args.file, target, size)
        stage = "완료 통지"
        response = post_json(opener, f"{base_url}/api/bank/uploads/{upload_id}/complete",
                             args.api_key, None, 202)
        print(json.dumps({"bank": args.bank, "response": response}, ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        detail = f"HTTP {error.code}" if isinstance(error, HTTPError) else str(error)
        detail = detail.replace(args.api_key, "[REDACTED]")
        job = f" (uploadId={upload_id})" if upload_id is not None else ""
        print(f"{stage} 실패{job}: {detail}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
