-- Source manifests drive rechecks; future-date completion is no longer a state.
ALTER TABLE alert_coverage_checks DROP COLUMN forward_complete;
