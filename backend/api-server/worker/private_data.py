"""Private identity protection compatible with the Spring ingest framing."""

import base64
import binascii
import hashlib
import hmac
import secrets
import struct

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _framed(*values: str) -> bytes:
    output = bytearray()
    for value in values:
        encoded = value.encode("utf-8")
        output.extend(struct.pack(">I", len(encoded)))
        output.extend(encoded)
    return bytes(output)


def _decode(value: str) -> bytes:
    # Java's basic Base64 decoder accepts omitted trailing padding.
    return base64.b64decode(value + "=" * (-len(value) % 4), validate=True)


class PrivateDataProtector:
    def __init__(self, encryption_key: str, search_key: str, version: str):
        try:
            encryption = _decode(encryption_key)
            search = _decode(search_key)
        except (ValueError, binascii.Error):
            raise ValueError("PRIVATE_DATA_KEY_INVALID") from None
        if len(encryption) != 32 or len(search) != 32:
            raise ValueError("PRIVATE_DATA_KEY_INVALID")
        if not version.strip() or hmac.compare_digest(encryption, search):
            raise ValueError("PRIVATE_DATA_KEYS_REQUIRED")
        self.version = version
        self._cipher = AESGCM(encryption)
        self._search_key = search

    def token(self, purpose: str, *values: str) -> str:
        return hmac.new(
            self._search_key, _framed(purpose, *values), hashlib.sha256
        ).hexdigest()

    def encrypt(self, purpose: str, plaintext: str) -> str:
        nonce = secrets.token_bytes(12)
        encrypted = self._cipher.encrypt(
            nonce, plaintext.encode("utf-8"), _framed(self.version, purpose)
        )
        return base64.b64encode(nonce + encrypted).decode("ascii")

    def decrypt(self, purpose: str, stored: str, key_version: str) -> str:
        if key_version != self.version:
            raise ValueError("PRIVATE_KEY_VERSION_MISMATCH")
        try:
            encoded = _decode(stored)
            if len(encoded) < 28:
                raise ValueError()
            return self._cipher.decrypt(
                encoded[:12], encoded[12:], _framed(self.version, purpose)
            ).decode("utf-8")
        except (ValueError, binascii.Error, InvalidTag):
            raise ValueError("PRIVATE_DATA_AUTHENTICATION_FAILED") from None
