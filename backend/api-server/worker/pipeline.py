"""Backend worker operations. Only persisted, fenced artifacts count as complete."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import uuid

import pyarrow.parquet as pq

from demo_calculator import FEATURE_VERSION, MODEL_VERSION
from frozen_input import FrozenInput, StaleExecution, write_demo_input
from worker_transport import ProtocolError


def _digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _lock(connection, execution):
    # Same integration lock/order as Spring correction/freeze operations.
    connection.execute("SELECT pg_advisory_xact_lock(17004000)")
    connection.execute("SELECT job_id FROM batch_jobs WHERE job_id=%s FOR UPDATE",
                       (execution.job_id,))
    connection.execute("SELECT run_id FROM analysis_runs WHERE run_id=%s FOR UPDATE",
                       (execution.run_id,))
    FrozenInput(connection, execution).check_current()


def _existing(connection, execution, root, kind):
    row = connection.execute("""
        SELECT input_artifact FROM analysis_model_tasks
        WHERE run_id=%s AND model_kind=%s AND phase='PUBLISH' AND status='READY'
        """, (execution.run_id, kind)).fetchone()
    if row is None or row[0] is None:
        return None
    document = row[0]
    if (document.get("run_id") != str(execution.run_id)
            or document.get("model_kind") != kind
            or document.get("model_version") != MODEL_VERSION
            or document.get("feature_version") != FEATURE_VERSION):
        raise ProtocolError("Stored input artifact identity mismatch")
    path = (root / document["path"]).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ProtocolError("Stored input artifact missing")
    if path.stat().st_size != document["size_bytes"] or _digest(path) != document["sha256"]:
        raise ProtocolError("Stored input artifact changed")
    return document


def _initialize(connection, execution):
    binding = dict(mode="demo", model_version=MODEL_VERSION,
                   feature_version=FEATURE_VERSION, input_contract_version=1)
    with connection.transaction():
        _lock(connection, execution)
        for kind in ("BINARY", "TYPE"):
            connection.execute("""
                INSERT INTO analysis_model_tasks(run_id,model_kind,phase,status,binding)
                VALUES(%s,%s,'PREPARE','READY',%s::jsonb) ON CONFLICT DO NOTHING
                """, (execution.run_id, kind, json.dumps(binding)))
            stored = connection.execute("""
                SELECT binding FROM analysis_model_tasks WHERE run_id=%s AND model_kind=%s
                """, (execution.run_id, kind)).fetchone()[0]
            if stored != binding:
                raise ProtocolError("Model binding changed within a run")


def _claim(connection, execution, kind):
    token = uuid.uuid4()
    with connection.transaction():
        _lock(connection, execution)
        # Only a new, fenced parent execution can recover an abandoned preparation.
        # Two processes with the same parent token may not steal each other's work.
        changed = connection.execute("""
            UPDATE analysis_model_tasks SET status='ACTIVE',execution_id=%s,
              execution_owner=%s,operation_attempts=operation_attempts+1,updated_at=now(),
              error_code=null,action_required=false
            WHERE run_id=%s AND model_kind=%s AND phase='PREPARE'
              AND (status IN ('READY','FAILED') OR (status='ACTIVE' AND execution_owner<>%s))
            """, (token, execution.execution_id, execution.run_id, kind,
                  execution.execution_id)).rowcount
        if changed != 1:
            raise StaleExecution("Model preparation is already owned or fenced")
    return token


def _record_failure(connection, execution, kind, token):
    try:
        with connection.transaction():
            _lock(connection, execution)
            connection.execute("""
                UPDATE analysis_model_tasks SET status='FAILED',execution_id=null,
                  execution_owner=null,error_code='PREPARE_FAILED',updated_at=now(),
                  consecutive_failures=consecutive_failures+1
                WHERE run_id=%s AND model_kind=%s AND status='ACTIVE' AND execution_id=%s
                """, (execution.run_id, kind, token))
    except Exception:
        # Preserve the original failure. A lost DB or cancelled run cannot accept
        # this observation; an abandoned ACTIVE token is fenced by the next claim.
        pass


def _stage_features(connection, path):
    # Stage bounded batches on this connection without holding application row locks.
    connection.execute("""CREATE TEMP TABLE IF NOT EXISTS prepared_features(
        tx_id bigint PRIMARY KEY, features jsonb NOT NULL)""")
    connection.execute("TRUNCATE prepared_features")
    with connection.cursor() as cursor:
        with cursor.copy("COPY prepared_features(tx_id,features) FROM STDIN") as copy:
            for batch in pq.ParquetFile(path).iter_batches(batch_size=4096):
                for row in batch.to_pylist():
                    copy.write_row((row["tx_id"], json.dumps({"demo_value": row["demo_value"]})))


def _save_prepared(connection, execution, kind, token, document):
    with connection.transaction():
        _lock(connection, execution)
        changed = connection.execute("""
            UPDATE analysis_model_tasks SET phase='PUBLISH',status='READY',input_artifact=%s::jsonb,
              execution_id=null,execution_owner=null,consecutive_failures=0,updated_at=now()
            WHERE run_id=%s AND model_kind=%s AND phase='PREPARE' AND status='ACTIVE'
              AND execution_id=%s AND execution_owner=%s
            """, (json.dumps(document), execution.run_id, kind, token,
                  execution.execution_id)).rowcount
        if changed != 1:
            raise StaleExecution("Model preparation token changed")
        if connection.execute("""
            SELECT EXISTS(SELECT 1 FROM transaction_features
              WHERE job_id=%s AND model_kind=%s AND run_id IS DISTINCT FROM %s)
            """, (execution.job_id, kind, execution.run_id)).fetchone()[0]:
            raise ProtocolError("Feature rows belong to another run")
        connection.execute("""
            INSERT INTO transaction_features(job_id,tx_id,model_kind,feature_version,features,run_id)
            SELECT %s,tx_id,%s,%s,features,%s FROM prepared_features
            ON CONFLICT(job_id,tx_id,model_kind) DO UPDATE SET
              feature_version=excluded.feature_version,features=excluded.features,run_id=excluded.run_id
            """, (execution.job_id, kind, FEATURE_VERSION, execution.run_id))


def _prepare_model(connection, execution, root, kind):
    source = FrozenInput(connection, execution)
    source.check_current()
    artifact = _existing(connection, execution, root, kind)
    if artifact is None:
        token = _claim(connection, execution, kind)
        relative = Path("runs") / str(execution.run_id) / kind / str(token) / "targets.parquet"
        output = root / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".partial", delete=False) as stream:
                temporary = Path(stream.name)
                count = write_demo_input(source, stream)
                stream.flush()
                os.fsync(stream.fileno())
            digest = _digest(temporary)
            size = temporary.stat().st_size
            os.replace(temporary, output)
            temporary = None
            artifact = dict(protocol_version=1, run_id=str(execution.run_id), model_kind=kind,
                            model_version=MODEL_VERSION, feature_version=FEATURE_VERSION,
                            path=relative.as_posix(), size_bytes=size, sha256=digest, row_count=count)
            _stage_features(connection, output)
            _save_prepared(connection, execution, kind, token, artifact)
        except Exception:
            _record_failure(connection, execution, kind, token)
            raise
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    return artifact


def prepare_features(connection, execution, storage_root):
    """Persist each model's input and feature rows before inference.

    Prepared models survive a later model failure. The existing stage runner still
    invokes this sequentially; independent publication is a separate dispatcher step.
    Files are retained after an uncertain commit and checked on reuse.
    """
    root = Path(storage_root).resolve()
    _initialize(connection, execution)
    models = {kind: _prepare_model(connection, execution, root, kind)
              for kind in ("BINARY", "TYPE")}
    artifact = json.dumps(dict(protocol_version=2, run_id=str(execution.run_id), models=models),
                          sort_keys=True, separators=(",", ":"))
    with connection.transaction():
        _lock(connection, execution)
        connection.execute("""
            INSERT INTO analysis_run_stage_results(run_id,stage,execution_id,artifact,completed)
            VALUES(%s,'FEATURES',%s,%s,true)
            ON CONFLICT(run_id,stage) DO UPDATE SET
              execution_id=excluded.execution_id,artifact=excluded.artifact,completed=true
            """, (execution.run_id, execution.execution_id, artifact))
    return artifact
