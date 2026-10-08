-- Fresh-install baseline. Never apply over the legacy migration history.
-- Activated only with the matching application and a verified database reset.
CREATE SCHEMA core;
CREATE SCHEMA ingest;
CREATE SCHEMA ledger;
CREATE SCHEMA analysis;
CREATE SCHEMA review;
CREATE SCHEMA ops;
CREATE SCHEMA private;
CREATE SCHEMA evaluation;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA private, evaluation, analysis FROM PUBLIC;

CREATE SEQUENCE core.work_id;
CREATE SEQUENCE review.case_id;
CREATE TABLE core.users (
 user_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 username VARCHAR(50) NOT NULL UNIQUE, name VARCHAR(100) NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('STAFF','ADMIN')), password_hash VARCHAR(100),
 last_assigned_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE VIEW core.assignable_staff AS
 SELECT user_id FROM core.users WHERE role='STAFF' AND password_hash IS NOT NULL AND password_hash<>'';
CREATE TABLE core.banks (
 bank_id INTEGER PRIMARY KEY, name VARCHAR(100), country VARCHAR(50),
 is_reporting BOOLEAN NOT NULL DEFAULT false,
 report_format TEXT NOT NULL DEFAULT 'AML17' CHECK(report_format='AML17'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE core.bank_reporting_periods (
 period_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 bank_id INTEGER NOT NULL REFERENCES core.banks,
 effective_from_date DATE NOT NULL, effective_to_date DATE,
 CHECK(effective_to_date IS NULL OR effective_to_date>=effective_from_date)
);
CREATE FUNCTION core.reject_reporting_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM core.banks WHERE bank_id=NEW.bank_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM core.bank_reporting_periods p WHERE p.bank_id=NEW.bank_id
 AND p.period_id<>NEW.period_id AND daterange(p.effective_from_date,p.effective_to_date,'[]')
 && daterange(NEW.effective_from_date,NEW.effective_to_date,'[]')) THEN
  RAISE EXCEPTION 'REPORTING_PERIOD_OVERLAP' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reporting_period_overlap BEFORE INSERT OR UPDATE ON core.bank_reporting_periods
 FOR EACH ROW EXECUTE FUNCTION core.reject_reporting_overlap();
CREATE TABLE core.fx_rates (
 fx_rate_version VARCHAR(50) NOT NULL, currency CHAR(3) NOT NULL,
 units_per_usd NUMERIC(20,8) NOT NULL CHECK(units_per_usd>0),
 PRIMARY KEY(fx_rate_version,currency)
);
CREATE TABLE core.owners (
 owner_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 service_owner_id UUID NOT NULL UNIQUE, display_name TEXT NOT NULL UNIQUE
);
CREATE TABLE private.owner_identities (
 owner_id BIGINT PRIMARY KEY REFERENCES core.owners,
 lookup_token TEXT NOT NULL UNIQUE, identity_cipher TEXT NOT NULL,
 name_cipher TEXT NOT NULL, key_version TEXT NOT NULL
);
CREATE TABLE core.accounts (
 account_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 service_account_id UUID NOT NULL UNIQUE, bank_id INTEGER NOT NULL REFERENCES core.banks,
 owner_id BIGINT NOT NULL REFERENCES core.owners,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(account_id,bank_id)
);
CREATE INDEX accounts_owner_bank ON core.accounts(owner_id,bank_id);
CREATE TABLE private.account_identities (
 account_id BIGINT PRIMARY KEY, bank_id INTEGER NOT NULL, lookup_token TEXT NOT NULL,
 identity_cipher TEXT NOT NULL, key_version TEXT NOT NULL,
 FOREIGN KEY(account_id,bank_id) REFERENCES core.accounts(account_id,bank_id),
 UNIQUE(bank_id,lookup_token)
);
CREATE TABLE ingest.uploads (
 upload_id BIGINT PRIMARY KEY DEFAULT nextval('core.work_id'),
 bank_id INTEGER NOT NULL REFERENCES core.banks, business_date DATE NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('URL_ISSUED','RECEIVED','RUNNING','COMPLETED','VALIDATION_FAILED','FAILED','EXPIRED')),
 file_name VARCHAR(255) NOT NULL, file_hash CHAR(64) NOT NULL,
 size_bytes BIGINT NOT NULL CHECK(size_bytes>0), s3_key VARCHAR(512),
 url_issued_at TIMESTAMPTZ, url_expires_at TIMESTAMPTZ, received_at TIMESTAMPTZ,
 started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 row_count INTEGER, missing_count INTEGER, duplicate_count INTEGER,
 attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 validation_errors JSONB, error_code TEXT, error_message TEXT,
 execution_id UUID, execution_owner UUID,
 CHECK((execution_id IS NULL)=(execution_owner IS NULL))
);
CREATE INDEX uploads_file_hash ON ingest.uploads(file_hash);
CREATE INDEX uploads_bank_received ON ingest.uploads(bank_id,received_at DESC);
CREATE TABLE ingest.reporting_scopes (
 business_date DATE PRIMARY KEY, scope_revision BIGINT NOT NULL DEFAULT 1,
 UNIQUE(business_date,scope_revision)
);
CREATE TABLE ingest.reporting_scope_banks (
 business_date DATE NOT NULL, scope_revision BIGINT NOT NULL,
 bank_id INTEGER NOT NULL REFERENCES core.banks,
 PRIMARY KEY(business_date,bank_id),
 FOREIGN KEY(business_date,scope_revision) REFERENCES ingest.reporting_scopes(business_date,scope_revision)
);
CREATE TABLE ingest.report_sets (
 set_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 bank_id INTEGER NOT NULL REFERENCES core.banks, business_date DATE NOT NULL,
 current_version_id BIGINT, generation BIGINT NOT NULL DEFAULT 0,
 UNIQUE(bank_id,business_date)
);
CREATE TABLE ingest.report_versions (
 version_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 set_id BIGINT NOT NULL REFERENCES ingest.report_sets,
 upload_id BIGINT NOT NULL UNIQUE REFERENCES ingest.uploads,
 version_no INTEGER NOT NULL CHECK(version_no>0), received_at TIMESTAMPTZ NOT NULL,
 stage_status TEXT NOT NULL CHECK(stage_status IN ('VALIDATED_WAITING_INTEGRATION','ACTIVE','PARTIALLY_HELD','HELD','WAITING_COUNTERPART','WAITING_ANALYSIS_RELEASE','SUPERSEDED')),
 error_code TEXT, row_count INTEGER CHECK(row_count>=0), revision BIGINT NOT NULL DEFAULT 1,
 correction_of_version_id BIGINT REFERENCES ingest.report_versions,
 self_valid BOOLEAN NOT NULL DEFAULT true,
 UNIQUE(set_id,version_no), UNIQUE(set_id,version_id)
);
ALTER TABLE ingest.report_sets ADD FOREIGN KEY(set_id,current_version_id)
 REFERENCES ingest.report_versions(set_id,version_id);
CREATE TABLE private.bank_reports (
 report_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 version_id BIGINT NOT NULL REFERENCES ingest.report_versions,
 source_row INTEGER NOT NULL CHECK(source_row>0), match_key TEXT NOT NULL,
 payload_cipher TEXT NOT NULL, key_version TEXT NOT NULL,
 report_status TEXT NOT NULL DEFAULT 'WAITING' CHECK(report_status IN ('WAITING','ACTIVE','HELD','DEPENDENCY_HELD')),
 error_code TEXT, UNIQUE(version_id,source_row)
);
CREATE INDEX bank_reports_match ON private.bank_reports(match_key);
CREATE TABLE ingest.integration_attempts (
 attempt_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_date DATE NOT NULL, cutoff_at TIMESTAMPTZ NOT NULL, scope_revision BIGINT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PREPARING','COMPLETED')),
 FOREIGN KEY(business_date,scope_revision) REFERENCES ingest.reporting_scopes(business_date,scope_revision)
);
CREATE TABLE ingest.integration_attempt_versions (
 attempt_id BIGINT NOT NULL REFERENCES ingest.integration_attempts,
 version_id BIGINT NOT NULL REFERENCES ingest.report_versions,
 generation BIGINT NOT NULL, revision BIGINT NOT NULL, PRIMARY KEY(attempt_id,version_id)
);
CREATE TABLE ingest.correction_requests (
 correction_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 bank_id INTEGER NOT NULL REFERENCES core.banks, business_date DATE NOT NULL,
 version_id BIGINT REFERENCES ingest.report_versions, reason_code TEXT NOT NULL,
 source_revision BIGINT NOT NULL, revision BIGINT NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','REPLACEMENT_RECEIVED','VALIDATING','WAITING_COUNTERPART','WAITING_ANALYSIS_RELEASE','RESOLVED')),
 replacement_version_id BIGINT REFERENCES ingest.report_versions,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ,
 UNIQUE NULLS NOT DISTINCT(bank_id,business_date,version_id,reason_code,source_revision)
);
CREATE INDEX corrections_bank_status_date ON ingest.correction_requests(bank_id,status,business_date);
CREATE TABLE ingest.correction_errors (
 correction_id BIGINT NOT NULL REFERENCES ingest.correction_requests,
 ordinal INTEGER NOT NULL, source_row INTEGER, column_name TEXT NOT NULL,
 code TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(correction_id,ordinal)
);
CREATE TABLE ingest.correction_uploads (
 upload_id BIGINT PRIMARY KEY REFERENCES ingest.uploads,
 correction_id BIGINT NOT NULL REFERENCES ingest.correction_requests,
 submission_id UUID NOT NULL, UNIQUE(correction_id,submission_id)
);
CREATE TABLE ledger.transactions (
 tx_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 occurred_at TIMESTAMPTZ NOT NULL, business_date DATE NOT NULL,
 from_account_id BIGINT NOT NULL REFERENCES core.accounts,
 to_account_id BIGINT NOT NULL REFERENCES core.accounts,
 amount_received NUMERIC(24,6) NOT NULL CHECK(amount_received>=0), receiving_currency CHAR(3) NOT NULL,
 amount_paid NUMERIC(24,6) NOT NULL CHECK(amount_paid>=0), payment_currency CHAR(3) NOT NULL,
 payment_format VARCHAR(30) NOT NULL, amount_usd NUMERIC(24,6) NOT NULL,
 fx_rate_version VARCHAR(50) NOT NULL, generation BIGINT NOT NULL DEFAULT 1,
 integration_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(integration_status IN ('ACTIVE','HELD','SUPERSEDED')),
 ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX transactions_active_time ON ledger.transactions(occurred_at DESC,tx_id) WHERE integration_status='ACTIVE';
CREATE INDEX transactions_from_time ON ledger.transactions(from_account_id,occurred_at);
CREATE INDEX transactions_to_time ON ledger.transactions(to_account_id,occurred_at);
CREATE INDEX transactions_day ON ledger.transactions(business_date);
CREATE TABLE ledger.transaction_reports (
 tx_id BIGINT NOT NULL REFERENCES ledger.transactions,
 report_id BIGINT NOT NULL UNIQUE REFERENCES private.bank_reports,
 report_role TEXT NOT NULL CHECK(report_role IN ('SENDER','RECEIVER','INTERNAL')),
 PRIMARY KEY(tx_id,report_id)
);
CREATE TABLE ops.business_clock (
 id BOOLEAN PRIMARY KEY DEFAULT true CHECK(id), business_at TIMESTAMPTZ,
 revision BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO ops.business_clock(id) VALUES(true);
CREATE TABLE analysis.jobs (
 job_id BIGINT PRIMARY KEY DEFAULT nextval('core.work_id'),
 analysis_date DATE NOT NULL UNIQUE, analysis_cutoff_at TIMESTAMPTZ NOT NULL,
 business_at TIMESTAMPTZ NOT NULL, threshold_value DOUBLE PRECISION NOT NULL CHECK(threshold_value>0 AND threshold_value<=1),
 status TEXT NOT NULL CHECK(status IN ('SCHEDULED','QUEUED','RUNNING','RETRY_WAIT','FAILED','COMPLETED')),
 current_stage TEXT NOT NULL CHECK(current_stage IN ('WAIT_INGEST','INTEGRATE','FREEZE_INPUT','FEATURES','INFERENCE','SCORES','ALERTS','COMPLETE')),
 current_run_id UUID, execution_id UUID, execution_owner UUID,
 attempt_count INTEGER NOT NULL DEFAULT 0, stage_attempt_count INTEGER NOT NULL DEFAULT 0,
 consecutive_failures INTEGER NOT NULL DEFAULT 0, retry_at TIMESTAMPTZ,
 started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 row_count INTEGER, missing_count INTEGER, duplicate_count INTEGER,
 suspicious_tx_count INTEGER, alert_count INTEGER,
 error_code TEXT, error_message TEXT, completion_reason TEXT,
 model_version_binary TEXT, model_version_type TEXT, feature_version_binary TEXT, feature_version_type TEXT,
 CHECK((execution_id IS NULL)=(execution_owner IS NULL))
);
CREATE INDEX jobs_retry ON analysis.jobs(retry_at) WHERE status='RETRY_WAIT';
CREATE TABLE analysis.receipts (
 job_id BIGINT NOT NULL REFERENCES analysis.jobs, upload_id BIGINT NOT NULL REFERENCES ingest.uploads,
 PRIMARY KEY(job_id,upload_id)
);
CREATE TABLE analysis.selected_versions (
 job_id BIGINT NOT NULL REFERENCES analysis.jobs, set_id BIGINT NOT NULL,
 version_id BIGINT NOT NULL, generation BIGINT NOT NULL, PRIMARY KEY(job_id,set_id),
 FOREIGN KEY(set_id,version_id) REFERENCES ingest.report_versions(set_id,version_id)
);
CREATE TABLE analysis.runs (
 run_id UUID PRIMARY KEY, job_id BIGINT NOT NULL REFERENCES analysis.jobs,
 input_revision BIGINT NOT NULL DEFAULT 1,
 status TEXT NOT NULL CHECK(status IN ('READY','ACTIVE','CANCEL_REQUESTED','CANCELLED','COMPLETED')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), cancel_requested_at TIMESTAMPTZ,
 cancel_reason TEXT, completed_at TIMESTAMPTZ, UNIQUE(job_id,run_id)
);
ALTER TABLE analysis.jobs ADD FOREIGN KEY(job_id,current_run_id) REFERENCES analysis.runs(job_id,run_id);
CREATE TABLE analysis.run_replacements (
 run_id UUID NOT NULL REFERENCES analysis.runs, replaces_run_id UUID NOT NULL UNIQUE REFERENCES analysis.runs,
 PRIMARY KEY(run_id,replaces_run_id), CHECK(run_id<>replaces_run_id)
);
CREATE TABLE analysis.stage_results (
 job_id BIGINT NOT NULL REFERENCES analysis.jobs, stage TEXT NOT NULL,
 run_id UUID, execution_id UUID NOT NULL, artifact TEXT, completed BOOLEAN NOT NULL,
 PRIMARY KEY(job_id,stage), FOREIGN KEY(job_id,run_id) REFERENCES analysis.runs(job_id,run_id)
);
CREATE TABLE analysis.failures (
 failure_id UUID PRIMARY KEY, job_id BIGINT NOT NULL REFERENCES analysis.jobs,
 stage TEXT NOT NULL, execution_id UUID, error_code TEXT NOT NULL,
 failed_at TIMESTAMPTZ NOT NULL, consecutive_count INTEGER NOT NULL,
 retry_at TIMESTAMPTZ, action_required BOOLEAN NOT NULL
);
CREATE TABLE analysis.input_transactions (
 run_id UUID NOT NULL REFERENCES analysis.runs, tx_id BIGINT NOT NULL REFERENCES ledger.transactions,
 input_role TEXT NOT NULL CHECK(input_role IN ('TARGET','CONTEXT')),
 occurred_at TIMESTAMPTZ NOT NULL, business_date DATE NOT NULL,
 from_bank_id INTEGER NOT NULL, to_bank_id INTEGER NOT NULL,
 from_account_id UUID NOT NULL, to_account_id UUID NOT NULL,
 from_owner_id UUID NOT NULL, to_owner_id UUID NOT NULL,
 amount_received NUMERIC(24,6) NOT NULL, receiving_currency TEXT NOT NULL,
 amount_paid NUMERIC(24,6) NOT NULL, payment_currency TEXT NOT NULL, payment_format TEXT NOT NULL,
 amount_usd NUMERIC(24,6) NOT NULL, fx_rate_version TEXT NOT NULL,
 PRIMARY KEY(run_id,tx_id)
);
CREATE INDEX input_transactions_tx ON analysis.input_transactions(tx_id,run_id);
CREATE TABLE analysis.input_reports (
 run_id UUID NOT NULL, tx_id BIGINT NOT NULL, report_id BIGINT NOT NULL REFERENCES private.bank_reports,
 PRIMARY KEY(run_id,tx_id,report_id), FOREIGN KEY(run_id,tx_id) REFERENCES analysis.input_transactions
);
CREATE TABLE analysis.target_ownership (
 tx_id BIGINT PRIMARY KEY REFERENCES ledger.transactions, run_id UUID NOT NULL,
 FOREIGN KEY(run_id,tx_id) REFERENCES analysis.input_transactions
);
CREATE TABLE analysis.input_coverage (
 run_id UUID NOT NULL REFERENCES analysis.runs, business_date DATE NOT NULL,
 expected_banks INTEGER NOT NULL, complete_banks INTEGER NOT NULL,
 complete BOOLEAN NOT NULL, reports JSONB NOT NULL, PRIMARY KEY(run_id,business_date)
);
CREATE TABLE analysis.input_scores (
 run_id UUID NOT NULL, tx_id BIGINT NOT NULL, score_run_id UUID NOT NULL REFERENCES analysis.runs,
 scores JSONB NOT NULL, PRIMARY KEY(run_id,tx_id),
 FOREIGN KEY(run_id,tx_id) REFERENCES analysis.input_transactions
);
CREATE TABLE analysis.source_manifest (
 run_id UUID NOT NULL REFERENCES analysis.runs, business_date DATE NOT NULL,
 state JSONB NOT NULL, PRIMARY KEY(run_id,business_date)
);
CREATE TABLE analysis.model_requests (
 request_id UUID NOT NULL, execution_round INTEGER NOT NULL CHECK(execution_round>0),
 run_id UUID NOT NULL REFERENCES analysis.runs, model_kind TEXT NOT NULL CHECK(model_kind IN ('BINARY','TYPE')),
 status TEXT NOT NULL CHECK(status IN ('REGISTERED','PUBLISHED','STOPPED','ALREADY_FINISHED','BLOCKED')),
 PRIMARY KEY(request_id,execution_round), UNIQUE(request_id,execution_round,run_id,model_kind)
);
CREATE INDEX model_requests_run ON analysis.model_requests(run_id);
CREATE TABLE analysis.model_tasks (
 run_id UUID NOT NULL REFERENCES analysis.runs, model_kind TEXT NOT NULL CHECK(model_kind IN ('BINARY','TYPE')),
 phase TEXT NOT NULL CHECK(phase IN ('PREPARE','PUBLISH','WAIT_REMOTE','COLLECT','DONE')),
 status TEXT NOT NULL CHECK(status IN ('READY','ACTIVE','WAITING','RETRY_WAIT','SUCCEEDED','FAILED','CANCELLED')),
 binding JSONB NOT NULL CHECK(jsonb_typeof(binding)='object'), request_id UUID,
 execution_round INTEGER CHECK(execution_round>0), input_artifact JSONB, result_artifact JSONB,
 execution_id UUID, execution_owner UUID, operation_attempts INTEGER NOT NULL DEFAULT 0 CHECK(operation_attempts>=0),
 consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK(consecutive_failures>=0),
 retry_at TIMESTAMPTZ, next_poll_at TIMESTAMPTZ, remote_deadline_at TIMESTAMPTZ,
 remote_revision BIGINT CHECK(remote_revision>=0), remote_snapshot JSONB, last_event_id UUID,
 error_code TEXT, action_required BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ,
 PRIMARY KEY(run_id,model_kind),
 FOREIGN KEY(request_id,execution_round,run_id,model_kind) REFERENCES analysis.model_requests(request_id,execution_round,run_id,model_kind),
 CHECK((request_id IS NULL)=(execution_round IS NULL)), CHECK((execution_id IS NULL)=(execution_owner IS NULL)),
 CHECK((status='ACTIVE')=(execution_id IS NOT NULL)),
 CHECK(input_artifact IS NULL OR jsonb_typeof(input_artifact)='object'),
 CHECK(result_artifact IS NULL OR jsonb_typeof(result_artifact)='object')
);
CREATE INDEX model_tasks_due ON analysis.model_tasks(status,retry_at,next_poll_at) WHERE status IN ('READY','WAITING','RETRY_WAIT');
CREATE TABLE analysis.cancel_outbox (
 cancel_id UUID PRIMARY KEY, request_id UUID NOT NULL, execution_round INTEGER NOT NULL,
 payload JSONB NOT NULL, requested_at TIMESTAMPTZ NOT NULL, delivered_at TIMESTAMPTZ,
 acknowledged_at TIMESTAMPTZ, attempts INTEGER NOT NULL DEFAULT 0, retry_at TIMESTAMPTZ, error_code TEXT,
 UNIQUE(request_id,execution_round), FOREIGN KEY(request_id,execution_round) REFERENCES analysis.model_requests
);
CREATE TABLE analysis.features (
 run_id UUID NOT NULL, tx_id BIGINT NOT NULL,
 model_kind TEXT NOT NULL CHECK(model_kind IN ('BINARY','TYPE')),
 feature_version TEXT NOT NULL, features JSONB NOT NULL,
 PRIMARY KEY(run_id,tx_id,model_kind), FOREIGN KEY(run_id,tx_id) REFERENCES analysis.input_transactions
);
CREATE TABLE analysis.scores (
 run_id UUID NOT NULL, tx_id BIGINT NOT NULL,
 p_laundering DOUBLE PRECISION NOT NULL CHECK(p_laundering>=0 AND p_laundering<=1),
 p_0 DOUBLE PRECISION NOT NULL CHECK(p_0>=0 AND p_0<=1),
 p_1 DOUBLE PRECISION NOT NULL CHECK(p_1>=0 AND p_1<=1),
 p_2 DOUBLE PRECISION NOT NULL CHECK(p_2>=0 AND p_2<=1),
 p_3 DOUBLE PRECISION NOT NULL CHECK(p_3>=0 AND p_3<=1),
 p_4 DOUBLE PRECISION NOT NULL CHECK(p_4>=0 AND p_4<=1),
 p_5 DOUBLE PRECISION NOT NULL CHECK(p_5>=0 AND p_5<=1),
 p_6 DOUBLE PRECISION NOT NULL CHECK(p_6>=0 AND p_6<=1),
 p_7 DOUBLE PRECISION NOT NULL CHECK(p_7>=0 AND p_7<=1),
 p_8 DOUBLE PRECISION NOT NULL CHECK(p_8>=0 AND p_8<=1),
 score_pct DOUBLE PRECISION CHECK(score_pct>=0 AND score_pct<=100),
 type_class SMALLINT NOT NULL CHECK(type_class BETWEEN 0 AND 8),
 PRIMARY KEY(run_id,tx_id), FOREIGN KEY(run_id,tx_id) REFERENCES analysis.input_transactions
);
CREATE TABLE analysis.current_scores (
 tx_id BIGINT PRIMARY KEY REFERENCES ledger.transactions, run_id UUID NOT NULL,
 FOREIGN KEY(run_id,tx_id) REFERENCES analysis.scores
);
CREATE TABLE review.alerts (
 alert_id BIGINT PRIMARY KEY DEFAULT nextval('review.case_id'),
 assignee_id BIGINT NOT NULL REFERENCES core.users,
 published_version INTEGER,
 review_started_at TIMESTAMPTZ, review_started_by BIGINT REFERENCES core.users,
 merged_into_alert_id BIGINT REFERENCES review.alerts,
 CHECK(merged_into_alert_id IS DISTINCT FROM alert_id),
 CHECK((review_started_at IS NULL)=(review_started_by IS NULL)),
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),
 outcome TEXT CHECK(outcome IN ('NORMAL','SUSPICIOUS','TRANSFERRED','SCOPE_CLEARED','MIXED')),
 summary JSONB NOT NULL DEFAULT '{}', summary_revision BIGINT NOT NULL DEFAULT 0,
 summary_scope_digest CHAR(64),
 risk_score DOUBLE PRECISION GENERATED ALWAYS AS (coalesce((summary->>'riskScore')::double precision,0)) STORED,
 revision BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL,
 assigned_at TIMESTAMPTZ NOT NULL, closed_at TIMESTAMPTZ, closed_by BIGINT REFERENCES core.users,
 CHECK((status='CLOSED')=(closed_at IS NOT NULL)),
 CHECK((status='CLOSED')=(outcome IS NOT NULL))
);
CREATE INDEX alerts_queue ON review.alerts(status,assignee_id,created_at) WHERE merged_into_alert_id IS NULL;
CREATE INDEX alerts_risk ON review.alerts(status,risk_score DESC,alert_id DESC) WHERE merged_into_alert_id IS NULL;
CREATE TABLE review.episodes (
 episode_id BIGINT PRIMARY KEY DEFAULT nextval('review.case_id'),
 assignee_id BIGINT NOT NULL REFERENCES core.users,
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),
 outcome TEXT CHECK(outcome IN ('NORMAL','SUSPICIOUS','SCOPE_CLEARED','DISSOLVED')),
 summary JSONB NOT NULL DEFAULT '{}', summary_revision BIGINT NOT NULL DEFAULT 0,
 summary_scope_digest CHAR(64),
 risk_score DOUBLE PRECISION GENERATED ALWAYS AS (coalesce((summary->>'riskScore')::double precision,0)) STORED,
 revision BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL,
 assigned_at TIMESTAMPTZ NOT NULL, closed_at TIMESTAMPTZ, closed_by BIGINT REFERENCES core.users,
 CHECK((status='CLOSED')=(closed_at IS NOT NULL)), CHECK((status='CLOSED')=(outcome IS NOT NULL))
);
CREATE INDEX episodes_queue ON review.episodes(status,assignee_id,created_at);
CREATE TABLE review.alert_versions (
 alert_id BIGINT NOT NULL REFERENCES review.alerts, version INTEGER NOT NULL CHECK(version>0),
 run_id UUID NOT NULL REFERENCES analysis.runs, fingerprint CHAR(64) NOT NULL,
 evidence JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), published_at TIMESTAMPTZ,
 PRIMARY KEY(alert_id,version), UNIQUE(alert_id,run_id)
);
ALTER TABLE review.alerts ADD CONSTRAINT alerts_published_version
 FOREIGN KEY(alert_id,published_version) REFERENCES review.alert_versions DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE analysis.alert_plans (
 run_id UUID NOT NULL REFERENCES analysis.runs, plan_key INTEGER NOT NULL,
 execution_id UUID NOT NULL, build_generation INTEGER NOT NULL CHECK(build_generation>0),
 plan_digest CHAR(64) NOT NULL, action TEXT NOT NULL
 CHECK(action IN ('NEW','UPDATE','MERGE','PROPOSE','FOLLOWUP','WITHDRAW','NOOP')),
 payload TEXT NOT NULL, PRIMARY KEY(run_id,plan_key)
);
CREATE TABLE analysis.alert_fact_checks (
 run_id UUID NOT NULL REFERENCES analysis.runs, tx_id BIGINT NOT NULL REFERENCES ledger.transactions,
 integration_status TEXT NOT NULL CHECK(integration_status IN ('ACTIVE','HELD','SUPERSEDED')),
 PRIMARY KEY(run_id,tx_id)
);
CREATE TABLE review.alert_transactions (
 alert_id BIGINT NOT NULL, version INTEGER NOT NULL, tx_id BIGINT NOT NULL REFERENCES ledger.transactions,
 role TEXT NOT NULL CHECK(role IN ('SEED','CONNECTION','CONTEXT')), reasons JSONB NOT NULL,
 seed_risk DOUBLE PRECISION CHECK(seed_risk>=0 AND seed_risk<=1),
 PRIMARY KEY(alert_id,version,tx_id), FOREIGN KEY(alert_id,version) REFERENCES review.alert_versions
);
CREATE INDEX alert_transactions_tx ON review.alert_transactions(tx_id,alert_id,version);
CREATE TABLE review.alert_coverage_checks (
 alert_id BIGINT NOT NULL REFERENCES review.alerts, run_id UUID NOT NULL REFERENCES analysis.runs,
 coverage JSONB NOT NULL, checked_at TIMESTAMPTZ,
 PRIMARY KEY(alert_id,run_id)
);
CREATE TABLE analysis.alert_origins (
 run_id UUID NOT NULL REFERENCES analysis.runs, alert_id BIGINT NOT NULL, version INTEGER NOT NULL,
 PRIMARY KEY(run_id,alert_id), FOREIGN KEY(alert_id,version) REFERENCES review.alert_versions
);
CREATE TABLE review.alert_groups (
 group_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 alert_id BIGINT NOT NULL REFERENCES review.alerts,
 label TEXT NOT NULL, revision BIGINT NOT NULL DEFAULT 0,
 decision TEXT CHECK(decision IN ('NORMAL','SUSPICIOUS')),
 evidence_version INTEGER NOT NULL,
 FOREIGN KEY(alert_id,evidence_version) REFERENCES review.alert_versions,
 UNIQUE(group_id,alert_id)
);
CREATE TABLE review.alert_members (
 group_id BIGINT NOT NULL, alert_id BIGINT NOT NULL, tx_id BIGINT NOT NULL,
 evidence_version INTEGER NOT NULL,
 review_role TEXT NOT NULL CHECK(review_role IN ('SUBJECT','CONTEXT')),
 state TEXT NOT NULL CHECK(state IN ('PENDING','DECIDED','EXCLUDED','TRANSFERRED')),
 decision TEXT CHECK(decision IN ('NORMAL','SUSPICIOUS')),
 PRIMARY KEY(group_id,tx_id), FOREIGN KEY(group_id,alert_id) REFERENCES review.alert_groups(group_id,alert_id),
 FOREIGN KEY(alert_id,evidence_version,tx_id) REFERENCES review.alert_transactions,
 CHECK(state<>'DECIDED' OR decision IS NOT NULL)
);
CREATE INDEX alert_members_tx ON review.alert_members(tx_id);
CREATE TABLE review.episode_alerts (
 alert_id BIGINT PRIMARY KEY REFERENCES review.alerts,
 episode_id BIGINT NOT NULL REFERENCES review.episodes, alert_version INTEGER NOT NULL,
 group_id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
 label TEXT NOT NULL, revision BIGINT NOT NULL DEFAULT 0,
 decision TEXT CHECK(decision IN ('NORMAL','SUSPICIOUS')),
 FOREIGN KEY(alert_id,alert_version) REFERENCES review.alert_versions,
 UNIQUE(group_id,alert_id)
);
CREATE INDEX episode_alerts_episode ON review.episode_alerts(episode_id);
CREATE TABLE review.episode_members (
 group_id BIGINT NOT NULL, alert_id BIGINT NOT NULL, tx_id BIGINT NOT NULL,
 evidence_version INTEGER NOT NULL,
 review_role TEXT NOT NULL CHECK(review_role IN ('SUBJECT','CONTEXT')),
 state TEXT NOT NULL CHECK(state IN ('PENDING','DECIDED','EXCLUDED','TRANSFERRED')),
 decision TEXT CHECK(decision IN ('NORMAL','SUSPICIOUS')),
 PRIMARY KEY(group_id,tx_id),
 FOREIGN KEY(group_id,alert_id) REFERENCES review.episode_alerts(group_id,alert_id) ON DELETE CASCADE,
 FOREIGN KEY(alert_id,evidence_version,tx_id) REFERENCES review.alert_transactions,
 CHECK(state<>'DECIDED' OR decision IS NOT NULL)
);
CREATE INDEX episode_members_tx ON review.episode_members(tx_id);
CREATE FUNCTION review.check_episode_count(p_id BIGINT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n BIGINT; disposition TEXT;
BEGIN
 SELECT outcome INTO disposition FROM review.episodes WHERE episode_id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT count(*) INTO n FROM review.episode_alerts WHERE episode_id=p_id;
 IF (disposition='DISSOLVED' AND n<>0) OR (disposition IS DISTINCT FROM 'DISSOLVED' AND n<2) THEN
  RAISE EXCEPTION 'Episode requires at least two whole Alerts, or zero when dissolved' USING ERRCODE='23514';
 END IF;
END $$;
CREATE FUNCTION review.enforce_episode_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='episodes' THEN PERFORM review.check_episode_count(NEW.episode_id);
 ELSE
  IF TG_OP<>'INSERT' THEN PERFORM review.check_episode_count(OLD.episode_id); END IF;
  IF TG_OP<>'DELETE' THEN PERFORM review.check_episode_count(NEW.episode_id); END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER episode_count AFTER INSERT OR UPDATE ON review.episodes
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION review.enforce_episode_count();
CREATE CONSTRAINT TRIGGER membership_count AFTER INSERT OR UPDATE OR DELETE ON review.episode_alerts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION review.enforce_episode_count();
CREATE TABLE review.events (
 event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 alert_id BIGINT REFERENCES review.alerts, episode_id BIGINT REFERENCES review.episodes,
 actor_id BIGINT REFERENCES core.users, action TEXT NOT NULL, comment TEXT NOT NULL,
 business_at TIMESTAMPTZ NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), snapshot JSONB NOT NULL,
 CHECK(num_nonnulls(alert_id,episode_id)=1)
);
CREATE INDEX events_alert ON review.events(alert_id,event_id DESC);
CREATE INDEX events_episode ON review.events(episode_id,event_id DESC);
CREATE TABLE review.alert_lineage (
 source_alert_id BIGINT NOT NULL REFERENCES review.alerts,
 target_alert_id BIGINT NOT NULL REFERENCES review.alerts,
 kind TEXT NOT NULL CHECK(kind IN ('MERGED_INTO','FOLLOWUP_OF')),
 event_id BIGINT NOT NULL REFERENCES review.events,
 PRIMARY KEY(source_alert_id,target_alert_id,kind), CHECK(source_alert_id<>target_alert_id)
);
CREATE UNIQUE INDEX alert_single_merge ON review.alert_lineage(source_alert_id) WHERE kind='MERGED_INTO';
CREATE INDEX alert_lineage_target ON review.alert_lineage(target_alert_id,kind,source_alert_id);
CREATE TABLE review.alert_change_proposals (
 proposal_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 target_alert_id BIGINT NOT NULL REFERENCES review.alerts, proposed_version INTEGER NOT NULL,
 evidence_digest CHAR(64) NOT NULL, status TEXT NOT NULL
 CHECK(status IN ('OPEN','ACCEPTED','REJECTED','SUPERSEDED')),
 source_run_id UUID NOT NULL REFERENCES analysis.runs,
 revision BIGINT NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 1,
 action TEXT NOT NULL CHECK(action IN ('UPDATE','MERGE','WITHDRAW')),
 payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, resolved_at TIMESTAMPTZ,
 UNIQUE(target_alert_id,evidence_digest),
 FOREIGN KEY(target_alert_id,proposed_version) REFERENCES review.alert_versions
);
CREATE TABLE review.alert_proposal_cases (
 proposal_id BIGINT NOT NULL REFERENCES review.alert_change_proposals,
 alert_id BIGINT NOT NULL REFERENCES review.alerts,
 expected_revision BIGINT NOT NULL, expected_published_version INTEGER NOT NULL,
 assignee_id BIGINT NOT NULL REFERENCES core.users,
 response TEXT NOT NULL DEFAULT 'PENDING' CHECK(response IN ('PENDING','APPROVED','REJECTED')),
 response_actor BIGINT REFERENCES core.users, response_at TIMESTAMPTZ,
 PRIMARY KEY(proposal_id,alert_id)
);
CREATE INDEX alert_proposal_case ON review.alert_proposal_cases(alert_id,proposal_id);
CREATE TABLE review.event_recipients (
 event_id BIGINT NOT NULL REFERENCES review.events, user_id BIGINT NOT NULL REFERENCES core.users,
 PRIMARY KEY(event_id,user_id)
);
CREATE INDEX event_recipients_user ON review.event_recipients(user_id,event_id DESC);
CREATE TABLE review.requests (
 actor_id BIGINT NOT NULL REFERENCES core.users, request_id UUID NOT NULL,
 payload JSONB NOT NULL, response JSONB NOT NULL, PRIMARY KEY(actor_id,request_id)
);
CREATE TABLE review.notification_reads (
 user_id BIGINT NOT NULL REFERENCES core.users, notification_id TEXT NOT NULL,
 read_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(user_id,notification_id)
);
CREATE TABLE ops.resets (
 reset_id UUID PRIMARY KEY, actor_id BIGINT NOT NULL REFERENCES core.users,
 status TEXT NOT NULL CHECK(status IN ('FILES_PENDING','FILES_FAILED','COMPLETED')),
 storage_scope TEXT NOT NULL, deleted_counts JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ
);
CREATE TABLE ops.reset_files (
 reset_id UUID NOT NULL REFERENCES ops.resets, object_key TEXT NOT NULL,
 is_prefix BOOLEAN NOT NULL, done BOOLEAN NOT NULL DEFAULT false, PRIMARY KEY(reset_id,object_key)
);
CREATE TABLE evaluation.report_labels (
 report_id BIGINT PRIMARY KEY REFERENCES private.bank_reports, is_laundering BOOLEAN NOT NULL
);
CREATE TABLE evaluation.transaction_labels (
 tx_id BIGINT PRIMARY KEY REFERENCES ledger.transactions, is_laundering BOOLEAN NOT NULL,
 pattern_label SMALLINT, attempt_id INTEGER
);
REVOKE ALL ON ALL TABLES IN SCHEMA private,evaluation,analysis FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA private,evaluation,analysis FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA private,evaluation,analysis REVOKE ALL ON TABLES FROM PUBLIC;

-- Read-only API projection; state is owned by the two physical tables above.
CREATE VIEW ops.work_items AS
 SELECT job_id,'ANALYSIS'::text AS job_type,status,analysis_date,NULL::integer AS bank_id,
 current_stage,attempt_count,stage_attempt_count,consecutive_failures,retry_at,error_code,error_message,
 started_at,finished_at,row_count,completion_reason,analysis_cutoff_at,
 model_version_binary,model_version_type,feature_version_binary,feature_version_type,
 threshold_value,suspicious_tx_count,alert_count,missing_count,duplicate_count,current_run_id
 FROM analysis.jobs
 UNION ALL
 SELECT upload_id,'INGEST',status,NULL::date,bank_id,
 NULL,attempt_count,0,0,NULL::timestamptz,error_code,error_message,
 started_at,finished_at,row_count,NULL,NULL::timestamptz,
 NULL,NULL,NULL,NULL,NULL::double precision,NULL::integer,NULL::integer,missing_count,duplicate_count,NULL::uuid
 FROM ingest.uploads;

-- Read projections do not own or duplicate investigation state.
CREATE VIEW review.cases AS
 SELECT alert_id AS case_id,'ALERT'::text AS kind,alert_id,assignee_id,status,outcome,
 revision,created_at,assigned_at,closed_at,closed_by,published_version,review_started_at,merged_into_alert_id,summary,summary_revision,summary_scope_digest,risk_score FROM review.alerts
 UNION ALL
 SELECT episode_id,'EPISODE',NULL::bigint,assignee_id,status,outcome,
 revision,created_at,assigned_at,closed_at,closed_by,NULL::integer,NULL::timestamptz,NULL::bigint,summary,summary_revision,summary_scope_digest,risk_score FROM review.episodes;
CREATE VIEW review.event_history AS
 SELECT e.*,coalesce(alert_id,episode_id) AS case_id FROM review.events e;
CREATE VIEW review.saved_members AS
 SELECT a.alert_id AS case_id,m.group_id,m.alert_id,m.tx_id,m.evidence_version,
 m.review_role,m.state,m.decision FROM review.alert_members m JOIN review.alert_groups a USING(group_id,alert_id)
 UNION ALL
 SELECT e.episode_id,m.group_id,m.alert_id,m.tx_id,m.evidence_version,
 m.review_role,m.state,m.decision FROM review.episode_members m JOIN review.episode_alerts e USING(group_id,alert_id);
CREATE VIEW review.latest_versions AS
 SELECT v.* FROM review.alerts a JOIN review.alert_versions v
 ON v.alert_id=a.alert_id AND v.version=a.published_version
 JOIN analysis.runs r USING(run_id) JOIN analysis.jobs j USING(job_id)
 WHERE v.published_at IS NOT NULL AND r.status='COMPLETED' AND j.status='COMPLETED';
CREATE VIEW review.effective_members AS
 SELECT m.case_id,m.group_id,m.alert_id,m.tx_id,m.evidence_version,m.review_role,m.state,m.decision
 FROM review.saved_members m
 WHERE EXISTS(SELECT 1 FROM review.episodes e WHERE e.episode_id=m.case_id)
 OR EXISTS(SELECT 1 FROM review.alerts a JOIN review.alert_transactions t
   ON t.alert_id=a.alert_id AND t.version=a.published_version
   WHERE a.alert_id=m.case_id AND t.tx_id=m.tx_id)
 UNION ALL
 SELECT a.alert_id,0::bigint,a.alert_id,t.tx_id,t.version,
 CASE WHEN t.role='CONTEXT' THEN 'CONTEXT' ELSE 'SUBJECT' END,'PENDING',NULL
 FROM review.alerts a JOIN review.latest_versions v USING(alert_id)
 JOIN review.alert_transactions t USING(alert_id,version)
 WHERE NOT EXISTS(SELECT 1 FROM review.alert_groups g WHERE g.alert_id=a.alert_id)
 AND NOT EXISTS(SELECT 1 FROM review.alert_members m WHERE m.alert_id=a.alert_id AND m.tx_id=t.tx_id);
CREATE VIEW review.visible_cases AS
 SELECT c.*,c.risk_score AS risk FROM review.cases c
 WHERE c.kind='EPISODE' OR (c.merged_into_alert_id IS NULL AND c.published_version IS NOT NULL);

CREATE VIEW review.notifications AS
 SELECT c.assignee_id AS user_id, 'batch:'||r.run_id AS notification_id,
 'ALERT_ASSIGNED'::text AS kind, max(c.assigned_at) AS at,
 '새 Alert 배정'::text AS title,
 count(*)||'건의 Alert가 배정되었습니다.' AS description,
 'ANALYSIS-'||r.job_id AS code, count(*) AS item_count,
 NULL::bigint AS case_id, 'ALERT'::text AS case_kind, r.run_id AS batch_run_id
 FROM review.cases c JOIN review.alert_versions v ON v.alert_id=c.alert_id AND v.version=1
 JOIN analysis.runs r ON r.run_id=v.run_id JOIN analysis.jobs b ON b.job_id=r.job_id
 WHERE r.status='COMPLETED' AND b.status='COMPLETED'
 GROUP BY c.assignee_id,r.run_id,r.job_id
 UNION ALL
 SELECT c.assignee_id,'episode:'||c.case_id,'EPISODE_ASSIGNED',c.assigned_at,
 '새 Episode 배정','Episode 조사가 배정되었습니다.','E-'||c.case_id,1,
 c.case_id,c.kind,NULL::uuid FROM review.cases c WHERE c.kind='EPISODE'
 AND NOT EXISTS(SELECT 1 FROM review.events e WHERE e.episode_id=c.case_id AND e.action='TRANSFER')
 UNION ALL
 SELECT c.assignee_id,'event:'||e.event_id,e.action,e.business_at,
 CASE e.action WHEN 'COMMENT' THEN '조사 의견 등록' WHEN 'CLOSE' THEN '사건 종결'
 WHEN 'TRANSFER' THEN 'Episode 편입' WHEN 'UNLINK' THEN 'Alert 연결 해제'
 WHEN 'DISSOLVE' THEN 'Episode 해체' END,
 e.comment,CASE c.kind WHEN 'ALERT' THEN 'A-'||c.alert_id ELSE 'E-'||c.case_id END,
 1,c.case_id,c.kind,NULL::uuid
 FROM review.event_history e JOIN review.cases c ON c.case_id=e.case_id
 WHERE e.action IN ('COMMENT','CLOSE','TRANSFER','UNLINK','DISSOLVE')
 AND (e.action<>'TRANSFER' OR c.kind='EPISODE')
 AND (c.kind='EPISODE' OR EXISTS(
   SELECT 1 FROM review.alert_versions v JOIN analysis.runs r USING(run_id)
   JOIN analysis.jobs b ON b.job_id=r.job_id
   WHERE v.alert_id=c.alert_id AND r.status='COMPLETED' AND b.status='COMPLETED'))
 UNION ALL
 SELECT recipient.user_id,'event:'||e.event_id,e.action,e.business_at,
 CASE e.action WHEN 'ADDED_EVIDENCE' THEN 'Alert 근거 추가' WHEN 'MERGED' THEN 'Alert 병합'
 WHEN 'CHANGE_PROPOSED' THEN 'Alert 변경 제안' WHEN 'FOLLOWUP_CREATED' THEN '후속 Alert 생성'
 WHEN 'EVIDENCE_WITHDRAWN' THEN 'Alert 근거 소멸' END,
 e.comment,'A-'||e.alert_id,1,e.alert_id,'ALERT',NULL::uuid
 FROM review.events e JOIN review.event_recipients recipient USING(event_id)
 WHERE e.action IN ('ADDED_EVIDENCE','MERGED','CHANGE_PROPOSED','FOLLOWUP_CREATED','EVIDENCE_WITHDRAWN');

-- Fixed demonstration exchange-rate snapshot.
INSERT INTO core.fx_rates (fx_rate_version, currency, units_per_usd) VALUES
    ('fx_rates_usd_v1', 'AUD', 1.41280000),
    ('fx_rates_usd_v1', 'BTC', 0.00008416),
    ('fx_rates_usd_v1', 'BRL', 5.64649997),
    ('fx_rates_usd_v1', 'CAD', 1.31930001),
    ('fx_rates_usd_v1', 'EUR', 0.85340000),
    ('fx_rates_usd_v1', 'MXN', 21.14310180),
    ('fx_rates_usd_v1', 'RUB', 77.80399773),
    ('fx_rates_usd_v1', 'INR', 73.44397914),
    ('fx_rates_usd_v1', 'SAR', 3.75109996),
    ('fx_rates_usd_v1', 'ILS', 3.37699997),
    ('fx_rates_usd_v1', 'CHF', 0.91500000),
    ('fx_rates_usd_v1', 'GBP', 0.77420000),
    ('fx_rates_usd_v1', 'USD', 1.00000000),
    ('fx_rates_usd_v1', 'JPY', 105.39995594),
    ('fx_rates_usd_v1', 'CNY', 6.69760020);

-- No credentials are embedded; these accounts remain disabled until provisioned.
INSERT INTO core.users(username,name,role) VALUES
 ('l1a','L1 심사자 A','STAFF'),('l1b','L1 심사자 B','STAFF'),
 ('l2a','L2 조사관 A','STAFF'),('l2b','L2 조사관 B','STAFF'),('admin','관리자','ADMIN');
