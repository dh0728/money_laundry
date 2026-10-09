"""Dev deployment preflight: real Bash/Compose, isolated AWS and runtime doubles.

Set AML_TEST_DOCKER to the Docker executable. No AWS calls, Docker socket mounts,
host environment files, published ports or persistent container resources are used.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import unittest


DEPLOY = Path(__file__).resolve().parents[1]
DOCKER = os.environ.get('AML_TEST_DOCKER')


@unittest.skipUnless(DOCKER, 'Set AML_TEST_DOCKER to run deployment preflight tests')
class DevDeploymentTests(unittest.TestCase):
    def script(self, missing=''):
        harness = r'''
set -eu
root=$(mktemp -d)
mkdir -p "$root/deploy/scripts"
tr -d '\r' < /source/scripts/deploy-dev.sh > "$root/deploy/scripts/deploy-dev.sh"
cp /source/compose.dev.yaml "$root/deploy/"
touch "$root/deploy/.env.dev"
export CALLS="$root/calls"
touch "$CALLS"
aws() {
  if [[ "$1 $2" == "sts get-caller-identity" ]]; then
    printf '123456789012\n'
  elif [[ "$1 $2" == "ssm get-parameter" ]]; then
    local name=''
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == '--name' ]]; then name="$2"; break; fi
      shift
    done
    printf 'parameter:%s\n' "$name" >> "$CALLS"
    if [[ "$name" == "/aml/dev/$MISSING" ]]; then return 1; fi
    case "$name" in
      /aml/dev/db/url|/aml/dev/db/username|/aml/dev/db/password|\
      /aml/dev/jwt/secret|/aml/dev/s3/bucket|/aml/dev/s3/prefix|\
      /aml/dev/ingest/encryption-key|/aml/dev/ingest/search-key|/aml/dev/ingest/key-version|\
      /aml/dev/analysis-db/username|/aml/dev/analysis-db/password|\
      /aml/dev/inference/token|/aml/dev/cloudflare/access/client-id|/aml/dev/cloudflare/access/client-secret)
        printf 'test-only\n' ;;
      *) return 1 ;;
    esac
  elif [[ "$1 $2" == 'ecr get-login-password' ]]; then
    printf 'test-only\n'
  else
    return 1
  fi
}
docker() {
  printf 'docker:%s\n' "$*" >> "$CALLS"
  if [[ "$1" == 'login' ]]; then cat >/dev/null; fi
  return 0
}
curl() { printf 'curl:%s\n' "$*" >> "$CALLS"; }
export -f aws docker curl
set +e
bash "$root/deploy/scripts/deploy-dev.sh" 1111111111111111111111111111111111111111
status=$?
cat "$CALLS"
exit "$status"
'''
        result = subprocess.run(
            [DOCKER, 'run', '--rm', '-i', '--network', 'none',
             '--mount', f'type=bind,source={DEPLOY},target=/source,readonly',
             '-e', 'MISSING=' + missing, '--entrypoint', '/bin/bash',
             'postgres:17-alpine', '-s'],
            input=harness.encode('utf-8'), capture_output=True, timeout=60)
        result.stdout = result.stdout.decode('utf-8')
        result.stderr = result.stderr.decode('utf-8')
        return result

    def test_deployment_without_obsolete_queue_parameter(self):
        result = self.script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('/sqs/', result.stdout)
        self.assertIn('up -d --no-build --pull never --wait', result.stdout)
        self.assertIn('http://127.0.0.1:8081/actuator/health', result.stdout)

    def test_missing_inference_token_stops_before_container_changes(self):
        result = self.script('inference/token')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('/aml/dev/inference/token', result.stderr)
        self.assertNotIn('docker:compose', result.stdout)
        self.assertNotIn('docker:login', result.stdout)

    def test_compose_resolves_without_queue_environment(self):
        compose = DEPLOY / 'compose.dev.yaml'
        env = {k: v for k, v in os.environ.items()
               if not k.startswith(('DEV_', 'COMPOSE_', 'SQS_'))}
        for name in re.findall(r'\$\{([A-Z0-9_]+):\?', compose.read_text(encoding='utf-8')):
            if 'SQS' not in name:
                env[name] = 'test-only'
        env.update(DEV_API_IMAGE='aml-api:test', DEV_WEB_IMAGE='aml-web:test')
        result = subprocess.run(
            [DOCKER, 'compose', '-f', str(compose), 'config', '--format', 'json'],
            text=True, capture_output=True, env=env, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        api = json.loads(result.stdout)['services']['api']['environment']
        self.assertNotIn('SQS_QUEUE_URL', api)
        self.assertEqual(api['INFERENCE_API_TOKEN'], 'test-only')


if __name__ == '__main__':
    unittest.main()
