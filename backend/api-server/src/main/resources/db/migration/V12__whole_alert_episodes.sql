-- User-approved reset of prototype investigation data only. Ledger, scores,
-- accounts, uploaded reports and generated Alert evidence are preserved.
DELETE FROM review_requests;
DELETE FROM review_cases;
UPDATE alerts SET status='OPEN', resolution=NULL;
INSERT INTO review_cases(kind,alert_id,assignee_id,created_at,assigned_at)
 SELECT 'ALERT',alert_id,assignee_id,created_at,created_at FROM alerts;

ALTER TABLE review_groups ADD CONSTRAINT uq_review_group_case UNIQUE(group_id,case_id);
CREATE TABLE episode_alerts (
 alert_id BIGINT PRIMARY KEY REFERENCES alerts,
 episode_case_id BIGINT NOT NULL REFERENCES review_cases ON DELETE CASCADE,
 group_id BIGINT NOT NULL UNIQUE,
 alert_version INTEGER NOT NULL CHECK(alert_version>0),
 FOREIGN KEY(group_id,episode_case_id) REFERENCES review_groups(group_id,case_id) ON DELETE CASCADE
);
CREATE INDEX ix_episode_alerts_case ON episode_alerts(episode_case_id);

-- Deferred checks permit atomic creation of an Episode and all its members,
-- but never allow a committed Episode with fewer than two distinct Alerts.
CREATE FUNCTION check_episode_alert_count(p_id BIGINT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE k TEXT; n BIGINT;
BEGIN
 SELECT kind INTO k FROM review_cases WHERE case_id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT count(*) INTO n FROM episode_alerts WHERE episode_case_id=p_id;
 IF (k='EPISODE' AND n<2) OR (k<>'EPISODE' AND n<>0) THEN
  RAISE EXCEPTION 'Episode requires at least two whole Alerts' USING ERRCODE='23514';
 END IF;
END $$;
CREATE FUNCTION enforce_episode_alert_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='review_cases' THEN
  PERFORM check_episode_alert_count(NEW.case_id);
 ELSE
  IF TG_OP<>'INSERT' THEN PERFORM check_episode_alert_count(OLD.episode_case_id); END IF;
  IF TG_OP<>'DELETE' THEN PERFORM check_episode_alert_count(NEW.episode_case_id); END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER review_episode_count
 AFTER INSERT OR UPDATE ON review_cases DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION enforce_episode_alert_count();
CREATE CONSTRAINT TRIGGER membership_episode_count
 AFTER INSERT OR UPDATE OR DELETE ON episode_alerts DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION enforce_episode_alert_count();
