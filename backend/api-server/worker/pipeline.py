"""Backend worker operations. Only persisted, fenced artifacts count as complete."""
import hashlib
import json
import os
from pathlib import Path
import tempfile

from demo_calculator import FEATURE_VERSION, MODEL_VERSION
from frozen_input import FrozenInput, write_demo_input
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


def _existing(connection, execution, root):
    row = connection.execute("""
        SELECT artifact FROM analysis_run_stage_results
        WHERE run_id=%s AND stage='FEATURES' AND completed
        """, (execution.run_id,)).fetchone()
    if row is None:
        return None
    document = json.loads(row[0])
    if (document.get("run_id") != str(execution.run_id)
            or document.get("model_version") != MODEL_VERSION
            or document.get("feature_version") != FEATURE_VERSION):
        raise ProtocolError("Stored input artifact identity mismatch")
    path = (root / document["path"]).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ProtocolError("Stored input artifact missing")
    if path.stat().st_size != document["size_bytes"] or _digest(path) != document["sha256"]:
        raise ProtocolError("Stored input artifact changed")
    return row[0]


def prepare_features(connection, execution, storage_root):
    """Create/reuse immutable demo input and commit its FEATURES checkpoint.

    Input is retained after uncertain DB failure so a valid checkpoint never
    points to a file deleted by error cleanup. No network or GPU call occurs here.
    """
    root = Path(storage_root).resolve()
    source = FrozenInput(connection, execution)
    source.check_current()
    artifact = _existing(connection, execution, root)
    if artifact is None:
        relative = Path("runs") / str(execution.run_id) / str(execution.execution_id) / "targets.parquet"
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
            artifact = json.dumps(dict(protocol_version=1, run_id=str(execution.run_id),
                                       model_version=MODEL_VERSION, feature_version=FEATURE_VERSION,
                                       path=relative.as_posix(), size_bytes=size, sha256=digest,
                                       row_count=count), sort_keys=True, separators=(",", ":"))
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    with connection.transaction():
        _lock(connection, execution)
        connection.execute("""
            INSERT INTO analysis_run_stage_results(run_id,stage,execution_id,artifact,completed)
            VALUES(%s,'FEATURES',%s,%s,true)
            ON CONFLICT(run_id,stage) DO UPDATE SET
              execution_id=excluded.execution_id,artifact=excluded.artifact,completed=true
            """, (execution.run_id, execution.execution_id, artifact))
    return artifact
