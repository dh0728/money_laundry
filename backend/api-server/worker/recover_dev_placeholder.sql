-- Operator-only recovery after stopping the dev API. Never run automatically.
-- psql -v job_id=<id> -v ON_ERROR_STOP=1 -f recover_dev_placeholder.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT set_config('aml.recovery_job', :'job_id', true);
DO $$
DECLARE
  target_job bigint := current_setting('aml.recovery_job')::bigint;
  target_run uuid;
BEGIN
  SELECT current_run_id INTO target_run FROM analysis.jobs
    WHERE job_id=target_job AND current_stage='INFERENCE'
      AND status IN ('RUNNING','RETRY_WAIT','QUEUED') FOR UPDATE;
  IF target_run IS NULL THEN
    RAISE EXCEPTION 'RECOVERY_REFUSED: job is not waiting for inference';
  END IF;
  PERFORM 1 FROM analysis.runs WHERE run_id=target_run AND status IN ('READY','ACTIVE') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECOVERY_REFUSED: run is not active'; END IF;
  PERFORM 1 FROM analysis.model_tasks WHERE run_id=target_run FOR UPDATE;
  IF (SELECT count(*) FROM analysis.model_tasks t
      JOIN analysis.model_requests r USING(request_id,execution_round)
      WHERE t.run_id=target_run AND r.run_id=target_run AND r.model_kind=t.model_kind
        AND t.phase='WAIT_REMOTE' AND t.status='WAITING' AND r.status='PUBLISHED'
        AND t.binding->'publication'->>'api_url'='https://example.com'
        AND t.input_artifact IS NOT NULL AND t.result_artifact IS NULL
        AND t.remote_revision IS NULL AND t.remote_snapshot IS NULL
        AND t.remote_deadline_at IS NULL AND t.last_event_id IS NULL
        AND t.execution_id IS NULL AND t.finished_at IS NULL) <> 2
     OR EXISTS(SELECT 1 FROM analysis.stage_results WHERE run_id=target_run
               AND stage IN ('INFERENCE','SCORES','ALERTS'))
     OR EXISTS(SELECT 1 FROM analysis.scores WHERE run_id=target_run)
     OR EXISTS(SELECT 1 FROM analysis.cancel_outbox c JOIN analysis.model_requests r
               USING(request_id,execution_round) WHERE r.run_id=target_run) THEN
    RAISE EXCEPTION 'RECOVERY_REFUSED: expected two unaccepted example.com requests';
  END IF;
  UPDATE analysis.model_tasks
    SET binding=(binding-'publication') || jsonb_build_object('placeholder_recovery',
          jsonb_build_object('previous_publication',binding->'publication',
            'previous_error',error_code,'recovered_at',clock_timestamp())),
        phase='PUBLISH',status='READY',consecutive_failures=0,error_code=NULL,
        action_required=false,retry_at=NULL,next_poll_at=NULL,updated_at=now()
    WHERE run_id=target_run;
  UPDATE analysis.jobs SET retry_at=now(),consecutive_failures=0,error_code=NULL
    WHERE job_id=target_job;
END $$;
SELECT model_kind,phase,status,request_id,execution_round
FROM analysis.model_tasks
WHERE run_id=(SELECT current_run_id FROM analysis.jobs
              WHERE job_id=current_setting('aml.recovery_job')::bigint)
ORDER BY model_kind;
COMMIT;
