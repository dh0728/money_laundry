-- Additive, immutable evidence versions. A transaction may belong to many cases.
CREATE TABLE alerts (
 alert_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED','ESCALATED')),
 resolution TEXT, assignee_id BIGINT NOT NULL REFERENCES users,
 parent_alert_id BIGINT REFERENCES alerts,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE alert_versions (
 alert_id BIGINT NOT NULL REFERENCES alerts, version INTEGER NOT NULL CHECK(version>0),
 run_id UUID NOT NULL REFERENCES analysis_runs, fingerprint CHAR(64) NOT NULL,
 evidence JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(alert_id,version), UNIQUE(alert_id,run_id)
);
CREATE TABLE alert_transactions (
 alert_id BIGINT NOT NULL, version INTEGER NOT NULL, tx_id BIGINT NOT NULL REFERENCES transactions,
 role TEXT NOT NULL CHECK(role IN ('SEED','CONNECTION','CONTEXT')), reasons JSONB NOT NULL,
 PRIMARY KEY(alert_id,version,tx_id), FOREIGN KEY(alert_id,version) REFERENCES alert_versions
);
CREATE INDEX ix_alert_transactions_tx ON alert_transactions(tx_id);
CREATE TABLE alert_coverage_checks (
 alert_id BIGINT NOT NULL REFERENCES alerts, run_id UUID NOT NULL REFERENCES analysis_runs,
 coverage JSONB NOT NULL, forward_complete BOOLEAN NOT NULL,
 PRIMARY KEY(alert_id,run_id)
);
CREATE TABLE analysis.alert_origins (
 run_id UUID NOT NULL REFERENCES analysis_runs, alert_id BIGINT NOT NULL REFERENCES alerts,
 version INTEGER NOT NULL, evidence JSONB NOT NULL,
 PRIMARY KEY(run_id,alert_id), FOREIGN KEY(alert_id,version) REFERENCES alert_versions
);
CREATE TABLE analysis.input_coverage (
 run_id UUID NOT NULL REFERENCES analysis_runs, business_date DATE NOT NULL,
 expected_banks INTEGER NOT NULL, complete_banks INTEGER NOT NULL,
 complete BOOLEAN NOT NULL, reports JSONB NOT NULL,
 PRIMARY KEY(run_id,business_date)
);
CREATE TABLE analysis.input_scores (
 run_id UUID NOT NULL REFERENCES analysis_runs, tx_id BIGINT NOT NULL REFERENCES transactions,
 score_job_id BIGINT NOT NULL REFERENCES batch_jobs, scores JSONB NOT NULL,
 PRIMARY KEY(run_id,tx_id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA analysis FROM PUBLIC;
