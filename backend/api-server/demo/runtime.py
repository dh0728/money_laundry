"""Persistent, local-only demo bootstrap. Never imported by API or worker code."""
import base64
from datetime import date
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

BUCKET = 'aml-demo-files'
SECRET_DIR = Path('/secrets')
TLS = Path('/tls')
KEYS = ('postgres-password', 'minio-password', 'inference-token', 'encryption-key', 'search-key')


def prepare_keys(folder):
    folder.mkdir(parents=True, exist_ok=True)
    if (folder / 'ready').exists() and any(not (folder / key).is_file() for key in KEYS):
        raise RuntimeError('Persistent keys are missing; restore the existing keys instead of regenerating them')
    for key in KEYS:
        target = folder / key
        if not target.exists():
            value = (base64.b64encode(secrets.token_bytes(32)).decode()
                     if key.endswith('-key') else secrets.token_urlsafe(36))
            with target.open('x') as stream:
                stream.write(value)
            target.chmod(0o444)
    (folder / 'ready').touch(exist_ok=True)


def command(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def prepare():
    import certifi
    prepare_keys(SECRET_DIR)
    TLS.mkdir(parents=True, exist_ok=True)
    if not (TLS / 'ca.pem').exists():
        command('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
                '-subj', '/CN=AML local demo CA', '-addext', 'basicConstraints=critical,CA:TRUE',
                '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
                '-keyout', '/tls/ca.key', '-out', '/tls/ca.pem')
    valid = (TLS / 'server.pem').exists() and subprocess.run(
        ['openssl', 'x509', '-checkend', '86400', '-noout', '-in', '/tls/server.pem'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if not valid:
        hosts = ['inference.test', 's3.amazonaws.com', 's3.ap-northeast-2.amazonaws.com',
                 BUCKET + '.s3.amazonaws.com', BUCKET + '.s3.ap-northeast-2.amazonaws.com']
        (TLS / 'extensions').write_text('subjectAltName=' + ','.join('DNS:' + h for h in hosts)
            + '\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\nbasicConstraints=critical,CA:FALSE\n')
        command('openssl', 'req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=inference.test',
                '-keyout', '/tls/server.key', '-out', '/tls/server.csr')
        command('openssl', 'x509', '-req', '-in', '/tls/server.csr', '-CA', '/tls/ca.pem',
                '-CAkey', '/tls/ca.key', '-CAcreateserial', '-days', '365',
                '-extfile', '/tls/extensions', '-out', '/tls/server.pem')
    (TLS / 'bundle.pem').write_bytes(Path(certifi.where()).read_bytes() + (TLS / 'ca.pem').read_bytes())
    if not (TLS / 'truststore').exists():
        command('/opt/java/openjdk/bin/keytool', '-importcert', '-noprompt', '-alias', 'local-demo',
                '-file', '/tls/ca.pem', '-keystore', '/tls/truststore', '-storepass', 'changeit')
    for name in ('ca.key', 'server.key'):
        (TLS / name).chmod(0o600)
    (TLS / 'nginx.conf').write_text('''events {}
http {
  access_log off;
  client_max_body_size 210m;
  server {
    listen 443 ssl;
    server_name inference.test;
    ssl_certificate /tls/server.pem;
    ssl_certificate_key /tls/server.key;
    location / { proxy_pass http://inference:8090; proxy_set_header Host $http_host; }
  }
  server {
    listen 443 ssl default_server;
    ssl_certificate /tls/server.pem;
    ssl_certificate_key /tls/server.key;
    location / {
      proxy_pass http://objects:9000;
      proxy_http_version 1.1;
      proxy_set_header Host $http_host;
      proxy_request_buffering off;
      proxy_buffering off;
    }
  }
}
''')
    print('Local keys and TLS ready (existing keys preserved)', flush=True)


def configure():
    values = {key: (SECRET_DIR / key).read_text().strip() for key in KEYS}
    os.environ.update(AWS_ACCESS_KEY_ID='local-demo-key', AWS_SECRET_ACCESS_KEY=values['minio-password'],
        AWS_REGION='ap-northeast-2', AWS_DEFAULT_REGION='ap-northeast-2', AWS_EC2_METADATA_DISABLED='true',
        AWS_CA_BUNDLE='/tls/bundle.pem', SSL_CERT_FILE='/tls/bundle.pem',
        SPRING_DATASOURCE_PASSWORD=values['postgres-password'],
        INGEST_ENCRYPTION_KEY=values['encryption-key'], INGEST_SEARCH_KEY=values['search-key'],
        INGEST_KEY_VERSION='local-demo', INFERENCE_API_TOKEN=values['inference-token'],
        INFERENCE_TOKEN=values['inference-token'],
        INFERENCE_OBJECT_BASE_URL='https://' + BUCKET + '.s3.amazonaws.com/demo/')


def bank_days(root):
    result = set()
    for folder in sorted(root.iterdir()):
        if not folder.is_dir():
            continue
        try:
            day = date.fromisoformat(folder.name)
        except ValueError:
            continue
        for file in folder.glob('*.csv'):
            match = re.fullmatch(r'bank_(\d+)(?:_' + re.escape(folder.name) + r')?\.csv', file.name)
            if not match or not file.resolve().is_relative_to(root.resolve()):
                raise ValueError('Invalid demo bank file name/path')
            result.add((int(match[1]), day))
    if not result:
        raise ValueError('No dated bank files found')
    return sorted(result)


def seed():
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError
    import psycopg
    registrations = bank_days(Path('/data-input'))
    with psycopg.connect(host='postgres', dbname='aml_demo', user='aml_demo',
                         password=(SECRET_DIR / 'postgres-password').read_text().strip()) as db:
        for bank, day in registrations:
            # Bank names are established from validated reports, never invented here.
            db.execute("INSERT INTO banks(bank_id,is_reporting,report_format) VALUES(%s,true,'AML17') ON CONFLICT(bank_id) DO NOTHING", (bank,))
            db.execute('''INSERT INTO bank_reporting_periods(bank_id,effective_from_date,effective_to_date)
                SELECT %s,%s,%s WHERE NOT EXISTS(SELECT 1 FROM bank_reporting_periods
                WHERE bank_id=%s AND effective_from_date<=%s AND (effective_to_date IS NULL OR effective_to_date>=%s))''',
                (bank, day, day, bank, day, day))
        db.execute("INSERT INTO users(username,name,role) SELECT 'local-demo-reviewer','Demo reviewer','L1' WHERE NOT EXISTS(SELECT 1 FROM users WHERE username='local-demo-reviewer')")
    s3 = boto3.client('s3', config=Config(signature_version='s3v4'))
    try:
        s3.head_bucket(Bucket=BUCKET)
    except ClientError as error:
        if error.response['ResponseMetadata']['HTTPStatusCode'] != 404:
            raise
        s3.create_bucket(Bucket=BUCKET, CreateBucketConfiguration={'LocationConstraint': 'ap-northeast-2'})
    print(f'Local demo ready: {len(registrations)} bank/day registrations; existing records preserved', flush=True)


def launch(mode):
    import certifi
    if mode != 'ui':
        Path(certifi.where()).write_bytes((TLS / 'bundle.pem').read_bytes())
    if mode == 'api':
        os.environ['JAVA_TOOL_OPTIONS'] = '-Djavax.net.ssl.trustStore=/tls/truststore -Djavax.net.ssl.trustStorePassword=changeit'
        args = ['java', '-jar', '/app/app.jar']
    elif mode == 'inference':
        args = [sys.executable, '-B', '/app/worker/inference_server.py']
    else:
        file, port = sys.argv[2:]
        if (file, port) not in (('app.py', '8501'), ('control_panel.py', '8502')):
            raise ValueError('Unknown UI entry')
        os.environ['AML_DEMO_API_URL'] = 'http://127.0.0.1:8080'
        args = [sys.executable, '-B', '-m', 'streamlit', 'run', file, '--server.address', '0.0.0.0',
                '--server.port', port, '--browser.gatherUsageStats', 'false']
    if os.geteuid() == 0:
        os.setgid(10001)
        os.setuid(10001)
    os.execvp(args[0], args)


if __name__ == '__main__':
    mode = sys.argv[1]
    try:
        if mode == 'prepare':
            prepare()
        else:
            configure()
            seed() if mode == 'seed' else launch(mode)
    except Exception as error:
        print('Local demo startup failed: ' + type(error).__name__ + '. Check mounted data and service health.', file=sys.stderr)
        sys.exit(1)
