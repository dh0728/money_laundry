"""Stream model results, validate them against what was sent, and atomically persist scores.

A binary result holds one probability per frozen TARGET (tx_id); a type result holds the
9 type probabilities per classified Alert (alert_key, see alert_types). S3 objects and local
files are not completion signals. Only fenced DB records are. Large files are
copied/validated in bounded batches, without application row locks.
"""
import hashlib
import math
import os
from pathlib import Path
from uuid import uuid4

import psycopg
import pyarrow as pa
import pyarrow.parquet as pq
from botocore.exceptions import BotoCoreError, ClientError

from common.frozen_input import StaleExecution
from common.run_fence import MODEL_STAGES, lock_stage, save_checkpoint
from common.worker_transport import ProtocolError, Request, encode


def _current(connection, execution, stage):
    row = connection.execute('''SELECT b.execution_id,b.status,b.current_stage,b.current_run_id,r.status
        FROM analysis.jobs b JOIN analysis.runs r ON r.run_id=b.current_run_id WHERE b.job_id=%s''',
        (execution.job_id,)).fetchone()
    if (row is None or row[:4] != (execution.execution_id, 'RUNNING', stage, execution.run_id)
            or row[4] not in ('READY', 'ACTIVE')):
        raise StaleExecution('Result owner is no longer current')


def _columns(kind):
    if kind == 'BINARY':
        return ['p_laundering']
    if kind == 'TYPE':
        return [f'p_{i}' for i in range(9)]
    raise ProtocolError('Invalid result model kind')


def _key(kind):
    return 'alert_key' if kind == 'TYPE' else 'tx_id'


def _expected(execution, kind, inputs):
    """Query and arguments of the keys a result must hold exactly: what the request was built from."""
    if kind == 'TYPE':
        from alert_types.alert_type_inference import ALERT_KEYS
        return ALERT_KEYS, (execution.run_id, inputs['build_generation'])
    return ("SELECT tx_id AS key FROM analysis.input_transactions WHERE run_id=%s AND input_role='TARGET'",
            (execution.run_id,))


def _table_name(kind):
    _columns(kind)
    return 'collected_' + kind.lower()


def _metadata(execution, kind, row):
    binding, inputs, request_id, round_id, snapshot = row
    request = Request(execution.job_id, kind.lower(), str(request_id), round_id,
                      binding['model_version'], binding['feature_version'], str(execution.run_id))
    # Reuse the same identity/path/version checks as GET, including after restart.
    from inference.inference_dispatch import normalize
    result = normalize(request, snapshot, binding['publication']['prefix'], inputs['row_count'])
    if result['status'] != 'COMPLETED':
        raise ProtocolError('Model result is not complete')
    return result['result'], binding


def _verified(path, descriptor):
    if not path.is_file() or path.stat().st_size != descriptor['size_bytes']:
        return False
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest() == descriptor['sha256']


def _download(s3, bucket, descriptor, path):
    """Read the bound key, never a URL supplied by the remote model."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.partial')
    try:
        body = s3.get_object(Bucket=bucket, Key=descriptor['key'])['Body']
        try:
            digest, size = hashlib.sha256(), 0
            with temporary.open('wb') as output:
                while chunk := body.read(1024 * 1024):
                    size += len(chunk)
                    if size > descriptor['size_bytes']:
                        raise ProtocolError('Result size mismatch')
                    digest.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if size != descriptor['size_bytes'] or digest.hexdigest() != descriptor['sha256']:
                raise ProtocolError('Result hash or size mismatch')
            os.replace(temporary, path)
        finally:
            body.close()
    finally:
        temporary.unlink(missing_ok=True)


def _stage(connection, execution, kind, path, rows, inputs, stage):
    """Validate schema, probabilities and the exact key set in a session table."""
    columns, name, key = _columns(kind), _table_name(kind), _key(kind)
    schema = pa.schema([(key, pa.int64()), *[(c, pa.float64()) for c in columns]])
    try:
        parquet = pq.ParquetFile(path)
        if not parquet.schema_arrow.equals(schema, check_metadata=False) or parquet.metadata.num_rows != rows:
            raise ProtocolError('Result schema or row count mismatch')
        connection.execute(f'''CREATE TEMP TABLE IF NOT EXISTS {name}({key} bigint PRIMARY KEY,
            {','.join(c + ' double precision NOT NULL' for c in columns)})''')
        connection.execute(f'TRUNCATE {name}')
        for batch in parquet.iter_batches(batch_size=4096):
            _current(connection, execution, stage)
            with connection.cursor() as cursor:
                with cursor.copy(f'COPY {name} FROM STDIN') as copy:
                    for row in batch.to_pylist():
                        identifier = row[key]
                        values = [row[c] for c in columns]
                        if (type(identifier) is not int or identifier <= 0
                                or any(v is None or not math.isfinite(v) or not 0 <= v <= 1 for v in values)
                                or (kind == 'TYPE' and abs(math.fsum(values) - 1) > 1e-9)):
                            raise ProtocolError('Invalid result probability or ID')
                        copy.write_row((identifier, *values))
    except (pa.ArrowException, psycopg.errors.UniqueViolation) as error:
        raise ProtocolError('Invalid Parquet or duplicate result ID') from error
    finally:
        if 'parquet' in locals():
            parquet.close()
    expected, arguments = _expected(execution, kind, inputs)
    mismatch = connection.execute(f'''SELECT EXISTS(
        SELECT 1 FROM {name} s FULL JOIN ({expected}) i ON i.key=s.{key}
        WHERE s.{key} IS NULL OR i.key IS NULL)''', arguments).fetchone()[0]
    if mismatch or rows <= 0:
        raise ProtocolError('Result key set mismatch')


def _failure(connection, execution, kind, token, error):
    transient = isinstance(error, (BotoCoreError, OSError)) and not isinstance(error, ProtocolError)
    if isinstance(error, ClientError):
        transient = (error.response.get('ResponseMetadata', {}).get('HTTPStatusCode', 0) >= 500
                     or error.response.get('Error', {}).get('Code') in ('SlowDown', 'RequestTimeout', 'NoSuchKey'))
    try:
        with connection.transaction():
            lock_stage(connection, execution, MODEL_STAGES[kind])
            connection.execute('''UPDATE analysis.model_tasks SET execution_id=null,execution_owner=null,
                consecutive_failures=consecutive_failures+1,error_code=%s,
                status=CASE WHEN %s AND consecutive_failures<2 THEN 'RETRY_WAIT' ELSE 'FAILED' END,
                action_required=NOT (%s AND consecutive_failures<2),
                retry_at=CASE WHEN %s AND consecutive_failures<2 THEN
                  now()+(CASE WHEN consecutive_failures=0 THEN 30 ELSE 120 END)*interval '1 second' ELSE null END,
                updated_at=now() WHERE run_id=%s AND model_kind=%s AND execution_id=%s''',
                ('RESULT_TRANSFER_FAILED' if transient else 'RESULT_INVALID', transient, transient, transient,
                 execution.run_id, kind, token))
    except psycopg.Error:
        pass  # Leave the abandoned token for a new parent execution to recover.


def collect_model(connection, execution, kind, storage_root, settings, s3):
    token = uuid4()
    with connection.transaction():
        lock_stage(connection, execution, MODEL_STAGES[kind])
        row = connection.execute('''SELECT binding,input_artifact,request_id,execution_round,remote_snapshot,
            phase,status,execution_owner FROM analysis.model_tasks WHERE run_id=%s AND model_kind=%s FOR UPDATE''',
            (execution.run_id, kind)).fetchone()
        if row is None or row[5] != 'COLLECT' or row[6] not in ('READY', 'RETRY_WAIT', 'ACTIVE'):
            raise StaleExecution('Result collection is not ready')
        if row[6] == 'ACTIVE' and row[7] == execution.execution_id:
            raise StaleExecution('Result collection is already owned')
        result, binding = _metadata(execution, kind, row[:5])
        if binding['publication'] != settings.binding():
            raise ProtocolError('Result destination changed')
        connection.execute('''UPDATE analysis.model_tasks SET status='ACTIVE',execution_id=%s,
            execution_owner=%s,operation_attempts=operation_attempts+1,updated_at=now()
            WHERE run_id=%s AND model_kind=%s''', (token, execution.execution_id, execution.run_id, kind))
    root = Path(storage_root).resolve()
    relative = Path('runs') / str(execution.run_id) / kind / str(token) / 'scores.parquet'
    path = root / relative
    try:
        _download(s3, settings.bucket, result['files'][0], path)
        _stage(connection, execution, kind, path, result['row_count'], row[1], MODEL_STAGES[kind])
        artifact = dict(result, path=relative.as_posix())
        with connection.transaction():
            lock_stage(connection, execution, MODEL_STAGES[kind])
            changed = connection.execute('''UPDATE analysis.model_tasks SET phase='DONE',status='SUCCEEDED',
                result_artifact=%s::jsonb,execution_id=null,execution_owner=null,consecutive_failures=0,
                error_code=null,action_required=false,retry_at=null,next_poll_at=null,finished_at=now(),updated_at=now()
                WHERE run_id=%s AND model_kind=%s AND phase='COLLECT' AND status='ACTIVE'
                  AND execution_id=%s AND execution_owner=%s''',
                (encode(artifact).decode(), execution.run_id, kind, token, execution.execution_id)).rowcount
            if changed != 1:
                raise StaleExecution('Result collection token changed')
    except (ProtocolError, OSError, BotoCoreError, ClientError) as error:
        if isinstance(error, StaleExecution):
            raise
        _failure(connection, execution, kind, token, error)
        path.unlink(missing_ok=True)
    # On uncertain DB commit retain the file. Never infer failure/success from it.


def finish_inference(connection, execution):
    with connection.transaction():
        lock_stage(connection, execution)
        rows = connection.execute('''SELECT model_kind,result_artifact FROM analysis.model_tasks
            WHERE run_id=%s AND model_kind='BINARY' AND phase='DONE' AND status='SUCCEEDED'
              AND result_artifact IS NOT NULL''', (execution.run_id,)).fetchall()
        if len(rows) != 1:
            raise ProtocolError('The validated binary result is required')
        artifact = encode(dict(run_id=str(execution.run_id), models=dict(rows))).decode()
        save_checkpoint(connection, execution, 'INFERENCE', artifact)


def run(connection, execution, context):
    """Stage entry: ⑦ 점수 저장 (SCORES)."""
    save_scores(connection, execution, context.storage_dir, context.settings, context.s3)


def done_task(connection, execution, kind):
    """The model task's stored result columns, once collection has finished."""
    row = connection.execute('''SELECT binding,input_artifact,request_id,execution_round,
        remote_snapshot,result_artifact FROM analysis.model_tasks
        WHERE run_id=%s AND model_kind=%s AND phase='DONE' AND status='SUCCEEDED' ''',
        (execution.run_id, kind)).fetchone()
    if row is None:
        raise ProtocolError('The model result is required')
    return row


def stage_stored(connection, execution, kind, data, storage_root, settings, s3, stage):
    """Validate a collected result again into its session table (collected_<kind>); return the binding."""
    root = Path(storage_root).resolve()
    result, binding = _metadata(execution, kind, data[:5])
    stored = data[5]
    if stored is None or {k: v for k, v in stored.items() if k != 'path'} != result:
        raise ProtocolError('Stored result binding mismatch')
    if binding['publication'] != settings.binding():
        raise ProtocolError('Result destination changed')
    path = (root / stored['path']).resolve()
    if not path.is_relative_to(root):
        raise ProtocolError('Result path escapes storage')
    if not _verified(path, result['files'][0]):
        # Local files are a cache; restore the same immutable remote result.
        # Separate token path avoids colliding with an abandoned process.
        path = root / 'runs' / str(execution.run_id) / kind / str(execution.execution_id) / 'scores.parquet'
        _download(s3, settings.bucket, result['files'][0], path)
    _stage(connection, execution, kind, path, result['row_count'], data[1], stage)
    return binding


def save_scores(connection, execution, storage_root, settings, s3):
    with connection.transaction():
        lock_stage(connection, execution, 'SCORES')
        task = done_task(connection, execution, 'BINARY')
        # A persisted checkpoint is authoritative after a lost worker response.
        saved = connection.execute('''SELECT artifact FROM analysis.stage_results
            WHERE run_id=%s AND stage='SCORES' AND completed''', (execution.run_id,)).fetchone()
        if saved:
            save_checkpoint(connection, execution, 'SCORES', saved[0])
            return
    binding = stage_stored(connection, execution, 'BINARY', task, storage_root, settings, s3, 'SCORES')
    # Rank work precedes the short fenced transaction. Equal scores share the
    # lowest rank; a singleton is 0. This is 100 * (rank - 1) / (count - 1).
    connection.execute('DROP TABLE IF EXISTS pg_temp.combined_scores')
    connection.execute('''CREATE TEMP TABLE combined_scores AS SELECT tx_id,p_laundering,
        100.0*percent_rank() OVER(ORDER BY p_laundering) AS score_pct
        FROM collected_binary''')
    with connection.transaction():
        lock_stage(connection, execution, 'SCORES')
        if connection.execute('''SELECT EXISTS(SELECT 1 FROM combined_scores s JOIN ledger.transactions t USING(tx_id)
            LEFT JOIN analysis.target_ownership o USING(tx_id)
            WHERE t.integration_status<>'ACTIVE' OR o.run_id IS DISTINCT FROM %s
            OR EXISTS(SELECT 1 FROM analysis.input_transactions i JOIN analysis.runs r USING(run_id)
              WHERE i.tx_id=t.tx_id AND i.input_role='TARGET' AND r.status='COMPLETED'))''',
            (execution.run_id,)).fetchone()[0]:
            raise ProtocolError('TARGET is no longer eligible for scoring')
        connection.execute('''INSERT INTO analysis.scores(run_id,tx_id,p_laundering,score_pct)
            SELECT %s,s.* FROM combined_scores s''', (execution.run_id,))
        connection.execute('''UPDATE analysis.jobs SET model_version_binary=%s,
            feature_version_binary=%s,row_count=(SELECT count(*) FROM combined_scores),
            suspicious_tx_count=(SELECT count(*) FROM combined_scores WHERE p_laundering>=threshold_value)
            WHERE job_id=%s''', (binding['model_version'], binding['feature_version'], execution.job_id))
        save_checkpoint(connection, execution, 'SCORES', encode(dict(run_id=str(execution.run_id),
            row_count=task[1]['row_count'], percentile='percent_rank-v1')).decode())
