"""Local tests only; these do not claim KubeSphere/S3 connectivity."""

import contextlib
import io
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

import kubesphere_download_smoke as smoke


FIXTURE = Path(__file__).resolve().parents[2] / "bank-mock/fixtures/kubesphere_smoke.csv"


class DownloadSmokeTests(unittest.TestCase):
    def test_original_fixture_is_one_verified_row(self):
        self.assertEqual(smoke.verify(FIXTURE.read_bytes())["rows"], 1)

    def test_altered_file_and_login_page_are_rejected(self):
        for data in (FIXTURE.read_bytes() + b"changed", b"<html>Login</html>"):
            with self.subTest(data=data[:20]), self.assertRaises(ValueError):
                smoke.verify(data)

    def test_https_download_uses_get_and_bounded_read(self):
        response = Mock()
        response.status = 200
        response.read.return_value = FIXTURE.read_bytes()
        opener = Mock()
        opener.open.return_value.__enter__ = Mock(return_value=response)
        opener.open.return_value.__exit__ = Mock(return_value=False)
        with patch.object(smoke, "build_opener", return_value=opener):
            self.assertEqual(smoke.download("https://example.test/input?token=secret")["status"], "OK")
        self.assertEqual(opener.open.call_args.args[0].get_method(), "GET")
        response.read.assert_called_once_with(smoke.MAX_BYTES + 1)

    def test_unsafe_urls_are_rejected_without_network(self):
        with patch.object(smoke, "build_opener") as opener:
            for url in ("file:///etc/passwd", "http://example.test", "https://user:pass@example.test"):
                with self.subTest(url=url), self.assertRaises(ValueError):
                    smoke.download(url)
            opener.assert_not_called()

    def test_http_and_network_errors_do_not_expose_url(self):
        url = "https://example.test/input?token=secret"
        errors = (HTTPError(url, 403, "secret", {}, None), URLError(url))
        for error in errors:
            output = io.StringIO()
            with patch.object(smoke, "download", side_effect=error), contextlib.redirect_stdout(output):
                self.assertFalse(smoke.run(url))
            self.assertNotIn("secret", output.getvalue())
            self.assertNotIn(url, output.getvalue())

    def test_redirect_is_not_followed(self):
        self.assertIsNone(smoke.NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.test"))


if __name__ == "__main__":
    unittest.main()
