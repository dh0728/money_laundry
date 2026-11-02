import unittest

from models.demo_random.spec import FEATURE_VERSION, MODEL_VERSION
from models.demo_random.build_input import build_targets
from common.worker_transport import ProtocolError


class DemoInputTests(unittest.TestCase):
    def test_targets_schema_matches_inference_demo_model(self):
        targets = build_targets([100, 99, 1, 2**63 - 1])
        self.assertEqual(targets.column_names, ["tx_id", "demo_value"])
        self.assertEqual(targets.column("tx_id").to_pylist(), [1, 99, 100, 2**63 - 1])
        self.assertEqual(targets.column("demo_value").to_pylist(), [1, 99, 0, 7])

    def test_new_run_does_not_query_legacy_hints(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        from features.prepare_features import versions_for_run
        connection = Mock()
        connection.execute.return_value.fetchall.return_value = []
        self.assertEqual(versions_for_run(connection, SimpleNamespace(run_id='run')),
                         {'BINARY': ('gnn-binary-v10', 'materials-v1'), 'TYPE': (MODEL_VERSION, FEATURE_VERSION)})
        self.assertEqual(connection.execute.call_count, 1)
        self.assertNotIn('demo_report_hints', connection.execute.call_args.args[0])
        connection.execute.return_value.fetchall.return_value = [
            ('BINARY', {'model_version': 'demo-labels-v2', 'feature_version': 'demo-label-input-v1'}),
            ('TYPE', {'model_version': 'demo-labels-v2', 'feature_version': 'demo-label-input-v1'})]
        with self.assertRaises(ProtocolError):
            versions_for_run(connection, SimpleNamespace(run_id='run'))

    def test_empty_duplicate_and_invalid_targets_rejected(self):
        for ids in ([], [1, 1], [None], [True], [1.0], [0], [-1], [2**63]):
            with self.subTest(ids=ids), self.assertRaises(ProtocolError):
                build_targets(ids)


if __name__ == "__main__":
    unittest.main()