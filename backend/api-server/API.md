# API 계약 v0.3 — 2026-09-04

지위: **BE 결정 통보 + 팀 합의 대상.** 표시 없는 항목은 BE가 정해 통보하는 컨벤션이며, `[미정: X]`만 X의 회신이 필요하다(목록은 §8). 합의 결과는 이 문서를 갱신하고 kickoff §4.5에 기록. 구현된 API의 정본은 Swagger(springdoc)이고 이 문서는 사전 합의·설계 결정 기록이다.
용어: kickoff §2.5 — `거래 → (임계 선별) 의심 거래 → (자동 묶음) Alert → (조사·연결) Episode`. 구 명칭 혼용 금지.
이 문서는 W2 [DB 설계]의 입력이다. 변경 이력: v0.1(09-02, 층1~4 초안) → v0.2(09-03, 외부 검수 반영 — 배치 상태·추론 파일 계약·전이 표·역할·감사 이력·인증·대시보드·화면별 제공 항목 추가) → **v0.3(09-04, 화면 리서치 반영 — 파생 데이터 원칙: USD 환산·거래 점수 파생(백분위·복합 후보·합의)·거래 편입 역할·Alert 요약·대표 계좌·참여 계좌 표·점수 통계·설명 요인. 근거 `worktable/AML_화면_데이터_리서치_2026-09-04.md` §5·§6)** → **v0.3 추가(09-06, 화면 피드백): Alert·Episode 공통 상태 모델 `OPEN → IN_REVIEW → CLOSED` + `resolution`(Alert만 `ESCALATED` 추가). `CLOSED_NORMAL/CLOSED_FALSE_POSITIVE` → `CLOSED + resolution`, Episode `INVESTIGATING` → `OPEN/IN_REVIEW`, `outcome` → `resolution`, 이력 `REVIEW_START`(§3.1·§3.3·§4·§6·§6.5·§7)** → **v0.3 추가(09-07): 배정 모델 A — Alert·Episode 생성 시 라운드로빈 자동 배정 + ADMIN 재배정(§3.4 신설, §0·§3.1·§3.2·§4·§5·§6.5·§7). 9/3에 근거 없이 기록됐던 "단일 공용 큐"·"L1이 L2 지정" 폐기** → **v0.3 추가(09-07): 수집 구조 — 은행 API 키 + Presigned PUT + 완료 API + 자동 적재, MVP 편입, 은행 목업 프로그램, 도착 현황 API, 상태 `URL_ISSUED`(§0·§1.1·§1.2·§1.3·§7·§8). 멀티파트 `POST /api/uploads` 폐기** → **v0.3 추가(09-07, 화면 피드백): `IN_REVIEW` 상태 제거 — 배정이 있으면 열람 여부로 상태를 쪼갤 이유가 없음. 열람은 `firstOpenedAt`(미열람 표시)로만 기록(§3.2·§3.3·§4·§6·§6.5·§7)** → **v0.3 추가(09-07): Alert→Episode 연결은 Alert 화면에서 L1만(`POST /api/episodes/{id}/alerts` [L1]), Episode 화면은 해제만; 재배정 ADMIN 전용 유지(§3.3·§4.2·§4.3·§7)** → **v0.3 추가(09-07): Episode 상세 조사 블록 6종(baseline·flow·patternEvidence·counterparties·accountHistory·accounts) + `/transactions`·`/context-transactions`·`/graph?hops=` — 전부 MVP(§4.1·§7). 리서치 §2.11 근거** → **v0.3 추가(09-07, DB 착수 결정 4건): 컬럼 명명 `tx_id`+팀 이름(§0), 라벨은 평가 스키마 분리(§1.4), 은행 테이블 = 전 코드 + `is_reporting`(§1.1·§1.2), 구성 거래 `UNIQUE(tx_id)` + 처분 거래 재묶음 제외(§3.1)** → **v0.3 추가(09-07): 피처 세트는 모델별로 다르고 구성 변동 — `features_binary/type.parquet`, `feature_version_binary/type`(§1.3·§2.1); 최종 모델 형태는 질문 제외(§8)**.

- **파생 데이터 원칙 (2026-09-04 사용자 확정)**: 화면을 현 계약에 맞추지 않는다. 원장·점수·피처·이력에서 계산할 수 있는 항목은 파생해 제공한다. 불가 판정은 원천 부재(실명·KYC 등)일 때만. 모델 형태(전체 GNN / GNN 임베딩 + 후단 모델 / LightGBM)에 의존하는 항목은 **결정 보류**(§8 사용자 ②) — 계약은 어느 모델이든 맞도록 필수 열 + 선택 확장 열로 둔다.

## 0. 공통 규칙

- **식별자**: `uploadId`(INGEST 작업, bigint), `jobId`(ANALYSIS 작업, bigint — 같은 batch_jobs 시퀀스), `txId`(원장 거래, bigint), `alertId`·`episodeId`·`userId`(bigint). 전부 서버 발급. W1의 `uploadId`(uuid)는 W2 [원장 적재]에서 bigint로 교체.
- **DB 컬럼 명명(2026-09-07 사용자 확정)**: 거래 식별자는 DB·S3 파일 모두 `tx_id`(§2.1 파일 계약과 일치 — Python 파이프라인이 DB를 직접 읽으므로 이름 하나). 그 외는 팀 ERD 이름(`occurred_at`, `amount_paid`, `bank_id INT`). API는 camelCase 경계 변환(`txId`, `txAt`).
- **표기**: JSON 필드는 camelCase. Python 파이프라인·S3 산출물은 snake_case — BE가 경계에서 변환. 점수는 전부 0~1 실수. 시각은 ISO-8601 UTC.
- **금액·통화(BE 결정 2026-09-04)**: 통화는 ISO 4217 코드로 정규화해 내보낸다(IBM 통화명 15종 → 코드 매핑표 §1.4, Bitcoin = `BTC`). 모든 금액 필드에 **원 통화 금액 + `…Usd` 환산액**을 병기한다. 환산은 모델 학습에 쓴 고정 환율표(`data_work/fx_rates_usd.txt` 스냅샷 → V1 `fx_rates` 테이블 `fx_rates_usd_v1`, 2026-09-07)로 적재 시 계산. 합계는 `totalAmountUsd` + `amountsByCurrency[{ currency, total }]`. 화면 표기 방식(축약·자릿수)만 FE 소관.
- **페이지네이션(BE 결정)**: 목록은 `{ content: [], page, size, totalElements, totalPages }`. 쿼리 `page`(0부터)·`size`(기본 20, 최대 200)·`sort=field,asc|desc`(복수 허용). 빈 목록 = 200 + 빈 `content`.
- **에러 응답(BE 결정)**: RFC 9457 ProblemDetail `{ type, title, status, detail, instance }` + 확장 `code`(문자열 enum, 아래 표)·`id`(관련 uploadId/jobId/alertId, 없으면 생략). 상태 코드: 400 검증·형식, 401 미인증, 403 역할 불가, 404 없음, 409 상태 충돌·중복, 413 파일 한도, 500 서버·워커 실패.

| code | status | 뜻 |
|---|---|---|
| `VALIDATION_FAILED` | 400 | 요청·파일 검증 실패(`errors[]`에 행·컬럼·사유) |
| `UPLOAD_MISMATCH` | 400 | 완료 통지 시 S3 객체 없음 또는 크기 불일치 |
| `UNAUTHENTICATED` | 401 | |
| `FORBIDDEN_ROLE` | 403 | 역할이 액션을 허용하지 않음 |
| `NOT_FOUND` | 404 | |
| `INVALID_TRANSITION` | 409 | 전이 표에 없는 상태 전이 |
| `DUPLICATE_FILE` | 409 | 같은 해시의 파일이 이미 적재됨 |
| `JOB_ALREADY_RUNNING` | 409 | 같은 analysisDate의 작업이 RUNNING |
| `FILE_TOO_LARGE` | 413 | |
| `WORKER_FAILED` | 500 | 워커 프로세스 실패·시간 초과 |
| `INTERNAL` | 500 | 그 외 |

- **역할**: `L1`·`L2`·`ADMIN`. 엔드포인트마다 `[허용 역할]` 표기. ADMIN은 사용자·모델 관리와 **배정·재배정** 전용이며 조사 액션(종결·심층 요청·연결·의견) 불가. MVP는 데이터 범위 제한 없음(모든 역할이 전체 조회, 허용된 액션은 전체에 대해). "담당자만 처분" 강제는 10월.
- **은행 주체 `BANK`**: 사용자 역할이 아니라 API 키로 인증되는 외부 시스템(§1.1). 수집 API만 호출할 수 있고 조회·조사 화면은 없다.
- **배정(2026-09-07 사용자 확정, 모델 A)**: Alert·Episode 모두 생성 시 시스템이 라운드로빈으로 담당자를 정한다(§3.4). L1이 L2를 고르지 않는다. 재배정은 ADMIN. 인증 *방식*(세션 vs JWT) `[미정: FE 로그인 착수 전, 늦어도 9/18]`.
- **감사 이력**: 모든 처분 액션은 §6 이력 행을 부수효과로 기록. 처분 액션의 `comment`는 **필수**(빈 값 400).
- **유형 코드**: 0~8, 매핑표 §2.3. 명칭은 `{ code, name }` 객체로 내보낸다(한글 표시명은 FE 소관).

## 1. 층 1 — 수집·배치

### 1.1 은행 수집 API (2026-09-07 사용자 확정 — MVP부터 Presigned+S3+완료 API, 구 멀티파트 `POST /api/uploads`는 폐기)

수집 주체는 **은행 시스템**(실제 서비스) / **은행 목업 프로그램**(시연·테스트, `backend/bank-mock/` Python, BE 소유). 사이트 이용자는 올리지 않고 도착 현황만 본다.

- **은행 테이블(2026-09-07 사용자 확정)**: 원장에 등장하는 **모든 은행 코드**를 담는다(적재 시 자동 upsert, 원장 FK). `name`·`country`는 `HI-Small_accounts.csv` Bank Name에서 채우고 못 채우면 null. **`is_reporting`** = API 키를 가진 보고 은행(도착 현황·시드 대상). 상대방 은행은 `is_reporting=false`로 이름만 보인다.
- **인증 — 은행 API 키**: 요청 헤더 `X-Api-Key`. 은행 테이블에 키 해시 저장(원문은 발급 시 1회 반환). 키 → `bankId` 해석. 키 없음/불일치 = 401 `UNAUTHENTICATED`. 은행 등록·키 발급 API(`POST /api/banks` [ADMIN] = `is_reporting` 켜기 + 키 발급, `POST /api/banks/{id}/api-keys` [ADMIN])는 10월 [업로드]; **MVP는 보고 은행 3~4곳(시연 CSV 분할 수) + 키를 시드**(환경변수).
- **POST /api/bank/uploads** [BANK] `{ fileName, sizeBytes, sha256, businessDate? }` → 201 `{ uploadId, url, method: "PUT", expiresAt, headers: { "Content-Type": "text/csv" } }`. S3 키 = `uploads/{bankId}/{uploadId}/{fileName}`, Presigned PUT 유효 15분(프로퍼티). batch_jobs(INGEST) `URL_ISSUED` 생성. 같은 `sha256`가 이미 `COMPLETED`면 409 `DUPLICATE_FILE`(URL 발급 전에 거른다). `sizeBytes` > 200MB면 413.
- 은행이 URL로 파일 PUT (BE 미개입).
- **POST /api/bank/uploads/{uploadId}/complete** [BANK] → BE가 S3 HEAD로 존재·크기 확인(불일치 = 400 `UPLOAD_MISMATCH`) → 상태 `RECEIVED` → 가벼운 검증(§1.4) → 표준화·가명화(Data 진입점) → 원장 적재 → `COMPLETED`. **응답 202** `{ uploadId, status: "RECEIVED" }`, 적재는 비동기(MVP: 완료 API가 워커 프로세스를 직접 호출, 10월: SQS 메시지 발행). 결과는 `GET /api/uploads/{uploadId}`로 조회. 검증 실패는 아무것도 적재하지 않는다(all-or-nothing, `VALIDATION_FAILED` + `errors[]`).
- URL 발급 후 완료 통지 없이 만료된 건은 도착 현황에서 "미도착(URL 발급됨)"으로 보이고, `EXPIRED` 전환 스윕은 10월.
- **은행 목업 프로그램 계약**: `python bank_mock.py --bank 021174 --file bank_021174_0904.csv [--api-url http://localhost:8080] [--api-key …]` → 위 3단계를 순서대로 수행하고 완료 응답을 출력, 실패 시 0이 아닌 종료 코드. 시연은 은행 3곳을 순서대로 실행.
- S3가 9/9까지 없으면 URL 대신 로컬 폴더 경로를 같은 응답 모양으로 돌려주고 목업이 파일 복사로 PUT을 대신한다(클라이언트만 교체).

### 1.2 처리현황 (W2 [원장 적재]·[일별 분석 진입점])
- **GET /api/uploads/{uploadId}** [전 역할·BANK(자기 것만)] — INGEST 작업 1건: `{ uploadId, bankId, fileName, sizeBytes, rowCount, status, errorCode, errorMessage, errors: [{ row, column, reason }], urlIssuedAt, receivedAt, startedAt, finishedAt }`
- **GET /api/banks/arrivals?date=** [전 역할] — **은행별 도착 현황**(수집·처리현황 화면의 중심): 보고 은행(`is_reporting`) 전부에 대해 `{ bankId, name, country, status: NOT_ARRIVED | URL_ISSUED | RECEIVED | RUNNING | COMPLETED | VALIDATION_FAILED | FAILED, uploadId, fileName, rowCount, receivedAt, finishedAt }` + 헤더 `{ date, cutoffAt, remainingSeconds, arrivedCount, totalBanks }`. `date` 기본 오늘(컷오프 기준일).
- **GET /api/batch-jobs** [전 역할] — 목록(페이지네이션). 필터 `type=INGEST|ANALYSIS`, `status`, `from/to`(startedAt). 행: `{ jobId, type, status, attemptCount, analysisDate(ANALYSIS), bankId(INGEST), rowCount, errorCode, errorMessage, startedAt, finishedAt, modelVersionBinary, modelVersionType, featureVersion, thresholdValue }`
- **GET /api/batch-jobs/{jobId}** [전 역할] — 위 행 + `counters: { suspiciousTxCount, alertCount, missingCount, duplicateCount }`.
- **POST /api/batch-jobs/analysis** [L1·L2·ADMIN — 시연용 수동 실행] — 요청 `{ analysisDate? }`(기본 오늘). 응답 202 `{ jobId, status: "QUEUED" }`. 같은 analysisDate가 RUNNING이면 409 `JOB_ALREADY_RUNNING`; COMPLETED·FAILED면 같은 job의 재시도(기존 결과 삭제+삽입, OPEN Alert만 재생성). 스케줄러(컷오프 06:00)도 같은 코드를 부른다.

### 1.3 배치 상태 (batch_jobs — 테이블 1개 + job_type)

| job_type | 상태 | 뜻 | 다음 |
|---|---|---|---|
| INGEST | `URL_ISSUED` | Presigned URL 발급, 파일 대기(완료 통지 전) | RECEIVED / (10월 EXPIRED) |
| INGEST | `RECEIVED` | 완료 통지 수신·S3 확인, 검증 중 | RUNNING / VALIDATION_FAILED |
| INGEST | `RUNNING` | 표준화·가명화·적재 중 | COMPLETED / FAILED |
| INGEST | `COMPLETED` | 원장 적재 완료 | — |
| INGEST | `VALIDATION_FAILED` | 가벼운 검증 실패(영구) — 은행이 고쳐 재업로드(새 작업) | — |
| INGEST | `FAILED` | 적재 중 오류(영구) | — |
| ANALYSIS | `SCHEDULED` | 스케줄러가 예약(10월; MVP는 생략) | QUEUED |
| ANALYSIS | `QUEUED` | 실행 대기 | RUNNING |
| ANALYSIS | `RUNNING` | 파이프라인 실행 중(heartbeat 갱신) | COMPLETED / RETRY_WAIT / FAILED |
| ANALYSIS | `RETRY_WAIT` | 일시 실패, 재시도 대기(attempt < 3) | RUNNING |
| ANALYSIS | `COMPLETED` | 점수·Alert 적재 완료 | — |
| ANALYSIS | `FAILED` | 영구 실패 또는 3회 소진 | — (수동 재실행으로 재시도) |

- 공통 컬럼: `attempt_count, claimed_at, heartbeat_at, started_at, finished_at, error_code, error_message`. ANALYSIS 전용: `analysis_date UNIQUE, threshold_value, model_version_binary, model_version_type, feature_version_binary, feature_version_type, suspicious_tx_count, alert_count`. INGEST 전용: `bank_id, file_name, file_hash(sha256), size_bytes, s3_key, url_issued_at, url_expires_at, received_at, row_count, missing_count, duplicate_count`.
- Claim·heartbeat·재시도 규칙은 kickoff §2.2. MVP(직접 호출)는 QUEUED→RUNNING을 Boot가 즉시 수행.

### 1.4 원장 입력 CSV 컬럼 표 (IBM AMLworld 헤더 → 표준명)

| CSV 헤더 | 표준명(원장 컬럼) | 타입 | 검증 |
|---|---|---|---|
| Timestamp | `tx_at` | timestamp | 필수, 형식 `[미정: Data — 시연 CSV 시각 형식]` |
| From Bank | `from_bank` | int | 필수 |
| Account | `from_account` | text(가명) | 필수 → 가명화 |
| To Bank | `to_bank` | int | 필수 |
| Account.1 | `to_account` | text(가명) | 필수 → 가명화 |
| Amount Received | `amount_received` | numeric(18,2) | 필수, ≥0 |
| Receiving Currency | `receiving_currency` | text | 필수 |
| Amount Paid | `amount_paid` | numeric(18,2) | 필수, ≥0 |
| Payment Currency | `payment_currency` | text | 필수 |
| Payment Format | `payment_format` | text | 필수 |
| Is Laundering | (원장에 저장하지 않음) | bool | 선택. 있으면 평가 스키마 `evaluation.transaction_labels(tx_id, is_laundering, pattern_label, attempt_id)`에만 적재(2026-09-07 사용자 확정). API·화면 비노출 |

- 원장 추가 컬럼: `tx_id`(PK), `bank_id`(업로드 bankId), `row_hash`(표준화 행 해시, `(bank_id,row_hash)` UNIQUE), `ingest_job_id`, `scored_job_id`(NULL = 미채점), **`amount_usd`**(= `amount_paid ÷ fx_rates.units_per_usd[payment_currency]` — 환율표는 "1 USD당 통화 단위"(2026-09-07 정정, V1 `fx_rates` 테이블), 적재 시 계산, `fx_rate_version` 함께), 통화 컬럼은 정규화된 ISO 코드로 저장(원명은 저장하지 않음).
- 통화명 → ISO 매핑표(고정, 15종): Australian Dollar `AUD` · Bitcoin `BTC` · Brazil Real `BRL` · Canadian Dollar `CAD` · Euro `EUR` · Mexican Peso `MXN` · Ruble `RUB` · Rupee `INR` · Saudi Riyal `SAR` · Shekel `ILS` · Swiss Franc `CHF` · UK Pound `GBP` · US Dollar `USD` · Yen `JPY` · Yuan `CNY`. 표에 없는 값은 행 검증 오류(`errors[]`).
- **가벼운 검증(완료 API 이후, 적재 프로세스 안)**: S3 객체 존재·크기 일치 / 비어 있지 않음 / CSV 파싱 가능 / 헤더에 위 필수 10개 존재 / 데이터 행 ≥ 1 / 파일 해시 미중복. 행 단위 형식 오류는 적재 단계에서 `errors[]`로 모아 `VALIDATION_FAILED`(조회로 확인).
- 인코딩·BOM·시각 형식·은행별 분할은 `[미정: Data — 시연 CSV 스펙, 9/7 전]`.

## 2. 층 2 — 추론·거래 점수·의심 거래

### 2.1 추론 에이전트 파일 계약 (S3, 확정 2026-09-03)

경로 접두어와 쓰기 순서(마지막 파일이 "준비/완료" 표식):

```
requests/{jobId}/features_binary.parquet   ← BE(Python 파이프라인)가 먼저 씀 (이진 모델 피처)
requests/{jobId}/features_type.parquet     ← 9클래스 모델 피처 (세트가 다름 — 2026-09-07 사용자 확정)
requests/{jobId}/manifest.json             ← 마지막에 씀 (이 파일이 보이면 요청 완료)
results/{jobId}/scores.parquet      ← 추론 에이전트가 먼저 씀
results/{jobId}/result.json         ← 마지막에 씀 (완료 표식)
results/{jobId}/error.json          ← 실패 시 (scores 없이)
```

- `manifest.json`: `{ job_id, analysis_date, row_count, feature_version_binary, feature_version_type, model_version_binary, model_version_type, requested_at }` — BE가 요청하는 버전(모델별 피처 버전).
- `features_binary.parquet` / `features_type.parquet`: 각각 `tx_id`(int64) + 그 모델의 피처 컬럼. **두 세트는 다르며 구성은 모델 개선에 따라 바뀐다**(2026-09-07 사용자 확정 — 컬럼 목록은 피처 빌더 정본, 계약은 컬럼을 고정하지 않고 `feature_version_*`로만 식별). 두 파일 모두 행 수·tx_id 집합이 같아야 한다.
- `scores.parquet`: `tx_id`(int64), `p_laundering`(float64), `p_0`…`p_8`(float64). 행 수·tx_id 집합은 features와 동일해야 한다. NaN 불허, 각 값 0~1 `[미정: Data — Σp_0..8 = 1 보장 여부]`.
- `result.json`: `{ job_id, row_count, model_version_binary, model_version_type, feature_version_binary, feature_version_type, started_at, finished_at }` — **실제 실행한 버전**을 에코. BE는 이 값을 batch_jobs에 기록하고 manifest와 다르면 WARN.
- `error.json`: `{ job_id, code, message, retryable }`. `retryable=true`면 일시 실패(RETRY_WAIT), false면 FAILED.
- 폴링: BE가 `results/{jobId}/result.json` 또는 `error.json`을 5초 간격, 최대 30분. 초과 = 일시 실패. 추론 에이전트는 `requests/*/manifest.json`을 폴링(1대만).
- 검증(BE): 필수 열(`tx_id, p_laundering, p_0..p_8`) 존재·이름, 행 수, tx_id 집합, NaN. 불일치 = 영구 실패(`FAILED`, error_code `SCORES_MISMATCH`). **필수 열 외 추가 열은 허용하되 BE는 무시(WARN 로그)** — 모델 형태 확정 후 확장 열(예: 거래별 기여 요인 `contrib_*`, 임베딩)을 이 계약에 추가한다(§8 사용자 ② 보류 항목).
- 정리: 성공·실패 확정 후 BE가 `requests/{jobId}/`·`results/{jobId}/` 삭제(보존 여부는 10월 Lifecycle에서).
- MVP 운반: 실제 AWS S3(9/7). 9/9까지 없으면 로컬 폴더에 같은 경로로 관통 후 클라이언트만 교체.

### 2.2 거래별 점수 테이블·파생 규칙
- 저장: `(job_id, tx_id) PK, p_laundering, p_0..p_8` 그대로. 같은 job 재실행 시 삭제+삽입.
- 파생(BE, 조회 시 계산): `launderingScore = p_laundering`, `typeClass = argmax(p_0..p_8)`(p_0이 최대면 0 그대로), `typeScore = 그 확률`. 동점 시 낮은 코드.
- 의심 거래 = `p_laundering >= threshold_value(그 job의 스냅샷)`. 저장 플래그가 아니라 파생. 임계는 프로퍼티 `app.suspicious-tx.threshold`(env `SUSPICIOUS_TX_THRESHOLD`), job 실행 시 batch_jobs에 스냅샷. `threshold_version`은 10월 thresholds 테이블에서.
- `ruleHits[]`는 룰 기반(향후 확장) 전까지 항상 빈 배열 — 추론 산출물이 아니라 BE 룰 엔진 산출. 점수 테이블에 룰 컬럼을 두지 않는다.
- **점수 파생 확장 (2026-09-04 채택, 모델 형태와 무관 — 확률 벡터만 사용)**:
  - `scorePercentile`: 같은 job 안에서 `p_laundering`의 백분위(0~100, 높을수록 상위). job 전체 분포가 필요하므로 **점수 적재 스텝(Python)에서 계산해 점수 테이블 `score_pct`에 저장** `[미정: Data — 적재 스텝에 계산 추가 동의]`. 화면은 절대값과 백분위를 병기한다(원값은 캘리브레이션되지 않음: run_114 recall 0.5 운영점 임계 0.9938).
  - `thresholdRatio = p_laundering / threshold_value`, `isSuspicious = p_laundering >= threshold_value` (조회 시 계산).
  - `typeCandidates[]`: `p_0..p_8` 상위 2개 `{ code, name, score }`. 1위−2위 차이가 `app.type.ambiguity-delta`(기본 0.10) 미만이면 두 개, 아니면 1개. `typeClass`는 그대로 1위.
  - `agreement`: 두 모델 합의 4분면 — `STRONG`(isSuspicious ∧ typeClass≠0) / `ATYPICAL`(isSuspicious ∧ typeClass=0 — 패턴 외 세탁 의심) / `PATTERN_ONLY`(¬isSuspicious ∧ typeClass≠0) / `WEAK`(둘 다 아님). 조회 시 계산.
  - `explanation.factors[]`: 거래의 송·수신 계좌 피처(피처 테이블) 중 해당 계좌의 30일 창 기준선 대비 편차가 큰 상위 3개 `{ feature, value, baseline, ratio, text }`. 후보 피처는 모델 중요도 상위(run_114 gain top15: `edge_cnt, u_recv_cnt, log_amount_usd, payment_format, v_since_last_min, v_burst_24h, u_dk7_sent_cnt, edge_rev_cnt, cycle3_flag_*` …)로 한정, 문장 템플릿은 BE. 피처 테이블 컬럼 확정([모델 래핑]) 후 구현. 거래별 SHAP(`pred_contrib`)은 모델 형태 보류 항목.

### 2.3 유형 코드 매핑표 (확정 2026-09-03 — 모델링 run_114 라벨 인코딩 그대로)

근거: 학습 스크립트(`train_eval_large.py`) 클래스 순서 · `data_work/HI-Large/prepare_report.txt` 클래스 분포 순서 · run_114 혼동행렬 열 순서 일치. IBM AMLworld 패턴명이 정본이며 `typeClass`·`primaryType.name`은 이 표를 따른다.

| 코드 | 코드명 (정본) | 데이터셋 원명 | 한글 설명 `[미정: FE 표시 명칭 — 초안]` |
|---|---|---|---|
| 0 | `NORMAL` | — | 패턴아님 (정상 + 패턴 외 세탁 병합) |
| 1 | `FAN-OUT` | FAN-OUT | 분산 송금 (1→N) |
| 2 | `FAN-IN` | FAN-IN | 집중 수취 (N→1) |
| 3 | `G-SCATTER` | GATHER-SCATTER | 모아서 뿌리기 (N→1→M) |
| 4 | `S-GATHER` | SCATTER-GATHER | 뿌려서 모으기 (1→N→1) |
| 5 | `CYCLE` | CYCLE | 순환 거래 |
| 6 | `RANDOM` | RANDOM | 무작위 경로 |
| 7 | `BIPARTITE` | BIPARTITE | 그룹 간 교차 송금 |
| 8 | `STACK` | STACK | 다층 중계 |

- 코드 0은 "정상"이 아니라 **패턴아님**이다: 정상 거래와 패턴에 속하지 않는 세탁(구 10클래스의 `NONPAT`, 라벨 9)이 병합돼 있다. 세탁 유무는 이진 모델(`p_laundering`)이 판정하므로 코드 0이면서 점수가 높은 거래가 존재한다.
- scores.parquet에 `p_0..p_8` 아홉 열이 정확히 없으면 배치 FAILED(`SCORES_MISMATCH`).

### 2.4 거래 행 (공통 스키마 — 의심 거래 목록·Alert 상세 `transactions[]`가 공유)

```
{ txId, txAt, fromBank, fromAccount, toBank, toAccount,
  amountReceived, receivingCurrency, amountPaid, paymentCurrency, amountUsd, paymentFormat,
  launderingScore, scorePercentile, thresholdRatio, isSuspicious,
  typeClass, typeName, typeScore, typeCandidates: [{ code, name, score }], agreement, jobId }
```
- `fromAccount`·`toAccount`는 가명. 통화는 ISO 코드(§0). 파생 필드 정의는 §2.2.
- Alert 상세 `transactions[]`에서는 행에 **`role: SEED|SUPPORTING|PATH|PATTERN_MEMBER`, `includedReason`(문자열), `direction: IN|OUT|SELF`(Alert 대표 계좌 기준)** 가 추가된다. MVP 최소판: `role` = isSuspicious ? SEED : SUPPORTING, `includedReason` = 묶음 근거 코드; Data 알고리즘이 PATH/PATTERN_MEMBER를 주면 교체.
- 상세에서 `explanation: { thresholdValue, factors[] }`(§2.2)를 거래 행에 붙일지 별도 조회로 둘지는 [W3 API]에서 성능 보고 결정(피처 테이블 조인 비용).

### 2.5 GET /api/suspicious-transactions  [전 역할]  (W1 구현됨 — W2 [일별 분석 진입점]에서 DB 조회·페이지네이션으로 교체)
- 임계 이상 거래 목록. 기본 정렬 `launderingScore,desc` (2차 `txId,asc`). 필터 `jobId`, `analysisDate`, `typeClass`, `minScore`, `bankId`.
- 행: §2.4 거래 행. W1 현재 응답(`uploadId, txRow, anomalyScore, typeScore, typeClass, ruleHits`, 맨 배열)은 W2에서 교체.
- 주의: 이건 **의심 거래** 목록이다. Alert(묶음) 목록은 §3.

## 3. 층 3 — Alert

### 3.1 Alert 산출물 (일별 분석 마지막 스텝 — Data 알고리즘이 DB에 직접 적재)

Alert 테이블(W3 [스키마]):

| 컬럼 | 내용 |
|---|---|
| `alert_id` | PK, DB 발급 |
| `job_id`, `analysis_date` | 생성한 일별 분석 작업 |
| `risk_score` | Alert 위험도 0~1 (거래 점수와 별도, 산출식은 Data 소유) |
| `primary_type` | 대표 유형 코드 0~8 |
| `type_distribution` | 유형별 구성비 JSON `{ "1": 0.6, "5": 0.4 }` (선택) |
| `tx_count`, `total_amount_usd`, `amounts_by_currency` | 건수 · USD 환산 합계(§0) · 통화별 합계 JSON `{ "USD": 123.4, "EUR": 56.7 }` — BE가 구성 거래에서 파생 |
| `first_tx_at`, `last_tx_at` | 작전 기간 |
| `subject_account_id`, `account_count`, `bank_count` | 대표 계좌(구성 거래 등장 횟수 최대, 동률이면 금액 합 최대; Data가 허브 계좌를 주면 우선) · 참여 계좌 수 · 참여 은행 수 — BE 파생 (2026-09-04 채택) |
| `score_mean`, `score_max`, `score_above_ratio`, `weighted_amount_usd`, `type_entropy` | 구성 거래 점수 통계 · 임계 초과 비율 · Σ(amount_usd × p) · 유형 구성비 엔트로피(낮을수록 순수한 묶음 — 시연 질문 1 근거) — BE 파생 (2026-09-04 채택) |
| `link_basis[]` | 묶음 근거 `[{ basis: TIME|ACCOUNT|BANK|PATH, value }]` `[미정: Data — 산출 가능 여부]` |
| `status`, `resolution`, `episode_id`, `created_at`, `updated_at` | 워크플로 — `status` 4종(§3.3), `resolution`은 `CLOSED`일 때만 `NORMAL|FALSE_POSITIVE`, 그 외 NULL |
| `assignee_id`, `assigned_at` | 담당 L1 — 생성 직후 BE가 라운드로빈으로 채움(§3.4), NOT NULL. 재생성된 OPEN Alert도 새로 배정 |

구성 거래 테이블: `(alert_id, tx_id, role, included_reason)`, **`UNIQUE(tx_id)`** — 한 거래는 한 Alert에만 속한다(2026-09-07 사용자 확정, 1:1). 이를 위해 Alert 구성 알고리즘의 입력에서 **처분된(ESCALATED·CLOSED) Alert의 거래는 제외**한다(재실행은 OPEN만 재생성). 복합 위험은 N:M이 아니라 `type_distribution`으로 표현. `role`·`included_reason` 정의는 §2.4.

**참여 계좌 테이블 `alert_accounts` (2026-09-04 채택, dberd 채택분)**: `(alert_id, account_id, role: SUBJECT|SOURCE|DESTINATION|INTERMEDIARY|HUB, in_count, in_amount_usd, out_count, out_amount_usd, max_score, counterparty_count)`. BE가 Alert 생성 직후 구성 거래에서 파생·저장. 역할 규칙: out만 = SOURCE, in만 = DESTINATION, 양쪽 = INTERMEDIARY, 차수 최대 = HUB, 대표 계좌 = SUBJECT. 계좌별 30일 창 기준선(`firstSeenAt`, 30일 in/out 건수·금액, 상대방 수)은 원장 조회로 상세 응답에 붙인다(저장 안 함). 관계 그래프의 노드 원천.
- **재실행 규칙**: 같은 job이 다시 돌면 `OPEN` Alert만 삭제·재생성(새로 배정). `ESCALATED`·`CLOSED`는 보존(alertId 유지). 처분된 Alert의 거래는 재묶음 입력에서 **제외**(확정 09-07).

### 3.2 조회
- **GET /api/alerts** [전 역할] — 목록(페이지네이션). 기본 정렬 `riskScore,desc`. 정렬 키: `riskScore, createdAt, lastTxAt, txCount, totalAmountUsd, scoreMax, weightedAmountUsd, ageDays`. 필터 `status`, `resolution`, `assigneeId`(`me` 허용), `typeClass`, `bankId`, `from/to`(lastTxAt 기준), `analysisDate`, `episodeId`. L1 기본 뷰 = `assigneeId=me&status=OPEN`. 필터 `unopened=true`(= `firstOpenedAt IS NULL`).
  행: `{ alertId, riskScore, summary, primaryType: { code, name }, subjectAccount: { bank, account }, accountCount, bankCount, txCount, totalAmountUsd, amountsByCurrency: [{ currency, total }], scoreStats: { mean, max, aboveRatio }, weightedAmountUsd, typeEntropy, firstTxAt, lastTxAt, banks: [int], status, resolution, assignee: { userId, name }, assignedAt, firstOpenedAt, episodeId, analysisDate, createdAt, ageDays }`
  - `summary`(2026-09-04 채택): BE 템플릿 한 줄 — `"{typeName} · 계좌 {accountCount} · 은행 {bankCount} · {기간 일수}일 · 총 USD {totalAmountUsd 축약}"` + 묶음 근거 1개(있으면). 저장하지 않고 조회 시 조합. 한글 명칭은 FE 매핑 전이므로 코드명으로 낸다.
  - `ageDays`: `now − createdAt`의 정수 일수(서버 계산 — 정렬·"N일 이상 미처리" 필터용). Episode 행에도 동일.
- **GET /api/alerts/{alertId}** [전 역할] — 목록 행 + `transactions: [거래 행 §2.4 + role, includedReason, direction]`, `typeDistribution`, `accounts: [{ account, bank, role, inCount, inAmountUsd, outCount, outAmountUsd, maxScore, counterpartyCount, firstSeenAt }]`(§3.1 alert_accounts + 30일 기준선), `scoreTimeline: [{ txAt, score }]`(시각순), `explanation`(§2.2 — 포함 여부는 [W3 API]에서 성능 보고 결정), `groupingBasis: link_basis[]`, `graph`(아래).
- **관계 그래프**: `graph: { nodes: [{ id, kind: ACCOUNT|BANK, label, riskLevel: HIGH|MEDIUM|LOW, role, inAmountUsd, outAmountUsd, txCount }], edges: [{ id, from, to, txCount, totalAmountUsd, maxScore, primaryType, direction, firstTxAt, lastTxAt }] }` — 노드 속성은 §3.1 alert_accounts에서, `edges[].id`는 항상 부여(멀티엣지 대비). 상세에 포함 vs `GET /api/alerts/{alertId}/graph` 분리 `[미정: FE 시각화 라이브러리 — BE 추천: 분리]`. `riskLevel` 경계는 BE 프로퍼티(기본 0.9/0.7).
- **GET /api/alerts/{alertId}/history** [전 역할] — §6 이력 행 목록.

### 3.3 Alert 상태 전이 표

**공통 상태 모델 (2026-09-06 사용자 확정 — Alert·Episode 통일, 09-07 `IN_REVIEW` 제거)**: 생애는 `OPEN`(담당자에게 배정되어 처리 중) → `CLOSED`(종결). 종결 결과는 상태에 넣지 않고 별도 필드 **`resolution`**(`CLOSED`일 때만 값, 그 외 NULL). Alert만 `ESCALATED`(Episode 귀속, `episodeId != null`과 항상 일치)를 추가로 가진다 — Episode에는 "넘김" 단계가 없다(감독기관형 범위, 보고 단계 없음). 열람은 상태를 바꾸지 않는다: 담당자의 첫 열람은 **`firstOpenedAt`**(nullable, 이력 `REVIEW_START`)에만 기록되고, null이면 화면에 "미열람" 표시. 재배정 시 `firstOpenedAt`은 초기화. dberd 정합 메모 결정 2(`NEW/CLOSED + resolution`) 해소.

Alert 상태: `OPEN` / `ESCALATED` / `CLOSED`. `resolution: NORMAL | FALSE_POSITIVE`.

| from | to | 액션 / 엔드포인트 | 허용 역할 | 필수 입력 | 이력 action |
|---|---|---|---|---|---|
| OPEN | (유지) | `GET /api/alerts/{id}` — 담당 L1(assignee)의 첫 열람이면 `firstOpenedAt` 기록(다른 사용자 열람은 기록 없음) | L1(assignee) | — | `REVIEW_START` |
| OPEN | OPEN | `POST /api/alerts/{id}/assign` `{ userId, comment }` — 재배정(L1 사용자), `firstOpenedAt` 초기화 | ADMIN | userId, comment | `ASSIGN` |
| OPEN | CLOSED (`resolution: NORMAL`) | `POST /api/alerts/{id}/close` `{ resolution: NORMAL, comment }` | L1 | resolution, comment | `CLOSE` |
| OPEN | CLOSED (`resolution: FALSE_POSITIVE`) | 같은 엔드포인트 `{ resolution: FALSE_POSITIVE, comment }` | L1 | resolution, comment | `CLOSE` |
| OPEN | ESCALATED | `POST /api/episodes` `{ alertIds[], comment }` (신규 Episode — 담당 L2는 라운드로빈 자동 §3.4) | L1 | alertIds ≥1, comment | `ESCALATE` |
| OPEN | ESCALATED | `POST /api/episodes/{episodeId}/alerts` `{ alertIds[], comment }` (기존 Episode에 연결 — **Alert 화면에서 L1이 수행**, Episode 화면엔 연결 없음 09-07) | L1 | comment | `LINK` |
| ESCALATED | OPEN | `DELETE /api/episodes/{episodeId}/alerts/{alertId}` `{ comment }` — 해제되면 기존 담당 L1에게 돌아감(`firstOpenedAt` 유지) | L2 | comment; Episode에 Alert가 2개 이상일 때만(빈 Episode 불허) | `UNLINK` |
| CLOSED | — | 어떤 액션도 불가 → 409 `INVALID_TRANSITION` | | | |
| ESCALATED | CLOSED | 불가(Episode 종결로만) → 409 | | | |
| OPEN | ESCALATED (CLOSED Episode에) | 불가 → 409 | | | |

- 대시보드 처리 흐름은 ① 미처리 Alert(`OPEN`, L1 담당) ② 경과일 ③ L2 조사 중(`ESCALATED` = Episode `OPEN`) ④ 처분(`CLOSED` + resolution). "미열람 n"은 ①·③의 부제(`firstOpenedAt IS NULL`).
- 재실행 규칙(§3.1)과의 관계: 같은 job 재실행 시 삭제·재생성 대상은 `OPEN`만(재생성분은 새로 배정). `ESCALATED`·`CLOSED`는 보존.

### 3.4 배정 규칙 (Alert·Episode 공통 — 2026-09-07 사용자 확정, 모델 A)

- **생성 시 자동 라운드로빈**: Alert는 일별 분석이 만든 직후 BE가 L1 사용자 중 한 명에게, Episode는 `POST /api/episodes` 직후 L2 사용자 중 한 명에게 배정. 대상 풀 = 해당 역할의 사용자 전원(부재·비활성 처리는 11월 [권한관리]). 선택 규칙 = `users.last_assigned_at`이 가장 오래된 사용자(NULL 우선, 동률이면 `userId` 오름차순), 배정 후 갱신. 한 job이 Alert N건을 만들면 N번 순환한다.
- **재배정**: `POST /api/alerts/{id}/assign`, `POST /api/episodes/{id}/assign` `{ userId, comment }` — **ADMIN 전용**. 대상은 같은 역할(L1/L2)의 사용자여야 한다(아니면 400). 재배정되면 상태는 `OPEN`으로, 이력 `ASSIGN`(`relatedIds` = 이전·이후 userId). CLOSED는 재배정 불가(409).
- **행위 제한**: MVP는 담당자가 아니어도 같은 역할이면 처분 가능(§0 범위 제한 없음). "담당자만 처분"은 10월. `firstOpenedAt` 기록은 담당자 열람에만 걸린다.
- 실무 근거: Oracle AM 배치 배정(사용자·풀, 규칙 기반)·ECM 자동 할당(개인별 최대 건수·부재 시 중단), Sardine 큐 라운드로빈, Unit21 관리자 재배정(500건 일괄) — 리서치 문서 §2.10. 개인별 보유 상한·부재 규칙은 11월 후보.

- `resolution` `NORMAL` = 정상 거래로 판단, `FALSE_POSITIVE` = 모델 오탐(둘 다 평가 지표 라벨로 쓰인다). 종결 필터는 `status=CLOSED&resolution=…`.
- 이동(다른 Episode로) = UNLINK + LINK 두 요청(MVP 비원자). 원자적 `move`·분리·병합은 10월: `POST /api/alerts/{id}/split`, `POST /api/alerts/merge`, `POST /api/episodes/{id}/alerts/move`.
- 재오픈·보류·반려는 MVP·10월 범위 밖.

## 4. 층 4 — Episode·조사

### 4.1 조회
- **GET /api/episodes** [전 역할] — 목록(페이지네이션). 기본 정렬 `riskScore,desc`(riskScore = 소속 Alert riskScore 최대값 `[미정: Data 동의]`). 정렬 키 `riskScore, createdAt, updatedAt, alertCount, ageDays`. 필터 `status`, `resolution`, `assigneeId`, `from/to`(createdAt). "내 담당" 뷰 = `assigneeId=me`, "새로 배정" 뷰 = `status=OPEN&assigneeId=me`.
  행: `{ episodeId, riskScore, alertCount, txCount, totalAmountUsd, amountsByCurrency: [{ currency, total }], primaryTypes: [{ code, name }], assignee: { userId, name }, status, resolution, createdBy: { userId, name }, createdAt, updatedAt, closedAt, ageDays }`
- **GET /api/episodes/{episodeId}** [전 역할] — 행 + `alerts: [Alert 목록 행]`, `history: [§6 행]` + **조사 블록 6종(2026-09-07 사용자 확정, 전부 MVP — 리서치 §2.11)**. 전부 조회 시 원장·점수·피처·이력에서 파생(저장 없음), 대표 계좌 = 소속 Alert 중 riskScore 최대 Alert의 `subjectAccount`:
  - `baseline`: `{ account, bank, windowDays: 30, firstSeenAt, accountAgeDays, metrics: [{ key: IN_USD | IN_COUNT | OUT_USD | OUT_COUNT | NEW_COUNTERPARTIES | MEDIAN_GAP_HOURS, current, baseline, ratio }] }` — current = Episode 기간, baseline = 직전 30일 창(피처 테이블·원장).
  - `flow`: `{ periodFrom, periodTo, inflowUsd, inflowCount, inflowBanks, outflowUsd, outflowCount, outflowBanks, netRetainedUsd, passThroughRatio, medianDwellHours, bankBoundaryHops: { in, out }, roundAmountCount, nearThresholdCount, txCount }` — 잔액 원천이 없으므로 `netRetainedUsd = inflow − outflow`. 라운드 = 1,000 단위 나누어떨어짐, 임계 직하 = 프로퍼티 `app.evidence.threshold-usd`(기본 10,000)의 90~100%.
  - `patternEvidence`: `[{ alertId, typeClass, typeName, checks: [{ key, label, passed, value }] }]` — 유형별 고정 항목: FAN-IN/FAN-OUT = `DISTINCT_COUNTERPARTIES`(≥ k), `TIME_SPAN_DAYS`, `ALL_NEW_COUNTERPARTIES`, `NEAR_THRESHOLD_REPEAT`, `ROUND_AMOUNTS`; CYCLE/RANDOM/STACK/G-SCATTER/S-GATHER/BIPARTITE = `HOPS`, `START_EQUALS_END`, `DECREMENT_PCT_RANGE`, `INTERMEDIARY_REUSE`, `BANK_BOUNDARY_EVERY_HOP`, `MEDIAN_HOP_GAP_HOURS`. `passed`는 BE 규칙(프로퍼티), 항목 정의 근거 = FFIEC App F·FinCEN 퍼널/뮬·FATF PML·AMLworld.
  - `counterparties`: `{ inbound: [...], outbound: [...] }`, 항목 `{ account, bank, txCount, totalUsd, isNew30d, otherAlerts: [{ alertId, status, resolution, primaryType, assignee }] }` — 상위 10 + 나머지 합계 행.
  - `accountHistory`: `[{ account, bank, alerts: [{ alertId, status, resolution, episodeId, createdAt }] }]` — Episode 참여 계좌 전부의 전 은행 Alert·Episode 이력.
  - `accounts`: 소속 Alert `accounts[]` 합집합(역할·in/out·기준선, §3.2와 같은 모양).
- **GET /api/episodes/{episodeId}/transactions** [전 역할] — 소속 Alert 구성 거래 합집합(§2.4 행 + `alertId`, `role`, `direction`(대표 계좌 기준)). 페이지네이션.
- **GET /api/episodes/{episodeId}/context-transactions?days=3** [전 역할] — 참여 계좌의 **Alert 밖** 거래(기간 ±days), §2.4 행 + `account`(어느 참여 계좌의 거래인지). 상한 500행.
- **GET /api/episodes/{episodeId}/graph?hops=0|1** [전 역할] — `hops=0` 소속 Alert 그래프 합집합(§3.2 형식), `hops=1` 참여 계좌의 Alert 밖 1-hop 이웃을 추가(노드 `outside: true`, 엣지 `outside: true`, 상한 노드 150·초과 시 `truncated: true`). 2-hop 이상·다기관 전체 그래프는 11월.
- **GET /api/episodes/{episodeId}/history** [전 역할].

### 4.2 액션
- **POST /api/episodes** [L1] `{ alertIds[], comment }` → 201 `{ episodeId, assignee }`. Episode `OPEN`, 담당 L2는 **BE가 라운드로빈으로 배정**(§3.4 — L1이 고르지 않는다), Alert들 `ESCALATED`.
- **GET /api/episodes/{id}** — 담당 L2(assignee)의 첫 열람이면 `firstOpenedAt` 기록, 이력 `REVIEW_START`. 상태 변화 없음. 다른 사용자 열람은 기록 없음.
- **POST /api/episodes/{id}/alerts** [L1] `{ alertIds[], comment }` — `OPEN` Alert만 연결 가능. **진입점은 Alert 상세의 "심층 요청 → 기존 Episode에 연결"뿐**(2026-09-07 사용자 확정). L2는 다른 담당의 Alert를 끌어오지 않는다 — Episode 화면의 "관련 Alert 후보"는 정보 표시만, 연결은 그 Alert의 담당 L1이 한다. 대상 Episode는 `CLOSED`가 아니어야 한다(409).
- **DELETE /api/episodes/{id}/alerts/{alertId}** [L2] `{ comment }` — 연결 해제. Alert `OPEN` 복귀, 기존 담당 L1 유지. 마지막 Alert면 409.
- **POST /api/episodes/{id}/assign** [ADMIN] `{ userId, comment }` — 재배정(L2 사용자, §3.4). **재배정되면 Episode는 `OPEN`으로 돌아간다**(새 담당이 아직 안 열었으므로).
- **POST /api/episodes/{id}/comments** [L2] `{ comment }` — 조사 의견. 상태 변화 없음, 이력 `COMMENT`.
- **POST /api/episodes/{id}/close** [L2] `{ resolution: NORMAL | SUSPICIOUS, comment }` — 종결. 소속 Alert는 `ESCALATED` 유지(조회는 Episode 상태로 판단).

### 4.3 Episode 상태 전이 표

상태: `OPEN`(담당 L2 조사 중) / `CLOSED`. `resolution: NORMAL | SUSPICIOUS`(`CLOSED`일 때만). Alert와 같은 공통 모델(§3.3) — `ESCALATED`만 없다. 미열람 = `firstOpenedAt IS NULL`.

| from | to | 액션 | 허용 역할 | 필수 입력 | 이력 action |
|---|---|---|---|---|---|
| — | OPEN | `POST /api/episodes` (담당 L2는 라운드로빈 자동) | L1 | alertIds, comment | `ESCALATE`(각 Alert) + `EPISODE_CREATE` + `ASSIGN`(SYSTEM) |
| OPEN | (유지) | `GET /api/episodes/{id}` — 담당 L2 첫 열람이면 `firstOpenedAt` 기록 | L2(assignee) | — | `REVIEW_START` |
| OPEN | (유지) | alerts 추가(Alert 화면에서) | L1 | comment | `LINK` |
| OPEN | (유지) | alerts 해제 / comments | L2 | comment | `UNLINK` / `COMMENT` |
| OPEN | OPEN | assign(재배정), `firstOpenedAt` 초기화 | ADMIN | userId, comment | `ASSIGN` |
| OPEN | CLOSED | `POST /api/episodes/{id}/close` | L2 | resolution, comment | `EPISODE_CLOSE` |
| CLOSED | — | 모든 변경 불가 → 409 | | | |

- 역할 요약: L1 = Alert 종결·심층 요청(신규 Episode 생성 / 기존 Episode에 연결 — 둘 다 Alert 화면). L2 = Episode 조사(해제·의견·종결; 10월 분리·병합). ADMIN = 배정·재배정 + 전체 조회, 조사 액션 없음.
- Episode 상태 표시 관점: 대시보드 "L2 조사 중" 칸 = Episode `OPEN`(Alert로는 `ESCALATED`). "새로 배정·미열람" = `OPEN` ∧ `firstOpenedAt IS NULL`.

## 5. 인증·사용자 (W4 [인증] — 초안, 방식은 미정)

- **POST /api/auth/login** `{ username, password }` → 200 `{ userId, name, role }` / 401. 세션 쿠키 또는 토큰 `[미정: 인증 방식]`.
- **POST /api/auth/logout** → 204.
- **GET /api/me** → `{ userId, name, role }`.
- **GET /api/users?role=L1|L2** [ADMIN·전 역할 조회] — 재배정 대상 선택용 `[{ userId, name, role, lastAssignedAt }]`. 사용자 생성·수정은 11월 [권한관리].
- 사용자 테이블에 `last_assigned_at`(§3.4 라운드로빈 포인터). MVP 시드 사용자: **L1 2명, L2 2명**, ADMIN 1명(비밀번호는 환경변수 시드) — 라운드로빈이 시연에서 보이려면 역할당 2명 이상 필요.

## 6. 감사 이력

행 스키마(단일 테이블):
```
{ id, actor: { userId, name, role }, action, targetType: ALERT|EPISODE, targetId,
  relatedIds: [], from, to, resolution, comment, at }
```
- `from`/`to`는 상태(공통 모델 §3.3), `resolution`은 `CLOSE`·`EPISODE_CLOSE` 행에만 값(그 외 null).
- `action` enum: `REVIEW_START, CLOSE, ESCALATE, LINK, UNLINK, ASSIGN, COMMENT, EPISODE_CREATE, EPISODE_CLOSE` (10월 예약: `SPLIT, MERGE, MOVE`). `REVIEW_START`는 조회가 만드는 유일한 행 — `comment` 없음(§0 "처분 액션 comment 필수"의 예외), 상태 변화 없음(`from = to = OPEN`), 담당자당 1회(`firstOpenedAt` 기록 시점).
- `relatedIds`: LINK/UNLINK 시 episodeId·alertId 쌍, ASSIGN 시 이전·이후 userId.
- **GET /api/alerts/{id}/history**, **GET /api/episodes/{id}/history** — Episode 이력은 소속 Alert의 ESCALATE/LINK/UNLINK 행을 포함.
- **GET /api/history?actor={userId}** [ADMIN·본인] — 사용자별 처리 이력(기획서 요구, 11월 [권한관리]에서 구현, 시그니처 예약).

## 6.5 대시보드 (W4 [Episode 조사 데이터 ⑥ + 대시보드], 09-29 — 처리 흐름 4칸 + 담당자별)

- **GET /api/dashboard/summary** [전 역할] — `{ alertsByStatus: { OPEN, ESCALATED, CLOSED }, alertsUnopened, alertsByResolution: { NORMAL, FALSE_POSITIVE }, alertsByType: [{ code, name, count }], episodesByStatus: { OPEN, CLOSED }, episodesUnopened, episodesByResolution: { NORMAL, SUSPICIOUS }, alertsByAssignee: [{ userId, name, open, unopened, closedToday, escalatedToday, maxAgeDays }], episodesByAssignee: [{ userId, name, open, unopened, closedLast7Days, maxAgeDays }], latestJob: { jobId, analysisDate, status, suspiciousTxCount, alertCount, finishedAt }, reductionRate }` — `reductionRate = 1 - alertCount / suspiciousTxCount`(최근 job). 지표 추가는 `[미정: FE — 시연 화면]`.

## 7. 화면별 제공 항목 (FE 통보용 — 회신 요청)

FE는 아래에서 **표시할 항목을 고르고, 빠진 항목을 요구**한다. 항목 추가는 W3 [스키마]·[API] 전(9/14)까지 회신하면 마이그레이션 없이 반영된다.

| 화면 | API | 제공 항목 |
|---|---|---|
| 수집·처리현황 (은행별 도착 현황) | §1.1, §1.2 | **은행별 도착 현황**(`GET /api/banks/arrivals`: 은행·상태 7종·파일명·행 수·도착 시각·컷오프 잔여·도착 n/N) / 적재 작업 목록·오류 표(`errors[]`) / 분석 작업 목록(status·attempt·analysisDate·모델 버전·임계·의심 거래·Alert) / "분석 실행" 버튼 = `POST /api/batch-jobs/analysis` / 사이트에 업로드 버튼 없음(은행·목업이 API로 전송) / ADMIN 은행·키 관리는 10월 |
| Alert 목록 (L1 큐) | §3.2 | 위험도, **요약문**, 대표 유형(코드·명), **대표 계좌·계좌 수·은행 수**, 거래 수, **USD 합계 + 통화별 합계**, **점수 통계(평균·최고·초과 비율)·점수 가중 금액·묶음 순도**, 기간(첫·마지막 거래), 참여 은행, 상태, **담당자(자동 배정)**, 소속 Episode, 분석 날짜, 생성 시각, **경과일** / 정렬 8종 / 필터 7종("내 담당" 기본 뷰) / ADMIN: 재배정 |
| Alert 상세 (L1) | §3.2, §3.3 | 목록 항목 + 구성 거래 표(§2.4 — 금액 USD·**백분위·임계 배율·의심 여부·복합 유형 후보·두 모델 합의·편입 역할·방향** 포함) + 유형 구성비 + 묶음 근거 + **참여 계좌 표(역할·in/out 건수·USD·최대 점수·상대방 수·첫 거래일)** + **시각순 점수 추이** + **설명 요인(피처 기준선 편차 상위 3, 포함 방식은 W3)** + 관계 그래프(노드 역할·금액·위험 등급, 엣지 id·거래 수·USD·최대 점수·유형·기간) + 이력 / 액션: 종결(정상·오탐, 의견 필수)·심층 요청(신규 Episode — L2 자동 배정 / 기존 Episode 연결) / ADMIN: 재배정 |
| Episode 목록 (L2 큐) | §4.1 | 위험도·자동 제목·Alert 수·거래 수·USD·유형들·담당자·상태(OPEN/CLOSED)·미열람·결과·요청 L1·경과일 / 뷰: 내 담당·미열람·전체 / 정렬·필터 §4.1 |
| Episode 상세 (L2 조사) | §4 | 상세(조사 순서): 소속 Alert 표 → ① 기준선 배율 → ② 자금 흐름 요약 → ③ 패턴 증거 체크 → ④ 상대방 표(다른 Alert 포함) → ⑤ 자금 경로 그래프(hops=0/1) + 연계 거래 → ⑥ 관련 계좌 이력 → ⑦ 의견·이력 → ⑧ 결론(who/what/when/where/why/how 템플릿 + resolution + 서술) / 액션: Alert 해제·조사 의견·종결 — 연결은 Alert 화면(L1) / ADMIN: 재배정 |
| (관계 그래프) | §3.2 graph · §4.1 graph | 독립 화면이 아니라 Alert 상세·Episode 상세 안의 패널(노드 = 계좌). Alert = 구성 거래 그래프, Episode = 합집합 + Alert 밖 1 hop. 다기관 전체 그래프는 11월 |
| 대시보드 | §6.5 | 처리 흐름 4칸(미처리 OPEN + 미열람 → 경과일 → L2 조사 ESCALATED/Episode OPEN + 미열람 → 처분 CLOSED + resolution 분포), 유형 분포, 담당자별(L1·L2), 최근 배치, 감소율 |
| 로그인 | §5 | 사용자·역할 반환. 역할별 첫 화면(L1 → Alert 목록 "내 담당", L2 → Episode 목록 "내 담당", ADMIN → 대시보드). 시연은 L1·L2 계정 전환 + ADMIN 재배정 1회(선택) |
| 모델 성능·버전 / 사용자·권한 | — | 시연 이후(10~11월) |

## 8. 미정 목록 (회신 주체별)

**FE**: ① 금액 **화면 표기 방식**(축약·자릿수 — 데이터 형태는 §0 BE 결정으로 해소) ② 그래프 응답 포함 vs 분리(BE 추천: 분리), 시각화 라이브러리 ③ 유형 한글 표시 명칭·'의심 거래' 표시 명칭(초안: 리서치 문서 §4.6) ④ §7 회신(빠진 항목) ⑤ 인증 방식 결정 기한(로그인 착수 시점) ⑥ 대시보드 추가 지표(후보: 위험 밴드 분해·미결 경과일 중앙/최대·처분 결과 분포·은행별·담당자별 부하·Alert→Episode 전환율).
**Data**: ① 시연 CSV 시각 형식·인코딩·은행별 분할(9/7 전) ② ~~이진 모델 피처 세트 동일 여부~~ → 다름·구성 변동으로 확정(09-07, §2.1) — 각 세트의 현재 컬럼 목록은 [모델 래핑] 때 피처 빌더에서 읽는다 ③ Σp 보장·dtype ④ `link_basis` 산출 가능 여부(+ 거래별 `role`/허브 계좌 산출 가능 여부) ⑤ ~~처분된 Alert 거래 제외 여부~~ → 제외로 확정(09-07, §3.1) — 알고리즘 입력 = 미소속 거래만 ⑥ Episode 위험도 = max Alert riskScore 동의 ⑦ 점수 적재 스텝에서 job 내 백분위(`score_pct`) 계산 추가 동의 ⑧ 학습 산출물(run json: 검증 PR-AUC, recall별 임계·precision·알람 수, 유형별 OVR PR-AUC, 피처 중요도) 인도 형식·시점 — 10월 [모델 관리] `model_versions` 입력, W2 캘리브레이션에도 사용.
**Infra**: ① BE IAM 키에 `uploads/` PUT용 Presigned 서명 + HEAD/GET 권한(9/7 항목에 추가) ② 버킷 CORS 불필요(서버 간 PUT) 확인.
**Data 추가(09-07)**: ⑨ Episode 조사 블록 패턴 증거 항목·통과 기준 초안 검토(§4.1) ⑩ 시연 CSV 은행별 분할 형식(은행 목업이 파일 단위로 전송).
**사용자**: ① ~~`is_laundering` 원장 보관 여부~~ → 평가 스키마 분리로 확정(09-07, §1.4) ② **최종 모델 형태 — 지금 답할 수 없음(2026-09-07 사용자)**: 모델 개선 결과에 따라 정해진다. 질문 목록에서 제외하고, 계약은 필수 열 + 무시되는 확장 열 규칙(§2.1)·모델별 피처 파일·`feature_version_*`로 어느 형태든 수용한다. 형태가 정해지면 그때 엣지 파일·`pred_contrib`·run 지표 인도 형식을 추가한다.
해소됨(v0.2): 점수 필드명, 유형 매핑표, 페이지네이션·정렬, 에러 응답, 배치 상태, 상태 전이, 역할 표, 감사 이력 행, 임계 저장(threshold_value 스냅샷). 해소됨(v0.3): 금액·통화 데이터 형태(USD 환산 병기·ISO 코드), Alert 요약·대표 계좌·참여 계좌·점수 통계·거래 편입 역할·점수 파생 확장.
