-- Additive migration. Existing reports, transactions and V2 execution history are retained.
ALTER TABLE report_versions ADD COLUMN correction_of_version_id BIGINT REFERENCES report_versions,
 ADD COLUMN self_valid BOOLEAN NOT NULL DEFAULT true;
UPDATE report_versions SET self_valid=false WHERE error_code='INVALID_SELF';
ALTER TABLE report_versions DROP CONSTRAINT report_versions_stage_status_check;
ALTER TABLE report_versions ADD CHECK(stage_status IN ('VALIDATED_WAITING_INTEGRATION','ACTIVE','PARTIALLY_HELD','HELD','WAITING_COUNTERPART','WAITING_ANALYSIS_RELEASE','SUPERSEDED'));
CREATE TABLE correction_requests (
 correction_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 bank_id INTEGER NOT NULL REFERENCES banks, business_date DATE NOT NULL,
 version_id BIGINT REFERENCES report_versions, reason_code TEXT NOT NULL, source_revision BIGINT NOT NULL,
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','REPLACEMENT_RECEIVED','VALIDATING','WAITING_COUNTERPART','WAITING_ANALYSIS_RELEASE','RESOLVED')),
 revision BIGINT NOT NULL DEFAULT 1, replacement_version_id BIGINT REFERENCES report_versions,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ,
 UNIQUE NULLS NOT DISTINCT(bank_id,business_date,version_id,reason_code,source_revision)
);
CREATE INDEX ix_corrections_bank_status_date ON correction_requests(bank_id,status,business_date);
CREATE TABLE correction_errors (
 correction_id BIGINT NOT NULL REFERENCES correction_requests, ordinal INTEGER NOT NULL,
 source_row INTEGER, column_name TEXT NOT NULL, code TEXT NOT NULL, reason TEXT NOT NULL,
 PRIMARY KEY(correction_id,ordinal)
);
CREATE TABLE correction_uploads (
 upload_id BIGINT PRIMARY KEY REFERENCES batch_jobs, correction_id BIGINT NOT NULL REFERENCES correction_requests,
 submission_id UUID NOT NULL, UNIQUE(correction_id,submission_id)
);
CREATE TABLE analysis_runs (
 run_id UUID PRIMARY KEY, job_id BIGINT NOT NULL REFERENCES batch_jobs,
 input_revision BIGINT NOT NULL DEFAULT 1,
 status TEXT NOT NULL CHECK(status IN ('READY','ACTIVE','CANCEL_REQUESTED','CANCELLED','COMPLETED')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), cancel_requested_at TIMESTAMPTZ,
 cancel_reason TEXT, completed_at TIMESTAMPTZ
);
ALTER TABLE batch_jobs ADD COLUMN current_run_id UUID REFERENCES analysis_runs;
CREATE TABLE analysis_run_replacements (
 run_id UUID NOT NULL REFERENCES analysis_runs, replaces_run_id UUID NOT NULL UNIQUE REFERENCES analysis_runs,
 PRIMARY KEY(run_id,replaces_run_id), CHECK(run_id<>replaces_run_id)
);
CREATE SCHEMA analysis;
REVOKE ALL ON SCHEMA analysis FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA analysis REVOKE ALL ON TABLES FROM PUBLIC;
CREATE TABLE analysis.input_transactions (
 run_id UUID NOT NULL REFERENCES analysis_runs, tx_id BIGINT NOT NULL REFERENCES transactions,
 input_role TEXT NOT NULL CHECK(input_role IN ('TARGET','CONTEXT')),
 occurred_at TIMESTAMPTZ NOT NULL, business_date DATE NOT NULL,
 from_bank_id INTEGER NOT NULL, to_bank_id INTEGER NOT NULL,
 from_account_id UUID NOT NULL, to_account_id UUID NOT NULL,
 from_entity_id UUID NOT NULL, to_entity_id UUID NOT NULL,
 amount_received NUMERIC(24,6) NOT NULL, receiving_currency TEXT NOT NULL,
 amount_paid NUMERIC(24,6) NOT NULL, payment_currency TEXT NOT NULL, payment_format TEXT NOT NULL,
 amount_usd NUMERIC(24,6) NOT NULL, fx_rate_version TEXT NOT NULL,
 PRIMARY KEY(run_id,tx_id,input_role)
);
CREATE INDEX ix_input_tx ON analysis.input_transactions(tx_id,run_id);
CREATE TABLE analysis_input_reports (
 run_id UUID NOT NULL REFERENCES analysis_runs, tx_id BIGINT NOT NULL REFERENCES transactions,
 report_id BIGINT NOT NULL REFERENCES private.bank_reports, PRIMARY KEY(run_id,tx_id,report_id)
);
CREATE TABLE analysis_target_ownership (
 tx_id BIGINT PRIMARY KEY REFERENCES transactions, run_id UUID NOT NULL REFERENCES analysis_runs
);
CREATE TABLE analysis_run_stage_results (
 run_id UUID NOT NULL REFERENCES analysis_runs, stage TEXT NOT NULL,
 execution_id UUID NOT NULL, artifact TEXT, completed BOOLEAN NOT NULL,
 PRIMARY KEY(run_id,stage)
);
CREATE TABLE analysis_model_requests (
 request_id UUID NOT NULL, execution_round INTEGER NOT NULL CHECK(execution_round>0),
 run_id UUID NOT NULL REFERENCES analysis_runs, model_kind TEXT NOT NULL CHECK(model_kind IN ('BINARY','TYPE')),
 status TEXT NOT NULL CHECK(status IN ('REGISTERED','PUBLISHED','STOPPED','ALREADY_FINISHED','BLOCKED')),
 PRIMARY KEY(request_id,execution_round)
);
CREATE INDEX ix_model_request_run ON analysis_model_requests(run_id);
CREATE TABLE analysis_cancel_outbox (
 cancel_id UUID PRIMARY KEY, request_id UUID NOT NULL, execution_round INTEGER NOT NULL,
 payload JSONB NOT NULL, requested_at TIMESTAMPTZ NOT NULL,
 delivered_at TIMESTAMPTZ, acknowledged_at TIMESTAMPTZ, attempts INTEGER NOT NULL DEFAULT 0,
 retry_at TIMESTAMPTZ, error_code TEXT,
 UNIQUE(request_id,execution_round),
 FOREIGN KEY(request_id,execution_round) REFERENCES analysis_model_requests
);
ALTER TABLE inference_results ADD COLUMN run_id UUID REFERENCES analysis_runs;
ALTER TABLE transaction_features ADD COLUMN run_id UUID REFERENCES analysis_runs;
REVOKE ALL ON ALL TABLES IN SCHEMA analysis FROM PUBLIC;

CREATE TABLE analysis_receipts (
 job_id BIGINT NOT NULL REFERENCES batch_jobs, upload_id BIGINT NOT NULL REFERENCES batch_jobs,
 PRIMARY KEY(job_id,upload_id)
);
CREATE TABLE analysis_selected_versions (
 job_id BIGINT NOT NULL REFERENCES batch_jobs, set_id BIGINT NOT NULL REFERENCES report_sets,
 version_id BIGINT NOT NULL REFERENCES report_versions, generation BIGINT NOT NULL,
 PRIMARY KEY(job_id,set_id)
);
