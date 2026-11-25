-- 룰 엔진. 예전 룰 표(조건이 고정 3개인 버전)를 없애고 rules 스키마로 바꾼다.
-- 룰 = 이름표(rules.rules) + 조건을 가진 버전(rules.rule_versions). 적중은 버전 × 대상 × 날짜다.
DROP TABLE review.rule_history;
DROP TABLE review.rules;

-- "처음 거래하는 상대"(FIRST_PAIR): 그 (송금 → 수취) 쌍의 이전 거래가 있는지 찾는다.
CREATE INDEX transactions_pair_time ON ledger.transactions(from_account_id,to_account_id,occurred_at);

CREATE SCHEMA rules;

-- 룰 이름표. 화면의 RULE-003 은 'RULE-'||lpad(rule_id::text,3,'0') 이다.
CREATE TABLE rules.rules (
 rule_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name TEXT NOT NULL,
 template TEXT NOT NULL CHECK(template IN ('FAN_OUT','FAN_IN','GATHER_SCATTER','SCATTER_GATHER','CYCLE','RANDOM',
  'LARGE_TX','STRUCTURING','SAME_AMOUNT','PASS_THROUGH')),
 owner_id BIGINT NOT NULL REFERENCES core.users, created_at TIMESTAMPTZ NOT NULL
);

-- 조건을 가진 버전. DRAFT 일 때만 definition 을 고친다.
CREATE TABLE rules.rule_versions (
 version_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 rule_id BIGINT NOT NULL REFERENCES rules.rules,
 version_no INTEGER NOT NULL CHECK(version_no>0),
 status TEXT NOT NULL CHECK(status IN ('DRAFT','SHADOW','PENDING','ACTIVE','PAUSED','RETIRED')),
 definition JSONB NOT NULL,
 -- 키 순서를 고정한 definition 문자열의 SHA-256. 백테스트가 지금 조건으로 돌린 것인지 확인한다.
 definition_digest CHAR(64) NOT NULL,
 summary TEXT NOT NULL,
 author_id BIGINT NOT NULL REFERENCES core.users,
 -- 이 순번(analysis.runs.input_seq) 뒤의 분석부터 매일 실행한다. NULL = 실행 안 함.
 eval_from_seq BIGINT,
 revision BIGINT NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL,
 submitted_at TIMESTAMPTZ, decided_at TIMESTAMPTZ, decided_by BIGINT REFERENCES core.users,
 UNIQUE(rule_id,version_no)
);
-- 룰마다 운영 버전 1개, 작업 중 버전 1개까지.
CREATE UNIQUE INDEX rule_versions_operating ON rules.rule_versions(rule_id) WHERE status IN ('ACTIVE','PAUSED');
CREATE UNIQUE INDEX rule_versions_working ON rules.rule_versions(rule_id) WHERE status IN ('DRAFT','SHADOW','PENDING');
CREATE INDEX rule_versions_evaluating ON rules.rule_versions(eval_from_seq) WHERE eval_from_seq IS NOT NULL;

-- 변경 기록. actor_id NULL = 시스템. 초안을 지우면 version_id 는 비고 snapshot 의 versionNo 만 남는다.
CREATE TABLE rules.events (
 event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 rule_id BIGINT NOT NULL REFERENCES rules.rules,
 version_id BIGINT REFERENCES rules.rule_versions ON DELETE SET NULL,
 actor_id BIGINT REFERENCES core.users,
 action TEXT NOT NULL CHECK(action IN ('CREATED','EDITED','DRAFT_DELETED','SHADOW_STARTED','SUBMITTED','WITHDRAWN',
  'APPROVED','REJECTED','PAUSED','RESUMED','BACKTEST_DONE')),
 comment TEXT NOT NULL DEFAULT '', snapshot JSONB NOT NULL DEFAULT '{}',
 business_at TIMESTAMPTZ NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX events_rule ON rules.events(rule_id,event_id DESC);
CREATE TABLE rules.event_recipients (
 event_id BIGINT NOT NULL REFERENCES rules.events ON DELETE CASCADE, user_id BIGINT NOT NULL REFERENCES core.users,
 PRIMARY KEY(event_id,user_id)
);

-- 백테스트 1회.
CREATE TABLE rules.backtests (
 backtest_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 version_id BIGINT NOT NULL REFERENCES rules.rule_versions,
 definition_digest CHAR(64) NOT NULL,
 baseline_version_id BIGINT REFERENCES rules.rule_versions,
 date_from DATE NOT NULL, date_to DATE NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
 progress SMALLINT NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 cancel_requested BOOLEAN NOT NULL DEFAULT false,
 requested_by BIGINT NOT NULL REFERENCES core.users, requested_at TIMESTAMPTZ NOT NULL,
 started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ,
 tx_count BIGINT, result JSONB, error_code TEXT
);
CREATE INDEX backtests_version ON rules.backtests(version_id,backtest_id DESC);
-- 백테스트의 대상별 결과(사례 표의 한 줄). subject_id 는 core.accounts.account_id 또는 tx_id.
CREATE TABLE rules.backtest_subjects (
 backtest_id BIGINT NOT NULL REFERENCES rules.backtests ON DELETE CASCADE,
 subject_type TEXT NOT NULL CHECK(subject_type IN ('ACCOUNT','TX')), subject_id BIGINT NOT NULL,
 in_new BOOLEAN NOT NULL, in_base BOOLEAN NOT NULL,
 measured JSONB NOT NULL, tx_ids BIGINT[] NOT NULL,
 alert_id BIGINT REFERENCES review.alerts,
 judgement TEXT CHECK(judgement IN ('SUSPICIOUS','NORMAL')),
 PRIMARY KEY(backtest_id,subject_type,subject_id)
);

-- 일일 실행 1회 = 분석 run × 룰 버전. busy_* 는 실행 당시의 바쁜 계좌 기준이고 busy_max 0 은 끔이다.
CREATE TABLE rules.executions (
 execution_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id UUID NOT NULL REFERENCES analysis.runs,
 version_id BIGINT NOT NULL REFERENCES rules.rule_versions,
 mode TEXT NOT NULL CHECK(mode IN ('LIVE','SHADOW')),
 status TEXT NOT NULL CHECK(status IN ('QUEUED','RUNNING','COMPLETED','FAILED')),
 attempt_count INTEGER NOT NULL DEFAULT 0,
 started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ,
 trigger_count INTEGER, hit_count INTEGER, skipped_subjects INTEGER, error_code TEXT,
 busy_max INTEGER NOT NULL, busy_window_minutes INTEGER NOT NULL,
 UNIQUE(run_id,version_id)
);
CREATE INDEX executions_queue ON rules.executions(execution_id) WHERE status IN ('QUEUED','RUNNING');

-- 적중 1건 = 버전 × 대상 × 날짜. creates_alert 는 적중 당시 그 버전의 THEN 이 Alert 생성이었는지다.
CREATE TABLE rules.hits (
 hit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 version_id BIGINT NOT NULL REFERENCES rules.rule_versions,
 execution_id BIGINT NOT NULL REFERENCES rules.executions,
 mode TEXT NOT NULL CHECK(mode IN ('LIVE','SHADOW')),
 creates_alert BOOLEAN NOT NULL,
 subject_type TEXT NOT NULL CHECK(subject_type IN ('ACCOUNT','TX')), subject_id BIGINT NOT NULL,
 hit_date DATE NOT NULL,
 window_start TIMESTAMPTZ NOT NULL, window_end TIMESTAMPTZ NOT NULL,
 measured JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(version_id,subject_type,subject_id,hit_date)
);
CREATE INDEX hits_version_date ON rules.hits(version_id,hit_date DESC);
CREATE TABLE rules.hit_transactions (
 hit_id BIGINT NOT NULL REFERENCES rules.hits ON DELETE CASCADE,
 tx_id BIGINT NOT NULL REFERENCES ledger.transactions,
 PRIMARY KEY(hit_id,tx_id)
);
-- Alert 의 거래 → 적중 찾기.
CREATE INDEX hit_transactions_tx ON rules.hit_transactions(tx_id);

-- Alert 생성기가 읽는 유일한 창구: Alert 생성 룰의 운영 적중의 근거 거래.
CREATE VIEW rules.alert_seeds AS
 SELECT e.run_id,ht.tx_id,h.version_id
 FROM rules.hits h
 JOIN rules.executions e ON e.execution_id=h.execution_id AND e.status='COMPLETED'
 JOIN rules.hit_transactions ht ON ht.hit_id=h.hit_id
 WHERE h.mode='LIVE' AND h.creates_alert;

-- 위험 점수 구간. 가장 최근 줄이 현재 값이고 나머지는 이력이다.
CREATE TABLE rules.risk_bands (
 band_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 caution_from DOUBLE PRECISION NOT NULL, danger_from DOUBLE PRECISION NOT NULL,
 saved_by BIGINT REFERENCES core.users, saved_at TIMESTAMPTZ NOT NULL,
 CHECK(caution_from>0 AND caution_from<danger_from AND danger_from<1)
);
INSERT INTO rules.risk_bands(caution_from,danger_from,saved_at) VALUES (0.7,0.9,now());
