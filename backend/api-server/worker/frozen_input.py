"""Read the V4 frozen TARGET snapshot for one claimed FEATURES execution.

The caller owns the PostgreSQL connection and output stream. No stage completion
or external publication occurs here; a cancelled read must discard its output.
"""
from dataclasses import dataclass
from uuid import UUID

import pyarrow.parquet as pq

from demo_calculator import build_targets
from worker_transport import ProtocolError


class StaleExecution(ProtocolError):
    pass


@dataclass(frozen=True)
class InputExecution:
    job_id: int
    run_id: UUID
    execution_id: UUID

    def __post_init__(self):
        if type(self.job_id) is not int or not 0 < self.job_id <= 2**63 - 1:
            raise ProtocolError("Invalid job ID")
        if not isinstance(self.run_id, UUID) or not isinstance(self.execution_id, UUID):
            raise ProtocolError("Run and execution UUIDs are required")


class FrozenInput:
    def __init__(self, connection, execution: InputExecution, *, batch_size=4096):
        # Each query sees current cancellation state; no long-running transaction
        # or snapshot is held while Arrow computes/serializes a batch.
        if connection.autocommit is not True:
            raise ProtocolError("Frozen input requires an autocommit connection")
        if type(batch_size) is not int or not 1 <= batch_size <= 65536:
            raise ProtocolError("Invalid input batch size")
        self.connection = connection
        self.execution = execution
        self.batch_size = batch_size

    def _check(self, row):
        token, status, stage, run, run_status = row[:5]
        if (str(token) != str(self.execution.execution_id) or status != "RUNNING"
                or stage != "FEATURES" or str(run) != str(self.execution.run_id)
                or run_status not in ("READY", "ACTIVE")):
            raise StaleExecution("Execution is no longer the active FEATURES owner")

    def _page(self, after):
        # LEFT JOIN preserves the ownership row even for an empty/end page.
        # All fields are observed in a single PostgreSQL statement snapshot.
        with self.connection.cursor() as cursor:
            cursor.execute("""
                SELECT b.execution_id, b.status, b.current_stage, b.current_run_id,
                       r.status, i.tx_id
                FROM batch_jobs b
                LEFT JOIN analysis_runs r ON r.run_id = b.current_run_id
                LEFT JOIN LATERAL (
                    SELECT tx_id FROM analysis.input_transactions
                    WHERE run_id = %s AND input_role = 'TARGET' AND tx_id > %s
                    ORDER BY tx_id LIMIT %s
                ) i ON true
                WHERE b.job_id = %s
                ORDER BY i.tx_id
                """, (str(self.execution.run_id), after, self.batch_size,
                      self.execution.job_id))
            rows = cursor.fetchall()
        if not rows:
            raise StaleExecution("Analysis job no longer exists")
        for row in rows:
            self._check(row)
        ids = [row[5] for row in rows if row[5] is not None]
        if any(type(value) is not int or value <= after for value in ids):
            raise ProtocolError("Invalid frozen TARGET ordering")
        if ids != sorted(set(ids)):
            raise ProtocolError("Duplicate or unordered frozen TARGET IDs")
        return ids

    def check_current(self):
        with self.connection.cursor() as cursor:
            cursor.execute("""
                SELECT b.execution_id, b.status, b.current_stage, b.current_run_id,
                       r.status
                FROM batch_jobs b
                LEFT JOIN analysis_runs r ON r.run_id = b.current_run_id
                WHERE b.job_id = %s
                """, (self.execution.job_id,))
            row = cursor.fetchone()
        if row is None:
            raise StaleExecution("Analysis job no longer exists")
        self._check(row)

    def batches(self):
        after = 0
        while True:
            ids = self._page(after)
            if not ids:
                return
            yield build_targets(ids)
            after = ids[-1]


def write_demo_input(source: FrozenInput, output) -> int:
    """Write targets.parquet to a caller-owned stream; return the TARGET count.

    Success is not permission to publish: the caller must recheck ownership when
    recording artifacts. Any exception invalidates the entire output stream.
    """
    batches = iter(source.batches())
    first = next(batches, None)
    if first is None:
        raise ProtocolError("Empty TARGET must complete as EMPTY_INPUT without inference")
    count = first.num_rows
    with pq.ParquetWriter(output, first.schema) as writer:
        writer.write_table(first)
        for batch in batches:
            writer.write_table(batch)
            count += batch.num_rows
    source.check_current()
    return count
