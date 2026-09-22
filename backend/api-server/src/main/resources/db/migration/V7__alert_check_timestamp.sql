-- Old rows have no known check time; do not invent one during migration.
ALTER TABLE alert_coverage_checks ADD COLUMN checked_at TIMESTAMPTZ;
