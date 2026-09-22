import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_client import ApiError
from control_panel import Controls, Replay, catalog


class PanelTests(unittest.TestCase):
    def test_catalog_dates_and_bank_names(self):
        with tempfile.TemporaryDirectory() as name:
            folder = Path(name) / '2023-09-01'
            folder.mkdir()
            (folder / 'bank_12_2023-09-01.csv').write_text('header')
            self.assertEqual(catalog(name)['2023-09-01'][0][0], 12)
            (folder / 'bank_12.csv').write_text('header')
            with self.assertRaises(ValueError):
                catalog(name)

    def test_only_loopback_controls(self):
        with self.assertRaises(ValueError):
            Controls('https://remote.example')

    def test_panel_renders_controls_without_sending_any_request(self):
        from streamlit.testing.v1 import AppTest
        with tempfile.TemporaryDirectory() as name:
            folder = Path(name) / '2023-09-01'
            folder.mkdir()
            (folder / 'bank_12_2023-09-01.csv').write_text('header')
            with patch.dict('os.environ', {'AML_DEMO_DATA_DIR': name, 'AML_DEMO_API_URL': 'http://127.0.0.1:8080'}):
                with patch.object(Controls, 'post') as post, patch.object(Controls, 'upload') as upload:
                    app = AppTest.from_file(str(Path(__file__).resolve().parents[1] / 'control_panel.py')).run(timeout=15)
                    self.assertFalse(app.exception)
                    self.assertFalse(app.error)
                    self.assertIn('전송 → 분석 자동 재생', [b.label for b in app.button])
                    post.assert_not_called()
                    upload.assert_not_called()
                    actual = app.session_state.replay.controls
                    actual.upload = Mock()
                    actual.post = Mock(return_value={'jobId': 5})
                    actual.get = Mock(return_value={'status': 'COMPLETED'})
                    next(b for b in app.button if b.label == '전송 → 분석 자동 재생').click().run()
                    self.assertFalse(app.exception)
                    app.session_state.replay.future.result(timeout=10)
                    self.assertIsNone(app.session_state.replay.snapshot()['error'])
                    actual.post.assert_called_once_with('demo/analysis', {'businessDate': '2023-09-01'})
                    app.session_state.replay.close()

    def test_upload_failure_never_triggers_analysis_or_next_day(self):
        control = Mock()
        control.upload.side_effect = RuntimeError('secret-url')
        replay = Replay(control)
        try:
            replay.start(['d1', 'd2'], {'d1': [(1, Path('a'))], 'd2': [(2, Path('b'))]})
            replay.future.result(timeout=5)
            control.post.assert_not_called()
            self.assertEqual(control.upload.call_count, 1)
            self.assertNotIn('secret-url', replay.snapshot()['error'])
        finally:
            replay.close()

    def test_daily_sequence_waits_and_does_not_repeat_completed_days(self):
        control = Mock()
        control.post.side_effect = [{'jobId': 1}, {'jobId': 2}]
        control.get.side_effect = [{'status': 'RUNNING'}, {'status': 'COMPLETED'}, {'status': 'COMPLETED'}]
        replay = Replay(control)
        files = {'d1': [(1, Path('a'))], 'd2': [(2, Path('b'))]}
        try:
            with patch('control_panel.time.sleep'):
                replay.start(['d1', 'd2'], files)
                replay.future.result(timeout=5)
            replay.start(['d1', 'd2'], files)
            replay.future.result(timeout=5)
            self.assertEqual(control.post.call_count, 2)
            self.assertEqual(control.upload.call_count, 2)
            self.assertEqual([x['date'] for x in replay.snapshot()['history']], ['d1', 'd2'])
            calls = control.method_calls
            self.assertLess(calls.index(('get', ('batch-jobs/1',), {})),
                            next(i for i, x in enumerate(calls) if x[0] == 'upload' and x[1][0] == 'd2'))
        finally:
            replay.close()

    def test_failed_analysis_waits_for_explicit_resume_and_reuses_job(self):
        control = Mock()
        control.post.return_value = {'jobId': 8}
        control.get.side_effect = [{'status': 'FAILED'}, {'status': 'COMPLETED'}]
        replay = Replay(control)
        try:
            replay.start(['d1'], {'d1': []})
            replay.future.result(timeout=5)
            self.assertTrue(replay.snapshot()['error'])
            replay.start(['d1'], {'d1': []})
            replay.future.result(timeout=5)
            self.assertEqual(control.post.call_count, 1)
            self.assertEqual(replay.completed, {'d1'})
        finally:
            replay.close()

    def test_pause_finishes_current_day(self):
        control = Mock()
        replay = Replay(control)
        control.upload.side_effect = lambda *args: replay.pause.set()
        control.post.return_value = {'jobId': 1}
        control.get.return_value = {'status': 'COMPLETED'}
        try:
            replay.start(['d1', 'd2'], {'d1': [(1, Path('a'))], 'd2': [(2, Path('b'))]})
            replay.future.result(timeout=5)
            self.assertEqual(control.upload.call_count, 1)
            control.post.assert_called_once()
            self.assertEqual(replay.snapshot()['message'], '일시정지')
        finally:
            replay.close()


if __name__ == '__main__':
    unittest.main()
