import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_client import ApiClient, ApiError
from control_panel import Replay


class PollRecoveryTests(unittest.TestCase):
    def test_transient_get_errors_are_distinct_from_auth_and_bad_responses(self):
        for status, retryable in [(502, True), (503, True), (504, True), (524, True),
                                  (401, False), (403, False), (404, False), (500, False)]:
            client = ApiClient('https://test.example', transport=httpx.MockTransport(
                lambda request: httpx.Response(status, json={})))
            with self.assertRaises(ApiError) as caught:
                client.get('batch-jobs/63')
            self.assertEqual(caught.exception.retryable, retryable)
        for error in (httpx.ReadTimeout('secret'), httpx.ConnectError('secret')):
            def fail(request):
                raise error
            client = ApiClient('https://test.example', transport=httpx.MockTransport(fail))
            with self.assertRaises(ApiError) as caught:
                client.get('batch-jobs/63')
            self.assertTrue(caught.exception.retryable)
            self.assertNotIn('secret', str(caught.exception))

    def test_timeout_then_completion_continues_next_day_without_duplicate_post(self):
        controls = Mock()
        controls.post.side_effect = [{'jobId': 63}, {'jobId': 74}]
        controls.get.side_effect = [
            {'status': 'RUNNING', 'currentStage': 'FREEZE_INPUT'},
            ApiError('timeout', retryable=True), ApiError('gateway', retryable=True),
            {'status': 'COMPLETED'}, {'status': 'COMPLETED'}]
        replay = Replay(controls)
        messages = []
        try:
            with patch('control_panel.time.sleep', side_effect=lambda _: messages.append(replay.snapshot())):
                replay.start(['d1', 'd2'], {'d1': [(7, Path('a'))], 'd2': [(8, Path('b'))]})
                replay.future.result(timeout=5)
            self.assertIsNone(replay.snapshot()['error'])
            self.assertEqual(replay.snapshot()['doneDays'], 2)
            self.assertEqual(controls.post.call_count, 2)
            self.assertEqual(controls.upload.call_count, 2)
            self.assertEqual([c.args[0] for c in controls.get.call_args_list], ['batch-jobs/63'] * 4 + ['batch-jobs/74'])
            waiting = [s for s in messages if '확인 대기' in s['message']]
            self.assertEqual(len(waiting), 2)
            self.assertIn('FREEZE_INPUT', waiting[0]['message'])
            self.assertIsNone(waiting[0]['bankId'])
        finally:
            replay.close()

    def test_auth_failure_stops_and_never_starts_next_day(self):
        controls = Mock()
        controls.post.return_value = {'jobId': 63}
        controls.get.side_effect = ApiError('인증 만료', 401)
        replay = Replay(controls)
        try:
            replay.start(['d1', 'd2'], {'d1': [], 'd2': []})
            replay.future.result(timeout=5)
            self.assertEqual(controls.post.call_count, 1)
            self.assertEqual(replay.snapshot()['error'], '인증 만료')
        finally:
            replay.close()

    def test_outage_respects_existing_observation_deadline(self):
        controls = Mock()
        controls.get.side_effect = ApiError('timeout', retryable=True)
        replay = Replay(controls)
        try:
            with patch('control_panel.time.monotonic', side_effect=[0, 1, 3599, 3601]), patch('control_panel.time.sleep'):
                with self.assertRaisesRegex(ApiError, '관찰 시간 초과'):
                    replay.wait_job(63, 'd1')
            controls.post.assert_not_called()
        finally:
            replay.close()
