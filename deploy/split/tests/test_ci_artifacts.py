import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SPLIT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SPLIT))

import build_bundle
import ci_artifacts

ACCOUNT = "123456789012"
SHA = "a" * 40
BUCKET = f"aml-deploy-artifacts-{ACCOUNT}"


def manifest():
    return {
        "version": 1, "environment": "prod", "account_id": ACCOUNT,
        "region": "ap-northeast-2", "app_sha": SHA,
        "images": {service: f"{ACCOUNT}.dkr.ecr.ap-northeast-2.amazonaws.com/aml-{service}@sha256:" + "b" * 64
                   for service in ("api", "web")},
    }


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="aml-ci-test-")
        self.addCleanup(self.temporary.cleanup)
        self.bundle = Path(self.temporary.name) / "bundle.tar.gz"
        self.bundle.write_bytes(b"verified deployment bundle")
        self.calls = []

    def fake_aws(self, *args):
        self.calls.append(args)
        if args[:2] == ("s3api", "put-object"):
            if getattr(self, "put_error", None):
                raise ci_artifacts.AWSError("s3api put-object", self.put_error)
        elif args[:2] == ("s3api", "get-object"):
            if getattr(self, "get_error", None):
                raise ci_artifacts.AWSError("s3api get-object", self.get_error)
            Path(args[-1]).write_bytes(getattr(self, "existing", self.bundle.read_bytes()))
        else:
            self.fail(f"Unexpected AWS call: {args[:2]}")
        return {}

    def publish(self, **changes):
        inputs = dict(environment="prod", sha=SHA, account=ACCOUNT, bucket=BUCKET)
        inputs.update(changes)
        with patch.object(ci_artifacts, "aws", side_effect=self.fake_aws):
            return ci_artifacts.publish(self.bundle, **inputs)

    def test_new_upload_is_conditional_owner_checked_and_read_back(self):
        self.assertEqual(self.publish(), hashlib.sha256(self.bundle.read_bytes()).hexdigest())
        self.assertEqual([call[1] for call in self.calls], ["put-object", "get-object"])
        put = self.calls[0]
        self.assertEqual(put[put.index("--if-none-match") + 1], "*")
        self.assertIn("--checksum-sha256", put)
        self.assertEqual(put[put.index("--key") + 1], f"releases/prod/{SHA}/deploy-bundle.tar.gz")
        for call in self.calls:
            self.assertEqual(call[call.index("--expected-bucket-owner") + 1], ACCOUNT)

    def test_identical_existing_bundle_is_reused_without_an_unconditional_write(self):
        self.put_error = "PreconditionFailed"
        self.assertEqual(self.publish(), hashlib.sha256(self.bundle.read_bytes()).hexdigest())
        self.assertEqual([call[1] for call in self.calls], ["put-object", "get-object"])

    def test_different_bundle_at_same_release_key_is_rejected(self):
        self.put_error, self.existing = "PreconditionFailed", b"previous pinned production bundle"
        with self.assertRaisesRegex(ValueError, "different bytes"):
            self.publish()
        self.assertEqual([call[1] for call in self.calls], ["put-object", "get-object"])

    def test_permission_conflict_and_unknown_errors_do_not_fall_back_to_overwrite(self):
        for code in ("AccessDenied", "ConditionalRequestConflict", "CLIError"):
            with self.subTest(code=code):
                self.calls.clear()
                self.put_error = code
                with self.assertRaises(ci_artifacts.AWSError):
                    self.publish()
                self.assertEqual([call[1] for call in self.calls], ["put-object"])

    def test_failed_readback_is_not_reported_as_success(self):
        self.get_error = "AccessDenied"
        with self.assertRaises(ci_artifacts.AWSError):
            self.publish()

    def test_wrong_destination_is_rejected_before_any_aws_request(self):
        for change in ({"bucket": "old-deployment-bucket"}, {"environment": "other"},
                       {"sha": "../wrong"}, {"account": "invalid"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.publish(**change)
        self.assertEqual(self.calls, [])


class ProductionSelectionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="aml-prod-pins-")
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.path = self.folder / "manifest.json"
        self.path.write_text(json.dumps(manifest()), encoding="utf-8")

    def test_both_digest_references_are_verified_in_the_expected_registry(self):
        def fake(*args):
            self.assertEqual(args[:2], ("ecr", "describe-images"))
            self.assertEqual(args[args.index("--registry-id") + 1], ACCOUNT)
            return {"imageDetails": [{"imageDigest": args[-1].split("=", 1)[1]}]}
        with patch.object(ci_artifacts, "aws", side_effect=fake) as aws:
            self.assertEqual(ci_artifacts.verify_production(self.path, ACCOUNT), manifest())
        self.assertEqual(aws.call_count, 2)

    def test_wrong_account_or_environment_fails_before_ecr(self):
        with patch.object(ci_artifacts, "aws") as aws:
            with self.assertRaises(ValueError):
                ci_artifacts.verify_production(self.path, "999999999999")
            bad = manifest()
            bad["environment"] = "dev"
            self.path.write_text(json.dumps(bad), encoding="utf-8")
            with self.assertRaises(ValueError):
                ci_artifacts.verify_production(self.path, ACCOUNT)
            aws.assert_not_called()

    def test_missing_or_mismatched_digest_fails(self):
        for response in ({"imageDetails": []}, {"imageDetails": [{"imageDigest": "sha256:" + "c" * 64}]}):
            with self.subTest(response=response), patch.object(ci_artifacts, "aws", return_value=response):
                with self.assertRaises(ValueError):
                    ci_artifacts.verify_production(self.path, ACCOUNT)

    def test_selected_manifest_is_packed_and_changes_the_bundle_checksum(self):
        import tarfile
        first = self.folder / "first.tar.gz"
        second = self.folder / "second.tar.gz"
        checksum = build_bundle.build(SPLIT.parents[1], "prod", first, manifest_path=self.path)
        with tarfile.open(first) as archive:
            packed = json.load(archive.extractfile("deploy/split/images.json"))
            self.assertEqual(packed, manifest())
        changed = manifest()
        changed["images"]["api"] = changed["images"]["api"].replace("b" * 64, "c" * 64)
        self.path.write_text(json.dumps(changed), encoding="utf-8")
        self.assertNotEqual(checksum, build_bundle.build(SPLIT.parents[1], "prod", second, manifest_path=self.path))

    def test_conflicting_image_inputs_do_not_create_an_archive(self):
        output = self.folder / "bad.tar.gz"
        with self.assertRaises(ValueError):
            build_bundle.build(SPLIT.parents[1], "prod", output, image_record=self.path, manifest_path=self.path)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
