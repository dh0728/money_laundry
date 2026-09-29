import unittest
import os
from dataclasses import replace
from unittest.mock import patch
from urllib.parse import urlsplit

from model_publication import Settings
from worker_transport import ProtocolError


class PublicationSettingsTests(unittest.TestCase):
    def test_http_requires_explicit_loopback_option(self):
        settings = Settings('http://127.0.0.1:8090', 'x' * 32, 'bucket', 'dev/', 'ap-northeast-2')
        with self.assertRaises(ProtocolError):
            settings.validate()
        replace(settings, allow_loopback=True).validate()
        for url in ('http://localhost:8090', 'http://inference:8090', 'http://example.com',
                    'http://127.0.0.1.evil.test', 'http://user@127.0.0.1:8090',
                    'http://127.0.0.1:8090?token=x', 'http://127.0.0.1:8090#fragment'):
            with self.subTest(url=url), self.assertRaises(ProtocolError):
                replace(settings, api_url=url, allow_loopback=True).validate()

    def test_https_remains_default(self):
        Settings('https://inference.example', 'x' * 32, 'bucket', 'dev/', 'ap-northeast-2').validate()

    def test_dev_presigned_urls_match_worker_object_allowlist(self):
        from model_publication import configured
        env = dict(INFERENCE_API_URL='http://127.0.0.1:8090', INFERENCE_API_TOKEN='x' * 32,
                   INFERENCE_ALLOW_LOOPBACK='true', S3_BUCKET='test-bucket', S3_PREFIX='dev/test/',
                   AWS_REGION='ap-northeast-2', AWS_ACCESS_KEY_ID='test', AWS_SECRET_ACCESS_KEY='test')
        if 'SYSTEMROOT' in os.environ:
            env['SYSTEMROOT'] = os.environ['SYSTEMROOT']
        with patch.dict('os.environ', env, clear=True):
            settings, client = configured()
            self.addCleanup(client.close)
            for method in ('get_object', 'put_object'):
                url = client.generate_presigned_url(method, Params={'Bucket': settings.bucket,
                                                     'Key': 'dev/test/results/example'})
                self.assertEqual(urlsplit(url).hostname, 'test-bucket.s3.ap-northeast-2.amazonaws.com')


if __name__ == '__main__':
    unittest.main()
