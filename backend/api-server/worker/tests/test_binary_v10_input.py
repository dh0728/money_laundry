"""binary_v10 frozen input -> normalized tables, and the delivered asset checksums."""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import secrets
import subprocess
import time
import unittest
from uuid import uuid4

import pyarrow.parquet as pq

from common.worker_transport import ProtocolError
from ingest.report_csv import CURRENCIES
from models.binary_v10 import frozen_tables, spec

KST = timezone(timedelta(hours=9))


def row(tx_id, *, target=True, src='a', dst='b', src_owner='o1', dst_owner='o2',
        src_type='Corporation', dst_type='Individual', src_country='Germany', dst_country=None,
        paid=10.0, received=10.0, paid_ccy='USD', received_ccy='EUR'):
    return (tx_id, target, datetime(2023, 9, 1, 9, 30), src, dst, src_owner, dst_owner, src_type,
            dst_type, src_country, dst_country, paid, received, paid_ccy, received_ccy, 'ACH')


class FrozenTableTests(unittest.TestCase):
    def test_currency_names_invert_ingest_and_have_calibration(self):
        self.assertEqual(frozen_tables.CURRENCY_NAMES, {code: name for name, code in CURRENCIES.items()})
        calibrated = set(pq.read_table(spec.asset('currency_stats.parquet')).column('currency').to_pylist())
        self.assertLessEqual(set(frozen_tables.CURRENCY_NAMES.values()), calibrated)

    def test_assets_match_delivered_package(self):
        for name in spec.ASSET_SHA256:
            with self.subTest(name=name):
                self.assertTrue(spec.asset(name).is_file())
        self.assertEqual(json.loads(spec.asset('binary.json').read_text(encoding='utf-8'))['threshold'],
                         spec.RECOMMENDED_THRESHOLD)
        self.assertEqual(json.loads(spec.asset('feature_schema.json').read_text(encoding='utf-8'))['entity_types'],
                         list(frozen_tables.ENTITY_TYPES))

    def test_build_maps_accounts_owners_and_categories(self):
        transactions, kyc, targets = frozen_tables.build([
            row(5), row(7, target=False, src='b', dst='c', src_owner='o2', dst_owner='o2',
                         src_type='Individual', dst_type='Individual', src_country=None,
                         dst_country='UK', paid_ccy='JPY', received_ccy='JPY')])
        self.assertEqual(targets, [5])
        self.assertEqual(transactions.schema, frozen_tables.TRANSACTIONS)
        self.assertEqual(transactions.column('edge_id').to_pylist(), [5, 7])
        self.assertEqual(transactions.column('src').to_pylist(), [0, 1])
        self.assertEqual(transactions.column('dst').to_pylist(), [1, 2])
        self.assertEqual(transactions.column('payment_currency').to_pylist(), ['US Dollar', 'Yen'])
        self.assertEqual(transactions.column('receiving_currency').to_pylist(), ['Euro', 'Yen'])
        self.assertEqual(transactions.column('duplicate_group_id').null_count, 2)
        self.assertEqual(kyc.to_pylist(), [
            dict(node_id=0, entity_id='o1', entity_type='Corporation', country='Germany'),
            dict(node_id=1, entity_id='o2', entity_type='Individual', country=None),
            dict(node_id=2, entity_id='o2', entity_type='Individual', country='UK')])

    def test_unknown_category_is_null_and_contract_breaks_raise(self):
        _, kyc, _ = frozen_tables.build([row(1, src_type='Trust', dst_type=None)])
        self.assertEqual(kyc.column('entity_type').to_pylist(), [None, None])
        for rows in ([row(1, paid_ccy='KRW')], [row(1, target=False)], [row(1, paid=-1.0)],
                     [row(1), row(2, src='a', src_owner='other')]):
            with self.subTest(rows=rows), self.assertRaises(ProtocolError):
                frozen_tables.build(rows)


@unittest.skipUnless(os.environ.get("AML_TEST_DOCKER"), "AML_TEST_DOCKER is required")
class FrozenTablesPostgresTests(unittest.TestCase):
    """The analysis login reads run_inputs and name-free categories with its real grants."""

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
        cls.psycopg = psycopg
        cls.container = "aml-binary-v10-input-test-" + uuid4().hex[:12]
        password = secrets.token_urlsafe(24)
        env = dict(os.environ, POSTGRES_PASSWORD=password)
        cls.docker("run", "--detach", "--rm", "--name", cls.container,
                   "--label", "aml.test=binary-v10-input", "--publish", "127.0.0.1::5432",
                   "--env", "POSTGRES_PASSWORD", "postgres:17-alpine", env=env)
        cls.addClassCleanup(cls.docker, "rm", "--force", "--volumes", cls.container)
        ports = json.loads(cls.docker("inspect", "--format",
                                     '{{json .NetworkSettings.Ports}}', cls.container))
        cls.connect_args = dict(host="127.0.0.1", port=ports["5432/tcp"][0]["HostPort"],
                                dbname="postgres", user="postgres", password=password,
                                autocommit=True, connect_timeout=2)
        deadline = time.monotonic() + 30
        while True:
            try:
                cls.admin = psycopg.connect(**cls.connect_args)
                break
            except psycopg.OperationalError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("Test PostgreSQL did not become ready") from None
                time.sleep(0.25)
        cls.addClassCleanup(cls.admin.close)
        migrations = Path(__file__).resolve().parents[2] / 'src/main/resources/db/migration'
        with cls.admin.transaction():
            for script in sorted(migrations.glob('V*__*.sql'), key=lambda p: int(p.name[1:].split('__')[0])):
                cls.admin.execute(script.read_text(encoding='utf-8-sig'))
        from configure_analysis_db import configure
        cls.worker_args = dict(cls.connect_args, user='analysis_fixture', password=secrets.token_urlsafe(32))
        configure(cls.admin, cls.worker_args['user'], cls.worker_args['password'])

    def test_reads_frozen_rows_with_categories(self):
        from common.frozen_input import FrozenInput, InputExecution
        admin = self.admin
        token, run = uuid4(), uuid4()
        job = admin.execute("""
            INSERT INTO analysis.jobs(analysis_date,business_at,analysis_cutoff_at,threshold_value,status,current_stage,execution_id,execution_owner)
            VALUES(date '2100-01-01',now(),now(),.7,'RUNNING','FEATURES',%s,gen_random_uuid()) RETURNING job_id
            """, (token,)).fetchone()[0]
        admin.execute("INSERT INTO analysis.runs(run_id,job_id,status) VALUES(%s,%s,'READY')", (run, job))
        admin.execute("UPDATE analysis.jobs SET current_run_id=%s WHERE job_id=%s", (run, job))
        admin.execute("INSERT INTO core.banks(bank_id,name,country) VALUES(12,'Germany Bank #12','Germany'),(13,'Savings Bank of Huron',NULL)")
        owners, accounts = {}, {}
        for name, kind, bank in (('corp', 'Corporation', 12), ('person', 'Individual', 13)):
            service = uuid4()
            owners[name] = (admin.execute("""
                INSERT INTO core.owners(service_owner_id,display_name,entity_type) VALUES(%s,%s,%s)
                RETURNING owner_id""", (service, uuid4().hex, kind)).fetchone()[0], service)
            account = uuid4()
            accounts[name] = (admin.execute("""
                INSERT INTO core.accounts(bank_id,service_account_id,owner_id) VALUES(%s,%s,%s)
                RETURNING account_id""", (bank, account, owners[name][0])).fetchone()[0], account, bank)
        when = datetime(2023, 9, 1, 9, 30, tzinfo=KST)
        expected = []
        for role, src, dst, paid_ccy in (('TARGET', 'corp', 'person', 'USD'), ('CONTEXT', 'person', 'corp', 'EUR')):
            tx = admin.execute("""
                INSERT INTO ledger.transactions(occurred_at,from_account_id,to_account_id,amount_received,
                  receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date)
                VALUES(%s,%s,%s,2,%s,3,%s,'ACH',1,'test','2023-09-01') RETURNING tx_id
                """, (when, accounts[src][0], accounts[dst][0], paid_ccy, paid_ccy)).fetchone()[0]
            admin.execute("""
                INSERT INTO analysis.input_transactions(run_id,tx_id,input_role,occurred_at,business_date,
                  from_bank_id,to_bank_id,from_account_id,to_account_id,from_owner_id,to_owner_id,
                  amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version)
                VALUES(%s,%s,%s,%s,'2023-09-01',%s,%s,%s,%s,%s,%s,2,%s,3,%s,'ACH',1,'test')
                """, (run, tx, role, when, accounts[src][2], accounts[dst][2], accounts[src][1],
                      accounts[dst][1], owners[src][1], owners[dst][1], paid_ccy, paid_ccy))
            expected.append(tx)
        with self.psycopg.connect(**self.worker_args) as worker:
            source = FrozenInput(worker, InputExecution(job, run, token))
            transactions, kyc, targets = frozen_tables.read(source)
        self.assertEqual(targets, expected[:1])
        self.assertEqual(transactions.column('edge_id').to_pylist(), expected)
        self.assertEqual(transactions.column('ts').to_pylist(), [datetime(2023, 9, 1, 9, 30)] * 2)
        self.assertEqual(transactions.column('payment_currency').to_pylist(), ['US Dollar', 'Euro'])
        by_owner = {r['entity_id']: r for r in kyc.to_pylist()}
        self.assertEqual(by_owner[str(owners['corp'][1])]['entity_type'], 'Corporation')
        self.assertEqual(by_owner[str(owners['corp'][1])]['country'], 'Germany')
        self.assertEqual(by_owner[str(owners['person'][1])]['entity_type'], 'Individual')
        self.assertIsNone(by_owner[str(owners['person'][1])]['country'])


if __name__ == '__main__':
    unittest.main()
