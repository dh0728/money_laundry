"""Ledger loading against a disposable PostgreSQL 17 (opt-in, AML_TEST_DOCKER)."""
import base64
import io
import json
import os
import secrets
import subprocess
import time
import unittest
from pathlib import Path
from uuid import uuid4

from common.private_data import PrivateDataProtector
from ingest.ledger_ingest import ingest

HEADER = ('Timestamp,From Bank,From Account,From Bank Name,From Entity ID,From Entity Name,To Bank,To Account,'
          'To Bank Name,To Entity ID,To Entity Name,Amount Received,Receiving Currency,Amount Paid,'
          'Payment Currency,Payment Format,Is Laundering\n')


def name(entity):
    return ('Individual' if entity % 2 == 0 else 'Corporation') + f' #{entity}'


def row(time, from_bank, account, entity, to_bank, to_account, to_entity, amount, label='0', currency='US Dollar'):
    return (f'{time},{from_bank},{account},Some Bank #{from_bank},{entity},{name(entity)},'
            f'{to_bank},{to_account},Some Bank #{to_bank},{to_entity},{name(to_entity)},'
            f'{amount},{currency},{amount},{currency},ACH,{label}\n')


@unittest.skipUnless(os.environ.get("AML_TEST_DOCKER"), "AML_TEST_DOCKER is required")
class LedgerIngestPostgresTests(unittest.TestCase):
    @classmethod
    def docker(cls, *args, env=None):
        result = subprocess.run([os.environ["AML_TEST_DOCKER"], *args],
                                capture_output=True, text=True, env=env, timeout=45)
        if result.returncode:
            raise RuntimeError(f"Test Docker command failed: {args[0]}")
        return result.stdout.strip()

    @classmethod
    def setUpClass(cls):
        import psycopg
        cls.container = "aml-ledger-ingest-test-" + uuid4().hex[:12]
        password = secrets.token_urlsafe(24)
        cls.docker("run", "--detach", "--rm", "--name", cls.container, "--label", "aml.test=ledger-ingest",
                   "--publish", "127.0.0.1::5432", "--env", "POSTGRES_PASSWORD", "postgres:17-alpine",
                   env=dict(os.environ, POSTGRES_PASSWORD=password))
        cls.addClassCleanup(cls.docker, "rm", "--force", "--volumes", cls.container)
        ports = json.loads(cls.docker("inspect", "--format", '{{json .NetworkSettings.Ports}}', cls.container))
        args = dict(host="127.0.0.1", port=ports["5432/tcp"][0]["HostPort"], dbname="postgres",
                    user="postgres", password=password, autocommit=True, connect_timeout=2)
        deadline = time.monotonic() + 30
        while True:
            try:
                cls.db = psycopg.connect(**args)
                break
            except psycopg.OperationalError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.25)
        cls.addClassCleanup(cls.db.close)
        schema = Path(__file__).resolve().parents[2] / 'src/main/resources/db/migration/V1__initial_schema.sql'
        with cls.db.transaction():
            cls.db.execute(schema.read_text(encoding='utf-8-sig'))
        cls.protector = PrivateDataProtector(base64.b64encode(bytes(32)).decode(),
                                             base64.b64encode(bytes([1] * 32)).decode(), 'test')

    def setUp(self):
        self.db.execute('TRUNCATE ingest.uploads, core.owners, core.banks CASCADE')

    def load(self, day, text):
        token = uuid4()
        upload = self.db.execute("""INSERT INTO ingest.uploads(business_date,status,file_name,file_hash,size_bytes,
            received_at,execution_id,execution_owner) VALUES(%s,'RUNNING','ledger.csv',repeat('a',64),1,now(),%s,%s)
            RETURNING upload_id""", (day, token, uuid4())).fetchone()[0]
        # Each load runs on its own connection, as the ingest process does.
        import psycopg
        info = self.db.info
        with psycopg.connect(host=info.host, port=info.port, dbname=info.dbname, user=info.user,
                             password=info.password, autocommit=True) as connection:
            ingest(connection, upload, token, io.StringIO(HEADER + text, newline=''), self.protector, 'fx_rates_usd_v1')
        return upload, self.db.execute(
            'SELECT status,validation_errors FROM ingest.uploads WHERE upload_id=%s', (upload,)).fetchone()

    def test_loads_numbered_accounts_owners_labels_and_usd_amounts(self):
        upload, (status, errors) = self.load('2023-09-01', row('2023/09/01 09:00', 27, 'A1', 101, 12, 'B1', 102, 100, '1')
                                             + row('2023/09/01 10:00', 27, 'A2', 103, 27, 'A1', 101, 90, '0', 'Euro'))
        self.assertEqual(status, 'COMPLETED', errors)
        self.assertEqual([r[0] for r in self.db.execute('SELECT service_account_id FROM core.accounts ORDER BY account_id')],
                         ['27-0001', '12-0001', '27-0002'])
        self.assertEqual(self.db.execute('SELECT count(*) FROM ledger.transactions WHERE upload_id=%s', (upload,)).fetchone()[0], 2)
        self.assertEqual([str(r[0]) for r in self.db.execute('SELECT amount_usd FROM ledger.transactions ORDER BY tx_id')],
                         ['100.000000', '105.460511'])
        self.assertEqual([r[0] for r in self.db.execute('SELECT is_laundering FROM evaluation.transaction_labels ORDER BY tx_id')],
                         [True, False])
        self.assertEqual(sorted(r[0] for r in self.db.execute('SELECT entity_type FROM core.owners')),
                         ['Corporation', 'Corporation', 'Individual'])
        self.assertEqual(self.db.execute('SELECT country FROM core.banks WHERE bank_id=27').fetchone()[0], 'Some')

    def test_next_day_reuses_accounts_and_continues_each_banks_numbers(self):
        self.load('2023-09-01', row('2023/09/01 09:00', 27, 'A1', 101, 12, 'B1', 102, 1))
        _, (status, errors) = self.load('2023-09-02', row('2023/09/02 09:00', 12, 'B2', 104, 27, 'A1', 101, 1))
        self.assertEqual(status, 'COMPLETED', errors)
        self.assertEqual([r[0] for r in self.db.execute('SELECT service_account_id FROM core.accounts ORDER BY account_id')],
                         ['27-0001', '12-0001', '12-0002'])

    def test_any_bad_row_or_identity_conflict_rejects_the_whole_file(self):
        _, (status, errors) = self.load('2023-09-01', row('2023/09/01 09:00', 27, 'A1', 101, 12, 'B1', 102, 1)
                                        + row('2023/09/02 09:00', 27, 'A1', 101, 12, 'B1', 102, 1))
        self.assertEqual(status, 'VALIDATION_FAILED')
        self.assertIn('BUSINESS_DATE_MISMATCH', json.dumps(errors))
        self.assertEqual(self.db.execute('SELECT count(*) FROM core.accounts').fetchone()[0], 0)
        self.load('2023-09-01', row('2023/09/01 09:00', 27, 'A1', 101, 12, 'B1', 102, 1))
        _, (status, errors) = self.load('2023-09-02', row('2023/09/02 09:00', 27, 'A1', 999, 12, 'B1', 102, 1))
        self.assertEqual(status, 'VALIDATION_FAILED')
        self.assertIn('IDENTITY_CONFLICT', json.dumps(errors))
        self.assertEqual(self.db.execute('SELECT count(*) FROM ledger.transactions').fetchone()[0], 1)

    def test_a_loaded_date_is_not_loaded_twice(self):
        self.load('2023-09-01', row('2023/09/01 09:00', 27, 'A1', 101, 12, 'B1', 102, 1))
        _, (status, errors) = self.load('2023-09-01', row('2023/09/01 11:00', 27, 'A1', 101, 12, 'B1', 102, 2))
        self.assertEqual(status, 'VALIDATION_FAILED')
        self.assertIn('DATE_ALREADY_LOADED', json.dumps(errors))
