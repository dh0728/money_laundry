"""Opt-in upgrade test: a run frozen under V2 keeps its copied scores and Alert facts after V3.

Set AML_TEST_DOCKER to the existing Docker executable. Migrations are applied one by one so the
fixture can sit between V2 and V3, which a Flyway test that starts from an empty schema cannot do.
"""
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import unittest
from uuid import uuid4

MIGRATIONS = Path(__file__).resolve().parents[2] / 'src/main/resources/db/migration'


@unittest.skipUnless(os.environ.get("AML_TEST_DOCKER"), "AML_TEST_DOCKER is required")
class SnapshotMigrationPostgresTests(unittest.TestCase):
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
        cls.container = "aml-snapshot-migration-test-" + uuid4().hex[:12]
        password = secrets.token_urlsafe(24)
        env = dict(os.environ, POSTGRES_PASSWORD=password)
        cls.docker("run", "--detach", "--rm", "--name", cls.container,
                   "--label", "aml.test=snapshot-migration", "--publish", "127.0.0.1::5432",
                   "--env", "POSTGRES_PASSWORD", "postgres:17-alpine", env=env)
        cls.addClassCleanup(cls.docker, "rm", "--force", "--volumes", cls.container)
        ports = json.loads(cls.docker("inspect", "--format",
                                     '{{json .NetworkSettings.Ports}}', cls.container))
        args = dict(host="127.0.0.1", port=ports["5432/tcp"][0]["HostPort"], dbname="postgres",
                    user="postgres", password=password, autocommit=True, connect_timeout=2)
        deadline = time.monotonic() + 30
        while True:
            try:
                cls.db = psycopg.connect(**args)
                break
            except psycopg.OperationalError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("Test PostgreSQL did not become ready") from None
                time.sleep(0.25)
        cls.addClassCleanup(cls.db.close)

    def migrate(self, version):
        script = next(MIGRATIONS.glob(f'V{version}__*.sql'))
        with self.db.transaction():
            self.db.execute(script.read_text(encoding='utf-8-sig'))

    def rows(self, sql, *args):
        return sorted(tuple(str(value) for value in row) for row in self.db.execute(sql, args))

    def test_run_frozen_under_v2_reads_its_copies_and_later_versions_do_not_leak(self):
        db = self.db
        self.migrate(1)
        self.migrate(2)
        db.execute("INSERT INTO core.banks(bank_id) VALUES(12)")
        owner = db.execute("INSERT INTO core.owners(service_owner_id,display_name) VALUES(gen_random_uuid(),'o')"
                           " RETURNING owner_id").fetchone()[0]
        account = db.execute("INSERT INTO core.accounts(bank_id,service_account_id,owner_id)"
                             " VALUES(12,gen_random_uuid(),%s) RETURNING account_id", (owner,)).fetchone()[0]
        tx = db.execute("""INSERT INTO ledger.transactions(occurred_at,from_account_id,to_account_id,
            amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,
            fx_rate_version,business_date) VALUES('2023-09-01 12:00+09',%s,%s,1,'USD',1,'USD','ACH',1,'t',
            '2023-09-01') RETURNING tx_id""", (account, account)).fetchone()[0]
        job = db.execute("""INSERT INTO analysis.jobs(business_at,threshold_value,status,current_stage,
            analysis_date,analysis_cutoff_at) VALUES(now(),.7,'COMPLETED','COMPLETE','2023-09-02',
            '2023-09-02 09:00+09') RETURNING job_id""").fetchone()[0]
        scored, frozen = uuid4(), uuid4()
        for run in (scored, frozen):
            db.execute("INSERT INTO analysis.runs(run_id,job_id,status) VALUES(%s,%s,'COMPLETED')", (run, job))
        columns = """occurred_at,business_date,12,12,a.service_account_id,a.service_account_id,
            o.service_owner_id,o.service_owner_id,amount_received,receiving_currency,amount_paid,
            payment_currency,payment_format,amount_usd,fx_rate_version"""
        db.execute(f"""INSERT INTO analysis.input_transactions SELECT %s,tx_id,'TARGET',{columns}
            FROM ledger.transactions t JOIN core.accounts a ON a.account_id=t.from_account_id
            JOIN core.owners o ON o.owner_id=a.owner_id""", (scored,))
        db.execute("""INSERT INTO analysis.scores(run_id,tx_id,p_laundering,p_0,p_1,p_2,p_3,p_4,p_5,p_6,
            p_7,p_8,score_pct,type_class) VALUES(%s,%s,1,1,0,0,0,0,0,0,0,0,50,0)""", (scored, tx))
        db.execute("INSERT INTO analysis.current_scores VALUES(%s,%s)", (tx, scored))
        # The run frozen under V2: a mark, its CONTEXT in the input ledger, and the three copies.
        db.execute("INSERT INTO analysis.input_ledger_marks VALUES(%s,nextval('analysis.input_ledger_seq'),now())",
                   (frozen,))
        db.execute(f"""INSERT INTO analysis.input_ledger SELECT tx_id,1,null,{columns}
            FROM ledger.transactions t JOIN core.accounts a ON a.account_id=t.from_account_id
            JOIN core.owners o ON o.owner_id=a.owner_id""")
        db.execute("""INSERT INTO analysis.input_scores SELECT %s,s.tx_id,s.run_id,to_jsonb(s)-'run_id'-'tx_id'
            FROM analysis.scores s""", (frozen,))
        user = db.execute("SELECT min(user_id) FROM core.users").fetchone()[0]
        alert = db.execute("INSERT INTO review.alerts(assignee_id,created_at,assigned_at) VALUES(%s,now(),now())"
                           " RETURNING alert_id", (user,)).fetchone()[0]
        db.execute("INSERT INTO review.alert_versions(alert_id,version,run_id,fingerprint,evidence)"
                   " VALUES(%s,1,%s,repeat('a',64),'{}')", (alert, scored))
        db.execute("INSERT INTO review.alert_transactions VALUES(%s,1,%s,'SEED','[]',null)", (alert, tx))
        db.execute("UPDATE review.alerts SET published_version=1 WHERE alert_id=%s", (alert,))
        db.execute("INSERT INTO analysis.alert_origins VALUES(%s,%s,1)", (frozen, alert))
        db.execute("INSERT INTO analysis.alert_fact_checks VALUES(%s,%s,'ACTIVE')", (frozen, tx))
        copies = {
            'scores': self.rows("SELECT tx_id,score_run_id,scores FROM analysis.input_scores WHERE run_id=%s", frozen),
            'origins': self.rows("SELECT alert_id,version FROM analysis.alert_origins WHERE run_id=%s", frozen),
            'facts': self.rows("SELECT tx_id,integration_status FROM analysis.alert_fact_checks WHERE run_id=%s", frozen),
        }

        self.migrate(3)

        def views():
            return {
                'scores': self.rows("SELECT tx_id,score_run_id,scores FROM analysis.run_scores WHERE run_id=%s", frozen),
                'origins': self.rows("SELECT alert_id,version FROM analysis.run_alert_origins WHERE run_id=%s", frozen),
                'facts': self.rows("SELECT tx_id,integration_status FROM analysis.run_fact_checks WHERE run_id=%s", frozen),
            }
        self.assertEqual(copies, views())
        # A later freeze writes ledger versions at a newer mark; the V2 run must not see them.
        later = uuid4()
        db.execute("INSERT INTO analysis.runs(run_id,job_id,status) VALUES(%s,%s,'READY')", (later, job))
        seq = db.execute("INSERT INTO analysis.input_ledger_marks VALUES(%s,nextval('analysis.input_ledger_seq'),now())"
                         " RETURNING run_seq", (later,)).fetchone()[0]
        db.execute("INSERT INTO analysis.score_ledger VALUES(%s,%s,%s,null)", (tx, scored, seq))
        db.execute("INSERT INTO analysis.alert_origin_ledger VALUES(%s,1,%s,null)", (alert, seq))
        db.execute("INSERT INTO analysis.fact_ledger VALUES(%s,'ACTIVE',%s,null)", (tx, seq))
        self.assertEqual(copies, views())
        # The ledger builds the same score document the former copy stored.
        self.assertEqual(
            copies['scores'],
            self.rows("SELECT tx_id,score_run_id,scores FROM analysis.run_scores WHERE run_id=%s", later))
        for run in (frozen, later):
            self.assertEqual(
                self.rows("SELECT tx_id,scores->'p_laundering' FROM analysis.run_scores WHERE run_id=%s", run),
                self.rows("SELECT tx_id,p_laundering FROM analysis.run_scores WHERE run_id=%s", run))


if __name__ == '__main__':
    unittest.main()
