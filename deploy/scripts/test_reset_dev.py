"""No AWS/Docker calls: validates reset scope and failure ordering with test doubles."""
import base64
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("reset_dev", Path(__file__).with_name("reset-dev.py"))
reset = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reset)


class ResetTests(unittest.TestCase):
    def scope(self):
        url = "jdbc:postgresql://postgres:5432/aml_dev_v3"
        return ({"SPRING_PROFILES_ACTIVE": "dev", "SPRING_DATASOURCE_URL": url,
                 "S3_BUCKET": reset.BUCKET, "S3_PREFIX": reset.PREFIX},
                {"POSTGRES_USER": reset.DB_USER, "POSTGRES_DB": "aml_dev"},
                {"/aml/dev/db/url": url, "/aml/dev/s3/bucket": reset.BUCKET,
                 "/aml/dev/s3/prefix": reset.PREFIX})

    def test_exact_scope_only(self):
        reset.check_scope(*self.scope())
        for key, value in [("SPRING_PROFILES_ACTIVE", "dev,prod"),
                           ("SPRING_DATASOURCE_URL", "jdbc:postgresql://postgres:5432/production"),
                           ("S3_BUCKET", "another-bucket"), ("S3_PREFIX", "dev/")]:
            args = self.scope()
            args[0][key] = value
            with self.assertRaises(RuntimeError):
                reset.check_scope(*args)

    def test_parameter_drift_is_rejected(self):
        args = self.scope()
        args[2]["/aml/dev/s3/prefix"] = "dev/other/"
        with self.assertRaises(RuntimeError):
            reset.check_scope(*args)

    @patch.object(reset, "aws")
    def test_unexpected_object_is_never_deleted(self, aws):
        aws.return_value = {"Versions": [{"Key": "prod/a", "VersionId": "1"}]}
        with self.assertRaises(RuntimeError):
            reset.object_versions()
        self.assertEqual(aws.call_count, 1)

    @patch.object(reset, "aws")
    def test_current_historical_and_delete_marker_versions_are_included(self, aws):
        aws.return_value = {
            "Versions": [{"Key": reset.PREFIX + "a", "VersionId": "1"},
                         {"Key": reset.PREFIX + "a", "VersionId": "null"}],
            "DeleteMarkers": [{"Key": reset.PREFIX + "a", "VersionId": "2"}]}
        self.assertEqual([v["VersionId"] for v in reset.object_versions()], ["1", "null", "2"])

    @patch.object(reset, "psql")
    @patch.object(reset, "aws", return_value={"Errors": [{"Code": "AccessDenied"}]})
    @patch.object(reset, "object_versions", return_value=[{"Key": reset.PREFIX + "a", "VersionId": "1"}])
    @patch.object(reset, "run")
    def test_s3_failure_leaves_databases_untouched_and_api_stopped(self, run, versions, aws, psql):
        run.side_effect = ["", '[{"State":{"Running":false}}]']
        with self.assertRaises(RuntimeError):
            reset.reset()
        psql.assert_not_called()
        self.assertEqual(run.call_args_list[0].args[0], ["docker", "stop", reset.API])
        self.assertEqual(run.call_count, 2)

    @patch.object(reset, "psql")
    @patch.object(reset, "aws", return_value={})
    @patch.object(reset, "object_versions", side_effect=[[], []])
    @patch.object(reset, "run", side_effect=["", '[{"State":{"Running":false}}]'])
    def test_only_two_named_databases_are_recreated(self, run, versions, aws, psql):
        reset.reset()
        self.assertEqual(psql.call_count, 2)
        for database, call in zip(reset.DATABASES, psql.call_args_list):
            self.assertIn(f'DROP DATABASE IF EXISTS "{database}"', call.args[0])
            self.assertIn(f'CREATE DATABASE "{database}"', call.args[0])

    def existing_keys(self):
        values = [base64.b64encode(bytes([1]) * 32).decode(),
                  base64.b64encode(bytes([2]) * 32).decode(), "dev-v1"]
        return {name: {"Name": name, "Value": value, "Type": "SecureString"}
                for name, value in zip(reset.KEY_NAMES, values)}

    def test_existing_keys_are_never_rotated(self):
        with patch.object(reset, "read_parameters", return_value=self.existing_keys()), \
             patch.object(reset, "aws") as aws:
            reset.ensure_keys()
            aws.assert_not_called()

    def test_invalid_existing_keys_are_not_overwritten(self):
        keys = self.existing_keys()
        keys[reset.KEY_NAMES[0]]["Value"] = "invalid-secret"
        with patch.object(reset, "read_parameters", return_value=keys), \
             patch.object(reset, "aws") as aws:
            with self.assertRaisesRegex(RuntimeError, "no key was replaced"):
                reset.ensure_keys()
            aws.assert_not_called()

    @patch.object(reset, "run", return_value='{}')
    def test_parameter_values_go_to_stdin_not_process_arguments(self, run):
        reset.aws("ssm", "put-parameter", body={"Value": "secret-value"})
        self.assertNotIn("secret-value", repr(run.call_args.args[0]))
        self.assertEqual(json.loads(run.call_args.args[1])["Value"], "secret-value")

    def test_default_mode_does_not_mutate(self):
        args = self.scope()
        parameters = {k: {"Value": v} for k, v in args[2].items()}
        with patch.object(reset.os, "name", "posix"), \
             patch.object(reset, "inspect", side_effect=args[:2]), \
             patch.object(reset, "read_parameters", return_value=parameters), \
             patch.object(reset, "psql"), \
             patch.object(reset, "object_versions", return_value=[]), \
             patch.object(reset, "ensure_keys") as keys, \
             patch.object(reset, "reset") as destroy:
            reset.main([])
            keys.assert_not_called()
            destroy.assert_not_called()

    def test_missing_key_write_permission_prevents_deletion(self):
        args = self.scope()
        parameters = {k: {"Value": v} for k, v in args[2].items()}
        with patch.object(reset.os, "name", "posix"), \
             patch.object(reset, "inspect", side_effect=args[:2]), \
             patch.object(reset, "read_parameters", return_value=parameters), \
             patch.object(reset, "psql"), \
             patch.object(reset, "object_versions", return_value=[]), \
             patch.object(reset, "ensure_keys", side_effect=RuntimeError("denied")), \
             patch.object(reset, "reset") as destroy:
            with self.assertRaisesRegex(RuntimeError, "denied"):
                reset.main(["--apply"])
            destroy.assert_not_called()

    def test_key_preparation_does_not_delete_data(self):
        args = self.scope()
        parameters = {k: {"Value": v} for k, v in args[2].items()}
        with patch.object(reset.os, "name", "posix"), \
             patch.object(reset, "inspect", side_effect=args[:2]), \
             patch.object(reset, "read_parameters", return_value=parameters), \
             patch.object(reset, "psql", side_effect=AssertionError("DB access")) as db, \
             patch.object(reset, "object_versions", side_effect=RuntimeError("AccessDenied")) as versions, \
             patch.object(reset, "ensure_keys") as keys, \
             patch.object(reset, "reset") as destroy:
            reset.main(["--prepare-keys"])
            keys.assert_called_once()
            destroy.assert_not_called()
            db.assert_not_called()
            versions.assert_not_called()

    def test_aws_error_code_is_reported_without_raw_output(self):
        result = reset.subprocess.CompletedProcess(
            [], 254, "", "An error occurred (AccessDenied) when calling ListObjectVersions: secret-value")
        with patch.object(reset.subprocess, "run", return_value=result):
            with self.assertRaises(RuntimeError) as caught:
                reset.run(["aws", "s3api", "list-object-versions"])
        self.assertIn("AWS error=AccessDenied", str(caught.exception))
        self.assertNotIn("secret-value", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
