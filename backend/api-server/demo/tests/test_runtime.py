import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runtime import KEYS, bank_days, prepare_keys


class RuntimeTests(unittest.TestCase):
    def test_keys_are_reused_and_missing_existing_keys_are_not_replaced(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            try:
                prepare_keys(root)
                before = {key: (root / key).read_bytes() for key in KEYS}
                prepare_keys(root)
                self.assertEqual(before, {key: (root / key).read_bytes() for key in KEYS})
                (root / KEYS[0]).chmod(0o600)
                (root / KEYS[0]).unlink()
                with self.assertRaises(RuntimeError):
                    prepare_keys(root)
                self.assertFalse((root / KEYS[0]).exists())
            finally:
                for file in root.iterdir():
                    file.chmod(0o600)

    def test_only_file_metadata_is_used_for_registration(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            day = root / '2023-09-01'
            day.mkdir()
            (day / 'bank_12_2023-09-01.csv').write_text('not parsed as transaction data')
            result = bank_days(root)
            self.assertEqual([(bank, str(date)) for bank, date in result], [(12, '2023-09-01')])
            (day / 'unknown.csv').touch()
            with self.assertRaises(ValueError):
                bank_days(root)

    def test_empty_input_is_not_silently_prepared(self):
        with tempfile.TemporaryDirectory() as name:
            with self.assertRaises(ValueError):
                bank_days(Path(name))
