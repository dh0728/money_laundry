-- Additive investigation state. Model evidence and the immutable ledger remain unchanged.
CREATE INDEX ix_inference_results_tx_job ON inference_results(tx_id,job_id DESC);
CREATE INDEX ix_transactions_active_day ON transactions(business_date,occurred_at,tx_id)
 WHERE integration_status='ACTIVE';
CREATE TABLE demo_business_clock (
 id BOOLEAN PRIMARY KEY DEFAULT true CHECK(id), business_at TIMESTAMPTZ,
 revision BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO demo_business_clock(id) VALUES(true);
ALTER TABLE batch_jobs ADD COLUMN business_at TIMESTAMPTZ;
CREATE FUNCTION stamp_analysis_business_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.job_type='ANALYSIS' THEN
  NEW.business_at := coalesce((SELECT business_at FROM demo_business_clock WHERE id),now());
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER analysis_business_time BEFORE INSERT ON batch_jobs
 FOR EACH ROW EXECUTE FUNCTION stamp_analysis_business_time();

CREATE TABLE review_cases (
 case_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('ALERT','EPISODE')),
 alert_id BIGINT UNIQUE REFERENCES alerts ON DELETE CASCADE,
 assignee_id BIGINT NOT NULL REFERENCES users,
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),
 outcome TEXT CHECK(outcome IN ('NORMAL','SUSPICIOUS','TRANSFERRED','SCOPE_CLEARED','MIXED')),
 revision BIGINT NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL, assigned_at TIMESTAMPTZ NOT NULL,
 closed_at TIMESTAMPTZ, closed_by BIGINT REFERENCES users,
 CHECK((kind='ALERT')=(alert_id IS NOT NULL)),
 CHECK((status='CLOSED')=(closed_at IS NOT NULL))
);
CREATE INDEX ix_review_cases_queue ON review_cases(kind,status,assignee_id,created_at);
CREATE TABLE review_groups (
 group_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 case_id BIGINT NOT NULL REFERENCES review_cases ON DELETE CASCADE,
 label TEXT NOT NULL, revision BIGINT NOT NULL DEFAULT 0,
 evidence_version INTEGER,
 decision TEXT CHECK(decision IN ('NORMAL','SUSPICIOUS')),
 members JSONB NOT NULL DEFAULT '[]',
 CHECK(jsonb_typeof(members)='array')
);
CREATE INDEX ix_review_groups_case ON review_groups(case_id);
CREATE TABLE review_events (
 event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 case_id BIGINT NOT NULL REFERENCES review_cases ON DELETE CASCADE,
 actor_id BIGINT REFERENCES users, action TEXT NOT NULL, comment TEXT NOT NULL,
 business_at TIMESTAMPTZ NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 snapshot JSONB NOT NULL
);
CREATE INDEX ix_review_events_case ON review_events(case_id,event_id);
CREATE VIEW visible_review_cases AS
 SELECT c.*,coalesce(
  (SELECT max((m->'transaction'->'scores'->>'p_laundering')::double precision)
   FROM review_groups g CROSS JOIN LATERAL jsonb_array_elements(g.members) m
   WHERE g.case_id=c.case_id AND m->'transaction'->>'role'='SEED'
    AND m->>'state' NOT IN ('EXCLUDED','TRANSFERRED')),
  (SELECT max((seed->>'score')::double precision) FROM
    (SELECT v.evidence FROM alert_versions v JOIN analysis_runs r USING(run_id)
     JOIN batch_jobs b ON b.job_id=r.job_id WHERE v.alert_id=c.alert_id
     AND r.status='COMPLETED' AND b.status='COMPLETED' ORDER BY v.version DESC LIMIT 1) latest,
    LATERAL jsonb_array_elements(latest.evidence->'seeds') seed),0) AS risk
 FROM review_cases c WHERE c.kind='EPISODE' OR EXISTS(
  SELECT 1 FROM alert_versions v JOIN analysis_runs r USING(run_id)
  JOIN batch_jobs b ON b.job_id=r.job_id WHERE v.alert_id=c.alert_id
   AND r.status='COMPLETED' AND b.status='COMPLETED');
CREATE TABLE review_requests (
 actor_id BIGINT NOT NULL REFERENCES users, request_id UUID NOT NULL,
 payload JSONB NOT NULL, response JSONB NOT NULL,
 PRIMARY KEY(actor_id,request_id)
);
CREATE FUNCTION create_alert_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE at_time TIMESTAMPTZ;
BEGIN
 at_time := coalesce((SELECT business_at FROM demo_business_clock WHERE id),NEW.created_at);
 INSERT INTO review_cases(kind,alert_id,assignee_id,created_at,assigned_at)
 VALUES('ALERT',NEW.alert_id,NEW.assignee_id,at_time,at_time);
 RETURN NEW;
END $$;
CREATE TRIGGER alert_review AFTER INSERT ON alerts FOR EACH ROW EXECUTE FUNCTION create_alert_review();
INSERT INTO review_cases(kind,alert_id,assignee_id,status,outcome,created_at,assigned_at,closed_at)
 SELECT 'ALERT',alert_id,assignee_id,CASE WHEN status='OPEN' THEN 'OPEN' ELSE 'CLOSED' END,
 CASE WHEN status='ESCALATED' THEN 'TRANSFERRED' WHEN status='CLOSED' THEN 'SCOPE_CLEARED' END,
 created_at,created_at,CASE WHEN status<>'OPEN' THEN created_at END FROM alerts;
