"""One bounded inference tick; never wait for a model or mark scores complete."""
import json
import re

import httpx

from model_contract import MODEL_ERRORS
from model_publication import _lock, publish_model
from worker_transport import ProtocolError, Request, S3Store, StoreUnavailable, encode


def normalize(request, view, prefix, expected_rows):
    if not isinstance(view, dict):
        raise ProtocolError('Invalid remote observation')
    request.check(view, versions=False)
    revision, status = view.get('revision'), view.get('status')
    if (type(revision) is not int or revision < 1 or status not in (
            'QUEUED', 'RUNNING', 'RETRY_WAIT', 'COMPLETED', 'FAILED',
            'RECOVERY_REQUIRED', 'CANCEL_REQUESTED', 'STOPPED')):
        raise ProtocolError('Invalid remote state')
    normalized = dict(request.identity(), revision=revision, status=status)
    if status == 'COMPLETED':
        result = view.get('result')
        if not isinstance(result, dict):
            raise ProtocolError('Completed observation has no result')
        request.check(result)
        files = result.get('files')
        if (result.get('status') != 'COMPLETED' or type(result.get('row_count')) is not int
                or result['row_count'] != expected_rows or not isinstance(files, list) or len(files) != 1):
            raise ProtocolError('Invalid result metadata')
        entry = files[0]
        if (not isinstance(entry, dict) or entry.get('name') != 'scores'
                or entry.get('key') != prefix + request.output + 'scores.parquet'
                or type(entry.get('size_bytes')) is not int or entry['size_bytes'] <= 0
                or not isinstance(entry.get('sha256'), str)
                or not re.fullmatch('[0-9a-f]{64}', entry['sha256'])):
            raise ProtocolError('Invalid result object')
        normalized['result'] = dict(request.identity(), **request.versions(), status='COMPLETED',
                                    row_count=result['row_count'], files=[{k: entry[k] for k in (
                                        'name', 'key', 'size_bytes', 'sha256')}])
    elif status in ('FAILED', 'RETRY_WAIT', 'RECOVERY_REQUIRED', 'STOPPED'):
        code = view.get('error_code')
        known = set(MODEL_ERRORS) | {'TRANSFER_UNAVAILABLE', 'TRANSFER_ACCESS_DENIED',
            'INPUT_OR_MODEL_INVALID', 'MODEL_PROCESS_FAILED', 'MODEL_PROTOCOL_INVALID',
            'MODEL_PROCESS_UNAVAILABLE', 'RECOVERY_REQUIRED'}
        normalized['error_code'] = code if isinstance(code, str) and code in known else 'REMOTE_EXECUTION_FAILED'
    return normalized


def observe_model(connection, execution, kind, settings, *, transport=None):
    with connection.transaction():
        _lock(connection, execution)
        row = connection.execute('''SELECT binding,input_artifact,request_id,execution_round
            FROM analysis_model_tasks WHERE run_id=%s AND model_kind=%s
              AND phase='WAIT_REMOTE' AND status='WAITING' FOR UPDATE''', (execution.run_id, kind)).fetchone()
        if row is None:
            return
        binding, artifact, request_id, round_id = row
        if binding.get('publication') != settings.binding():
            raise ProtocolError('Publication destination changed within a run')
        request = Request(execution.job_id, kind.lower(), str(request_id), round_id,
                          binding['model_version'], binding['feature_version'], str(execution.run_id))
    endpoint = settings.api_url.rstrip('/') + f'/api/v1/inference-requests/{request_id}/rounds/{round_id}'
    with httpx.Client(timeout=15, follow_redirects=False, trust_env=False, transport=transport) as client:
        with client.stream('GET', endpoint, headers={'Authorization': 'Bearer ' + settings.token}) as response:
            response.raise_for_status()
            if response.status_code != 200:
                raise ProtocolError('Unexpected observation response')
            data = bytearray()
            for chunk in response.iter_bytes():
                data.extend(chunk)
                if len(data) > 65536:
                    raise ProtocolError('Observation is too large')
            view = normalize(request, json.loads(data), S3Store(None, settings.bucket, settings.prefix).prefix,
                             artifact['row_count'])
    with connection.transaction():
        _lock(connection, execution)
        stored = connection.execute('''SELECT remote_revision,remote_snapshot,phase,status FROM analysis_model_tasks
            WHERE run_id=%s AND model_kind=%s FOR UPDATE''', (execution.run_id, kind)).fetchone()
        if stored[0] is not None:
            if view['revision'] < stored[0]:
                return
            if view['revision'] == stored[0] and stored[1] != view:
                raise ProtocolError('Conflicting remote revision')
        if stored[2:] != ('WAIT_REMOTE', 'WAITING'):
            return
        remote = view['status']
        phase, status = ('COLLECT', 'READY') if remote == 'COMPLETED' else (
            ('WAIT_REMOTE', 'FAILED') if remote in ('FAILED', 'STOPPED') else ('WAIT_REMOTE', 'WAITING'))
        connection.execute('''UPDATE analysis_model_tasks SET phase=%s,status=%s,remote_revision=%s,
            remote_snapshot=%s::jsonb,consecutive_failures=0,retry_at=null,
            error_code=%s,action_required=%s,updated_at=now(),
            next_poll_at=CASE WHEN %s='WAITING' THEN now()+interval '5 seconds' ELSE null END
            WHERE run_id=%s AND model_kind=%s''', (phase, status, view['revision'], encode(view).decode(),
                view.get('error_code') if remote in ('FAILED', 'STOPPED', 'RECOVERY_REQUIRED') else None,
                remote in ('FAILED', 'STOPPED', 'RECOVERY_REQUIRED'), status, execution.run_id, kind))
        if status == 'WAITING':
            connection.execute('''UPDATE analysis_model_tasks SET action_required=true,
                error_code=coalesce(error_code,'REMOTE_WAIT_EXPIRED')
                WHERE run_id=%s AND model_kind=%s AND remote_deadline_at<=now()''', (execution.run_id, kind))


def _failure(connection, execution, kind, error):
    with connection.transaction():
        _lock(connection, execution)
        row = connection.execute('''SELECT phase,consecutive_failures,request_id,execution_round
            FROM analysis_model_tasks WHERE run_id=%s AND model_kind=%s FOR UPDATE''', (execution.run_id, kind)).fetchone()
        phase, failures, request_id, round_id = row
        # publish_model has already recorded a failure. Observations have not.
        failures = max(1, failures) if phase == 'PUBLISH' else failures + 1
        transient = isinstance(error, (httpx.TransportError, StoreUnavailable)) or (
            isinstance(error, httpx.HTTPStatusError) and (
                error.response.status_code in (408, 429) or error.response.status_code >= 500))
        terminal = not transient or failures >= 3
        possibly_published = request_id is not None and connection.execute('''SELECT status='PUBLISHED'
            FROM analysis_model_requests WHERE request_id=%s AND execution_round=%s''', (request_id, round_id)).fetchone()[0]
        # An unconfirmed remote execution is never abandoned or retried as a new round.
        waiting = phase == 'WAIT_REMOTE' or (terminal and possibly_published)
        connection.execute('''UPDATE analysis_model_tasks SET phase=%s,status=%s,execution_id=null,
            execution_owner=null,consecutive_failures=%s,action_required=%s,error_code=%s,
            retry_at=CASE WHEN %s THEN null ELSE now()+(%s * interval '1 second') END,
            next_poll_at=CASE WHEN %s THEN now()+(%s * interval '1 second') ELSE null END,updated_at=now()
            WHERE run_id=%s AND model_kind=%s''', (
                'WAIT_REMOTE' if waiting else phase, 'WAITING' if waiting else 'FAILED' if terminal else 'RETRY_WAIT',
                failures, terminal, 'REMOTE_OBSERVATION_FAILED' if waiting else 'PUBLICATION_FAILED',
                waiting or terminal, 30 if failures == 1 else 120,
                waiting, 30 if failures == 1 else 120, execution.run_id, kind))


def advance(connection, execution, storage_root, settings, s3, *, transport=None):
    settings.validate()
    with connection.transaction():
        _lock(connection, execution)
        connection.execute('''UPDATE analysis_model_tasks SET action_required=true,
            error_code=coalesce(error_code,'REMOTE_WAIT_EXPIRED')
            WHERE run_id=%s AND status='WAITING' AND remote_deadline_at<=now()''', (execution.run_id,))
        rows = connection.execute('''SELECT model_kind,phase,status,
            coalesce(CASE WHEN phase='WAIT_REMOTE' THEN next_poll_at ELSE retry_at END<=now(),true)
            FROM analysis_model_tasks WHERE run_id=%s ORDER BY (phase='WAIT_REMOTE') DESC,model_kind''',
            (execution.run_id,)).fetchall()
        if {r[0] for r in rows} != {'BINARY', 'TYPE'}:
            raise ProtocolError('Both prepared model tasks are required')
    for kind, phase, status, due in rows:
        if not due or status in ('SUCCEEDED', 'CANCELLED'):
            continue
        try:
            if phase == 'PUBLISH' and status in ('READY', 'ACTIVE', 'RETRY_WAIT'):
                publish_model(connection, execution, kind, storage_root, settings, s3, transport=transport)
            elif phase == 'WAIT_REMOTE' and status == 'WAITING':
                observe_model(connection, execution, kind, settings, transport=transport)
        except (httpx.HTTPError, StoreUnavailable, ProtocolError, ValueError, KeyError) as error:
            from frozen_input import StaleExecution
            if isinstance(error, StaleExecution):
                raise
            _failure(connection, execution, kind, error)
    from result_collection import collect_model, finish_inference
    collections = connection.execute('''SELECT model_kind FROM analysis_model_tasks
        WHERE run_id=%s AND phase='COLLECT' AND status IN ('READY','RETRY_WAIT','ACTIVE')
          AND (retry_at IS NULL OR retry_at<=now()) ORDER BY model_kind''', (execution.run_id,)).fetchall()
    for (kind,) in collections:
        collect_model(connection, execution, kind, storage_root, settings, s3)
    states = connection.execute('SELECT phase,status FROM analysis_model_tasks WHERE run_id=%s',
                                (execution.run_id,)).fetchall()
    if any(status in ('WAITING', 'RETRY_WAIT', 'ACTIVE') or (phase == 'PUBLISH' and status == 'READY')
           for phase, status in states):
        return 76  # Durable deferred work, not a failed execution.
    if any(status == 'FAILED' for phase, status in states):
        return 77
    finish_inference(connection, execution)
    return 0
