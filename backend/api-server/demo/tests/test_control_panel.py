import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
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
                with patch('api_client.login_panel', return_value=(__import__('api_client').ApiClient('http://127.0.0.1:8080'), {'role':'ADMIN'})), patch.object(Controls, 'post') as post, patch.object(Controls, 'upload') as upload, patch('api_client.ApiClient.get', return_value={'businessAt': '2023-09-02T09:00:00+09:00', 'configured': True, 'revision': 1}), patch.object(Controls, 'prepare_day'):
                    app = AppTest.from_file(str(Path(__file__).resolve().parents[1] / 'control_panel.py')).run(timeout=15)
                    self.assertFalse(app.exception)
                    self.assertFalse(app.error)
                    self.assertIn('전송 → 분석 자동 재생', [b.label for b in app.button])
                    post.assert_not_called()
                    upload.assert_not_called()
                    actual = app.session_state.replay.controls
                    actual.upload = Mock()
                    actual.prepare_day = Mock()
                    actual.post = Mock(return_value={'jobId': 5})
                    actual.get = Mock(side_effect=lambda path: {'status': 'COMPLETED'} if path.startswith('batch-jobs') else {'businessAt': '2023-09-02T09:00:00+09:00', 'configured': True, 'revision': 1})
                    next(b for b in app.button if b.label == '전송 → 분석 자동 재생').click().run()
                    self.assertFalse(app.exception)
                    app.session_state.replay.future.result(timeout=10)
                    self.assertIsNone(app.session_state.replay.snapshot()['error'])
                    app.run()
                    self.assertEqual([item.value for item in app.get('progress')], [100, 100])
                    actual.post.assert_called_once_with('demo/analysis', {'businessDate': '2023-09-01'})
                    app.session_state.replay.close()

    def test_resume_form_keeps_the_typed_id_and_result_across_refreshes(self):
        from streamlit.testing.v1 import AppTest
        from api_client import ApiError
        with tempfile.TemporaryDirectory() as name:
            (Path(name) / '2023-09-01').mkdir()
            (Path(name) / '2023-09-01' / 'bank_12_2023-09-01.csv').write_text('header')
            with patch.dict('os.environ', {'AML_DEMO_DATA_DIR': name, 'AML_DEMO_API_URL': 'http://127.0.0.1:8080'}), \
                    patch('api_client.login_panel', return_value=(__import__('api_client').ApiClient('http://127.0.0.1:8080'), {'role': 'ADMIN'})), \
                    patch('api_client.ApiClient.get', return_value={'businessAt': '2023-09-02T09:00:00+09:00', 'configured': True, 'revision': 1}):
                app = AppTest.from_file(str(Path(__file__).resolve().parents[1] / 'control_panel.py')).run(timeout=15)
                # The app runs the script as its own module, so stub the panel's own instance.
                post = app.session_state.replay.controls.post = Mock(return_value={'jobId': 22, 'status': 'QUEUED'})
                resume = lambda: next(b for b in app.button if b.label == '실패 작업 재개')
                resume().click().run()
                post.assert_not_called()
                self.assertIn('작업 ID를 입력', app.error[0].value)
                next(n for n in app.number_input if n.label == '재개할 실패 작업 ID').set_value(22)
                resume().click().run()
                post.assert_called_once_with('batch-jobs/22/resume')
                app.run()  # a later refresh keeps the outcome on screen
                self.assertIn('작업 22 재개 요청을 접수', app.success[0].value)
                post.side_effect = ApiError('상태가 변경됐거나 처리 조건이 충족되지 않았습니다. (HTTP 409)', 409)
                next(n for n in app.number_input if n.label == '재개할 실패 작업 ID').set_value(23)
                resume().click().run()
                app.run()
                self.assertIn('작업 23 재개 실패', app.error[0].value)
                self.assertFalse(app.exception)
                app.session_state.replay.close()

    def test_inference_wait_is_not_shown_as_a_retry(self):
        from control_panel import describe
        waiting = {'status': 'RETRY_WAIT', 'currentStage': 'INFERENCE', 'consecutiveFailures': 0, 'models': [
            {'modelKind': 'BINARY', 'status': 'WAITING', 'remoteStatus': 'RUNNING'},
            {'modelKind': 'TYPE', 'status': 'WAITING', 'remoteStatus': 'ACCEPTED'}]}
        line = describe(waiting)
        self.assertIn('모델 추론 · 추론 결과 대기 (이진 계산 중, 유형 접수됨)', line)
        self.assertNotIn('재시도', line.split('(RETRY_WAIT')[0])
        self.assertIn('실패 후 재시도 대기 · 연속 실패 2회', describe(dict(waiting, consecutiveFailures=2)))
        self.assertIn('Alert 구성 · 실행 중', describe({'status': 'RUNNING', 'currentStage': 'ALERTS'}))
        self.assertIn('완료', describe({'status': 'COMPLETED', 'currentStage': 'COMPLETE'}))

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
            self.assertEqual(replay.snapshot()['doneDays'], 0)
            self.assertEqual(replay.snapshot()['fileDone'], 0)
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
            self.assertEqual(replay.snapshot()['doneDays'], 2)
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
            self.assertEqual(replay.snapshot()['doneDays'], 1)
            self.assertEqual(replay.snapshot()['totalDays'], 2)
        finally:
            replay.close()

    def test_progress_waits_for_analysis_and_resumes_without_double_counting(self):
        control = Mock()
        entered, release = threading.Event(), threading.Event()
        def result(_):
            entered.set()
            if not release.wait(5):
                raise TimeoutError('test gate')
            return {'status': 'FAILED'}
        control.get.side_effect = result
        control.post.return_value = {'jobId': 3}
        replay = Replay(control)
        files = {'d1': [(1, Path('a')), (2, Path('b'))]}
        try:
            replay.start(['d1'], files)
            self.assertTrue(entered.wait(5))
            state = replay.snapshot()
            self.assertEqual((state['fileDone'], state['fileTotal'], state['doneDays']), (2, 2, 0))
            release.set()
            replay.future.result(timeout=5)
            self.assertEqual(replay.snapshot()['doneDays'], 0)
            control.get.side_effect = None
            control.get.return_value = {'status': 'COMPLETED'}
            replay.start(['d1'], files)
            replay.future.result(timeout=5)
            self.assertEqual(replay.snapshot()['doneDays'], 1)
            self.assertEqual(replay.snapshot()['fileDone'], 2)
            self.assertEqual(control.upload.call_count, 2)
        finally:
            release.set()
            replay.close()


if __name__ == '__main__':
    unittest.main()
