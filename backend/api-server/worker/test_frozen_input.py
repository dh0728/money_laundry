import io
import unittest
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pyarrow.parquet as pq

from frozen_input import FrozenInput, InputExecution, StaleExecution, write_demo_input
from worker_transport import ProtocolError


class FrozenInputTests(unittest.TestCase):
    def setUp(self):
        self.execution = InputExecution(7, uuid4(), uuid4())
        self.connection = MagicMock(autocommit=True)
        self.cursor = self.connection.cursor.return_value.__enter__.return_value

    def row(self, tx_id=None, **changes):
        fields = dict(token=self.execution.execution_id, status="RUNNING",
                      stage="FEATURES", run=self.execution.run_id, run_status="READY")
        fields.update(changes)
        return (*fields.values(), tx_id)

    def test_paged_input_writes_only_demo_columns(self):
        self.cursor.fetchall.side_effect = [
            [self.row(1), self.row(99)], [self.row(100)], [self.row()]]
        self.cursor.fetchone.return_value = self.row()[:5]
        output = io.BytesIO()
        self.assertEqual(write_demo_input(
            FrozenInput(self.connection, self.execution, batch_size=2), output), 3)
        table = pq.read_table(io.BytesIO(output.getvalue()))
        self.assertEqual(table.to_pydict(), {"tx_id": [1, 99, 100], "demo_value": [1, 99, 0]})
        calls = self.cursor.execute.call_args_list
        self.assertEqual([call.args[1][1] for call in calls[:3]], [0, 99, 100])
        self.connection.commit.assert_not_called()

    def test_cancel_between_batches_aborts_generation(self):
        self.cursor.fetchall.side_effect = [[self.row(1)],
                                            [self.row(2, run_status="CANCEL_REQUESTED")]]
        with self.assertRaises(StaleExecution):
            write_demo_input(FrozenInput(self.connection, self.execution), io.BytesIO())

    def test_cancel_after_serialization_is_not_reported_as_success(self):
        self.cursor.fetchall.side_effect = [[self.row(1)], [self.row()]]
        self.cursor.fetchone.return_value = self.row(run_status="CANCELLED")[:5]
        with self.assertRaises(StaleExecution):
            write_demo_input(FrozenInput(self.connection, self.execution), io.BytesIO())

    def test_stale_run_token_stage_or_job_rejected(self):
        for changes in (dict(token=uuid4()), dict(run=uuid4()), dict(stage="INFERENCE"),
                        dict(status="QUEUED"), dict(run_status="COMPLETED"),
                        dict(run_status=None)):
            with self.subTest(changes=changes):
                self.cursor.fetchall.return_value = [self.row(1, **changes)]
                with self.assertRaises(StaleExecution):
                    list(FrozenInput(self.connection, self.execution).batches())
        self.cursor.fetchall.return_value = []
        with self.assertRaises(StaleExecution):
            list(FrozenInput(self.connection, self.execution).batches())

    def test_empty_input_never_becomes_inference_file(self):
        self.cursor.fetchall.return_value = [self.row()]
        output = io.BytesIO()
        with self.assertRaisesRegex(ProtocolError, "EMPTY_INPUT"):
            write_demo_input(FrozenInput(self.connection, self.execution), output)
        self.assertEqual(output.getvalue(), b"")

    def test_autocommit_and_batch_bounds(self):
        self.connection.autocommit = False
        with self.assertRaises(ProtocolError):
            FrozenInput(self.connection, self.execution)
        self.connection.autocommit = True
        for size in (0, -1, True, 65537):
            with self.subTest(size=size), self.assertRaises(ProtocolError):
                FrozenInput(self.connection, self.execution, batch_size=size)

    def test_invalid_or_repeated_pagination_ids_rejected(self):
        for rows in ([self.row(1), self.row(1)], [self.row(2), self.row(1)], [self.row(0)]):
            self.cursor.fetchall.return_value = rows
            with self.assertRaises(ProtocolError):
                list(FrozenInput(self.connection, self.execution).batches())

    def test_invalid_execution_identity_rejected(self):
        for job in (True, 0, -1, 2**63):
            with self.assertRaises(ProtocolError):
                InputExecution(job, uuid4(), uuid4())
        with self.assertRaises(ProtocolError):
            InputExecution(1, "not-a-uuid", UUID(int=1))


if __name__ == "__main__":
    unittest.main()
