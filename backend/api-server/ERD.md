# ERD — 적용 스키마 V1~V9와 다음 조사 저장 계약

실행 DB: PostgreSQL 17. 인프라·로컬 Compose·통합 테스트의 이미지 태그는 `postgres:17-alpine`이다. DB 이미지 변경 자체는 Flyway 스키마 변경이 아니므로 기존 마이그레이션을 수정하지 않는다.

로컬 Compose는 Alpine에서 초기화한 `pgdata_alpine` 볼륨을 사용한다. 다른 배포판에서 만든 DB 데이터 디렉터리를 직접 연결하지 않고, 기존 데이터가 있다면 논리 백업·복원 후 검증한다.

지위: 관계·식별자의 확정 기록. 컬럼의 정본은 Flyway 마이그레이션(`src/main/resources/db/migration`)이고, API 계약은 `API.md` v0.9다.
팀 ERD(`docs_ref/dberd.md`, 송동현)와의 정합 판정은 `worktable/dberd_정합_메모.md`. 아래 첫 그림은 과거 개념 모델로 적용 DDL이 아니다. 특히 단일 Episode 귀속 관계는 현재 설계가 아니며, 실제 적용은 V1~V9 절과 Flyway, 다음 조사 구조는 마지막 절을 따른다.

용어(kickoff §2.5): `거래 → (임계 선별) 의심 거래 → (자동 묶음) Alert → (조사·연결) Episode`.

## 1. 과거 개념 관계 (적용 DDL 및 다음 조사 계약과 구분)

```mermaid
erDiagram
    banks ||--o{ accounts : has
    banks ||--o{ report_sets : reports
    banks ||--o{ bank_reporting_periods : contract
    reporting_scopes ||--o{ reporting_scope_banks : fixes
    report_sets ||--o{ report_versions : versions
    batch_jobs ||--o| report_versions : upload_id
    report_versions ||--o{ private_bank_reports : source_rows
    transactions ||--o{ transaction_reports : provenance
    private_bank_reports ||--o| transaction_reports : matched_once
    private_entities ||--o{ accounts : owns
    banks ||--o{ batch_jobs : "INGEST bank_id"
    accounts ||--o{ transactions : "from_account_id"
    accounts ||--o{ transactions : "to_account_id"
    batch_jobs ||--o{ transactions : "scored_job_id"
    batch_jobs ||--o{ inference_results : "job_id"
    batch_jobs ||--o{ transaction_features : "job_id"
    transactions ||--o{ inference_results : "tx_id"
    transactions ||--o{ transaction_features : "tx_id"
    transactions ||--o| evaluation_transaction_labels : "tx_id"

    batch_jobs ||--o{ alerts : "job_id (W3)"
    alerts ||--o{ alert_transactions : "alert_id (W3)"
    transactions ||--o{ alert_transactions : "tx_id N:M (V6)"
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
        boolean is_reporting "보고 은행 = 도착 현황 대상"
        char api_key_hash "기존 호환용, nullable, UNIQUE"
    }
    accounts {
        bigint account_id PK
        int bank_id FK
        uuid service_account_id UK
        bigint entity_id FK
        text account_lookup_token "private only"
        text identity_cipher "private only"
        text key_version
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
        date business_date
        bigint generation
        text integration_status
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
    }
    alert_transactions {
        bigint alert_id PK_FK "W3"
        bigint tx_id PK_FK "version별 N:M"
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

## 2. 현재 스키마 (V1~V4)

| 테이블 | 식별자 | 핵심 제약·인덱스 | 근거 |
|---|---|---|---|
| `banks` | `bank_id` = IBM 코드 정수 | `api_key_hash` UNIQUE, `is_reporting` | 착수 결정 3 |
| `private.accounts` | 내부 account_id와 별도 service_account_id UUID | UNIQUE(bank_id,account_lookup_token), entity_id FK | 원문 계좌 암호문·소유 개체 분리 |
| `fx_rates` | `(fx_rate_version, currency)` | 시드 15종 `fx_rates_usd_v1` | API.md §0 금액·통화 |
| `batch_jobs` | `job_id` (INGEST·ANALYSIS 공용 시퀀스) | `analysis_date` UNIQUE(ANALYSIS 부분 인덱스), `file_hash`·`(bank_id, created_at)` INGEST 부분 인덱스, `status` CHECK | API.md §1.3, kickoff §2.2 |
| `transactions` | tx_id 발급, business_date/generation/status | 송수신 계좌·시각 인덱스, source 연결은 transaction_reports | 동일 내용 반복도 발생 건별 저장 |
| `inference_results` | `(job_id, tx_id)` | `p_laundering` 0~1 CHECK, `(job_id, p_laundering DESC)` | API.md §2.2, 정합 메모 B(이름은 팀 것) |
| `transaction_features` | `(job_id, tx_id, model_kind)` | JSONB 행 저장(2026-09-07 사용자 확정) | kickoff §7 권고안 |
| `users` | `user_id` 발급 | `username` UNIQUE, `role` CHECK, 시드 L1 2·L2 2·ADMIN 1 | API.md §3.4·§5 |
| `evaluation.transaction_labels` | `tx_id` | 운영 스키마 밖 | 착수 결정 2 |

### V3 보고와 정상 거래의 분리

| 테이블 | 관계·제약 |
|---|---|
| private.entities | 내부 bigint와 별도 서비스 UUID, 원천 Entity ID 검색 토큰 UNIQUE, 원문 ID/이름 암호문·키 버전 |
| bank_reporting_periods | 은행별 거래 기준일 적용 기간, 같은 은행 기간 중복 거절 |
| reporting_scopes / reporting_scope_banks | 기준일·revision별 고정 수집 범위. 이미 확정한 빈 범위도 자동 재계산하지 않음 |
| report_sets | UNIQUE(bank_id,business_date), current_version_id·generation |
| report_versions | UNIQUE(upload_id), UNIQUE(set_id,version_no), 수신 시각·자체 검수/통합 상태·원인 |
| private.bank_reports | UNIQUE(version_id,source_row), 암호화 보고 payload·키 버전·매칭 검색 토큰·행 상태 |
| transaction_reports | tx_id와 report_id 연결, report_id UNIQUE, SENDER/RECEIVER/INTERNAL 역할 |
| integration_attempts / integration_attempt_versions | cutoff·scope_revision·선택 report version/revision/generation 고정 |
| evaluation.report_labels | report_id별 원천 평가 라벨. 통합시 일치하는 유효 라벨만 transaction_labels 연결 |

그림의 accounts는 `private.accounts`다. API는 서비스 UUID만 공개하고 원문·검색 토큰·암호문은 공개하지 않는다. private/evaluation의 PUBLIC 접근과 기본 테이블 권한을 제거한다. V3에는 분석 입력을 생성하지 않았으며 V4가 analysis.input_transactions를 추가한다. 분석 역할에 private/evaluation 접근을 부여하지 않는다.

V3는 기존 계좌·거래·작업이 있는 DB에서 실패한다. 기존 DB/볼륨을 보존한 별도 빈 개발 DB에 V1~V3를 적용한다. 원문 보호 키는 실행 환경에서만 공급하며 데이터/문서에 넣지 않는다. 서비스 UUID는 새 개발 데이터셋 내 재사용을 보장하며 기존 DB ID를 추정 복원하지 않는다.

정정 교체·실행 취소·고정 분석 입력은 아래 V4로 확장한다. V1~V3 이력은 보존한다. Python 실행측과 실제 S3 관통은 후속 태스크다.

## 3. 조사 기능의 현재와 다음 저장 계약

현재 `alerts`/`alert_versions`/`alert_transactions`는 V6~V9에서 구현됐다. 다음 조사 계약의 Episode·조사 범위·부분 이관·사건별 판정·감사·시연 업무 시각은 아직 마이그레이션이 없다. 구 N:1 `alerts.episode_id` 및 상태와 단일 FK의 동치 제약을 다음 스키마로 채택하지 않는다. 아래 '다음 구현 저장 계약'을 따른다.

## 4. 이 태스크에서 정한 컨벤션 (2026-09-07 사용자 확인 완료)

- **금액 `NUMERIC(24,6)`**(dberd 타입 채택 — 초안의 `numeric(18,2)`는 Bitcoin 소수 6자리를 잃는다. HI-Small 실측 최대 6자리. API.md §1.4 v0.4에서 정정).
- **확률 `DOUBLE PRECISION`**(scores.parquet float64 그대로, Python 적재에 변환 없음. dberd `NUMERIC(8,7)`과 다름).
- **환율 의미**: `fx_rates_usd.txt`는 "1 USD당 통화 단위"(EUR 0.8534, JPY 105.4)이므로 `amount_usd = amount_paid / units_per_usd`. API.md §1.4 정정 완료(09-07).
- **은행 식별**: dev/local X-Bank-Id는 테스트 대역이다. banks.is_reporting 및 bank_reporting_periods를 사전 등록해야 수집하며 URL 요청으로 등록하지 않는다. report_format AML17은 서버의 공통 입력 규칙 선택값이다. 은행 웹·로그인은 범위 밖이다.
- **사용자 시드에 비밀번호 없음**: `password_hash` nullable, W4 [인증]에서 환경변수로 채움. 시드는 W3 라운드로빈에 먼저 필요해서 V1에 둔다.
- **`validation_errors JSONB`**: API.md §1.2 `errors[]`의 저장처(계약에 컬럼명이 없어 추가).
- **라벨 타입**: `pattern_label SMALLINT`(HI-Small_labels_10class.csv의 10클래스 코드), `attempt_id INTEGER`(-1은 NULL로).
- **피처 저장 형식 = JSONB 행 저장**(2026-09-07 사용자 확정). 기각 대안: 버전별 wide 테이블 재생성(피처 개선마다 마이그레이션), DB 미저장(설명 요인·기준선이 parquet을 읽어야 함).


## V2 일별 분석 실행 (2026-09-10)

컬럼 정본: `V2__analysis_execution.sql`. 기존 V1은 변경하지 않는다.

- `batch_jobs`: analysis_cutoff_at, current_stage, stage_attempt_count, consecutive_failures, retry_at, execution_id, execution_owner, completion_reason 추가.
- `analysis_uploads`: (job_id, upload_id) PK, upload_id UNIQUE. 최초 수신 대상 고정과 작업 간 중복 편입 방지. excluded는 검증 실패 파일만 표시한다.
- `analysis_stage_results`: (job_id, stage) PK, execution_id, artifact, completed. 정상 산출물 참조 및 단계 완료 보존. 실제 피처/추론/Alert 연결은 후속 작업이다.
- `analysis_failures`: failure_id UUID PK, job_id, stage, execution_id, error_code, failed_at, consecutive_count, retry_at, action_required. 명시 재개해도 이력은 남는다.
- 세션 advisory lock은 동시 활성 실행을 직렬화하고 실행 UUID가 오래된 결과 쓰기를 차단한다. 수신전이/대상등록은 별도 공유 transaction lock을 쓴다. 원장 자체 INGEST 복구는 이번 범위 밖이다.
- 실제 Python 직접 DB 저장은 토큰 확인·데이터·단계 완료를 Python 자신의 트랜잭션으로 묶어야 한다. Java 테스트 실행기의 트랜잭션은 별도 Python 연결까지 포함하지 않는다.

## V4 정정 및 실행 세대

V1~V3를 변경하지 않는 추가 마이그레이션이다. 기존 보고·거래·분석 이력을 보존한다. 배포 취소는 새 forward migration으로 검토하며 기존 DB를 삭제/초기화하지 않는다.

| 테이블/컬럼 | 계약 |
|---|---|
| correction_requests / correction_errors | 은행·기준일·대상 버전/원인 revision별 요청과 정제된 오류. 미도착 version은 null. 제출 이력은 correction_uploads로 보존 |
| correction_uploads | upload_id PK, correction_id FK, UNIQUE(correction_id,submission_id UUID). 일반 파일 중복과 별개의 업로드 문맥 |
| report_versions | correction_of_version_id FK, self_valid. 후보 대기/분석 해제 대기/교체 이력 상태 추가 |
| analysis_runs | run_id UUID PK, job_id FK, input_revision, READY/ACTIVE/CANCEL_REQUESTED/CANCELLED/COMPLETED, cancel 시각/코드. batch_jobs.current_run_id와 구분 |
| analysis_run_replacements | 새 run/구 run 연결. 여러 취소 실행의 모든 TARGET을 한 후속 입력으로 보존 가능 |
| analysis.input_transactions | (run_id,tx_id,input_role) PK, TARGET/CONTEXT. 원래 시각/금액/통화/방식/서비스 계좌·개체 UUID/환산 버전의 값 복사. 원문·라벨·검색토큰 없음 |
| analysis_input_reports | 입력 run·tx와 당시 report_id 출처 고정. 현재 연결 교체가 과거 입력 출처를 바꾸지 않음 |
| analysis_target_ownership | tx_id PK, run_id FK. 완료 TARGET 및 활성 TARGET의 단일 소유, 취소 TARGET은 대체 연결을 통해서만 재편입 |
| analysis_run_stage_results | (run_id,stage) PK. 기존 V2 analysis_stage_results 보존 |
| analysis_model_requests | request_id/회차별 run·model_kind·게시/종료 상태. 취소와 같은 run 잠금으로 등록/게시 fencing |
| analysis_cancel_outbox | request_id/회차 UNIQUE, cancel_id UUID, 불변 payload·요청 시각, 전달 시도·재시도/확인 상태. 단순 발송은 종료 확인 아님 |

정정·입력 확정은 기존 원문 관계 통합 advisory lock을 공유한다. 보고 set과 job/run을 일정 순서로 잠그고 같은 트랜잭션에서 후보 revision·현재 상태를 검사한다. analysis 스키마 및 테이블의 PUBLIC 권한을 제거하며 Spring은 READY 입력을 트랜잭션으로 고정하고 run 상태와 단계 토큰으로 결과 반영을 차단한다. 실제 Python 입력 조회 역할/뷰와 worker 연결은 후속 범위이며 이 스키마 생성만으로 해당 연결을 완료했다고 주장하지 않는다.

- `analysis_receipts(job_id,upload_id)`는 기존 날짜에 소속된 수신도 포함한 cutoff 고정 전체 수신 집합이다. 검수 지연·이전 날짜 후보를 같은 집합에서 재검사한다.
- `analysis_selected_versions(job_id,set_id,version_id,generation)`는 통합/입력 고정 사이 revision 확인용이다. 거래 입력의 값·출처는 별도 불변 스냅샷이다.
- `inference_results.run_id`, `transaction_features.run_id`는 새 산출물 세대 귀속 경계다. 이전 null run 이력은 current_run_id가 없는 완료 작업에서만 기존 의미로 조회한다. 새 작업의 결과는 현재 완료 run과 일치해야 노출한다. 현재 Python SCORES는 고정 TARGET만 검증·합류하여 run_id와 함께 저장한다. 점수·scored_job_id·버전/카운터·SCORES 체크포인트를 같은 트랜잭션에서 반영한다. 취소된 선행 작업의 점수 행은 보존하고, 명시 대체 run만 해당 거래의 scored_job_id 연결을 갱신한다.
- 취소된 run의 모든 TARGET 출처 묶음이 준비되기 전에는 그 run과 관련된 새 tx_id도 일반 신규 TARGET으로 우회하지 않는다. 완료 CONTEXT의 과거 값/출처와 취소 run 이력은 보존한다.

## V5 모델별 일감

`analysis_model_tasks`는 `(run_id, model_kind)`별 로컬 작업·산출물·원격 관측을 저장한다. V1~V4의 표와 데이터를 변경하지 않으며, 기존 원격 요청 및 취소 이력은 `analysis_model_requests`와 `analysis_cancel_outbox`에 유지한다. 되돌림이 필요하면 후속 forward migration을 사용하며 DB 초기화를 요구하지 않는다.

- phase: PREPARE/PUBLISH/WAIT_REMOTE/COLLECT/DONE. status: READY/ACTIVE/WAITING/RETRY_WAIT/SUCCEEDED/FAILED/CANCELLED. 현재 실행 연결은 PREPARE→PUBLISH→WAIT_REMOTE→COLLECT→DONE/SUCCEEDED다. 두 모델의 검증된 결과를 SCORES에서 합류 저장한다. ALERTS 저장은 V6에서 연결되었다.
- binding: 실행 동안 고정된 JSONB 모델/피처/입력 계약 버전. 현재 demo 버전만 사용한다. 인증 정보·서명 URL·실제 입력 행을 넣지 않는다. input_artifact/result_artifact는 파일 참조와 검증 메타데이터다.
- request_id/execution_round는 둘 다 NULL이거나 V4 요청을 참조한다. execution_id/execution_owner는 ACTIVE일 때만 함께 존재한다. 현재 PREPARE의 owner는 상위 FEATURES 실행 토큰이다. operation_attempts는 모델 계산이 아닌 로컬 동작 시도 횟수다.
- retry_at/next_poll_at/remote_deadline_at, remote_revision/remote_snapshot/last_event_id, error_code/action_required, 생성·갱신·종료 시각을 둔다. GET 관측은 revision·식별·완료 메타데이터를 검사해 저장하고 예약 시각에 다시 실행한다. 콜백(last_event_id 사용)은 아직 연결 전이다.
- Python은 모델별 입력 파일을 완성한 후 임시 테이블에 피처를 청크 적재한다. 최종 integration lock→job→run→task 검사와 `transaction_features` 저장·PUBLISH/READY 전이를 하나의 트랜잭션으로 처리한다. 파일 계산·추론 대기 동안 DB 행 잠금을 유지하지 않는다.
- 먼저 준비된 모델은 다른 모델 실패 후에도 재사용한다. 같은 상위 토큰의 중복 프로세스는 ACTIVE 소유권을 빼앗지 못하고, 새 상위 토큰은 중단된 PREPARE를 회수할 수 있다. 재사용 시 파일 존재·크기·SHA256·버전을 확인한다.
- 현재 FEATURES 실행은 두 모델을 순차 준비한 뒤 상위 체크포인트를 기록한다. 모델별 즉시 게시·비동기 실행은 후속 연결이며, INFERENCE/SCORES 완료는 실제 검증·DB 체크포인트에 의존하며 ALERTS를 가짜 성공으로 넘기지 않는다. 시연 피처는 결과 도착 전 `transaction_features`에 저장되고, 과거 run의 행을 덮어쓰지 않는다.
- 정정 취소는 같은 트랜잭션에서 모델별 토큰도 무효화한다. 산출물 참조와 피처는 이력으로 보존하며 취소 run의 신규 반영은 거절한다.


## V6 고정 맥락·Alert 근거

현재 Alert 정본은 V6이며 위 W3/W4 예약 컬럼은 향후 확장 목표다. 기존 V1~V5는 변경하지 않는다.

- `alerts`: 사건 ID, OPEN/CLOSED/ESCALATED, resolution, L1 assignee FK, parent_alert_id 자기참조, created_at. Episode 연결·판정 변경 API는 후속 구현이다.
- `alert_versions`: PK(alert_id,version), UNIQUE(alert_id,run_id), run FK, fingerprint, immutable evidence JSONB. 완료 run/job 버전만 공개한다. evidence는 씨앗·가명 거래·동결 점수·요약·그래프·초기 제한을 포함한다.
- `alert_transactions`: PK(alert_id,version,tx_id), version 복합 FK, 원장 tx FK, SEED/CONNECTION/CONTEXT, reasons JSONB. 한 거래는 여러 사건 및 여러 버전에 존재할 수 있다.
- `alert_coverage_checks`: PK(alert_id,run_id), 날짜별 수신 현황·탐색 제한 JSONB, V7의 nullable checked_at(실제 검사 시각). 기존 행의 시각은 추정하지 않는다. 새 연결 없는 재검사는 근거 버전을 만들지 않는다. API는 forward_complete를 공개하지 않고 dataAsOf(근거 run의 cutoff)·lastCheckedAt(성공 검사 checked_at)를 구분한다.
- `analysis.alert_origins`: run별 기존 공개 Alert 버전·evidence 고정. V8 보고/수집 범위 변경 날짜가 기존 구성 거래일 전후2일과 겹치는 사건을 고정하며 완료 후속 사건이 있으면 그 후속에서 탐색한다.
- `analysis.input_coverage`: run/날짜별 예상 은행수·완결 보고수·보고 버전/상태 고정. 자료 미수신과 연결 없음은 다르다.
- `analysis.input_scores`: run별 CONTEXT의 기존 완료 점수 스냅샷. 신규 TARGET 점수는 해당 run inference_results를 사용하고, 미채점 맥락은 null을 유지한다.
- FREEZE_INPUT은 각 TARGET/선정 씨앗의 서울 날짜 전후6일 고정 입력 범위 중 cutoff 시각 이하 ACTIVE 거래만 CONTEXT로 복사한다. CONTEXT는 target ownership을 취득하지 않으며 출처는 analysis_input_reports에 연결되어 기존 정정 취소 fence가 적용된다.
- ALERTS는 기존 통합 advisory lock → job/run 행잠금 순서로 토큰 검증·근거·라운드로빈 배정·카운터·체크포인트를 원자 저장한다. 실패 시 신규 저장을 롤백하고 응답 유실은 같은 run 체크포인트로 복구한다.

### V8: Alert 변경 출처 고정

`analysis.alert_source_manifest`는 PK(run_id,business_date), state JSONB로 scope_revision·정렬된 예상 은행·보고 set/version/revision/generation/status를 기록한다. FREEZE_INPUT의 기존 통합 잠금/트랜잭션에서 cutoff 서울 날짜 이하의 수신 보고만 고정한다. 마지막 성공 검사 run(없으면 근거 run)과 날짜별 전체 비교하며 삭제된 날짜도 감지한다. 미완료/취소 run과 미완료 job은 소비 완료로 보지 않는다. 외부 큐·전역 최대ID watermark는 없다.

### V9: 미래 수신 완료 상태 제거

`alert_coverage_checks.forward_complete` 삭제. coverage는 실제 고정한 날짜의 수신 현황만 기록한다. 날짜2일 이동·깊이2 탐색에는최대4일 도달 및 마지막 노드의 추가2일 계좌활동/한도 검사가 필요해 입력을 전후6일로 넓게 고정한다. 이는 Alert 소속 범위가 아니며 cutoff 이후 거래/보고·미래 coverage 날짜는 제외한다. 실제 편입에는 방향·깊이·행 수·계좌 활동 조건을 적용한다. 입력 복사량의 Large 최적화는 미검증이다.


## 다음 구현 저장 계약 — 2026-09-23

**설계 승인 / DDL 미작성·미적용.** [API.md §9](API.md#9-네-화면시연-시각범위별-판정-계약-승인--구현-전)가 외부 동작 계약이며 아래는 저장해야 할 의미다. 논리 이름은 테이블/컬럼 확정이 아니다. 기존 V1~V9를 수정하거나 문서 갱신만으로 DB가 전환됐다고 간주하지 않는다.

| 논리 데이터 | 필요한 저장 내용·관계 |
|---|---|
| 시연 업무 시각 | 로컬 시연 기준 시각, 변경 전후·행위자·실제 기록 시각. 재시작 보존. 진행 중 변경/과거 역행 차단에 필요한 처리 상태와 일관되게 검사 |
| 사건 업무 | Alert/Episode 담당자·업무 상태·개정·할당/종결 업무 시각·종료 사유. 혼합 결과와 판정 없는 범위 정리 종료를 NORMAL로 압축하지 않음 |
| 조사 범위 버전·구성원 | 사건/묶음·버전·tx_id·근거 버전·SUBJECT/CONTEXT·제외/이관/판정 처리. 자동 탐색 role과 별도. 당시 목록을 고정 |
| Episode 조사 묶음 | 초기 Alert별 이관 범위, L2 분리/이동 후 독립 묶음 정체성·버전. 원본 Alert를 조사 묶음 자체로 수정하지 않음 |
| 이관·출처 연결 | 원본 Alert/근거/선택 범위→Episode/묶음. 한 Alert의 여러 범위가 여러 Episode로 이어질 수 있음. 동일 거래의 복수 출처 보존 |
| 사건별 판정 | 행위자·근거·의견·결론·적용 범위 버전·명시 대상 tx 목록·업무/실제 기록 시각. 맥락/추가 거래 미전파. 원장/모델 라벨과 별도 |
| 감사·요청 식별 | 배정·열람·의견·제외·분리·이동·판정·종결의 전후 범위와 요청 식별. 재전송 중복·동시 범위 변경 탐지 |

관계: 원장 거래↔Alert 근거는 기존 N:M이다. Alert 출처↔Episode는 부분 이관·L2 이동 이력을 통해 복수 연결이 가능하다. 현재 Episode 소속과 과거 출처를 구분하며 거래별 전체 사건 이력을 단일 최종 판정으로 덮지 않는다. 화면 건수·금액은 tx_id 중복 제거하되 실제 반복 발생의 서로 다른 tx_id는 보존한다.

원자 경계: 새 Episode 생성(해당 시), 한 요청의 모든 선택 범위 이관, 업무 상태·출처·감사 변경을 동일 DB 트랜잭션으로 처리한다. L2 범위 이동도 출발/목적지 개정·담당자·OPEN 여부를 검사하고 원자적으로 처리한다. 닫힌 사건/과거 판정은 불변이며 변경된 묶음에 과거 판정을 자동 승계하지 않는다.

범위가 전부 이동/제외돼 비면 판정 없는 범위 정리 종료를 표현할 수 있어야 한다. 미판정 조사 대상이 남은 사건은 완료로 처리할 수 없다. 종결 enum과 기존 Alert 상태 호환·정확한 인덱스/제약은 DDL 단계에서 구체화한다.

조회 파생: 위험도·대표 유형·기관/개인 대시보드·통화별 금액은 원장/점수/고정 범위/업무 이력에서 계산한다. 요약 저장 여부는 아직 확정하지 않았으며 원본을 대체하지 않는다. 평가 라벨은 운영 조회·구성·판정의 정답 공급원이 아니다. private 원문 접근 범위도 이 설계로 확대하지 않는다.
