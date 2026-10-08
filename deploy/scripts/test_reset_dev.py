"""No AWS/Docker calls: validates reset scope and failure ordering with test doubles."""
import base64
import importlib.util
import json
from pathlib import Path
import unittest
import tempfile
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
        with patch.object(reset, "configuration_backup") as backup, self.assertRaises(RuntimeError):
            reset.reset("config.json")
        backup.assert_called_once_with("config.json")
        psql.assert_not_called()
        self.assertEqual(run.call_args_list[0].args[0], ["docker", "stop", reset.API])
        self.assertEqual(run.call_count, 2)

    @patch.object(reset, "psql")
    @patch.object(reset, "aws", return_value={})
    @patch.object(reset, "object_versions", side_effect=[[], []])
    @patch.object(reset, "run", side_effect=["", '[{"State":{"Running":false}}]'])
    def test_only_active_database_is_recreated_after_backup(self, run, versions, aws, psql):
        with patch.object(reset, "configuration_backup") as backup:
            reset.reset("config.json")
        backup.assert_called_once_with("config.json")
        psql.assert_called_once()
        sql = psql.call_args.args[0]
        self.assertIn(f'DROP DATABASE "{reset.DATABASE}"', sql)
        self.assertIn(f'CREATE DATABASE "{reset.DATABASE}"', sql)
        self.assertNotIn('"aml_dev"', sql)

    def test_backup_failure_prevents_s3_and_database_deletion(self):
        with patch.object(reset, "run", side_effect=["", '[{"State":{"Running":false}}]']), \
             patch.object(reset, "configuration_backup", side_effect=RuntimeError("backup failed")), \
             patch.object(reset, "object_versions") as versions, patch.object(reset, "psql") as db:
            with self.assertRaisesRegex(RuntimeError, "backup failed"):
                reset.reset("config.json")
            versions.assert_not_called()
            db.assert_not_called()

    def test_db_only_reset_never_accesses_s3_and_requires_backup(self):
        for failed_backup in (False, True):
            with self.subTest(failed_backup=failed_backup), \
                 patch.object(reset, "run", side_effect=["", '[{"State":{"Running":false}}]']), \
                 patch.object(reset, "configuration_backup", side_effect=RuntimeError("backup failed") if failed_backup else None) as backup, \
                 patch.object(reset, "object_versions") as versions, \
                 patch.object(reset, "aws") as aws, patch.object(reset, "psql") as db:
                if failed_backup:
                    with self.assertRaisesRegex(RuntimeError, "backup failed"):
                        reset.reset("config.json", db_only=True)
                    db.assert_not_called()
                else:
                    reset.reset("config.json", db_only=True)
                    db.assert_called_once()
                    self.assertIn('DROP DATABASE "aml_dev_v3"', db.call_args.args[0])
                backup.assert_called_once_with("config.json")
                versions.assert_not_called()
                aws.assert_not_called()

    def test_db_only_cli_inspection_apply_and_missing_backup(self):
        for mode in ([], ["--apply"], ["--apply", "--backup-file", "config.json"]):
            args = self.scope()
            parameters = {k: {"Value": v} for k, v in args[2].items()}
            with self.subTest(mode=mode), patch.object(reset.os, "name", "posix"), \
                 patch.object(reset, "inspect", side_effect=args[:2]), \
                 patch.object(reset, "read_parameters", return_value=parameters), \
                 patch.object(reset, "psql"), patch.object(reset, "object_versions") as versions, \
                 patch.object(reset, "ensure_keys") as keys, patch.object(reset, "reset") as destroy:
                if mode == ["--apply"]:
                    with self.assertRaisesRegex(RuntimeError, "requires --backup-file"):
                        reset.main(["--db-only", *mode])
                    destroy.assert_not_called()
                else:
                    reset.main(["--db-only", *mode])
                    if mode:
                        destroy.assert_called_once_with("config.json", db_only=True)
                    else:
                        destroy.assert_not_called()
                versions.assert_not_called()
                keys.assert_not_called()

    def test_configuration_backup_is_exclusive_and_restoration_is_atomic(self):
        tables = {name: [] for name in reset.CONFIGURATION}
        tables['users'] = [dict(zip(reset.CONFIGURATION['users'].split(','),
            [42, 'admin', "O'Brien", 'ADMIN', 'fixture-hash', None, '2026-10-07T00:00:00Z']))]
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'configuration.json'
            with patch.object(reset, 'psql', side_effect=['public\n', json.dumps(tables)]):
                reset.configuration_backup(path)
            self.assertEqual(json.loads(path.read_text(encoding='utf-8'))['tables'], tables)
            with patch.object(reset, 'psql', side_effect=['public\n', json.dumps(tables)]):
                with self.assertRaises(FileExistsError):
                    reset.configuration_backup(path)
            legacy = json.loads(path.read_text(encoding='utf-8'))
            legacy['tables']['users'][0]['last_assigned_at'] = '2099-01-01T00:00:00Z'
            path.write_text(json.dumps(legacy), encoding='utf-8')
            with patch.object(reset, 'psql') as db:
                reset.restore_configuration(path)
            sql, database = db.call_args.args
            self.assertEqual(database, reset.DATABASE)
            self.assertTrue(sql.startswith('BEGIN;'))
            self.assertTrue(sql.endswith('COMMIT;'))
            self.assertIn('RESTORE_REQUIRES_EMPTY_BUSINESS_DATA', sql)
            self.assertIn('OVERRIDING SYSTEM VALUE', sql)
            self.assertIn("O''Brien", sql)
            self.assertIn('fixture-hash', sql)
            self.assertNotIn('2099-01-01', sql)
            self.assertNotIn('CASCADE', sql)
            self.assertTrue(path.exists())

    def test_new_backup_discards_assignment_history_but_preserves_account_fields(self):
        tables = {name: [] for name in reset.CONFIGURATION}
        user = dict(zip(reset.CONFIGURATION['users'].split(','),
            [42, 'staff', 'Staff', 'STAFF', 'fixture-hash', '2099-01-01T00:00:00Z', '2026-10-07T00:00:00Z']))
        tables['users'] = [user]
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'configuration.json'
            with patch.object(reset, 'psql', side_effect=['core\n', json.dumps(tables)]):
                reset.configuration_backup(path)
            restored = json.loads(path.read_text(encoding='utf-8'))['tables']['users'][0]
            self.assertEqual(restored, {**user, 'last_assigned_at': None})

    def test_foreign_or_incomplete_backup_is_rejected(self):
        for payload in ({'format': 1, 'database': 'prod', 'tables': {}},
                        {'format': 1, 'database': reset.DATABASE, 'tables': {}}):
            with self.assertRaises(RuntimeError):
                reset.validate_backup(payload)

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
                reset.main(["--apply", "--backup-file", "config.json"])
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
