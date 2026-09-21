"""Publish one prepared model through the backend worker's single entry point.

Short DB fencing transactions surround S3/HTTP calls; ambiguous publication
always retains the request identity and round for an idempotent retry.
"""
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import httpx

from frozen_input import StaleExecution
from worker_transport import ProtocolError, Request, S3Store, encode, publish


@dataclass(frozen=True)
class Settings:
    api_url: str
    token: str
    bucket: str
    prefix: str
    region: str

    def validate(self):
        url = urlsplit(self.api_url)
        if (url.scheme != 'https' or not url.hostname or url.username or url.password
                or url.query or url.fragment or len(self.token) < 32
                or not self.bucket or not self.region):
            raise ProtocolError('Invalid inference publication configuration')
        S3Store(None, self.bucket, self.prefix)  # Validate relative environment prefix.

    def binding(self):
        return dict(api_url=self.api_url.rstrip('/'), bucket=self.bucket,
                    prefix=S3Store(None, self.bucket, self.prefix).prefix, region=self.region)


def configured():
    settings = Settings(os.environ.get('INFERENCE_API_URL', ''),
                        os.environ.get('INFERENCE_API_TOKEN', ''),
                        os.environ.get('S3_BUCKET', ''), os.environ.get('S3_PREFIX', ''),
                        os.environ.get('AWS_REGION', 'ap-northeast-2'))
    settings.validate()
    import boto3
    from botocore.config import Config
    client = boto3.client('s3', region_name=settings.region,
                          config=Config(signature_version='s3v4', connect_timeout=5,
                                        read_timeout=15, retries={'total_max_attempts': 1}))
    return settings, client


def _lock(connection, execution):
    connection.execute('SELECT pg_advisory_xact_lock(17004000)')
    connection.execute('SELECT job_id FROM batch_jobs WHERE job_id=%s FOR UPDATE', (execution.job_id,))
    connection.execute('SELECT run_id FROM analysis_runs WHERE run_id=%s FOR UPDATE', (execution.run_id,))
    row = connection.execute('''
        SELECT b.execution_id,b.status,b.current_stage,b.current_run_id,r.status
        FROM batch_jobs b LEFT JOIN analysis_runs r ON r.run_id=b.current_run_id WHERE b.job_id=%s
        ''', (execution.job_id,)).fetchone()
    if row != (execution.execution_id, 'RUNNING', 'INFERENCE', execution.run_id, 'READY') and row != (
            execution.execution_id, 'RUNNING', 'INFERENCE', execution.run_id, 'ACTIVE'):
        raise StaleExecution('Publication owner is no longer current')
    blocked = connection.execute('''
        WITH RECURSIVE predecessors(run_id) AS (
          SELECT replaces_run_id FROM analysis_run_replacements WHERE run_id=%s
          UNION SELECT x.replaces_run_id FROM analysis_run_replacements x JOIN predecessors p ON x.run_id=p.run_id)
        SELECT EXISTS(SELECT 1 FROM analysis_model_requests m JOIN predecessors p USING(run_id)
          WHERE m.status NOT IN ('STOPPED','ALREADY_FINISHED','BLOCKED'))
        ''', (execution.run_id,)).fetchone()[0]
    if blocked:
        raise StaleExecution('Previous run has not stopped')


def publish_model(connection, execution, kind, storage_root, settings, s3, *, transport=None):
    if kind not in ('BINARY', 'TYPE') or connection.autocommit is not True:
        raise ProtocolError('Invalid publication operation')
    settings.validate()
    token = uuid4()
    with connection.transaction():
        _lock(connection, execution)
        row = connection.execute('''
            SELECT phase,status,binding,input_artifact,request_id,execution_round,execution_owner
            FROM analysis_model_tasks WHERE run_id=%s AND model_kind=%s FOR UPDATE
            ''', (execution.run_id, kind)).fetchone()
        if row is None:
            raise ProtocolError('Model input is not prepared')
        phase, status, binding, artifact, request_id, round_id, owner = row
        remote = settings.binding()
        if binding.get('publication', remote) != remote:
            raise ProtocolError('Publication destination changed within a run')
        if phase == 'WAIT_REMOTE' and status == 'WAITING':
            return  # Receipt is durable; status observation is a separate operation.
        if (phase != 'PUBLISH' or artifact is None or status not in ('READY', 'FAILED', 'ACTIVE')
                or (status == 'ACTIVE' and owner == execution.execution_id)):
            raise StaleExecution('Publication is already owned or fenced')
        request_id, round_id = request_id or uuid4(), round_id or 1
        request = Request(execution.job_id, kind.lower(), str(request_id), round_id,
                          binding['model_version'], binding['feature_version'], str(execution.run_id))
        connection.execute('''
            INSERT INTO analysis_model_requests(request_id,execution_round,run_id,model_kind,status)
            VALUES(%s,%s,%s,%s,'REGISTERED') ON CONFLICT DO NOTHING
            ''', (request_id, round_id, execution.run_id, kind))
        registered = connection.execute('''SELECT run_id,model_kind,status FROM analysis_model_requests
            WHERE request_id=%s AND execution_round=%s''', (request_id, round_id)).fetchone()
        if registered[:2] != (execution.run_id, kind) or registered[2] not in ('REGISTERED', 'PUBLISHED'):
            raise ProtocolError('Request lineage mismatch')
        binding['publication'] = remote
        connection.execute('''
            UPDATE analysis_model_tasks SET status='ACTIVE',binding=%s::jsonb,request_id=%s,execution_round=%s,
              execution_id=%s,execution_owner=%s,operation_attempts=operation_attempts+1,updated_at=now()
            WHERE run_id=%s AND model_kind=%s
            ''', (encode(binding).decode(), request_id, round_id, token, execution.execution_id, execution.run_id, kind))
    try:
        root = Path(storage_root).resolve()
        path = (root / artifact['path']).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ProtocolError('Prepared input file is missing')
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if (path.stat().st_size != artifact['size_bytes'] or digest != artifact['sha256']
                or artifact['run_id'] != str(execution.run_id) or artifact['model_kind'] != kind
                or artifact['model_version'] != request.model_version
                or artifact['feature_version'] != request.feature_version):
            raise ProtocolError('Prepared input changed')
        store = S3Store(s3, settings.bucket, settings.prefix)
        manifest = publish(store, request, path.parent,
                           [{'name': 'targets', 'relative_path': path.name}], artifact['row_count'])
        if (manifest['files'][0]['sha256'] != artifact['sha256']
                or manifest['files'][0]['size_bytes'] != artifact['size_bytes']):
            raise ProtocolError('Input changed while uploading')
        def signed(method, key):
            return s3.generate_presigned_url(method, Params={'Bucket': settings.bucket,
                'Key': store.object_key(key)}, ExpiresIn=3600)
        body = dict(request.identity(), **request.versions(),
                    manifest_sha256=hashlib.sha256(encode(manifest)).hexdigest(),
                    manifest_url=signed('get_object', request.manifest),
                    input_url=signed('get_object', request.inputs + 'targets.parquet'),
                    result_urls={name: signed('put_object', request.output + name)
                                 for name in ('scores.parquet', 'result.json')})
        with connection.transaction():
            _lock(connection, execution)
            owned = connection.execute('''SELECT execution_id FROM analysis_model_tasks
                WHERE run_id=%s AND model_kind=%s FOR UPDATE''', (execution.run_id, kind)).fetchone()[0]
            if owned != token:
                raise StaleExecution('Publication token changed')
            if connection.execute('''UPDATE analysis_model_requests SET status='PUBLISHED'
                WHERE request_id=%s AND execution_round=%s AND status IN ('REGISTERED','PUBLISHED')
                ''', (request_id, round_id)).rowcount != 1:
                raise StaleExecution('Request cancelled before publication')
        # Persist PUBLISHED before calling the remote API, including timeout cases.
        endpoint = settings.api_url.rstrip('/') + f'/api/v1/inference-requests/{request_id}/rounds/{round_id}'
        with httpx.Client(timeout=15, follow_redirects=False, trust_env=False, transport=transport) as client:
            with client.stream('PUT', endpoint, headers={'Authorization': 'Bearer ' + settings.token}, json=body) as response:
                response.raise_for_status()
                if response.status_code not in (200, 202):
                    raise ProtocolError('Unexpected inference receipt')
                data = bytearray()
                for chunk in response.iter_bytes():
                    data.extend(chunk)
                    if len(data) > 65536:
                        raise ProtocolError('Inference receipt is too large')
                import json
                receipt = json.loads(data)
                if not isinstance(receipt, dict):
                    raise ProtocolError('Invalid inference receipt')
                request.check(receipt, versions=False)
                if receipt.get('status') not in ('QUEUED', 'RUNNING', 'RETRY_WAIT', 'COMPLETED',
                                                  'FAILED', 'RECOVERY_REQUIRED', 'CANCEL_REQUESTED', 'STOPPED'):
                    raise ProtocolError('Invalid inference receipt')
        with connection.transaction():
            _lock(connection, execution)
            if connection.execute('''
                UPDATE analysis_model_tasks SET phase='WAIT_REMOTE',status='WAITING',execution_id=null,
                  execution_owner=null,consecutive_failures=0,error_code=null,action_required=false,
                  next_poll_at=now(),remote_deadline_at=coalesce(remote_deadline_at,now()+interval '30 minutes'),updated_at=now()
                WHERE run_id=%s AND model_kind=%s AND execution_id=%s AND status='ACTIVE'
                ''', (execution.run_id, kind, token)).rowcount != 1:
                raise StaleExecution('Publication completion fenced')
    except Exception:
        try:
            with connection.transaction():
                _lock(connection, execution)
                connection.execute('''UPDATE analysis_model_tasks SET status='FAILED',execution_id=null,
                    execution_owner=null,error_code='PUBLICATION_FAILED',consecutive_failures=consecutive_failures+1,
                    updated_at=now() WHERE run_id=%s AND model_kind=%s AND execution_id=%s
                    ''', (execution.run_id, kind, token))
        except Exception:
            pass  # A cancelled run/lost DB must not replace the original error.
        raise
