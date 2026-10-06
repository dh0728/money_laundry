-- Keep dissolved Episodes as closed history without active Alert memberships.
-- Existing investigation data is preserved.
ALTER TABLE review_cases DROP CONSTRAINT review_cases_outcome_check;
ALTER TABLE review_cases ADD CONSTRAINT review_cases_outcome_check
 CHECK(outcome IN ('NORMAL','SUSPICIOUS','TRANSFERRED','SCOPE_CLEARED','MIXED','DISSOLVED'));
ALTER TABLE review_cases ADD CONSTRAINT dissolved_episode_state
 CHECK(outcome IS DISTINCT FROM 'DISSOLVED' OR (kind='EPISODE' AND status='CLOSED'));

CREATE OR REPLACE FUNCTION check_episode_alert_count(p_id BIGINT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE k TEXT; result TEXT; n BIGINT;
BEGIN
 SELECT kind,outcome INTO k,result FROM review_cases WHERE case_id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT count(*) INTO n FROM episode_alerts WHERE episode_case_id=p_id;
 IF (k='EPISODE' AND result IS DISTINCT FROM 'DISSOLVED' AND n<2)
    OR (result='DISSOLVED' AND n<>0) OR (k<>'EPISODE' AND n<>0) THEN
  RAISE EXCEPTION 'Episode requires at least two whole Alerts; dissolved history requires none'
   USING ERRCODE='23514';
 END IF;
END $$;
