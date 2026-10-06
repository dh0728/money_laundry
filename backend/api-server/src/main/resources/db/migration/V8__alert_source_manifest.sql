-- Immutable source state per run. Only completed runs/jobs may be baselines.
CREATE TABLE analysis.alert_source_manifest (
 run_id UUID NOT NULL REFERENCES analysis_runs,
 business_date DATE NOT NULL,
 state JSONB NOT NULL,
 PRIMARY KEY(run_id,business_date)
);
REVOKE ALL ON analysis.alert_source_manifest FROM PUBLIC;
