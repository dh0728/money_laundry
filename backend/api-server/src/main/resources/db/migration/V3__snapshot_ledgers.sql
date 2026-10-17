-- Versioned frozen scores and Alert facts: FREEZE_INPUT opens and closes what changed instead of
-- copying every score, published Alert and member state for each run. Each version is valid for
-- input_ledger_marks with valid_from_seq <= run_seq < valid_to_seq, as in analysis.input_ledger.

-- Completed current scores of eligible transactions, as frozen into the former input_scores.
CREATE TABLE analysis.score_ledger (
 tx_id BIGINT NOT NULL, score_run_id UUID NOT NULL,
 valid_from_seq BIGINT NOT NULL, valid_to_seq BIGINT,
 PRIMARY KEY(tx_id,valid_from_seq),
 FOREIGN KEY(score_run_id,tx_id) REFERENCES analysis.scores,
 CHECK(valid_to_seq IS NULL OR valid_to_seq > valid_from_seq)
);
CREATE UNIQUE INDEX score_ledger_open ON analysis.score_ledger(tx_id) WHERE valid_to_seq IS NULL;

-- Published Alert versions, as frozen into the former alert_origins.
CREATE TABLE analysis.alert_origin_ledger (
 alert_id BIGINT NOT NULL, version INTEGER NOT NULL,
 valid_from_seq BIGINT NOT NULL, valid_to_seq BIGINT,
 PRIMARY KEY(alert_id,valid_from_seq),
 FOREIGN KEY(alert_id,version) REFERENCES review.alert_versions,
 CHECK(valid_to_seq IS NULL OR valid_to_seq > valid_from_seq)
);
CREATE UNIQUE INDEX alert_origin_ledger_open ON analysis.alert_origin_ledger(alert_id) WHERE valid_to_seq IS NULL;

-- Member states of those versions, as frozen into the former alert_fact_checks.
CREATE TABLE analysis.fact_ledger (
 tx_id BIGINT NOT NULL REFERENCES ledger.transactions,
 integration_status TEXT NOT NULL CHECK(integration_status IN ('ACTIVE','HELD','SUPERSEDED')),
 valid_from_seq BIGINT NOT NULL, valid_to_seq BIGINT,
 PRIMARY KEY(tx_id,valid_from_seq),
 CHECK(valid_to_seq IS NULL OR valid_to_seq > valid_from_seq)
);
CREATE UNIQUE INDEX fact_ledger_open ON analysis.fact_ledger(tx_id) WHERE valid_to_seq IS NULL;

-- Each view keeps the former table's columns: runs frozen before this migration read their copied
-- rows, later runs read the versions valid at their mark (the ledgers start after every such mark).
-- run_scores adds p_laundering on its own so the seed decision over every frozen score does not
-- build each score document; it is the same jsonb value the document holds.
CREATE VIEW analysis.run_scores AS
 SELECT run_id,tx_id,score_run_id,scores,scores->'p_laundering' AS p_laundering FROM analysis.input_scores
 UNION ALL
 SELECT m.run_id,l.tx_id,l.score_run_id,jsonb_build_object(
   'p_laundering',s.p_laundering,'p_0',s.p_0,'p_1',s.p_1,'p_2',s.p_2,'p_3',s.p_3,'p_4',s.p_4,
   'p_5',s.p_5,'p_6',s.p_6,'p_7',s.p_7,'p_8',s.p_8,'score_pct',s.score_pct,'type_class',s.type_class),
   to_jsonb(s.p_laundering)
 FROM analysis.input_ledger_marks m
 JOIN analysis.score_ledger l ON l.valid_from_seq <= m.run_seq AND (l.valid_to_seq IS NULL OR l.valid_to_seq > m.run_seq)
 LEFT JOIN analysis.scores s ON s.run_id=l.score_run_id AND s.tx_id=l.tx_id;

CREATE VIEW analysis.run_alert_origins AS
 SELECT run_id,alert_id,version FROM analysis.alert_origins
 UNION ALL
 SELECT m.run_id,l.alert_id,l.version FROM analysis.input_ledger_marks m
 JOIN analysis.alert_origin_ledger l ON l.valid_from_seq <= m.run_seq AND (l.valid_to_seq IS NULL OR l.valid_to_seq > m.run_seq);

CREATE VIEW analysis.run_fact_checks AS
 SELECT run_id,tx_id,integration_status FROM analysis.alert_fact_checks
 UNION ALL
 SELECT m.run_id,l.tx_id,l.integration_status FROM analysis.input_ledger_marks m
 JOIN analysis.fact_ledger l ON l.valid_from_seq <= m.run_seq AND (l.valid_to_seq IS NULL OR l.valid_to_seq > m.run_seq);

REVOKE ALL ON analysis.score_ledger, analysis.alert_origin_ledger, analysis.fact_ledger,
 analysis.run_scores, analysis.run_alert_origins, analysis.run_fact_checks FROM PUBLIC;
