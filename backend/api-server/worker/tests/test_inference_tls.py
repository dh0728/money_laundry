"""Real loopback TLS handshakes with ephemeral test keys; no GPU, AWS or DB access."""
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
from pathlib import Path
import ssl
import tempfile
import threading
import unittest
from dataclasses import replace
from unittest.mock import patch

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
import httpx

from inference.model_publication import Settings, configured
from common.worker_transport import ProtocolError


class InferenceTlsTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(prefix='aml-tls-test-')
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.now = datetime.now(timezone.utc)
        self.ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Ephemeral Test CA')])
        self.ca = (x509.CertificateBuilder().subject_name(self.ca_name).issuer_name(self.ca_name)
                   .public_key(self.ca_key.public_key()).serial_number(x509.random_serial_number())
                   .not_valid_before(self.now - timedelta(days=1)).not_valid_after(self.now + timedelta(days=2))
                   .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
                   .add_extension(x509.SubjectKeyIdentifier.from_public_key(self.ca_key.public_key()), False)
                   .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, None, None), critical=True)
                   .sign(self.ca_key, hashes.SHA256()))
        self.ca_path = self.root / 'ca.crt'
        self.ca_path.write_bytes(self.ca.public_bytes(serialization.Encoding.PEM))

    def server(self, ip='127.0.0.1', expired=False):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cert = (x509.CertificateBuilder().subject_name(x509.Name([
                    x509.NameAttribute(NameOID.COMMON_NAME, ip)]))
                .issuer_name(self.ca_name).public_key(key.public_key())
                .serial_number(x509.random_serial_number())
                .not_valid_before(self.now - timedelta(days=2))
                .not_valid_after(self.now + timedelta(days=-1 if expired else 1))
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(self.ca_key.public_key()), False)
                .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(ip))]), False)
                .sign(self.ca_key, hashes.SHA256()))
        cert_path, key_path = self.root / 'server.crt', self.root / 'server.key'
        cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM,
                            serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                code = 200 if self.headers.get('Authorization') == 'Bearer ' + 'x' * 32 else 401
                self.send_response(code)
                self.end_headers()
                self.wfile.write(b'{}')

            do_PUT = do_GET

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert_path, key_path)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def stop():
            server.shutdown()
            server.server_close()
            thread.join(3)
        self.addCleanup(stop)
        return f'https://127.0.0.1:{server.server_port}'

    def settings(self, url):
        return Settings(url, 'x' * 32, 'test-bucket', 'dev/test/', 'ap-northeast-2',
                        ca_file=str(self.ca_path))

    def test_trusted_ip_get_put_and_auth_with_env_proxy_ignored(self):
        settings = self.settings(self.server())
        with patch.dict('os.environ', {'HTTPS_PROXY': 'http://127.0.0.1:1', 'SSL_CERT_FILE': 'missing'}):
            with settings.client() as client:
                self.assertEqual(client.get(settings.api_url).status_code, 401)
                for method in ('GET', 'PUT'):
                    self.assertEqual(client.request(method, settings.api_url,
                        headers={'Authorization': 'Bearer ' + settings.token}).status_code, 200)

    def test_missing_trust_rejects_server(self):
        settings = replace(self.settings(self.server()), ca_file='')
        with settings.client() as client, self.assertRaises(httpx.ConnectError):
            client.get(settings.api_url)

    def test_ip_san_mismatch_is_rejected(self):
        settings = self.settings(self.server(ip='127.0.0.2'))
        with settings.client() as client, self.assertRaises(httpx.ConnectError):
            client.get(settings.api_url)

    def test_expired_server_is_rejected(self):
        settings = self.settings(self.server(expired=True))
        with settings.client() as client, self.assertRaises(httpx.ConnectError):
            client.get(settings.api_url)

    def test_missing_ca_or_invalid_token_fails_before_publication(self):
        settings = self.settings('https://gpu.example')
        with self.assertRaises(ProtocolError):
            replace(settings, ca_file=str(self.root / 'missing')).validate()
        for token in ('short', 'x' * 32 + '\n', 'x' * 32 + '한'):
            with self.assertRaises(ProtocolError):
                replace(settings, token=token).validate()

    def test_external_s3_signing_keeps_regional_host_and_separate_trust(self):
        env = dict(INFERENCE_API_URL='https://gpu.example', INFERENCE_API_TOKEN='x' * 32,
                   INFERENCE_CA_FILE=str(self.ca_path), S3_BUCKET='test-bucket', S3_PREFIX='dev/test/',
                   AWS_REGION='ap-northeast-2', AWS_ACCESS_KEY_ID='test', AWS_SECRET_ACCESS_KEY='test')
        with patch.dict('os.environ', env):
            settings, client = configured()
            self.addCleanup(client.close)
            self.assertEqual(settings.ca_file, str(self.ca_path))
            for method in ('get_object', 'put_object'):
                url = client.generate_presigned_url(method, Params={'Bucket': settings.bucket, 'Key': 'dev/test/example'})
                self.assertTrue(url.startswith('https://test-bucket.s3.ap-northeast-2.amazonaws.com/'))
            self.assertNotEqual(client._endpoint.http_session._verify, settings.ca_file)


if __name__ == '__main__':
    unittest.main()
