import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_panel import Controls
from api_client import ApiError


class UploadRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.controls = Controls('http://localhost:8080')
        self.mock = Mock()
        self.mock.inspect_file.return_value = (100, 'hash')
        self.mock.request_upload.return_value = {'uploadId': 670}
        self.report = Mock()

    def upload(self):
        with patch('control_panel.bank_module', return_value=self.mock), patch('control_panel.build_opener'), patch('control_panel.time.sleep'):
            return self.controls.upload('2023-09-04', 28, Path('bank_28_2023-09-04.csv'), self.report)

    def test_lost_get_is_retried_without_reupload(self):
        self.mock.request_status.side_effect = [
            {'status': 'RUNNING'}, URLError('secret'), {'status': 'COMPLETED'}]
        self.assertEqual(self.upload(), 670)
        self.assertEqual(self.mock.request_upload.call_count, 1)
        self.assertEqual(self.mock.upload_file.call_count, 1)
        self.assertEqual(self.mock.request_status.call_count, 3)
        self.assertNotIn('secret', str(self.report.call_args_list))

    def test_exhausted_get_can_resume_same_id_without_post_or_put(self):
        self.mock.request_status.side_effect = [{'status': 'RUNNING'}] + [URLError('secret')] * 6
        with self.assertRaises(ApiError):
            self.upload()
        self.mock.request_status.side_effect = [{'status': 'COMPLETED'}]
        self.assertEqual(self.upload(), 670)
        self.assertEqual(self.mock.request_upload.call_count, 1)
        self.assertEqual(self.mock.upload_file.call_count, 1)
        self.assertFalse(self.mock.request_status.call_args.kwargs.get('complete', False))

    def test_lost_complete_response_is_reconciled_by_get(self):
        self.mock.request_status.side_effect = [URLError('secret'), {'status': 'COMPLETED'}]
        self.assertEqual(self.upload(), 670)
        self.assertEqual(self.mock.request_status.call_count, 2)
        self.assertTrue(self.mock.request_status.call_args_list[0].kwargs['complete'])
        self.assertFalse(self.mock.request_status.call_args_list[1].kwargs.get('complete', False))

    def test_server_failure_never_counts_as_completed(self):
        self.mock.request_status.return_value = {'status': 'VALIDATION_FAILED'}
        with self.assertRaises(ApiError):
            self.upload()

    def test_changed_file_does_not_reuse_old_upload(self):
        self.mock.request_status.return_value = {'status': 'COMPLETED'}
        self.upload()
        self.mock.inspect_file.return_value = (101, 'different')
        self.mock.request_upload.return_value = {'uploadId': 671}
        self.assertEqual(self.upload(), 671)
        self.assertEqual(self.mock.upload_file.call_count, 2)

    def conflict(self, code='DUPLICATE_FILE', upload=670):
        return HTTPError('https://hidden', 409, 'hidden', {},
                         io.BytesIO(json.dumps({'code': code, 'uploadId': upload}).encode()))

    def test_restart_recovers_completed_duplicate_without_put(self):
        self.mock.request_upload.side_effect = self.conflict()
        self.mock.request_status.return_value = {
            'status': 'COMPLETED', 'businessDate': '2023-09-04', 'sizeBytes': 100}
        self.assertEqual(self.upload(), 670)
        self.mock.upload_file.assert_not_called()
        self.assertFalse(self.mock.request_status.call_args.kwargs.get('complete', False))

    def test_lost_issue_response_reconciles_in_progress_and_waits(self):
        self.mock.request_upload.side_effect = [URLError('hidden'), self.conflict('UPLOAD_IN_PROGRESS')]
        self.mock.request_status.side_effect = [
            {'status': 'RUNNING', 'businessDate': '2023-09-04', 'sizeBytes': 100},
            {'status': 'COMPLETED'}]
        self.assertEqual(self.upload(), 670)
        self.mock.upload_file.assert_not_called()

    def test_existing_different_day_is_not_skipped(self):
        self.mock.request_upload.side_effect = self.conflict()
        self.mock.request_status.return_value = {
            'status': 'COMPLETED', 'businessDate': '2023-09-03', 'sizeBytes': 100}
        with self.assertRaisesRegex(ApiError, '기준일·크기'):
            self.upload()
        self.mock.upload_file.assert_not_called()

    def test_old_server_without_id_does_not_skip_file(self):
        self.mock.request_upload.side_effect = self.conflict(upload=None)
        with self.assertRaises(ApiError):
            self.upload()
        self.mock.request_status.assert_not_called()
        self.mock.upload_file.assert_not_called()

    def test_url_only_recovery_verifies_object_before_accepting(self):
        self.mock.request_upload.side_effect = self.conflict('UPLOAD_IN_PROGRESS')
        self.mock.request_status.side_effect = [
            {'status': 'URL_ISSUED', 'businessDate': '2023-09-04', 'sizeBytes': 100},
            HTTPError('https://hidden', 400, 'hidden', {},
                      io.BytesIO(b'{"code":"UPLOAD_MISMATCH"}'))]
        with self.assertRaisesRegex(ApiError, 'UPLOAD_MISMATCH'):
            self.upload()
        self.mock.upload_file.assert_not_called()
        self.assertFalse(self.controls.uploads)
