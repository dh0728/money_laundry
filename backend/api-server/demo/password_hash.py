"""Offline hash for the configured Spring PBKDF2 v5.8 encoder. No DB access."""
import getpass
import hashlib
import secrets


def encode(password, salt=None):
    salt = secrets.token_bytes(16) if salt is None else salt
    return (salt + hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 310000, 32)).hex()


if __name__ == '__main__':
    password = getpass.getpass('Password (hidden): ')
    if not password or password != getpass.getpass('Confirm (hidden): '):
        raise SystemExit('Empty or mismatched password')
    print(encode(password))
