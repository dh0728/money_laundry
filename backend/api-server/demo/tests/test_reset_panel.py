import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_client import ApiError
from control_panel import Replay
import operator_session


class ResetPanelTests(unittest.TestCase):
    def test_reset_clears_sent_jobs_and_history_only_after_success(self):
        controls = Mock()
        replay = Replay(controls)
        replay.sent.add(('day', 12, 'file'))
        replay.jobs['day'] = 10
        replay.completed.add('day')
        try:
            controls.post.side_effect = ApiError('busy', 409)
            with self.assertRaises(ApiError):
                replay.reset_demo({})
            self.assertEqual(replay.jobs, {'day': 10})
            controls.post.side_effect = None
            controls.post.return_value = {'resetId': 'reset-1', 'status': 'FILES_PENDING'}
            replay.reset_demo({})
            self.assertFalse(replay.sent)
            self.assertFalse(replay.jobs)
            self.assertFalse(replay.completed)
            replay.jobs['new-day'] = 11
            replay.clear_after_reset('reset-1')
            self.assertEqual(replay.jobs, {'new-day': 11})
        finally:
            replay.close()

    def test_reset_blocked_during_replay(self):
        entered, release = threading.Event(), threading.Event()
        controls = Mock()
        controls.prepare_day.side_effect = lambda _: (entered.set(), release.wait(5))
        replay = Replay(controls)
        try:
            replay.start(['day'], {'day': []}, analyze=False)
            self.assertTrue(entered.wait(3))
            with self.assertRaises(ApiError):
                replay.reset_demo({})
            controls.post.assert_not_called()
        finally:
            release.set()
            replay.future.result(timeout=5)
            replay.close()

    def test_ui_requires_preview_confirmation_then_cleans_files(self):
        from streamlit.testing.v1 import AppTest
        controls = Mock(base='https://dev.example')
        current = {'status': 'NONE'}
        clock = {'businessAt': '2023-09-02T09:00:00+09:00', 'configured': True, 'revision': 2}
        def get(path):
            if path == 'demo/reset/latest':
                return dict(current)
            if path == 'demo/reset/preview':
                return {'counts': {'transactions': 12}, 'snapshot': 'snapshot'}
            return clock
        def post(path, payload=None):
            if path == 'demo/reset':
                self.assertEqual(payload['confirmation'], '시연 데이터 초기화')
                self.assertEqual(payload['snapshot'], 'snapshot')
                current.update(resetId='reset-1', status='FILES_PENDING', totalTargets=1, remainingTargets=1)
            else:
                self.assertEqual(path, 'demo/reset/reset-1/cleanup')
                current.update(status='COMPLETED', remainingTargets=0)
            return dict(current)
        controls.get.side_effect = get
        controls.post.side_effect = post
        replay = Replay(controls)
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root) / '2023-09-01'
            folder.mkdir()
            (folder / 'bank_12.csv').write_text('header')
            runtime = SimpleNamespace(base=controls.base, root=root, replay=replay)
            try:
                with patch.object(operator_session, 'runtime', runtime):
                    app = AppTest.from_file(str(Path(__file__).resolve().parents[1] / 'control_panel.py')).run(timeout=15)
                    controls.post.assert_not_called()
                    next(b for b in app.button if b.label == '초기화 대상 확인').click().run()
                    self.assertTrue(next(b for b in app.button if b.label == 'DB 및 관련 파일 초기화').disabled)
                    app.text_input(key='reset_confirmation').set_value('시연 데이터 초기화').run()
                    next(b for b in app.button if b.label == 'DB 및 관련 파일 초기화').click().run()
                    self.assertFalse(app.exception)
                    self.assertFalse(app.error)
                    self.assertEqual(current['status'], 'COMPLETED')
                    self.assertEqual(controls.post.call_count, 2)
                    self.assertTrue(any('초기화 완료' in x.value for x in app.success))
            finally:
                replay.close()

    def test_file_failure_is_not_reported_as_complete_and_blocks_replay(self):
        from streamlit.testing.v1 import AppTest
        controls = Mock(base='https://dev.example')
        def get(path):
            if path == 'demo/reset/latest':
                return {'resetId': 'reset-1', 'status': 'FILES_FAILED', 'totalTargets': 2, 'remainingTargets': 1}
            return {'businessAt': '2023-09-02T09:00:00+09:00', 'configured': False, 'revision': 2}
        controls.get.side_effect = get
        replay = Replay(controls)
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root) / '2023-09-01'
            folder.mkdir()
            (folder / 'bank_12.csv').write_text('header')
            try:
                with patch.object(operator_session, 'runtime', SimpleNamespace(base=controls.base, root=root, replay=replay)):
                    app = AppTest.from_file(str(Path(__file__).resolve().parents[1] / 'control_panel.py')).run(timeout=15)
                    self.assertFalse(app.exception)
                    self.assertTrue(any('파일 정리 실패' in x.value for x in app.error))
                    self.assertFalse(app.success)
                    self.assertTrue(next(b for b in app.button if b.label == '전송 → 분석 자동 재생').disabled)
                    controls.post.assert_not_called()
            finally:
                replay.close()
