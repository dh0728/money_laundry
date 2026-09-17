"""Download the one-row S3 smoke fixture from a terminal or Jupyter notebook.

Notebook: from kubesphere_download_smoke import run; run()
Provide an HTTPS GET URL, not the bank mock's signed PUT URL.
The URL is read with getpass or AML_SMOKE_DOWNLOAD_URL and is never printed.
Only Python's standard library is required. No local output files are created.
"""

import csv
import getpass
import hashlib
import io
import os
import socket
import ssl
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


EXPECTED_SHA256 = "b85e326d48e4e47100169edc07c095b69d11639dfb35627cb4e1d755f184945c"
MAX_BYTES = 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify(data: bytes) -> dict:
    """Reject login pages, unrelated objects and altered fixture bytes."""
    digest = hashlib.sha256(data).hexdigest()
    if digest != EXPECTED_SHA256:
        raise ValueError("SHA-256 mismatch: the downloaded object is not the smoke fixture")
    rows = list(csv.DictReader(io.StringIO(data.decode("utf-8"))))
    if len(rows) != 1 or len(rows[0]) != 17:
        raise ValueError("Expected one data row with 17 columns")
    return {"status": "OK", "bytes": len(data), "rows": len(rows), "sha256": digest}


def download(url: str) -> dict:
    address = urlsplit(url)
    if (address.scheme != "https" or not address.hostname
            or address.username or address.password or address.fragment):
        raise ValueError("An HTTPS download URL is required")
    request = Request(url, method="GET")
    with build_opener(NoRedirect()).open(request, timeout=30) as response:
        if response.status != 200:
            raise ValueError("Expected HTTP 200")
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("Smoke input exceeds the 1 MiB limit")
    return verify(data)


def run(url: str | None = None) -> bool:
    """Use run() in Jupyter to enter the URL without displaying it in the cell."""
    try:
        url = url or os.environ.get("AML_SMOKE_DOWNLOAD_URL")
        if not url:
            url = getpass.getpass("S3 download GET URL (hidden): ")
        result = download(url.strip())
    except HTTPError as error:
        print(f"FAILED: HTTP {error.code}; check GET permission, URL expiry and endpoint")
        return False
    except (URLError, socket.timeout, ssl.SSLError, OSError):
        print("FAILED: network, DNS or TLS connection; URL and response body are hidden")
        return False
    except ValueError:
        print("FAILED: invalid URL or file content; expected the original one-row smoke fixture")
        return False
    print(f"OK: downloaded {result['bytes']} bytes, {result['rows']} row; SHA-256 matched")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if run() else 1)
