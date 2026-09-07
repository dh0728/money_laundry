# ERD 스케치 — 2026-09-07 ([W2 DB 설계])

지위: 관계·식별자의 확정 기록. 컬럼의 정본은 Flyway 마이그레이션(`src/main/resources/db/migration`)이고, API 계약은 `API.md` v0.3이다.
팀 ERD(`docs_ref/dberd.md`, 송동현)와의 정합 판정은 `worktable/dberd_정합_메모.md`. 이 문서는 V1에 든 테이블과 W3·W4에서 추가할 테이블을 한 그림에 둔다.

용어(kickoff §2.5): `거래 → (임계 선별) 의심 거래 → (자동 묶음) Alert → (조사·연결) Episode`.

## 1. 전체 관계

```mermaid
erDiagram
    banks ||--o{ accounts : has
    banks ||--o{ transactions : reports
    banks ||--o{ batch_jobs : "INGEST bank_id"
    accounts ||--o{ transactions : "from_account_id"
    accounts ||--o{ transactions : "to_account_id"
    batch_jobs ||--o{ transactions : "ingest_job_id"
    batch_jobs ||--o{ transactions : "scored_job_id"
    batch_jobs ||--o{ inference_results : "job_id"
    batch_jobs ||--o{ transaction_features : "job_id"
    transactions ||--o{ inference_results : "tx_id"
    transactions ||--o{ transaction_features : "tx_id"
    transactions ||--o| evaluation_transaction_labels : "tx_id"

    batch_jobs ||--o{ alerts : "job_id (W3)"
    alerts ||--o{ alert_transactions : "alert_id (W3)"
    transactions ||--o| alert_transactions : "tx_id UNIQUE (W3)"
    alerts ||--o{ alert_accounts : "alert_id (W3)"
    accounts ||--o{ alert_accounts : "account_id (W3)"
    accounts ||--o{ alerts : "subject_account_id (W3)"
    users ||--o{ alerts : "assignee_id (W3)"
    episodes ||--o{ alerts : "episode_id (W4)"
    users ||--o{ episodes : "assignee_id / created_by (W4)"
    users ||--o{ history : "actor_id (W4)"

    banks {
        int bank_id PK "IBM 은행 코드"
        varchar name "nullable"
        varchar country "nullable"
        boolean is_reporting "API 키 보유 = 도착 현황·시드 대상"
        char api_key_hash "SHA-256, UNIQUE"
    }
    accounts {
        bigint account_id PK
        int bank_id FK
        varchar account_number "가명"
    }
    fx_rates {
        varchar fx_rate_version PK
        char currency PK "ISO 4217"
        numeric units_per_usd "amount_usd = amount / units_per_usd"
    }
    batch_jobs {
        bigint job_id PK "uploadId(INGEST) · jobId(ANALYSIS)"
        varchar job_type "INGEST | ANALYSIS"
        varchar status "API.md §1.3"
        int attempt_count
        timestamptz claimed_at
        timestamptz heartbeat_at
        date analysis_date "ANALYSIS, UNIQUE"
        double threshold_value "ANALYSIS 스냅샷"
        varchar model_version_binary
        varchar model_version_type
        varchar feature_version_binary
        varchar feature_version_type
        int bank_id FK "INGEST"
        char file_hash "INGEST sha256"
        varchar s3_key
        timestamptz url_issued_at
        timestamptz url_expires_at
        timestamptz received_at
        jsonb validation_errors "errors[] {row, column, reason}"
    }
    transactions {
        bigint tx_id PK
        int bank_id FK "보고 은행"
        timestamptz occurred_at
        bigint from_account_id FK
        bigint to_account_id FK
        numeric amount_paid
        char payment_currency "ISO"
        numeric amount_received
        char receiving_currency "ISO"
        varchar payment_format
        numeric amount_usd
        varchar fx_rate_version
        char row_hash "UNIQUE(bank_id, row_hash)"
        bigint ingest_job_id FK
        bigint scored_job_id FK "NULL = 미채점"
    }
    inference_results {
        bigint job_id PK_FK
        bigint tx_id PK_FK
        double p_laundering
        double p_0_to_p_8 "9클래스 확률 원값"
        double score_pct "job 내 백분위 0~100"
    }
    transaction_features {
        bigint job_id PK_FK
        bigint tx_id PK_FK
        varchar model_kind PK "BINARY | TYPE"
        varchar feature_version
        jsonb features "피처명 → 값"
    }
    users {
        bigint user_id PK
        varchar username UK
        varchar name
        varchar role "L1 | L2 | ADMIN"
        varchar password_hash "W4 [인증]에서 채움"
        timestamptz last_assigned_at "라운드로빈 포인터"
    }
    evaluation_transaction_labels {
        bigint tx_id PK_FK "스키마 evaluation"
        boolean is_laundering
        smallint pattern_label
        int attempt_id
    }
    alerts {
        bigint alert_id PK "W3"
        bigint job_id FK
        date analysis_date
        double risk_score
        smallint primary_type "0~8"
        jsonb type_distribution
        bigint subject_account_id FK
        varchar status "OPEN | ESCALATED | CLOSED"
        varchar resolution "NORMAL | FALSE_POSITIVE, CLOSED일 때만"
        bigint episode_id FK "ESCALATED과 항상 일치"
        bigint assignee_id FK "L1, NOT NULL"
        timestamptz assigned_at
        timestamptz first_opened_at "NULL = 미열람"
    }
    alert_transactions {
        bigint alert_id PK_FK "W3"
        bigint tx_id PK_FK "UNIQUE(tx_id) — 한 거래 = 한 Alert"
        varchar role "SEED | SUPPORTING | PATH | PATTERN_MEMBER"
        text included_reason
    }
    alert_accounts {
        bigint alert_id PK_FK "W3"
        bigint account_id PK_FK "INDEX(account_id)"
        varchar role "SUBJECT | SOURCE | DESTINATION | INTERMEDIARY | HUB"
        int in_count
        numeric in_amount_usd
        int out_count
        numeric out_amount_usd
        double max_score
        int counterparty_count
    }
    episodes {
        bigint episode_id PK "W4"
        varchar status "OPEN | CLOSED"
        varchar resolution "NORMAL | SUSPICIOUS"
        bigint assignee_id FK "L2"
        timestamptz assigned_at
        timestamptz first_opened_at
        bigint created_by FK "L1"
        timestamptz closed_at
    }
    history {
        bigint id PK "W4, append-only"
        varchar actor_type "SYSTEM | USER"
        bigint actor_id FK "nullable"
        varchar action "API.md §6 enum"
        varchar target_type "ALERT | EPISODE"
        bigint target_id
        jsonb related_ids
        varchar from_status
        varchar to_status
        varchar resolution
        text comment
    }
```

## 2. V1에 든 것 (2026-09-07)

| 테이블 | 식별자 | 핵심 제약·인덱스 | 근거 |
|---|---|---|---|
| `banks` | `bank_id` = IBM 코드 정수 | `api_key_hash` UNIQUE, `is_reporting` | 착수 결정 3 |
| `accounts` | `account_id` 발급 | `UNIQUE(bank_id, account_number)` | dberd 채택, 가명화 (은행, 계좌) 쌍 전제 |
| `fx_rates` | `(fx_rate_version, currency)` | 시드 15종 `fx_rates_usd_v1` | API.md §0 금액·통화 |
| `batch_jobs` | `job_id` (INGEST·ANALYSIS 공용 시퀀스) | `analysis_date` UNIQUE(ANALYSIS 부분 인덱스), `file_hash`·`(bank_id, created_at)` INGEST 부분 인덱스, `status` CHECK | API.md §1.3, kickoff §2.2 |
| `transactions` | `tx_id` 발급 | `UNIQUE(bank_id, row_hash)`, `(from_account_id, occurred_at)`·`(to_account_id, occurred_at)`(**V1 필수**)·`occurred_at`·미채점 부분 인덱스 | API.md §1.4, 착수 결정 1 |
| `inference_results` | `(job_id, tx_id)` | `p_laundering` 0~1 CHECK, `(job_id, p_laundering DESC)` | API.md §2.2, 정합 메모 B(이름은 팀 것) |
| `transaction_features` | `(job_id, tx_id, model_kind)` | JSONB 행 저장(2026-09-07 사용자 확정) | kickoff §7 권고안 |
| `users` | `user_id` 발급 | `username` UNIQUE, `role` CHECK, 시드 L1 2·L2 2·ADMIN 1 | API.md §3.4·§5 |
| `evaluation.transaction_labels` | `tx_id` | 운영 스키마 밖 | 착수 결정 2 |

## 3. W3·W4에서 추가할 것 — 관계·식별자만 지금 확정

- **`alerts`** (W3 [스키마]): `job_id` FK, `subject_account_id` FK(nullable), `assignee_id` FK users NOT NULL(라운드로빈), `episode_id` FK episodes(nullable, `status = ESCALATED`와 항상 일치 — CHECK), `status`·`resolution`(CLOSED일 때만 — CHECK). 파생 요약 컬럼(`tx_count`, `total_amount_usd`, `amounts_by_currency`, `account_count`, `bank_count`, `score_*`, `weighted_amount_usd`, `type_entropy`, `first_tx_at`, `last_tx_at`, `link_basis`)은 API.md §3.1. `episodes`를 참조하므로 W3에서 `episodes` 뼈대(id·status)를 먼저 만들거나 W4에서 FK를 추가한다 — W3 [스키마] 때 정한다.
- **`alert_transactions`** (W3): PK `(alert_id, tx_id)` + **`UNIQUE(tx_id)`**(착수 결정 4). 처분된 Alert의 거래는 재묶음 입력에서 제외.
- **`alert_accounts`** (W3): PK `(alert_id, account_id)` + `INDEX(account_id)`(관련 Alert·계좌 이력 조회 — V1 필수 목록의 세 번째 인덱스, 테이블이 생기는 W3에서 함께).
- **`episodes`** (W4 [워크플로]): `assignee_id` FK users(L2), `created_by` FK users(L1), `status`·`resolution`·`first_opened_at`. Alert : Episode = N : 1(`alerts.episode_id`) — dberd `case_alerts` N:M을 채택하지 않음(정합 메모 B).
- **`history`** (W4, 감사 이력 단일 테이블): `actor_type`·`actor_id`·`action`·`target_type`·`target_id`·`related_ids`·`from_status`·`to_status`·`resolution`·`comment`·`created_at`. dberd `alert_events`의 `actor_type`·`details` 채택, `request_id`는 MDC 도입 후.
- 10월 예약: `thresholds`(threshold_version), `bank_api_keys`(키 회전이 필요해지면 `banks.api_key_hash`를 분리), `model_versions`, `batch_jobs.grouping_version`(Alert 구성 알고리즘 버전 — 정합 메모 A 권장, W3 [스키마]에서 `alerts`와 함께 넣을지 결정).

## 4. 이 태스크에서 정한 컨벤션 (2026-09-07 사용자 확인 완료)

- **금액 `NUMERIC(24,6)`**(dberd 타입 채택 — API.md §1.4의 `numeric(18,2)`는 Bitcoin 소수 6자리를 잃는다. HI-Small 실측 최대 6자리).
- **확률 `DOUBLE PRECISION`**(scores.parquet float64 그대로, Python 적재에 변환 없음. dberd `NUMERIC(8,7)`과 다름).
- **환율 의미**: `fx_rates_usd.txt`는 "1 USD당 통화 단위"(EUR 0.8534, JPY 105.4)이므로 `amount_usd = amount_paid / units_per_usd`. API.md §1.4 정정 완료(09-07).
- **은행 API 키 시드는 V1에 없다**: 키는 환경변수이므로 SQL 시드가 불가 — [원장 적재]에서 기동 시 upsert(보고 은행 3~4곳 + 해시).
- **사용자 시드에 비밀번호 없음**: `password_hash` nullable, W4 [인증]에서 환경변수로 채움. 시드는 W3 라운드로빈에 먼저 필요해서 V1에 둔다.
- **`validation_errors JSONB`**: API.md §1.2 `errors[]`의 저장처(계약에 컬럼명이 없어 추가).
- **라벨 타입**: `pattern_label SMALLINT`(HI-Small_labels_10class.csv의 10클래스 코드), `attempt_id INTEGER`(-1은 NULL로).
- **피처 저장 형식 = JSONB 행 저장**(2026-09-07 사용자 확정). 기각 대안: 버전별 wide 테이블 재생성(피처 개선마다 마이그레이션), DB 미저장(설명 요인·기준선이 parquet을 읽어야 함).
