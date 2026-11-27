"""S3 transfer progress and the estimated server-load bar of the control panel."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

import ledger_upload
from control_panel import load_estimate, load_progress


class TransferProgressTests(unittest.TestCase):
    def test_upload_streams_blocks_reports_bytes_and_keeps_fixed_length(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'ledger_2023-08-31.csv'
            source.write_bytes(b'x' * ((1 << 20) * 2 + 5))
            size = source.stat().st_size
            seen, sent = [], []

            def put(url, content, headers, timeout):
                request = httpx.Request('PUT', url, content=content, headers=headers)
                # A fixed length must stay; signed S3 PUTs refuse chunked transfer encoding.
                self.assertNotIn('transfer-encoding', request.headers)
                self.assertEqual(request.headers['content-length'], str(size))
                sent.append(sum(len(block) for block in request.stream))
                return httpx.Response(200)

            target = {'url': 'https://bucket.example/key', 'headers': {'Content-Type': 'text/csv'}}
            with patch.object(ledger_upload.httpx, 'put', side_effect=put):
                ledger_upload.upload_file(source, target, size, on_progress=lambda done, total: seen.append((done, total)))
        self.assertEqual(sent, [size])
        self.assertEqual([done for done, _ in seen], [1 << 20, 2 << 20, size])
        self.assertTrue(all(total == size for _, total in seen))

    def test_upload_without_callback_still_sends_the_whole_file(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'ledger.csv'
            source.write_bytes(b'a,b\n1,2\n')
            with patch.object(ledger_upload.httpx, 'put',
                              side_effect=lambda url, content, headers, timeout: httpx.Response(
                                  200 if b''.join(content) == b'a,b\n1,2\n' else 400)):
                ledger_upload.upload_file(source, {'url': 'https://b.example/k', 'headers': {}}, 8)


class LoadBarTests(unittest.TestCase):
    def test_estimate_scales_with_file_size(self):
        rows, (low, high) = load_estimate(912_710_368)
        self.assertEqual(rows, 4_474_070)
        self.assertAlmostEqual(low / 60, 33.6, places=1)
        self.assertAlmostEqual(high / 60, 44.7, places=1)

    def test_bars_show_transfer_and_elapsed_load_without_reaching_full(self):
        state = {'transferTotal': 100 * 2**20, 'transferSent': 25 * 2**20}
        [(value, text)] = load_progress(state, 0)
        self.assertEqual(value, 0.25)
        self.assertIn('25 / 100 MB (25%)', text)
        state = {'loadStarted': 1000.0, 'loadLow': 600.0, 'loadHigh': 1200.0, 'loadRows': 1_000_000,
                 'loadStatus': 'RUNNING', 'loadCheckedAt': 1590.0}
        [(value, text)] = load_progress(state, 1600.0)
        self.assertEqual(value, 0.5)
        self.assertIn('서버 적재 중 · 경과 10분 · 예상 10~20분 (약 1,000,000건 추정) · 서버 확인 10초 전', text)
        [(value, text)] = load_progress(state, 5000.0)
        self.assertEqual(value, 0.99)
        self.assertIn('예상보다 오래 걸리는 중', text)

    def test_cleared_state_shows_no_bars(self):
        self.assertEqual(load_progress({'transferTotal': None, 'loadStarted': None}, 10), [])


if __name__ == '__main__':
    unittest.main()
