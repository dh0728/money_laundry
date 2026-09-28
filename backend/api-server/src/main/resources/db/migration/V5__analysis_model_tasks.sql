-- Additive only: preserve V1-V4 data and request/cancellation history.
CREATE TABLE analysis_model_tasks (
 run_id UUID NOT NULL REFERENCES analysis_runs,
 model_kind TEXT NOT NULL CHECK(model_kind IN ('BINARY','TYPE')),
 phase TEXT NOT NULL CHECK(phase IN ('PREPARE','PUBLISH','WAIT_REMOTE','COLLECT','DONE')),
 status TEXT NOT NULL CHECK(status IN ('READY','ACTIVE','WAITING','RETRY_WAIT','SUCCEEDED','FAILED','CANCELLED')),
 binding JSONB NOT NULL CHECK(jsonb_typeof(binding)='object'),
 request_id UUID, execution_round INTEGER CHECK(execution_round>0),
 input_artifact JSONB, result_artifact JSONB,
 execution_id UUID, execution_owner UUID,
 operation_attempts INTEGER NOT NULL DEFAULT 0 CHECK(operation_attempts>=0),
 consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK(consecutive_failures>=0),
 retry_at TIMESTAMPTZ, next_poll_at TIMESTAMPTZ, remote_deadline_at TIMESTAMPTZ,
 remote_revision BIGINT CHECK(remote_revision>=0), remote_snapshot JSONB, last_event_id UUID,
 error_code TEXT, action_required BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 finished_at TIMESTAMPTZ,
 PRIMARY KEY(run_id,model_kind),
 FOREIGN KEY(request_id,execution_round) REFERENCES analysis_model_requests,
 CHECK((request_id IS NULL)=(execution_round IS NULL)),
 CHECK((execution_id IS NULL)=(execution_owner IS NULL)),
 CHECK((status='ACTIVE')=(execution_id IS NOT NULL)),
 CHECK(input_artifact IS NULL OR jsonb_typeof(input_artifact)='object'),
 CHECK(result_artifact IS NULL OR jsonb_typeof(result_artifact)='object')
);
CREATE INDEX ix_model_task_due ON analysis_model_tasks(status,retry_at,next_poll_at)
 WHERE status IN ('READY','WAITING','RETRY_WAIT');
