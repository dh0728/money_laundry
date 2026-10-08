"""Publication baseline conflict regressions for the flow pipeline."""
import unittest
from unittest.mock import Mock
from alert_pipeline import _validate_baselines
from frozen_input import StaleExecution
from worker_transport import ProtocolError


class AlertBaselineTests(unittest.TestCase):
    def test_baseline_conflicts_preserve_origin_and_error_priority(self):
        for unpublished, changed, expected in ((None, None, None), (1, None, StaleExecution),
                (None, 2, ProtocolError), (1, 2, StaleExecution), (2, 1, ProtocolError),
                (2, 2, StaleExecution)):
            connection = Mock()
            connection.execute.return_value.fetchone.side_effect = [(unpublished,), (changed,)]
            if expected is None:
                _validate_baselines(connection, 'run')
            else:
                with self.assertRaises(expected):
                    _validate_baselines(connection, 'run')
            self.assertEqual(connection.execute.call_count, 2)


if __name__ == '__main__':
    unittest.main()
