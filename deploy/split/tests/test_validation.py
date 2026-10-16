"""Regression coverage for Compose versions that omit false JSON fields."""
import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("split_validate", ROOT / "validate.py")
validate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validate)


class InferenceMountValidationTests(unittest.TestCase):
    def setUp(self):
        self.source = (ROOT / "backend/inference.external.yaml").read_text(encoding="utf-8")
        self.mount = dict(type="bind", target="/app/certs/inference-ca.crt", read_only=True)

    def test_explicit_and_omitted_false_are_accepted(self):
        for extra in ({"bind": {"create_host_path": False}}, {"bind": {}}, {}):
            with self.subTest(extra=extra):
                validate.validate_inference_mount([dict(self.mount, **extra)], self.source)

    def test_host_path_creation_is_rejected(self):
        with self.assertRaises(AssertionError):
            validate.validate_inference_mount(
                [dict(self.mount, bind={"create_host_path": True})], self.source)

    def test_writable_ca_is_rejected(self):
        with self.assertRaises(AssertionError):
            validate.validate_inference_mount([dict(self.mount, read_only=False)], self.source)

    def test_missing_ca_mount_is_rejected(self):
        with self.assertRaises(AssertionError):
            validate.validate_inference_mount([], self.source)

    def test_named_volume_is_rejected(self):
        with self.assertRaises(AssertionError):
            validate.validate_inference_mount([dict(self.mount, type="volume")], self.source)

    def test_source_must_explicitly_disable_creation_even_if_json_omits_it(self):
        for replacement in ("create_host_path: true", "# create_host_path: false", ""):
            with self.subTest(replacement=replacement), self.assertRaises(AssertionError):
                source = self.source.replace("create_host_path: false", replacement)
                validate.validate_inference_mount([self.mount], source)


if __name__ == "__main__":
    unittest.main()
