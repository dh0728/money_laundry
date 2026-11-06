"""Model input preparation stage. Only persisted, fenced artifacts count as complete.

Each model kind is bound to a model package (models/registry.py) when a run starts;
the package's build_input writes the targets file. Every model input also carries the
same model-independent materials (features/materials.py), so the files sent to the
inference server do not change when a model or its features change.

The binary model judges every frozen TARGET and is prepared here (FEATURES). The type
model judges only the TARGETs the binary model marked suspicious (p_laundering at or
above the job's threshold_value, the same value every suspicious count uses), so it is
prepared during INFERENCE once the binary result is collected (prepare_type).
"""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import uuid

import pyarrow.parquet as pq

from common.frozen_input import FrozenInput, StaleExecution
from common.worker_transport import ProtocolError
from features.materials import MATERIALS, REPLICA_MATERIALS, write_materials
from models import registry

MODEL_KINDS = ("BINARY", "TYPE")


def versions_for_run(connection, execution):
    """(model_version, feature_version) per model kind; a new run takes the registry defaults."""
    stored = dict(connection.execute('SELECT model_kind,binding FROM analysis.model_tasks WHERE run_id=%s',
                                     (execution.run_id,)).fetchall())
    if not stored:
        return {kind: registry.default(kind).versions() for kind in MODEL_KINDS}
    versions = {kind: (binding.get('model_version'), binding.get('feature_version'))
                for kind, binding in stored.items()}
    if set(versions) != set(MODEL_KINDS) or not all(
            registry.supported_versions(*pair) for pair in versions.values()):
        raise ProtocolError('Conflicting or unsupported stored model versions')
    return versions


def _digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _lock(connection, execution, stage="FEATURES"):
    # Same integration lock/order as Spring correction/freeze operations.
    connection.execute("SELECT pg_advisory_xact_lock(17004000)")
    connection.execute("SELECT job_id FROM analysis.jobs WHERE job_id=%s FOR UPDATE",
                       (execution.job_id,))
    connection.execute("SELECT run_id FROM analysis.runs WHERE run_id=%s FOR UPDATE",
                       (execution.run_id,))
    FrozenInput(connection, execution, stage=stage).check_current()


def artifact_files(document):
    """[(name, relative path, size, sha256)] of a prepared input.

    Version 1 held only targets, 2 adds the materials, 3 adds the removed file for the
    inference server's ledger copy (with a "replica" position).
    """
    if document.get("protocol_version") == 1:
        return [("targets", document["path"], document["size_bytes"], document["sha256"])]
    files = [(f["name"], f["path"], f["size_bytes"], f["sha256"]) for f in document["files"]]
    expected = REPLICA_MATERIALS if document.get("protocol_version") == 3 else MATERIALS
    if [name for name, *_ in files] != ["targets", *expected]:
        raise ProtocolError("Unexpected prepared input files")
    return files


def replica_plan(connection, execution, *, full=False):
    """Ledger copy position for this run's inputs, or None when the run has no ledger position.

    The base is the latest earlier run whose request the inference server received; the copy
    is then at that run's position. A copy at any other position answers REPLICA_MISMATCH and
    the model is prepared again with full=True.
    """
    seq = connection.execute("SELECT input_seq FROM analysis.runs WHERE run_id=%s",
                             (execution.run_id,)).fetchone()[0]
    if seq is None:
        return None
    base = None if full else connection.execute("""
        SELECT max(r.input_seq) FROM analysis.runs r
        WHERE r.input_seq<%s AND EXISTS(SELECT 1 FROM analysis.model_tasks t
          WHERE t.run_id=r.run_id AND t.remote_revision IS NOT NULL)
        """, (seq,)).fetchone()[0]
    # Transactions frozen at seq: the server installs a copy only with exactly this many.
    rows = connection.execute("SELECT count(*) FROM analysis.run_inputs WHERE run_id=%s",
                              (execution.run_id,)).fetchone()[0]
    if base:
        return dict(mode="delta", base_seq=base, seq=seq, rows=rows)
    return dict(mode="full", base_seq=0, seq=seq, rows=rows)


def _existing(connection, execution, root, kind, versions):
    row = connection.execute("""
        SELECT input_artifact FROM analysis.model_tasks
        WHERE run_id=%s AND model_kind=%s AND phase='PUBLISH' AND status='READY'
        """, (execution.run_id, kind)).fetchone()
    if row is None or row[0] is None:
        return None
    document = row[0]
    if (document.get("run_id") != str(execution.run_id)
            or document.get("model_kind") != kind
            or document.get("model_version") != versions[0]
            or document.get("feature_version") != versions[1]):
        raise ProtocolError("Stored input artifact identity mismatch")
    for _, relative, size, digest in artifact_files(document):
        path = (root / relative).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ProtocolError("Stored input artifact missing")
        if path.stat().st_size != size or _digest(path) != digest:
            raise ProtocolError("Stored input artifact changed")
    return document


def _initialize(connection, execution, versions):
    with connection.transaction():
        _lock(connection, execution)
        first = connection.execute("SELECT NOT EXISTS(SELECT 1 FROM analysis.model_tasks WHERE run_id=%s)",
                                   (execution.run_id,)).fetchone()[0]
        recommended = getattr(registry.require(*versions["BINARY"]).spec, "RECOMMENDED_THRESHOLD", None)
        if first and recommended is not None:
            # The suspicious threshold follows the bound binary model (user decision, 2026-10-17).
            connection.execute("UPDATE analysis.jobs SET threshold_value=%s WHERE job_id=%s",
                               (recommended, execution.job_id))
        for kind in MODEL_KINDS:
            binding = dict(mode="demo", model_version=versions[kind][0],
                           feature_version=versions[kind][1], input_contract_version=1)
            connection.execute("""
                INSERT INTO analysis.model_tasks(run_id,model_kind,phase,status,binding)
                VALUES(%s,%s,'PREPARE','READY',%s::jsonb) ON CONFLICT DO NOTHING
                """, (execution.run_id, kind, json.dumps(binding)))
            stored = connection.execute("""
                SELECT binding FROM analysis.model_tasks WHERE run_id=%s AND model_kind=%s
                """, (execution.run_id, kind)).fetchone()[0]
            if stored != binding:
                raise ProtocolError("Model binding changed within a run")


def _claim(connection, execution, kind, stage="FEATURES"):
    token = uuid.uuid4()
    with connection.transaction():
        _lock(connection, execution, stage)
        # Only a new, fenced parent execution can recover an abandoned preparation.
        # Two processes with the same parent token may not steal each other's work.
        changed = connection.execute("""
            UPDATE analysis.model_tasks SET status='ACTIVE',execution_id=%s,
              execution_owner=%s,operation_attempts=operation_attempts+1,updated_at=now(),
              error_code=null,action_required=false
            WHERE run_id=%s AND model_kind=%s AND phase='PREPARE'
              AND (status IN ('READY','FAILED','RETRY_WAIT') OR (status='ACTIVE' AND execution_owner<>%s))
            """, (token, execution.execution_id, execution.run_id, kind,
                  execution.execution_id)).rowcount
        if changed != 1:
            raise StaleExecution("Model preparation is already owned or fenced")
    return token


def _record_failure(connection, execution, kind, token, stage="FEATURES"):
    try:
        with connection.transaction():
            _lock(connection, execution, stage)
            connection.execute("""
                UPDATE analysis.model_tasks SET status='FAILED',execution_id=null,
                  execution_owner=null,error_code='PREPARE_FAILED',updated_at=now(),
                  consecutive_failures=consecutive_failures+1
                WHERE run_id=%s AND model_kind=%s AND status='ACTIVE' AND execution_id=%s
                """, (execution.run_id, kind, token))
    except Exception:
        # Preserve the original failure. A lost DB or cancelled run cannot accept
        # this observation; an abandoned ACTIVE token is fenced by the next claim.
        pass


def _record_unclaimed_failure(connection, execution, kind, stage="INFERENCE"):
    """A failure before the task was claimed (reading the binary result): fail it visibly."""
    try:
        with connection.transaction():
            _lock(connection, execution, stage)
            connection.execute("""
                UPDATE analysis.model_tasks SET status='FAILED',error_code='PREPARE_FAILED',updated_at=now(),
                  consecutive_failures=consecutive_failures+1
                WHERE run_id=%s AND model_kind=%s AND phase='PREPARE' AND status IN ('READY','RETRY_WAIT')
                """, (execution.run_id, kind))
    except Exception:
        pass  # Preserve the original failure, as _record_failure does.


def _stage_features(connection, path):
    # Stage bounded batches on this connection without holding application row locks.
    connection.execute("""CREATE TEMP TABLE IF NOT EXISTS prepared_features(
        tx_id bigint PRIMARY KEY, features jsonb NOT NULL)""")
    connection.execute("TRUNCATE prepared_features")
    with connection.cursor() as cursor:
        with cursor.copy("COPY prepared_features(tx_id,features) FROM STDIN") as copy:
            for batch in pq.ParquetFile(path).iter_batches(batch_size=4096):
                for row in batch.to_pylist():
                    copy.write_row((row["tx_id"], json.dumps({k: v for k, v in row.items() if k != "tx_id"})))


def _save_prepared(connection, execution, kind, token, document, stage="FEATURES"):
    with connection.transaction():
        _lock(connection, execution, stage)
        changed = connection.execute("""
            UPDATE analysis.model_tasks SET phase='PUBLISH',status='READY',input_artifact=%s::jsonb,
              execution_id=null,execution_owner=null,consecutive_failures=0,updated_at=now()
            WHERE run_id=%s AND model_kind=%s AND phase='PREPARE' AND status='ACTIVE'
              AND execution_id=%s AND execution_owner=%s
            """, (json.dumps(document), execution.run_id, kind, token,
                  execution.execution_id)).rowcount
        if changed != 1:
            raise StaleExecution("Model preparation token changed")
        connection.execute("""
            INSERT INTO analysis.features(run_id,tx_id,model_kind,feature_version,features)
            SELECT %s,tx_id,%s,%s,features FROM prepared_features
            ON CONFLICT(run_id,tx_id,model_kind) DO UPDATE SET
              feature_version=excluded.feature_version,features=excluded.features
            """, (execution.run_id, kind, document["feature_version"]))


def _prepare_model(connection, execution, root, kind, versions, *, stage="FEATURES", full=False, source=None):
    source = source or FrozenInput(connection, execution, stage=stage)
    source.check_current()
    artifact = _existing(connection, execution, root, kind, versions)
    if artifact is None:
        replica = replica_plan(connection, execution, full=full)
        token = _claim(connection, execution, kind, stage)
        relative = Path("runs") / str(execution.run_id) / kind / str(token) / "targets.parquet"
        output = root / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".partial", delete=False) as stream:
                temporary = Path(stream.name)
                count = registry.require(*versions).build_input.write_input(source, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, output)
            temporary = None
            write_materials(source, output.parent, replica=replica)
            files = []
            for name in ("targets", *(MATERIALS if replica is None else REPLICA_MATERIALS)):
                path = output.with_name(name + ".parquet")
                files.append(dict(name=name, path=relative.with_name(path.name).as_posix(),
                                  size_bytes=path.stat().st_size, sha256=_digest(path)))
            artifact = dict(protocol_version=2 if replica is None else 3, run_id=str(execution.run_id),
                            model_kind=kind, model_version=versions[0], feature_version=versions[1],
                            files=files, row_count=count, **({} if replica is None else dict(replica=replica)))
            _stage_features(connection, output)
            _save_prepared(connection, execution, kind, token, artifact, stage)
        except Exception:
            _record_failure(connection, execution, kind, token, stage)
            raise
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    return artifact


class _SuspiciousTargets:
    """The frozen input seen through the binary result: only suspicious TARGET IDs."""

    def __init__(self, source, ids, batch_size=4096):
        self._source, self._ids, self._batch_size = source, ids, batch_size
        self.connection, self.execution = source.connection, source.execution

    def target_pages(self):
        for start in range(0, len(self._ids), self._batch_size):
            yield self._ids[start:start + self._batch_size]

    def check_current(self):
        self._source.check_current()


def _suspicious_ids(connection, execution, storage_root, s3, bucket):
    """TARGET IDs whose collected binary score reaches the job's threshold_value, ascending."""
    from scores.result_collection import load_collected
    load_collected(connection, execution, 'BINARY', storage_root, s3, bucket, 'INFERENCE')
    # Same comparison as the suspicious count in SCORES (p_laundering>=threshold_value).
    return [row[0] for row in connection.execute("""
        SELECT b.tx_id FROM collected_binary b JOIN analysis.jobs j ON j.job_id=%s
        WHERE b.p_laundering>=j.threshold_value ORDER BY b.tx_id""", (execution.job_id,)).fetchall()]


# Result of a type task that had no suspicious TARGET to judge.
EMPTY_RESULT = {"status": "NO_SUSPICIOUS_TARGET", "row_count": 0}


def _complete_without_suspicious(connection, execution, kind):
    """No suspicious TARGET: the type model has nothing to judge, so no request is sent."""
    with connection.transaction():
        _lock(connection, execution, "INFERENCE")
        changed = connection.execute("""
            UPDATE analysis.model_tasks SET phase='DONE',status='SUCCEEDED',input_artifact=null,
              result_artifact=%s::jsonb,execution_id=null,execution_owner=null,consecutive_failures=0,
              error_code=null,action_required=false,retry_at=null,next_poll_at=null,
              finished_at=now(),updated_at=now()
            WHERE run_id=%s AND model_kind=%s AND phase='PREPARE' AND status IN ('READY','RETRY_WAIT')
            """, (json.dumps(EMPTY_RESULT), execution.run_id, kind)).rowcount
        if changed != 1:
            raise StaleExecution("Model preparation is already owned or fenced")


def prepare_type(connection, execution, storage_root, s3, bucket, *, full=False):
    """⑥ 모델 추론 (INFERENCE): prepare the type model from the collected binary result.

    Returns the input artifact, or None when no TARGET is suspicious (the task is then done
    without a request). full=True resends the whole frozen input after REPLICA_MISMATCH.
    """
    versions = versions_for_run(connection, execution)["TYPE"]
    source = FrozenInput(connection, execution, stage="INFERENCE")
    try:
        ids = _suspicious_ids(connection, execution, storage_root, s3, bucket)
    except StaleExecution:
        raise
    except Exception:
        _record_unclaimed_failure(connection, execution, "TYPE")
        raise
    if not ids:
        _complete_without_suspicious(connection, execution, "TYPE")
        return None
    return _prepare_model(connection, execution, Path(storage_root).resolve(), "TYPE", versions,
                          stage="INFERENCE", full=full, source=_SuspiciousTargets(source, ids))


def prepare_full_again(connection, execution, storage_root, kind):
    """⑥ 모델 추론 (INFERENCE): prepare one model again with its whole frozen input.

    Used when the inference server's ledger copy was not at the delta's base position
    (REPLICA_MISMATCH); the task was reset to PREPARE for a new round.
    """
    versions = versions_for_run(connection, execution)[kind]
    return _prepare_model(connection, execution, Path(storage_root).resolve(), kind, versions,
                          stage="INFERENCE", full=True)


def run(connection, execution, context):
    """Stage entry: ⑤ 모델 입력 준비 (FEATURES)."""
    prepare_features(connection, execution, context.storage_dir)


def prepare_features(connection, execution, storage_root):
    """Persist the binary model's input and feature rows before inference.

    Both model tasks are created here; the type task stays in PREPARE until the binary
    result is collected (prepare_type). Files are retained after an uncertain commit and
    checked on reuse.
    """
    root = Path(storage_root).resolve()
    FrozenInput(connection, execution).check_current()
    versions = versions_for_run(connection, execution)
    _initialize(connection, execution, versions)
    models = {"BINARY": _prepare_model(connection, execution, root, "BINARY", versions["BINARY"])}
    artifact = json.dumps(dict(protocol_version=2, run_id=str(execution.run_id), models=models),
                          sort_keys=True, separators=(",", ":"))
    with connection.transaction():
        _lock(connection, execution)
        connection.execute("""
            INSERT INTO analysis.stage_results(job_id,run_id,stage,execution_id,artifact,completed)
            VALUES(%s,%s,'FEATURES',%s,%s,true)
            ON CONFLICT(job_id,stage) DO UPDATE SET
              run_id=excluded.run_id,execution_id=excluded.execution_id,artifact=excluded.artifact,completed=true
            """, (execution.job_id, execution.run_id, execution.execution_id, artifact))
    return artifact
