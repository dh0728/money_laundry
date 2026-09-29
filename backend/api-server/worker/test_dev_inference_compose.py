"""Opt-in test of the dev Compose topology with isolated names and synthetic secrets."""
import base64
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import unittest
from uuid import uuid4


@unittest.skipUnless(os.environ.get('AML_TEST_DOCKER') and os.environ.get('AML_TEST_API_IMAGE'),
                     'Docker and a locally built API image are required')
class DevInferenceComposeTests(unittest.TestCase):
    def test_start_authentication_persistence_and_api_recreation(self):
        docker = os.environ['AML_TEST_DOCKER']
        image = os.environ['AML_TEST_API_IMAGE']
        project = 'aml-inference-check-' + uuid4().hex[:10]
        root = Path(__file__).resolve().parents[3]
        compose_file = root / 'deploy/compose.dev.yaml'
        env = dict(os.environ)
        for name in re.findall(r'\$\{([A-Z_]+)', compose_file.read_text(encoding='utf-8')):
            env[name] = 'test-only'
        key = base64.b64encode(secrets.token_bytes(32)).decode()
        env.update(DEV_API_IMAGE=image, DEV_WEB_IMAGE=image, DEV_DB_URL='jdbc:postgresql://postgres:5432/aml_check',
                   DEV_POSTGRES_DB='aml_check', DEV_POSTGRES_USER='aml_check',
                   DEV_POSTGRES_PASSWORD=secrets.token_urlsafe(32), DEV_JWT_SECRET=secrets.token_urlsafe(48),
                   DEV_INGEST_ENCRYPTION_KEY=key,
                   DEV_INGEST_SEARCH_KEY=base64.b64encode(secrets.token_bytes(32)).decode(), DEV_INGEST_KEY_VERSION='test',
                   DEV_INFERENCE_API_TOKEN=secrets.token_urlsafe(32), DEV_S3_BUCKET='test-bucket',
                   DEV_S3_PREFIX='dev/test/', AWS_REGION='ap-northeast-2', DEV_API_PORT='8081', DEV_WEB_PORT='3001',
                   DEV_INFERENCE_OBJECT_BASE_URL='https://test-bucket.s3.ap-northeast-2.amazonaws.com/dev/test/')

        def run(*args, input=None, timeout=180):
            result = subprocess.run([docker, *args], input=input, text=True, capture_output=True,
                                    env=env, timeout=timeout)
            if result.returncode:
                raise AssertionError(f'Docker {args[0]} failed: {result.stderr[-3000:]}')
            return result.stdout.strip()

        config = json.loads(run('compose', '-f', str(compose_file), 'config', '--format', 'json'))
        self.assertEqual(config['services']['inference']['network_mode'], 'service:api')
        self.assertFalse(config['services']['inference'].get('ports'))
        config['name'] = project
        del config['services']['web']
        for value in config['volumes'].values():
            value['name'] = project + '-' + value['name']
        for value in config['networks'].values():
            value['name'] = project + '-' + value['name']
        for value in config['services'].values():
            value['pull_policy'] = 'never'
        config['services']['api']['ports'] = []
        config['services']['api']['environment'].update(AWS_ACCESS_KEY_ID='test-only',
            AWS_SECRET_ACCESS_KEY='test-only', AWS_EC2_METADATA_DISABLED='true')
        encoded = json.dumps(config)

        def compose(*args):
            try:
                return run('compose', '-p', project, '-f', '-', *args, input=encoded)
            except AssertionError:
                if args[0] == 'up':
                    logs = run('compose', '-p', project, '-f', '-', 'logs', '--no-color', '--tail=100', 'api', 'inference', input=encoded)
                    print(logs[-7000:])
                raise

        def api_python(source):
            return run('exec', '-i', project + '-api-1', '/usr/local/bin/python', '-B', '-', input=source)

        self.addCleanup(compose, 'down', '--volumes', '--remove-orphans')
        compose('up', '-d', '--wait', '--wait-timeout', '120')
        request_id = str(uuid4())
        path = f'/api/v1/inference-requests/{request_id}/rounds/1'
        body = dict(contract_version=2, job_id=1, run_id=str(uuid4()), model_kind='BINARY',
                    request_id=request_id, execution_round=1, cancel_id=str(uuid4()),
                    reason_code='REPORT_CORRECTED', requested_at='2026-09-29T00:00:00+00:00')
        prelude = "import os,httpx\nb='http://127.0.0.1:8090'\nh={'Authorization':'Bearer '+os.environ['INFERENCE_API_TOKEN']}\n"
        api_python(prelude + f"assert httpx.get(b+'/health').status_code==200\n"
                   f"assert httpx.get(b+{path!r}).status_code==401\n"
                   f"r=httpx.put(b+{path!r}+'/cancellation',headers=h,json={body!r})\n"
                   "assert r.status_code==200, r.status_code\nassert r.json()['status']=='STOPPED'\n")
        compose('up', '-d', '--force-recreate', '--wait', '--wait-timeout', '120', 'api', 'inference')
        api_python(prelude + f"r=httpx.get(b+{path!r},headers=h)\n"
                   "assert r.status_code==200, r.status_code\nassert r.json()['status']=='STOPPED'\n")


if __name__ == '__main__':
    unittest.main()
