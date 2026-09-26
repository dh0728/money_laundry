-- V1 초기 스키마 — [W2 DB 설계] 2026-09-07
-- 기준: API.md v0.3(§0 명명·금액, §1.3 batch_jobs, §1.4 원장, §2.2 점수, §5 사용자), kickoff §4 "W2 [DB 설계] 입력",
--       worktable/dberd_정합_메모.md. 관계 전체 그림은 backend/api-server/ERD.md.
-- 팀 dberd(docs_ref/dberd.md)와의 차이:
--   · 거래 식별자 tx_id (dberd transaction_id) — S3 파일 계약과 같은 이름(09-07 사용자 확정)
--   · bank_id INTEGER (dberd VARCHAR(50)) — IBM 은행 코드 정수 그대로, banks 테이블 PK
--   · inference_results: (job_id, tx_id) PK + 확률 원값(p_laundering, p_0..p_8) 저장. 모델·피처 버전은 batch_jobs에 기록
--     (dberd는 transaction_id+model_version UNIQUE, risk_score·predicted_label)
--   · risk_signals·entities·alert_signals·alert_patterns 없음 — 일 배치·MVP 범위 밖
--   · 라벨은 evaluation 스키마로 분리(dberd §10 채택)
--   · alerts·alert_transactions·alert_accounts·episodes·history는 W3·W4 마이그레이션(ERD.md에 예약)

-- 은행: 원장에 등장하는 모든 은행 코드(적재 시 자동 upsert). is_reporting = API 키를 가진 보고 은행
CREATE TABLE banks (
    bank_id      INTEGER PRIMARY KEY,
    name         VARCHAR(100),
    country      VARCHAR(50),
    is_reporting BOOLEAN NOT NULL DEFAULT FALSE,
    api_key_hash CHAR(64) UNIQUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 계좌: 가명 계좌. IBM은 계좌번호가 은행 안에서만 유일 → (bank_id, account_number)
CREATE TABLE accounts (
    account_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bank_id        INTEGER NOT NULL REFERENCES banks,
    account_number VARCHAR(100) NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (bank_id, account_number)
);

-- 환율: data_work/fx_rates_usd.txt 스냅샷. units_per_usd = 1 USD당 해당 통화 단위 수 → amount_usd = amount / units_per_usd
CREATE TABLE fx_rates (
    fx_rate_version VARCHAR(50) NOT NULL,
    currency        CHAR(3) NOT NULL,
    units_per_usd   NUMERIC(20, 8) NOT NULL,
    PRIMARY KEY (fx_rate_version, currency)
);

-- 배치 작업: 테이블 1개 + job_type. uploadId = INGEST 행, jobId = ANALYSIS 행(같은 시퀀스)
CREATE TABLE batch_jobs (
    job_id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_type               VARCHAR(10) NOT NULL CHECK (job_type IN ('INGEST', 'ANALYSIS')),
    status                 VARCHAR(20) NOT NULL CHECK (status IN (
                               'URL_ISSUED', 'RECEIVED', 'RUNNING', 'COMPLETED', 'VALIDATION_FAILED', 'FAILED', 'EXPIRED',
                               'SCHEDULED', 'QUEUED', 'RETRY_WAIT')),
    attempt_count          INTEGER NOT NULL DEFAULT 0,
    claimed_at             TIMESTAMPTZ,
    heartbeat_at           TIMESTAMPTZ,
    started_at             TIMESTAMPTZ,
    finished_at            TIMESTAMPTZ,
    error_code             VARCHAR(50),
    error_message          TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- INGEST 전용
    bank_id                INTEGER REFERENCES banks,
    business_date          DATE,
    file_name              VARCHAR(255),
    file_hash              CHAR(64),
    size_bytes             BIGINT,
    s3_key                 VARCHAR(512),
    url_issued_at          TIMESTAMPTZ,
    url_expires_at         TIMESTAMPTZ,
    received_at            TIMESTAMPTZ,
    row_count              INTEGER,
    missing_count          INTEGER,
    duplicate_count        INTEGER,
    validation_errors      JSONB,
    -- ANALYSIS 전용
    analysis_date          DATE,
    threshold_value        DOUBLE PRECISION,
    model_version_binary   VARCHAR(100),
    model_version_type     VARCHAR(100),
    feature_version_binary VARCHAR(100),
    feature_version_type   VARCHAR(100),
    suspicious_tx_count    INTEGER,
    alert_count            INTEGER
);
CREATE UNIQUE INDEX uq_batch_jobs_analysis_date ON batch_jobs (analysis_date) WHERE job_type = 'ANALYSIS';
CREATE INDEX ix_batch_jobs_ingest_file_hash ON batch_jobs (file_hash) WHERE job_type = 'INGEST';
CREATE INDEX ix_batch_jobs_ingest_bank_created ON batch_jobs (bank_id, created_at) WHERE job_type = 'INGEST';

-- 원장: 표준화·가명화된 거래. bank_id = 보고(업로드) 은행, 송수신 은행은 accounts.bank_id
CREATE TABLE transactions (
    tx_id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bank_id            INTEGER NOT NULL REFERENCES banks,
    occurred_at        TIMESTAMPTZ NOT NULL,
    from_account_id    BIGINT NOT NULL REFERENCES accounts,
    to_account_id      BIGINT NOT NULL REFERENCES accounts,
    amount_received    NUMERIC(24, 6) NOT NULL CHECK (amount_received >= 0),
    receiving_currency CHAR(3) NOT NULL,
    amount_paid        NUMERIC(24, 6) NOT NULL CHECK (amount_paid >= 0),
    payment_currency   CHAR(3) NOT NULL,
    payment_format     VARCHAR(30) NOT NULL,
    amount_usd         NUMERIC(24, 6) NOT NULL,
    fx_rate_version    VARCHAR(50) NOT NULL,
    row_hash           CHAR(64) NOT NULL,
    ingest_job_id      BIGINT NOT NULL REFERENCES batch_jobs,
    scored_job_id      BIGINT REFERENCES batch_jobs,
    ingested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (bank_id, row_hash)
);
CREATE INDEX ix_transactions_from_time ON transactions (from_account_id, occurred_at);
CREATE INDEX ix_transactions_to_time ON transactions (to_account_id, occurred_at);
CREATE INDEX ix_transactions_occurred_at ON transactions (occurred_at);
CREATE INDEX ix_transactions_unscored ON transactions (tx_id) WHERE scored_job_id IS NULL;

-- 거래별 점수: 추론 에이전트 scores.parquet 원값 그대로. 파생(typeClass 등)은 조회 시 계산. score_pct = job 내 백분위(0~100)
CREATE TABLE inference_results (
    job_id       BIGINT NOT NULL REFERENCES batch_jobs,
    tx_id        BIGINT NOT NULL REFERENCES transactions,
    p_laundering DOUBLE PRECISION NOT NULL,
    p_0          DOUBLE PRECISION NOT NULL,
    p_1          DOUBLE PRECISION NOT NULL,
    p_2          DOUBLE PRECISION NOT NULL,
    p_3          DOUBLE PRECISION NOT NULL,
    p_4          DOUBLE PRECISION NOT NULL,
    p_5          DOUBLE PRECISION NOT NULL,
    p_6          DOUBLE PRECISION NOT NULL,
    p_7          DOUBLE PRECISION NOT NULL,
    p_8          DOUBLE PRECISION NOT NULL,
    score_pct    DOUBLE PRECISION,
    PRIMARY KEY (job_id, tx_id),
    CHECK (p_laundering BETWEEN 0 AND 1),
    CHECK (score_pct IS NULL OR score_pct BETWEEN 0 AND 100)
);
CREATE INDEX ix_inference_results_job_score ON inference_results (job_id, p_laundering DESC);

-- 거래별 피처: 모델별 세트 2개(BINARY·TYPE), 구성 변동 전제 → JSONB 행 저장(컬럼 고정 안 함, feature_version으로 식별)
CREATE TABLE transaction_features (
    job_id          BIGINT NOT NULL REFERENCES batch_jobs,
    tx_id           BIGINT NOT NULL REFERENCES transactions,
    model_kind      VARCHAR(6) NOT NULL CHECK (model_kind IN ('BINARY', 'TYPE')),
    feature_version VARCHAR(100) NOT NULL,
    features        JSONB NOT NULL,
    PRIMARY KEY (job_id, tx_id, model_kind)
);

-- 사용자: 역할 3종. last_assigned_at = 라운드로빈 포인터. password_hash는 W4 [인증]에서 환경변수 시드로 채움
CREATE TABLE users (
    user_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username         VARCHAR(50) NOT NULL UNIQUE,
    name             VARCHAR(100) NOT NULL,
    role             VARCHAR(10) NOT NULL CHECK (role IN ('L1', 'L2', 'ADMIN')),
    password_hash    VARCHAR(100),
    last_assigned_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 평가 전용 스키마: 라벨은 운영 원장에 두지 않는다. API·화면 비노출
CREATE SCHEMA evaluation;
CREATE TABLE evaluation.transaction_labels (
    tx_id         BIGINT PRIMARY KEY REFERENCES transactions,
    is_laundering BOOLEAN NOT NULL,
    pattern_label SMALLINT,
    attempt_id    INTEGER
);

-- 시드: 환율 스냅샷(15종, ISO 4217) — data_work/fx_rates_usd.txt
INSERT INTO fx_rates (fx_rate_version, currency, units_per_usd) VALUES
    ('fx_rates_usd_v1', 'AUD', 1.41280000),
    ('fx_rates_usd_v1', 'BTC', 0.00008416),
    ('fx_rates_usd_v1', 'BRL', 5.64649997),
    ('fx_rates_usd_v1', 'CAD', 1.31930001),
    ('fx_rates_usd_v1', 'EUR', 0.85340000),
    ('fx_rates_usd_v1', 'MXN', 21.14310180),
    ('fx_rates_usd_v1', 'RUB', 77.80399773),
    ('fx_rates_usd_v1', 'INR', 73.44397914),
    ('fx_rates_usd_v1', 'SAR', 3.75109996),
    ('fx_rates_usd_v1', 'ILS', 3.37699997),
    ('fx_rates_usd_v1', 'CHF', 0.91500000),
    ('fx_rates_usd_v1', 'GBP', 0.77420000),
    ('fx_rates_usd_v1', 'USD', 1.00000000),
    ('fx_rates_usd_v1', 'JPY', 105.39995594),
    ('fx_rates_usd_v1', 'CNY', 6.69760020);

-- 시드: 사용자 L1 2·L2 2·ADMIN 1 (라운드로빈은 W3부터 필요, 비밀번호는 W4)
INSERT INTO users (username, name, role) VALUES
    ('l1a', 'L1 심사자 A', 'L1'),
    ('l1b', 'L1 심사자 B', 'L1'),
    ('l2a', 'L2 조사관 A', 'L2'),
    ('l2b', 'L2 조사관 B', 'L2'),
    ('admin', '관리자', 'ADMIN');
