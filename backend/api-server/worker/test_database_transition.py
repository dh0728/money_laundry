"""Real PostgreSQL checks for configuration preservation and worker privileges."""
import importlib.util
import json
import os
from pathlib import Path
import secrets
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from configure_analysis_db import configure
import test_frozen_input_postgres as fixtures


@unittest.skipUnless(os.environ.get('AML_TEST_DOCKER'), 'AML_TEST_DOCKER is required')
class DatabaseTransitionTests(unittest.TestCase):
    docker = classmethod(fixtures.FrozenInputPostgresTests.docker.__func__)
    setUpClass = classmethod(fixtures.FrozenInputPostgresTests.setUpClass.__func__)

    def test_analysis_login_runs_without_private_labels_or_password_hash_access(self):
        user, password = 'worker_' + uuid4().hex, secrets.token_urlsafe(32)
        configure(self.admin, user, password)
        try:
            with self.psycopg.connect(**dict(self.connect_args, user=user, password=password)) as worker:
                worker.execute('SELECT * FROM analysis.input_transactions')
                worker.execute('SELECT * FROM core.assignable_staff')
                worker.execute('SELECT tx_id FROM ledger.transactions')
                for table in ('private.bank_reports', 'private.owner_identities', 'private.account_identities', 'evaluation.report_labels', 'evaluation.transaction_labels'):
                    with self.assertRaises(self.psycopg.errors.InsufficientPrivilege):
                        worker.execute('SELECT * FROM ' + table)
                with self.assertRaises(self.psycopg.errors.InsufficientPrivilege):
                    worker.execute('SELECT password_hash FROM core.users')
                with self.assertRaises(self.psycopg.errors.InsufficientPrivilege):
                    worker.execute('UPDATE core.users SET role=\'ADMIN\'')
                with self.assertRaises(self.psycopg.errors.InsufficientPrivilege):
                    worker.execute('UPDATE core.users SET last_assigned_at=now() WHERE false')
            with self.assertRaises(ValueError):
                configure(self.admin, self.connect_args['user'], password)
        finally:
            self.admin.execute(self.psycopg.sql.SQL('DROP OWNED BY {}; DROP ROLE {}').format(self.psycopg.sql.Identifier(user), self.psycopg.sql.Identifier(user)))

    def test_configuration_roundtrip_preserves_ids_hashes_and_sequences(self):
        from psycopg.types.json import set_json_loads
        set_json_loads(lambda data: json.loads(data, parse_float=str), self.admin)
        script = Path(__file__).resolve().parents[3] / 'deploy/scripts/reset-dev.py'
        spec = importlib.util.spec_from_file_location('transition_reset', script)
        reset = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(reset)
        self.admin.execute("UPDATE core.users SET password_hash='fixture-hash' WHERE username='admin'")
        self.admin.execute("INSERT INTO core.banks(bank_id,name,is_reporting) VALUES(991,'Fixture',true)")
        self.admin.execute("INSERT INTO core.bank_reporting_periods(bank_id,effective_from_date) VALUES(991,'2023-01-01')")
        self.admin.execute("INSERT INTO core.fx_rates VALUES('precision-fixture','USD',123456789012.12345678)")

        def psql(statement, database=None):
            cursor = self.admin.execute(statement)
            if cursor.description:
                value = cursor.fetchone()[0]
                return json.dumps(value) if isinstance(value, dict) else str(value)
            return ''

        with tempfile.TemporaryDirectory() as folder, patch.object(reset, 'psql', side_effect=psql):
            backup = Path(folder) / 'configuration.json'
            reset.configuration_backup(backup)
            before = json.loads(backup.read_text(encoding='utf-8'))['tables']
            self.admin.execute("UPDATE core.users SET password_hash=NULL; UPDATE core.banks SET name='changed'")
            reset.restore_configuration(backup)
            for table, rows in before.items():
                actual = self.admin.execute('SELECT coalesce(json_agg(t),\'[]\'::json) FROM (SELECT ' + reset.CONFIGURATION[table] + ' FROM core.' + table + ') t').fetchone()[0]
                self.assertEqual(sorted(actual, key=str), sorted(rows, key=str))
            new_id = self.admin.execute("INSERT INTO core.users(username,name,role) VALUES('new-fixture','New','STAFF') RETURNING user_id").fetchone()[0]
            self.assertGreater(new_id, max(row['user_id'] for row in before['users']))
            self.assertEqual(self.admin.execute("SELECT units_per_usd::text FROM core.fx_rates WHERE fx_rate_version='precision-fixture'").fetchone()[0], '123456789012.12345678')
