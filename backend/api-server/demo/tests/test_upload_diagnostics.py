import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_panel import Controls, Replay, upload_failure


class UploadDiagnosticsTests(unittest.TestCase):
    def test_prepare_failure_keeps_date_and_stage_without_disclosing_exception(self):
        controls = Mock()
        controls.prepare_day.side_effect = KeyError('secret-token')
        replay = Replay(controls)
        try:
            replay.start(['2023-08-31'], {'2023-08-31': [(10, Path('file.csv'))]})
            replay.future.result(timeout=5)
            state = replay.snapshot()
            self.assertEqual(state['currentDay'], '2023-08-31')
            self.assertIn('업무 시각 준비 실패 (KeyError)', state['error'])
            self.assertNotIn('secret', state['error'])
            controls.upload.assert_not_called()
            controls.post.assert_not_called()
        finally:
            replay.close()

    def http_error(self, status, body):
        return HTTPError('https://secret-url?token=secret', status, 'secret', {},
                         io.BytesIO(json.dumps(body).encode()))

    def test_first_bank_registration_error_keeps_bank_and_stage_without_starting_analysis(self):
        controls = Controls('http://localhost:8080')
        controls.prepare_day = Mock()
        controls.post = Mock()
        mock = Mock()
        mock.inspect_file.return_value = (10, 'checksum')
        mock.request_upload.side_effect = self.http_error(403, {'code': 'REPORTING_NOT_REGISTERED', 'detail': 'secret'})
        replay = Replay(controls)
        try:
            with patch('control_panel.bank_module', return_value=mock), patch('control_panel.build_opener'):
                replay.start(['2023-08-31'], {'2023-08-31': [(10, Path('file.csv'))]})
                replay.future.result(timeout=5)
            state = replay.snapshot()
            self.assertEqual(state['bankId'], 10)
            self.assertIsNone(state['uploadId'])
            self.assertEqual(state['fileDone'], 0)
            self.assertIn('업로드 URL 발급', state['error'])
            self.assertIn('HTTP 403 · REPORTING_NOT_REGISTERED', state['error'])
            self.assertNotIn('secret', state['error'])
            controls.post.assert_not_called()
            mock.upload_file.assert_not_called()
        finally:
            replay.close()

    def test_s3_failure_keeps_issued_id_and_does_not_notify_completion(self):
        controls = Controls('http://localhost:8080')
        controls.prepare_day = Mock()
        mock = Mock()
        mock.inspect_file.return_value = (10, 'checksum')
        mock.request_upload.return_value = {'uploadId': 87}
        mock.upload_file.side_effect = self.http_error(403, {'code': 'AccessDenied', 'detail': 'secret'})
        replay = Replay(controls)
        try:
            with patch('control_panel.bank_module', return_value=mock), patch('control_panel.build_opener'):
                replay.start(['2023-08-31'], {'2023-08-31': [(12, Path('file.csv'))]})
                replay.future.result(timeout=5)
            state = replay.snapshot()
            self.assertEqual(state['uploadId'], 87)
            self.assertIn('S3 전송 실패', state['error'])
            self.assertNotIn('secret', state['error'])
            mock.request_status.assert_not_called()
        finally:
            replay.close()

    def test_redirect_unknown_html_and_timeout_are_safe(self):
        for error in [self.http_error(302, {'detail': 'secret'}),
                      self.http_error(500, {'code': ['secret']}),
                      HTTPError('https://secret', 403, 'secret', {}, io.BytesIO(b'<html>secret</html>')),
                      URLError('secret'), ValueError('secret')]:
            result = str(upload_failure(error, 12, '업로드 URL 발급'))
            self.assertIn('은행 12', result)
            self.assertIn('업로드 URL 발급', result)
            self.assertNotIn('secret', result)

    def test_missing_file_is_local_failure(self):
        controls = Controls('http://localhost:8080')
        report = Mock()
        mock = Mock()
        mock.inspect_file.side_effect = FileNotFoundError('secret-path')
        with patch('control_panel.bank_module', return_value=mock), patch('control_panel.build_opener'):
            with self.assertRaisesRegex(Exception, '파일 확인 실패') as error:
                controls.upload('2023-08-31', 12, Path('missing.csv'), report)
        self.assertNotIn('secret', str(error.exception))
        mock.request_upload.assert_not_called()
