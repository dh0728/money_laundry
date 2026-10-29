"""⑨ Alert 유형 분류 (ALERT_TYPES): the type model classifies each prepared Alert.

Alert 구성 (ALERTS) leaves its plans in analysis.alert_plans. This stage sends the plans' Alerts
to the inference server as one TYPE request: targets holds alert_key (plan_key + 1, so keys are
positive) and alert_transactions holds each Alert's core transactions (SEED and CONNECTION) as
its evidence lists them. Publication, observation and collection are the same model task steps
as 모델 추론 (analysis.model_tasks, model kind TYPE). The most probable class (the first on ties)
becomes alert_plans.type_class, and Spring publishes the plans after this stage's checkpoint.
A plan without core transactions (NOOP, WITHDRAW) gets no type.
"""
from datetime import datetime
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import uuid

from common.frozen_input import StaleExecution
from common.run_fence import lock_stage, save_checkpoint
from common.worker_transport import ProtocolError, encode
from models import registry

STAGE = 'ALERT_TYPES'
CORE_ROLES = ('SEED', 'CONNECTION')
# alert_key of every plan with core transactions in one plan build; a type result holds exactly these.
ALERT_KEYS = '''SELECT p.plan_key+1 AS key FROM analysis.alert_plans p
    WHERE p.run_id=%s AND p.build_generation=%s AND EXISTS(
      SELECT 1 FROM jsonb_array_elements(p.payload::jsonb->'evidence'->'transactions') m
      WHERE m->>'role' IN ('SEED','CONNECTION'))'''


def run(connection, execution, context):
    """Stage entry: ⑨ Alert 유형 분류 (ALERT_TYPES), one bounded tick; returns the worker exit code."""
    return classify(connection, execution, context.storage_dir, context.settings, context.s3)


def classify(connection, execution, storage_root, settings, s3, *, transport=None):
    settings.validate()
    with connection.transaction():
        lock_stage(connection, execution, STAGE)
        saved = connection.execute('''SELECT artifact FROM analysis.stage_results
            WHERE run_id=%s AND stage=%s AND completed''', (execution.run_id, STAGE)).fetchone()
        if saved:
            # A lost worker response: the plans are typed already; hand them to this execution.
            connection.execute('UPDATE analysis.alert_plans SET execution_id=%s WHERE run_id=%s',
                               (execution.execution_id, execution.run_id))
            save_checkpoint(connection, execution, STAGE, saved[0])
            return 0
        generation = _generation(connection, execution)
        if not connection.execute(f'SELECT EXISTS({ALERT_KEYS})', (execution.run_id, generation)).fetchone()[0]:
            _complete(connection, execution, generation, 0, None)
            return 0
        _bind(connection, execution, generation)
    from inference.inference_dispatch import tick
    code = tick(connection, execution, 'TYPE', storage_root, settings, s3,
                prepare=prepare_alert_input, transport=transport)
    if code is None:
        finish_alert_types(connection, execution, storage_root, settings, s3)
    return code or 0


def _generation(connection, execution):
    """Build generation of the plans Alert 구성 prepared; every stored plan must belong to it."""
    row = connection.execute('''SELECT artifact FROM analysis.stage_results
        WHERE run_id=%s AND stage='ALERTS' AND completed''', (execution.run_id,)).fetchone()
    manifest = json.loads(row[0]) if row else {}
    generation = manifest.get('buildGeneration')
    if manifest.get('publication') != 'PREPARED' or type(generation) is not int:
        raise ProtocolError('Prepared Alert plans are required')
    if connection.execute('''SELECT EXISTS(SELECT 1 FROM analysis.alert_plans
        WHERE run_id=%s AND build_generation<>%s)''', (execution.run_id, generation)).fetchone()[0]:
        raise ProtocolError('Alert plans changed')
    return generation


def _bind(connection, execution, generation):
    """Create the TYPE task with the default type model, or start a new request for rebuilt plans."""
    row = connection.execute('''SELECT phase,input_artifact FROM analysis.model_tasks
        WHERE run_id=%s AND model_kind='TYPE' FOR UPDATE''', (execution.run_id,)).fetchone()
    if row is None:
        model_version, feature_version = registry.default('TYPE').versions()
        binding = dict(mode='demo', model_version=model_version, feature_version=feature_version,
                       input_contract_version=1)
        connection.execute('''INSERT INTO analysis.model_tasks(run_id,model_kind,phase,status,binding)
            VALUES(%s,'TYPE','PREPARE','READY',%s::jsonb)''', (execution.run_id, json.dumps(binding)))
        return
    phase, inputs = row
    if inputs is None or inputs.get('build_generation') == generation:
        return
    if phase != 'DONE':
        raise ProtocolError('An Alert type request of earlier Alert plans is still open')
    # Alert 구성 ran again (the published baseline changed): its new plans are a new request.
    connection.execute('''UPDATE analysis.model_tasks SET phase='PREPARE',status='READY',request_id=null,
        execution_round=null,input_artifact=null,result_artifact=null,remote_revision=null,remote_snapshot=null,
        remote_deadline_at=null,next_poll_at=null,last_event_id=null,error_code=null,action_required=false,
        consecutive_failures=0,retry_at=null,finished_at=null,updated_at=now()
        WHERE run_id=%s AND model_kind='TYPE' ''', (execution.run_id,))


def _alerts(connection, execution, generation):
    """(alert_key, core transactions) of each plan with core transactions, in alert_key order."""
    with connection.transaction(), connection.cursor(name='alert_type_plans') as cursor:
        cursor.execute('''SELECT plan_key,payload FROM analysis.alert_plans
            WHERE run_id=%s AND build_generation=%s ORDER BY plan_key''', (execution.run_id, generation))
        for key, payload in cursor:
            evidence = json.loads(payload)['evidence'] or {}
            rows = [dict(tx_id=member['txId'], occurred_at=datetime.fromisoformat(member['occurredAt']),
                         from_account_id=member['fromAccountId'], to_account_id=member['toAccountId'],
                         amount_usd=Decimal(member['amountUsd']), payment_format=member['paymentFormat'])
                    for member in evidence.get('transactions', ()) if member['role'] in CORE_ROLES]
            if rows:
                yield key + 1, rows


def _digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def prepare_alert_input(connection, execution, storage_root, kind):
    """Write the TYPE request's files from the current plans; only the fenced save completes it."""
    token = uuid.uuid4()
    with connection.transaction():
        lock_stage(connection, execution, STAGE)
        generation = _generation(connection, execution)
        binding = connection.execute('''SELECT binding FROM analysis.model_tasks
            WHERE run_id=%s AND model_kind=%s''', (execution.run_id, kind)).fetchone()[0]
        # Only a new parent execution can take over an abandoned preparation.
        if connection.execute('''UPDATE analysis.model_tasks SET status='ACTIVE',execution_id=%s,
              execution_owner=%s,operation_attempts=operation_attempts+1,updated_at=now(),
              error_code=null,action_required=false
            WHERE run_id=%s AND model_kind=%s AND phase='PREPARE'
              AND (status IN ('READY','FAILED','RETRY_WAIT') OR (status='ACTIVE' AND execution_owner<>%s))''',
                (token, execution.execution_id, execution.run_id, kind, execution.execution_id)).rowcount != 1:
            raise StaleExecution('Alert type preparation is already owned or fenced')
    try:
        package = registry.require(binding['model_version'], binding['feature_version'])
        root = Path(storage_root).resolve()
        relative = Path('runs') / str(execution.run_id) / kind / str(token)
        (root / relative).mkdir(parents=True, exist_ok=True)
        count = package.build_input.write_input(_alerts(connection, execution, generation), root / relative)
        files = [dict(name=name, path=(relative / f'{name}.parquet').as_posix(),
                      size_bytes=(root / relative / f'{name}.parquet').stat().st_size,
                      sha256=_digest(root / relative / f'{name}.parquet')) for name in package.build_input.FILES]
        artifact = dict(protocol_version=4, run_id=str(execution.run_id), model_kind=kind,
                        model_version=binding['model_version'], feature_version=binding['feature_version'],
                        files=files, row_count=count, build_generation=generation)
        with connection.transaction():
            lock_stage(connection, execution, STAGE)
            if connection.execute('''UPDATE analysis.model_tasks SET phase='PUBLISH',status='READY',
                  input_artifact=%s::jsonb,execution_id=null,execution_owner=null,consecutive_failures=0,updated_at=now()
                WHERE run_id=%s AND model_kind=%s AND phase='PREPARE' AND status='ACTIVE'
                  AND execution_id=%s AND execution_owner=%s''',
                    (json.dumps(artifact), execution.run_id, kind, token, execution.execution_id)).rowcount != 1:
                raise StaleExecution('Alert type preparation token changed')
    except Exception:
        try:
            with connection.transaction():
                lock_stage(connection, execution, STAGE)
                connection.execute('''UPDATE analysis.model_tasks SET status='FAILED',execution_id=null,
                    execution_owner=null,error_code='PREPARE_FAILED',updated_at=now(),
                    consecutive_failures=consecutive_failures+1
                    WHERE run_id=%s AND model_kind=%s AND status='ACTIVE' AND execution_id=%s''',
                    (execution.run_id, kind, token))
        except Exception:
            pass  # A lost DB or fenced run cannot take this observation; keep the original error.
        raise


def finish_alert_types(connection, execution, storage_root, settings, s3):
    """Keep the collected types on the plans they were built from, then save the stage checkpoint."""
    from scores.result_collection import done_task, stage_stored
    with connection.transaction():
        lock_stage(connection, execution, STAGE)
        task = done_task(connection, execution, 'TYPE')
    generation = task[1]['build_generation']
    binding = stage_stored(connection, execution, 'TYPE', task, storage_root, settings, s3, STAGE)
    with connection.transaction():
        lock_stage(connection, execution, STAGE)
        if _generation(connection, execution) != generation:
            raise ProtocolError('Alert plans changed while they were classified')
        typed = connection.execute('''UPDATE analysis.alert_plans p SET type_class=array_position(
              array[c.p_0,c.p_1,c.p_2,c.p_3,c.p_4,c.p_5,c.p_6,c.p_7,c.p_8],
              greatest(c.p_0,c.p_1,c.p_2,c.p_3,c.p_4,c.p_5,c.p_6,c.p_7,c.p_8))-1
            FROM collected_type c WHERE p.run_id=%s AND p.plan_key+1=c.alert_key''',
            (execution.run_id,)).rowcount
        _complete(connection, execution, generation, typed, binding)


def _complete(connection, execution, generation, typed, binding):
    # AlertPublisher accepts only plans stamped with the execution that completes this stage.
    connection.execute('UPDATE analysis.alert_plans SET execution_id=%s WHERE run_id=%s',
                       (execution.execution_id, execution.run_id))
    if binding is not None:
        connection.execute('''UPDATE analysis.jobs SET model_version_type=%s,feature_version_type=%s
            WHERE job_id=%s''', (binding['model_version'], binding['feature_version'], execution.job_id))
    save_checkpoint(connection, execution, STAGE, encode(dict(
        run_id=str(execution.run_id), buildGeneration=generation, typedAlertCount=typed)).decode())
