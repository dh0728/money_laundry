import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_panel import Controls, Replay, upload_failure
from ledger_upload import UploadHttpError


class UploadDiagnosticsTests(unittest.TestCase):
    def test_prepare_failure_keeps_date_and_stage_without_disclosing_exception(self):
        controls = Mock()
        controls.prepare_day.side_effect = KeyError('secret-token')
        replay = Replay(controls)
        try:
            replay.start(['2023-08-31'], {'2023-08-31': Path('ledger_2023-08-31.csv')})
            replay.future.result(timeout=5)
            state = replay.snapshot()
            self.assertEqual(state['currentDay'], '2023-08-31')
            self.assertIn('업무 시각 준비 실패 (KeyError)', state['error'])
            self.assertNotIn('secret', state['error'])
            controls.upload.assert_not_called()
            controls.post.assert_not_called()
        finally:
            replay.close()

    def test_rejected_issue_keeps_stage_without_starting_analysis(self):
        controls = Controls('http://localhost:8080')
        controls.prepare_day = Mock()
        controls.post = Mock()
        mock = Mock()
        mock.inspect_file.return_value = (10, 'checksum')
        mock.request_upload.side_effect = UploadHttpError(409, 'DATE_ALREADY_LOADED')
        replay = Replay(controls)
        try:
            with patch('control_panel.ledger_upload', mock):
                replay.start(['2023-08-31'], {'2023-08-31': Path('ledger_2023-08-31.csv')})
                replay.future.result(timeout=5)
            state = replay.snapshot()
            self.assertIsNone(state['uploadId'])
            self.assertEqual(state['fileDone'], 0)
            self.assertIn('업로드 URL 발급', state['error'])
            self.assertIn('HTTP 409 · DATE_ALREADY_LOADED', state['error'])
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
        mock.upload_file.side_effect = UploadHttpError(403)
        replay = Replay(controls)
        try:
            with patch('control_panel.ledger_upload', mock):
                replay.start(['2023-08-31'], {'2023-08-31': Path('ledger_2023-08-31.csv')})
                replay.future.result(timeout=5)
            state = replay.snapshot()
            self.assertEqual(state['uploadId'], 87)
            self.assertIn('S3 전송 실패', state['error'])
            mock.request_status.assert_not_called()
        finally:
            replay.close()

    def test_redirect_unknown_and_transport_errors_are_safe(self):
        for error in [UploadHttpError(302), UploadHttpError(500, 'secret-code'),
                      UploadHttpError(403), httpx.ConnectError('secret'), ValueError('secret')]:
            result = str(upload_failure(error, '2023-08-31', '업로드 URL 발급'))
            self.assertIn('2023-08-31 원장 파일', result)
            self.assertIn('업로드 URL 발급', result)
            self.assertNotIn('secret', result)

    def test_missing_file_is_local_failure(self):
        controls = Controls('http://localhost:8080')
        report = Mock()
        mock = Mock()
        mock.inspect_file.side_effect = FileNotFoundError('secret-path')
        with patch('control_panel.ledger_upload', mock):
            with self.assertRaisesRegex(Exception, '파일 확인 실패') as error:
                controls.upload('2023-08-31', Path('missing.csv'), report)
        self.assertNotIn('secret', str(error.exception))
        mock.request_upload.assert_not_called()
