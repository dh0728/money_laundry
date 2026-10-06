-- Demo-only annotations. Normal analysis.input_transactions contains no labels.
CREATE TABLE evaluation.demo_report_hints (
 report_id BIGINT PRIMARY KEY REFERENCES private.bank_reports,
 dataset_version TEXT NOT NULL CHECK(dataset_version='pattern5-2023-v1'),
 is_laundering BOOLEAN NOT NULL,
 type_code INTEGER NOT NULL CHECK(type_code BETWEEN 0 AND 8),
 CHECK(is_laundering OR type_code=0)
);
REVOKE ALL ON evaluation.demo_report_hints FROM PUBLIC;
