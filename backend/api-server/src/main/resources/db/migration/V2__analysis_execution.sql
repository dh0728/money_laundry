-- 일별 분석 대상 고정·단계 실행·실패 이력. V1과 기존 INGEST를 보존한다.
ALTER TABLE batch_jobs ADD COLUMN analysis_cutoff_at TIMESTAMPTZ,
 ADD COLUMN current_stage VARCHAR(20), ADD COLUMN stage_attempt_count INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN retry_at TIMESTAMPTZ, ADD COLUMN execution_id UUID, ADD COLUMN execution_owner UUID,
 ADD COLUMN completion_reason VARCHAR(30);
CREATE TABLE analysis_uploads (
 job_id BIGINT NOT NULL REFERENCES batch_jobs, upload_id BIGINT NOT NULL UNIQUE REFERENCES batch_jobs,
 excluded BOOLEAN NOT NULL DEFAULT false, PRIMARY KEY(job_id,upload_id));
CREATE TABLE analysis_stage_results (
 job_id BIGINT NOT NULL REFERENCES batch_jobs, stage VARCHAR(20) NOT NULL,
 execution_id UUID NOT NULL, artifact TEXT, completed BOOLEAN NOT NULL,
 PRIMARY KEY(job_id,stage));
CREATE TABLE analysis_failures (
 failure_id UUID PRIMARY KEY, job_id BIGINT NOT NULL REFERENCES batch_jobs,
 stage VARCHAR(20) NOT NULL, execution_id UUID, error_code VARCHAR(50) NOT NULL,
 failed_at TIMESTAMPTZ NOT NULL, consecutive_count INTEGER NOT NULL, retry_at TIMESTAMPTZ,
 action_required BOOLEAN NOT NULL);
CREATE INDEX ix_analysis_retry ON batch_jobs(retry_at) WHERE job_type='ANALYSIS';
