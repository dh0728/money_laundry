"""Ledger file upload through the API (issue URL → PUT to storage → complete → status).

Requests reuse the operator's ADMIN session of ApiClient. Errors carry only the HTTP status and
the API error code, never response bodies, signed URLs or file contents.
"""
import base64
import hashlib
import os
from datetime import datetime
from urllib.parse import urlsplit

import httpx

TRANSIENT = (408, 429, 500, 502, 503, 504, 520, 522, 524)


class UploadHttpError(Exception):
    def __init__(self, status, code=None, upload_id=None):
        super().__init__(f'HTTP {status}')
        self.status, self.code, self.upload_id = status, code, upload_id


def inspect_file(source):
    with source.open('rb') as stream:
        size = os.fstat(stream.fileno()).st_size
        if size == 0:
            raise ValueError('empty file')
        digest = hashlib.file_digest(stream, 'sha256').digest()
    return size, base64.b64encode(digest).decode('ascii')


def _send(client, method, path, payload, cf_headers, timeout):
    headers = dict(client.headers)
    headers.update(cf_headers or {})
    if method != 'GET' and client.csrf:
        headers[client.csrf['headerName']] = client.csrf['token']
    with httpx.Client(timeout=timeout, follow_redirects=False, headers=headers,
                      cookies=client.cookies, transport=client.transport) as http:
        response = http.request(method, client.base_url + '/api/v1/' + path, json=payload)
        client.cookies.update(http.cookies)
    return response


def _call(client, method, path, payload=None, *, cf_headers=None, timeout=30):
    """``client`` is an ApiClient, or the dev AdminClient that wraps one and can sign in again."""
    session = getattr(client, '_client', client)
    response = _send(session, method, path, payload, cf_headers, timeout)
    if response.status_code in (401, 403) and hasattr(client, 'connect'):
        # An expired operator session (or its CSRF token) is renewed once, as AdminClient does.
        client.connect()
        response = _send(session, method, path, payload, cf_headers, timeout)
    return response


def _failure(response):
    code = upload_id = None
    try:
        body = response.json()
        if isinstance(body, dict):
            code = body.get('code') if isinstance(body.get('code'), str) else None
            upload_id = body.get('uploadId') if type(body.get('uploadId')) is int else None
    except ValueError:
        pass
    return UploadHttpError(response.status_code, code, upload_id)


def request_upload(client, day, file, size, checksum, *, cf_headers=None):
    response = _call(client, 'POST', 'ledger-uploads', {
        'fileName': file.name, 'businessDate': day, 'sizeBytes': size, 'checksumSha256': checksum},
        cf_headers=cf_headers)
    if response.status_code != 201:
        raise _failure(response)
    target = response.json()
    if type(target.get('uploadId')) is not int or target.get('method') != 'PUT':
        raise ValueError('invalid response')
    url = urlsplit(target.get('url') if isinstance(target.get('url'), str) else '')
    if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password:
        raise ValueError('invalid upload URL')
    if datetime.fromisoformat(target['expiresAt']).tzinfo is None:
        raise ValueError('invalid expiry')
    headers = target.get('headers')
    if not isinstance(headers, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in headers.items()):
        raise ValueError('invalid headers')
    normalized = {k.lower(): v for k, v in headers.items()}
    if (normalized.get('content-type') != 'text/csv'
            or normalized.get('x-amz-checksum-sha256') != checksum
            or any(name in normalized for name in ('x-api-key', 'authorization', 'cookie',
                                                   'cf-access-client-id', 'cf-access-client-secret'))):
        raise ValueError('invalid signed headers')
    return target


def _chunks(stream, size, on_progress, chunk=1 << 20):
    """Yields the file in 1 MiB blocks and reports bytes handed to the connection so far."""
    sent = 0
    while block := stream.read(chunk):
        sent += len(block)
        if on_progress is not None:
            on_progress(sent, size)
        yield block


def upload_file(source, target, size, on_progress=None):
    headers = dict(target['headers'])
    # An explicit length keeps httpx from switching to chunked encoding, which signed PUTs refuse.
    headers['Content-Length'] = str(size)
    with source.open('rb') as stream:
        # The timeout bounds each read/write, not the whole transfer of a large file.
        response = httpx.put(target['url'], content=_chunks(stream, size, on_progress),
                             headers=headers, timeout=60)
    if not 200 <= response.status_code < 300:
        raise UploadHttpError(response.status_code)


def request_status(client, upload_id, *, complete=False, cf_headers=None):
    path = f'ledger-uploads/{upload_id}' + ('/complete' if complete else '')
    response = _call(client, 'POST' if complete else 'GET', path, cf_headers=cf_headers)
    if response.status_code != (202 if complete else 200):
        raise _failure(response)
    result = response.json()
    if type(result.get('uploadId')) is not int or result['uploadId'] != upload_id:
        raise ValueError('invalid upload id')
    return result
