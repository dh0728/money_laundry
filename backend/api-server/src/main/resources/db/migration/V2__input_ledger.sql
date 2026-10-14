-- Versioned CONTEXT input: FREEZE_INPUT opens and closes eligible transactions here instead of
-- copying the whole eligible ledger into analysis.input_transactions for every run.

-- Freeze order. run_seq is issued under the integration lock, so it is also commit order.
CREATE SEQUENCE analysis.input_ledger_seq;
CREATE TABLE analysis.input_ledger_marks (
 run_id UUID PRIMARY KEY REFERENCES analysis.runs,
 run_seq BIGINT NOT NULL UNIQUE,
 cutoff_at TIMESTAMPTZ NOT NULL
);

-- One row per frozen version of an eligible transaction, valid for marks with
-- valid_from_seq <= run_seq < valid_to_seq. Columns follow analysis.input_transactions.
CREATE TABLE analysis.input_ledger (
 tx_id BIGINT NOT NULL REFERENCES ledger.transactions,
 valid_from_seq BIGINT NOT NULL, valid_to_seq BIGINT,
 occurred_at TIMESTAMPTZ NOT NULL, business_date DATE NOT NULL,
 from_bank_id INTEGER NOT NULL, to_bank_id INTEGER NOT NULL,
 from_account_id UUID NOT NULL, to_account_id UUID NOT NULL,
 from_owner_id UUID NOT NULL, to_owner_id UUID NOT NULL,
 amount_received NUMERIC(24,6) NOT NULL, receiving_currency TEXT NOT NULL,
 amount_paid NUMERIC(24,6) NOT NULL, payment_currency TEXT NOT NULL, payment_format TEXT NOT NULL,
 amount_usd NUMERIC(24,6) NOT NULL, fx_rate_version TEXT NOT NULL,
 PRIMARY KEY(tx_id,valid_from_seq),
 CHECK(valid_to_seq IS NULL OR valid_to_seq > valid_from_seq)
);
CREATE UNIQUE INDEX input_ledger_open ON analysis.input_ledger(tx_id) WHERE valid_to_seq IS NULL;

-- The only reader of a run's report links needs their report sets, not every CONTEXT report row.
CREATE TABLE analysis.input_report_sets (
 run_id UUID NOT NULL REFERENCES analysis.runs, set_id BIGINT NOT NULL,
 PRIMARY KEY(run_id,set_id)
);
INSERT INTO analysis.input_report_sets
SELECT DISTINCT ir.run_id,v.set_id FROM analysis.input_reports ir
JOIN private.bank_reports br USING(report_id) JOIN ingest.report_versions v USING(version_id);

-- Scores stay frozen for CONTEXT transactions that are no longer rows of input_transactions.
ALTER TABLE analysis.input_scores DROP CONSTRAINT input_scores_run_id_tx_id_fkey;
ALTER TABLE analysis.input_scores ADD FOREIGN KEY(run_id) REFERENCES analysis.runs;
ALTER TABLE analysis.input_scores ADD FOREIGN KEY(tx_id) REFERENCES ledger.transactions;

-- A run's frozen input: its own rows (TARGET, and CONTEXT of runs frozen before this migration)
-- plus the ledger versions valid at its mark that are not already among them.
CREATE VIEW analysis.run_inputs AS
 SELECT run_id,tx_id,input_role,occurred_at,business_date,from_bank_id,to_bank_id,
 from_account_id,to_account_id,from_owner_id,to_owner_id,amount_received,receiving_currency,
 amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version
 FROM analysis.input_transactions
 UNION ALL
 SELECT m.run_id,l.tx_id,'CONTEXT'::text,l.occurred_at,l.business_date,l.from_bank_id,l.to_bank_id,
 l.from_account_id,l.to_account_id,l.from_owner_id,l.to_owner_id,l.amount_received,l.receiving_currency,
 l.amount_paid,l.payment_currency,l.payment_format,l.amount_usd,l.fx_rate_version
 FROM analysis.input_ledger_marks m
 JOIN analysis.input_ledger l ON l.valid_from_seq <= m.run_seq AND (l.valid_to_seq IS NULL OR l.valid_to_seq > m.run_seq)
 WHERE NOT EXISTS(SELECT 1 FROM analysis.input_transactions i WHERE i.run_id=m.run_id AND i.tx_id=l.tx_id);

REVOKE ALL ON analysis.input_ledger_marks, analysis.input_ledger, analysis.input_report_sets, analysis.run_inputs FROM PUBLIC;
REVOKE ALL ON SEQUENCE analysis.input_ledger_seq FROM PUBLIC;
