-- Fresh development database only: never infer missing ownership or report provenance.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM accounts) OR EXISTS(SELECT 1 FROM transactions)
 OR EXISTS(SELECT 1 FROM batch_jobs) THEN
  RAISE EXCEPTION 'TRANSACTION_INTEGRATION_REQUIRES_EMPTY_DATABASE';
 END IF;
END $$;
CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private, evaluation FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON TABLES FROM PUBLIC;
CREATE TABLE private.entities (
 entity_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 service_entity_id UUID NOT NULL UNIQUE,
 entity_lookup_token TEXT NOT NULL UNIQUE,
 identity_cipher TEXT NOT NULL, name_cipher TEXT NOT NULL, key_version TEXT NOT NULL
);
ALTER TABLE accounts SET SCHEMA private;
ALTER TABLE private.accounts DROP COLUMN account_number;
ALTER TABLE private.accounts ADD COLUMN service_account_id UUID NOT NULL UNIQUE,
 ADD COLUMN account_lookup_token TEXT NOT NULL,
 ADD COLUMN entity_id BIGINT NOT NULL REFERENCES private.entities,
 ADD COLUMN identity_cipher TEXT NOT NULL, ADD COLUMN key_version TEXT NOT NULL,
 ADD CONSTRAINT uq_private_account UNIQUE(bank_id,account_lookup_token);
CREATE INDEX ix_accounts_entity_bank ON private.accounts(entity_id,bank_id);
ALTER TABLE transactions DROP CONSTRAINT transactions_bank_id_row_hash_key;
ALTER TABLE transactions DROP COLUMN bank_id, DROP COLUMN row_hash, DROP COLUMN ingest_job_id;
ALTER TABLE transactions ADD COLUMN business_date DATE NOT NULL,
 ADD COLUMN generation BIGINT NOT NULL DEFAULT 1,
 ADD COLUMN integration_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(integration_status IN ('ACTIVE','HELD','SUPERSEDED'));
ALTER TABLE banks ADD COLUMN report_format TEXT NOT NULL DEFAULT 'AML17' CHECK(report_format IN ('AML17'));
CREATE TABLE bank_reporting_periods (
 period_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 bank_id INTEGER NOT NULL REFERENCES banks,
 effective_from_date DATE NOT NULL, effective_to_date DATE,
 CHECK(effective_to_date IS NULL OR effective_to_date>=effective_from_date)
);
-- Serialize same-bank period changes without requiring btree_gist extension installation.
CREATE FUNCTION reject_reporting_overlap() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM banks WHERE bank_id=NEW.bank_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM bank_reporting_periods p WHERE p.bank_id=NEW.bank_id
 AND p.period_id<>NEW.period_id
 AND daterange(p.effective_from_date,p.effective_to_date,'[]') && daterange(NEW.effective_from_date,NEW.effective_to_date,'[]'))
 THEN RAISE EXCEPTION 'REPORTING_PERIOD_OVERLAP'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reporting_period_overlap BEFORE INSERT OR UPDATE ON bank_reporting_periods FOR EACH ROW EXECUTE FUNCTION reject_reporting_overlap();
CREATE TABLE reporting_scopes (
 business_date DATE PRIMARY KEY, scope_revision BIGINT NOT NULL DEFAULT 1,
 UNIQUE(business_date,scope_revision)
);
CREATE TABLE reporting_scope_banks (
 business_date DATE NOT NULL, scope_revision BIGINT NOT NULL,
 bank_id INTEGER NOT NULL REFERENCES banks,
 FOREIGN KEY(business_date,scope_revision) REFERENCES reporting_scopes(business_date,scope_revision),
 PRIMARY KEY(business_date,bank_id)
);
CREATE TABLE report_sets (
 set_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 bank_id INTEGER NOT NULL REFERENCES banks, business_date DATE NOT NULL,
 current_version_id BIGINT, generation BIGINT NOT NULL DEFAULT 0,
 UNIQUE(bank_id,business_date)
);
CREATE TABLE report_versions (
 version_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 set_id BIGINT NOT NULL REFERENCES report_sets,
 upload_id BIGINT NOT NULL UNIQUE REFERENCES batch_jobs,
 version_no INTEGER NOT NULL, received_at TIMESTAMPTZ NOT NULL,
 stage_status TEXT NOT NULL CHECK(stage_status IN ('VALIDATED_WAITING_INTEGRATION','ACTIVE','PARTIALLY_HELD','HELD')),
 error_code TEXT, row_count INTEGER CHECK(row_count>=0), revision BIGINT NOT NULL DEFAULT 1,
 UNIQUE(set_id,version_no), UNIQUE(set_id,version_id)
);
ALTER TABLE report_sets ADD FOREIGN KEY(set_id,current_version_id) REFERENCES report_versions(set_id,version_id);
CREATE TABLE private.bank_reports (
 report_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 version_id BIGINT NOT NULL REFERENCES report_versions, source_row INTEGER NOT NULL,
 match_key TEXT NOT NULL, payload_cipher TEXT NOT NULL, key_version TEXT NOT NULL,
 report_status TEXT NOT NULL DEFAULT 'WAITING' CHECK(report_status IN ('WAITING','ACTIVE','HELD','DEPENDENCY_HELD')),
 error_code TEXT, UNIQUE(version_id,source_row)
);
CREATE INDEX ix_bank_reports_match ON private.bank_reports(match_key);
CREATE TABLE transaction_reports (
 tx_id BIGINT NOT NULL REFERENCES transactions, report_id BIGINT NOT NULL UNIQUE REFERENCES private.bank_reports,
 report_role TEXT NOT NULL CHECK(report_role IN ('SENDER','RECEIVER','INTERNAL')),
 PRIMARY KEY(tx_id,report_id)
);
CREATE TABLE evaluation.report_labels (
 report_id BIGINT PRIMARY KEY REFERENCES private.bank_reports, is_laundering BOOLEAN NOT NULL
);
CREATE TABLE integration_attempts (
 attempt_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_date DATE NOT NULL REFERENCES reporting_scopes, cutoff_at TIMESTAMPTZ NOT NULL,
 scope_revision BIGINT NOT NULL, status TEXT NOT NULL CHECK(status IN ('PREPARING','COMPLETED')),
 FOREIGN KEY(business_date,scope_revision) REFERENCES reporting_scopes(business_date,scope_revision)
);
CREATE TABLE integration_attempt_versions (
 attempt_id BIGINT NOT NULL REFERENCES integration_attempts, version_id BIGINT NOT NULL REFERENCES report_versions,
 generation BIGINT NOT NULL, revision BIGINT NOT NULL, PRIMARY KEY(attempt_id,version_id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA private, evaluation FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA private, evaluation FROM PUBLIC;
