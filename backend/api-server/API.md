# API 계약 v0.2 — 2026-09-03

지위: **BE 결정 통보 + 팀 합의 대상.** 표시 없는 항목은 BE가 정해 통보하는 컨벤션이며, `[미정: X]`만 X의 회신이 필요하다(목록은 §8). 합의 결과는 이 문서를 갱신하고 kickoff §4.5에 기록. 구현된 API의 정본은 Swagger(springdoc)이고 이 문서는 사전 합의·설계 결정 기록이다.
용어: kickoff §2.5 — `거래 → (임계 선별) 의심 거래 → (자동 묶음) Alert → (조사·연결) Episode`. 구 명칭 혼용 금지.
이 문서는 W2 [DB 설계]의 입력이다. 변경 이력: v0.1(09-02, 층1~4 초안) → v0.2(09-03, 외부 검수 반영 — 배치 상태·추론 파일 계약·전이 표·역할·감사 이력·인증·대시보드·화면별 제공 항목 추가).

## 0. 공통 규칙

- **식별자**: `uploadId`(INGEST 작업, bigint), `jobId`(ANALYSIS 작업, bigint — 같은 batch_jobs 시퀀스), `txId`(원장 거래, bigint), `alertId`·`episodeId`·`userId`(bigint). 전부 서버 발급. W1의 `uploadId`(uuid)는 W2 [원장 적재]에서 bigint로 교체.
- **표기**: JSON 필드는 camelCase. Python 파이프라인·S3 산출물은 snake_case — BE가 경계에서 변환. 점수는 전부 0~1 실수. 시각은 ISO-8601 UTC. 금액·통화 표기 `[미정: FE]`.
- **페이지네이션(BE 결정)**: 목록은 `{ content: [], page, size, totalElements, totalPages }`. 쿼리 `page`(0부터)·`size`(기본 20, 최대 200)·`sort=field,asc|desc`(복수 허용). 빈 목록 = 200 + 빈 `content`.
- **에러 응답(BE 결정)**: RFC 9457 ProblemDetail `{ type, title, status, detail, instance }` + 확장 `code`(문자열 enum, 아래 표)·`id`(관련 uploadId/jobId/alertId, 없으면 생략). 상태 코드: 400 검증·형식, 401 미인증, 403 역할 불가, 404 없음, 409 상태 충돌·중복, 413 파일 한도, 500 서버·워커 실패.

| code | status | 뜻 |
|---|---|---|
| `VALIDATION_FAILED` | 400 | 요청·파일 검증 실패(`errors[]`에 행·컬럼·사유) |
| `MISSING_PART` | 400 | 멀티파트 `file` 누락 |
| `UNAUTHENTICATED` | 401 | |
| `FORBIDDEN_ROLE` | 403 | 역할이 액션을 허용하지 않음 |
| `NOT_FOUND` | 404 | |
| `INVALID_TRANSITION` | 409 | 전이 표에 없는 상태 전이 |
| `DUPLICATE_FILE` | 409 | 같은 해시의 파일이 이미 적재됨 |
| `JOB_ALREADY_RUNNING` | 409 | 같은 analysisDate의 작업이 RUNNING |
| `FILE_TOO_LARGE` | 413 | |
| `WORKER_FAILED` | 500 | 워커 프로세스 실패·시간 초과 |
| `INTERNAL` | 500 | 그 외 |

- **역할**: `L1`·`L2`·`ADMIN`. 엔드포인트마다 `[허용 역할]` 표기. ADMIN은 사용자·모델 관리 전용이며 조사 액션 불가. MVP는 데이터 범위 제한 없음(모든 역할이 전체 조회, 허용된 액션은 전체에 대해). "담당 Episode만" 제한은 10월. 인증 *방식*(세션 vs JWT) `[미정: FE 로그인 착수 전, 늦어도 9/18]`.
- **감사 이력**: 모든 처분 액션은 §6 이력 행을 부수효과로 기록. 처분 액션의 `comment`는 **필수**(빈 값 400).
- **유형 코드**: 0~8, 매핑표 §2.3. 명칭은 `{ code, name }` 객체로 내보낸다(한글 표시명은 FE 소관).

## 1. 층 1 — 수집·배치

### 1.1 POST /api/uploads  [L1·L2·ADMIN]  (W1 구현됨 → W2 [원장 적재]에서 재목적)
- 요청: multipart/form-data — `file`(은행별 거래 CSV, 한도 200MB), `bankId`(정수, IBM `From Bank` 코드).
- 동작: 가벼운 검증(§1.4) → 표준화·가명화(Data 진입점) → 원장 적재 → batch_jobs(INGEST) 기록. **적재까지 동기.** 검증 실패는 아무것도 적재하지 않는다(all-or-nothing).
- 응답 200: `{ uploadId, bankId, rowCount, status: "COMPLETED", ingestedAt }`
- 실패: 400 `VALIDATION_FAILED` + `errors: [{ row, column, reason }]`(최대 50건) / 409 `DUPLICATE_FILE` / 413.
- W1 현재 응답 `{ uploadId(uuid), rowCount }`는 W2에서 위 형태로 교체.
- 10월: 은행별 Presigned URL + S3 직행으로 전환(`URL_ISSUED`→`EXPIRED` 상태 추가).

### 1.2 처리현황 (W2 [원장 적재]·[일별 분석 진입점])
- **GET /api/uploads/{uploadId}** [전 역할] — INGEST 작업 1건: `{ uploadId, bankId, fileName, rowCount, status, errorCode, errorMessage, startedAt, finishedAt }`
- **GET /api/batch-jobs** [전 역할] — 목록(페이지네이션). 필터 `type=INGEST|ANALYSIS`, `status`, `from/to`(startedAt). 행: `{ jobId, type, status, attemptCount, analysisDate(ANALYSIS), bankId(INGEST), rowCount, errorCode, errorMessage, startedAt, finishedAt, modelVersionBinary, modelVersionType, featureVersion, thresholdValue }`
- **GET /api/batch-jobs/{jobId}** [전 역할] — 위 행 + `counters: { suspiciousTxCount, alertCount, missingCount, duplicateCount }`.
- **POST /api/batch-jobs/analysis** [L1·L2·ADMIN — 시연용 수동 실행] — 요청 `{ analysisDate? }`(기본 오늘). 응답 202 `{ jobId, status: "QUEUED" }`. 같은 analysisDate가 RUNNING이면 409 `JOB_ALREADY_RUNNING`; COMPLETED·FAILED면 같은 job의 재시도(기존 결과 삭제+삽입, OPEN Alert만 재생성). 스케줄러(컷오프 06:00)도 같은 코드를 부른다.

### 1.3 배치 상태 (batch_jobs — 테이블 1개 + job_type)

| job_type | 상태 | 뜻 | 다음 |
|---|---|---|---|
| INGEST | `RECEIVED` | 파일 수신, 검증 중 | RUNNING / VALIDATION_FAILED |
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

- 공통 컬럼: `attempt_count, claimed_at, heartbeat_at, started_at, finished_at, error_code, error_message`. ANALYSIS 전용: `analysis_date UNIQUE, threshold_value, model_version_binary, model_version_type, feature_version, suspicious_tx_count, alert_count`. INGEST 전용: `bank_id, file_name, file_hash, row_count, missing_count, duplicate_count`.
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
| Is Laundering | `is_laundering` | bool | 선택(시연 평가용, 화면 비노출) `[미정: 사용자 — 보관 여부]` |

- 원장 추가 컬럼: `tx_id`(PK), `bank_id`(업로드 bankId), `row_hash`(표준화 행 해시, `(bank_id,row_hash)` UNIQUE), `ingest_job_id`, `scored_job_id`(NULL = 미채점).
- **가벼운 검증(업로드 API 동기)**: 비어 있지 않음 / CSV 파싱 가능 / 헤더에 위 필수 10개 존재 / 데이터 행 ≥ 1 / 파일 해시 미중복. 행 단위 형식 오류는 적재 단계에서 `errors[]`로 모아 400.
- 인코딩·BOM·시각 형식·은행별 분할은 `[미정: Data — 시연 CSV 스펙, 9/7 전]`.

## 2. 층 2 — 추론·거래 점수·의심 거래

### 2.1 추론 에이전트 파일 계약 (S3, 확정 2026-09-03)

경로 접두어와 쓰기 순서(마지막 파일이 "준비/완료" 표식):

```
requests/{jobId}/features.parquet   ← BE(Python 파이프라인)가 먼저 씀
requests/{jobId}/manifest.json      ← 마지막에 씀 (이 파일이 보이면 요청 완료)
results/{jobId}/scores.parquet      ← 추론 에이전트가 먼저 씀
results/{jobId}/result.json         ← 마지막에 씀 (완료 표식)
results/{jobId}/error.json          ← 실패 시 (scores 없이)
```

- `manifest.json`: `{ job_id, analysis_date, row_count, feature_version, model_version_binary, model_version_type, requested_at }` — BE가 요청하는 버전.
- `features.parquet`: `tx_id`(int64) + 피처 컬럼(features_v2, 컬럼 목록은 피처 빌더 정본) `[미정: Data — 이진 모델 피처 세트 동일 여부]`.
- `scores.parquet`: `tx_id`(int64), `p_laundering`(float64), `p_0`…`p_8`(float64). 행 수·tx_id 집합은 features와 동일해야 한다. NaN 불허, 각 값 0~1 `[미정: Data — Σp_0..8 = 1 보장 여부]`.
- `result.json`: `{ job_id, row_count, model_version_binary, model_version_type, feature_version, started_at, finished_at }` — **실제 실행한 버전**을 에코. BE는 이 값을 batch_jobs에 기록하고 manifest와 다르면 WARN.
- `error.json`: `{ job_id, code, message, retryable }`. `retryable=true`면 일시 실패(RETRY_WAIT), false면 FAILED.
- 폴링: BE가 `results/{jobId}/result.json` 또는 `error.json`을 5초 간격, 최대 30분. 초과 = 일시 실패. 추론 에이전트는 `requests/*/manifest.json`을 폴링(1대만).
- 검증(BE): 열 개수·이름, 행 수, tx_id 집합, NaN. 불일치 = 영구 실패(`FAILED`, error_code `SCORES_MISMATCH`).
- 정리: 성공·실패 확정 후 BE가 `requests/{jobId}/`·`results/{jobId}/` 삭제(보존 여부는 10월 Lifecycle에서).
- MVP 운반: 실제 AWS S3(9/7). 9/9까지 없으면 로컬 폴더에 같은 경로로 관통 후 클라이언트만 교체.

### 2.2 거래별 점수 테이블·파생 규칙
- 저장: `(job_id, tx_id) PK, p_laundering, p_0..p_8` 그대로. 같은 job 재실행 시 삭제+삽입.
- 파생(BE, 조회 시 계산): `launderingScore = p_laundering`, `typeClass = argmax(p_0..p_8)`(p_0이 최대면 0 그대로), `typeScore = 그 확률`. 동점 시 낮은 코드.
- 의심 거래 = `p_laundering >= threshold_value(그 job의 스냅샷)`. 저장 플래그가 아니라 파생. 임계는 프로퍼티 `app.suspicious-tx.threshold`(env `SUSPICIOUS_TX_THRESHOLD`), job 실행 시 batch_jobs에 스냅샷. `threshold_version`은 10월 thresholds 테이블에서.
- `ruleHits[]`는 룰 기반(향후 확장) 전까지 항상 빈 배열 — 추론 산출물이 아니라 BE 룰 엔진 산출. 점수 테이블에 룰 컬럼을 두지 않는다.

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
  amountReceived, receivingCurrency, amountPaid, paymentCurrency, paymentFormat,
  launderingScore, typeClass, typeName, typeScore, jobId }
```
- `fromAccount`·`toAccount`는 가명. 금액 표기 `[미정: FE]`.

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
| `tx_count`, `total_amount`(`[미정: FE — 통화 기준]`) | |
| `first_tx_at`, `last_tx_at` | 작전 기간 |
| `accounts[]`, `banks[]` | 참여 계좌(가명)·기관 — BE가 구성 거래에서 파생 |
| `link_basis[]` | 묶음 근거 `[{ basis: TIME|ACCOUNT|BANK|PATH, value }]` `[미정: Data — 산출 가능 여부]` |
| `status`, `episode_id`, `created_at`, `updated_at` | 워크플로 |

구성 거래 테이블: `(alert_id, tx_id)`. 한 거래는 한 OPEN Alert에만 속한다.
- **재실행 규칙**: 같은 job이 다시 돌면 `OPEN` Alert만 삭제·재생성. `CLOSED_*`·`ESCALATED`는 보존(alertId 유지). 처분된 Alert의 거래를 재묶음 입력에서 제외할지 `[미정: Data]`.

### 3.2 조회
- **GET /api/alerts** [전 역할] — 목록(페이지네이션). 기본 정렬 `riskScore,desc`. 정렬 키: `riskScore, createdAt, lastTxAt, txCount, totalAmount`. 필터 `status`, `typeClass`, `bankId`, `from/to`(lastTxAt 기준), `analysisDate`, `episodeId`.
  행: `{ alertId, riskScore, primaryType: { code, name }, txCount, totalAmount, firstTxAt, lastTxAt, banks: [int], status, episodeId, analysisDate, createdAt }`
- **GET /api/alerts/{alertId}** [전 역할] — 목록 행 + `transactions: [거래 행 §2.4]`, `typeDistribution`, `accounts[]`, `groupingBasis: link_basis[]`, `graph`(아래).
- **관계 그래프**: `graph: { nodes: [{ id, kind: ACCOUNT|BANK, label, riskLevel: HIGH|MEDIUM|LOW }], edges: [{ from, to, txCount, totalAmount, maxScore, primaryType, direction }] }` — 상세에 포함 vs `GET /api/alerts/{alertId}/graph` 분리 `[미정: FE 시각화 라이브러리]`. `riskLevel` 경계는 BE 프로퍼티(기본 0.9/0.7).
- **GET /api/alerts/{alertId}/history** [전 역할] — §6 이력 행 목록.

### 3.3 Alert 상태 전이 표

상태: `OPEN`(큐 대기) / `CLOSED_NORMAL` / `CLOSED_FALSE_POSITIVE` / `ESCALATED`(Episode 귀속, `episodeId != null`과 항상 일치).

| from | to | 액션 / 엔드포인트 | 허용 역할 | 필수 입력 | 이력 action |
|---|---|---|---|---|---|
| OPEN | CLOSED_NORMAL | `POST /api/alerts/{id}/close` `{ resolution: NORMAL, comment }` | L1 | comment | `CLOSE` |
| OPEN | CLOSED_FALSE_POSITIVE | 같은 엔드포인트 `{ resolution: FALSE_POSITIVE, comment }` | L1 | comment | `CLOSE` |
| OPEN | ESCALATED | `POST /api/episodes` `{ alertIds[], assigneeId, comment }` (신규 Episode) | L1 | alertIds ≥1, assigneeId(L2), comment | `ESCALATE` |
| OPEN | ESCALATED | `POST /api/episodes/{episodeId}/alerts` `{ alertIds[], comment }` (기존 Episode) | L1·L2 | comment | `LINK` |
| ESCALATED | OPEN | `DELETE /api/episodes/{episodeId}/alerts/{alertId}` `{ comment }` | L2 | comment; Episode에 Alert가 2개 이상일 때만(빈 Episode 불허) | `UNLINK` |
| CLOSED_* | — | 어떤 액션도 불가 → 409 `INVALID_TRANSITION` | | | |
| ESCALATED | CLOSED_* | 불가(Episode 종결로만) → 409 | | | |
| OPEN | ESCALATED (CLOSED Episode에) | 불가 → 409 | | | |

- `CLOSED_NORMAL` = 정상 거래로 판단, `CLOSED_FALSE_POSITIVE` = 모델 오탐(둘 다 평가 지표 라벨로 쓰인다).
- 이동(다른 Episode로) = UNLINK + LINK 두 요청(MVP 비원자). 원자적 `move`·분리·병합은 10월: `POST /api/alerts/{id}/split`, `POST /api/alerts/merge`, `POST /api/episodes/{id}/alerts/move`.
- 재오픈·보류·반려는 MVP·10월 범위 밖.

## 4. 층 4 — Episode·조사

### 4.1 조회
- **GET /api/episodes** [전 역할] — 목록(페이지네이션). 기본 정렬 `riskScore,desc`(riskScore = 소속 Alert riskScore 최대값 `[미정: Data 동의]`). 정렬 키 `riskScore, createdAt, updatedAt, alertCount`. 필터 `status`, `assigneeId`, `from/to`(createdAt).
  행: `{ episodeId, riskScore, alertCount, txCount, totalAmount, primaryTypes: [{ code, name }], assignee: { userId, name }, status, outcome, createdBy: { userId, name }, createdAt, updatedAt, closedAt }`
- **GET /api/episodes/{episodeId}** [전 역할] — 행 + `alerts: [Alert 목록 행]`, `history: [§6 행]`.
- **GET /api/episodes/{episodeId}/history** [전 역할].

### 4.2 액션
- **POST /api/episodes** [L1] `{ alertIds[], assigneeId, comment }` → 201 `{ episodeId }`. Episode `INVESTIGATING`, Alert들 `ESCALATED`. assigneeId는 L2 사용자여야 한다(아니면 400).
- **POST /api/episodes/{id}/alerts** [L1·L2] `{ alertIds[], comment }` — OPEN Alert만 연결 가능.
- **DELETE /api/episodes/{id}/alerts/{alertId}** [L2] `{ comment }` — Alert `OPEN` 복귀. 마지막 Alert면 409.
- **POST /api/episodes/{id}/assign** [L2] `{ userId, comment }` — 재배정(L2 사용자). 최초 배정은 생성 시.
- **POST /api/episodes/{id}/comments** [L2] `{ comment }` — 조사 의견. 상태 변화 없음, 이력 `COMMENT`.
- **POST /api/episodes/{id}/close** [L2] `{ outcome: NORMAL | SUSPICIOUS, comment }` — 종결. 소속 Alert는 `ESCALATED` 유지(조회는 Episode 상태로 판단).

### 4.3 Episode 상태 전이 표

상태: `INVESTIGATING` / `CLOSED`.

| from | to | 액션 | 허용 역할 | 필수 입력 | 이력 action |
|---|---|---|---|---|---|
| — | INVESTIGATING | `POST /api/episodes` | L1 | alertIds, assigneeId, comment | `ESCALATE`(각 Alert) + `EPISODE_CREATE` |
| INVESTIGATING | INVESTIGATING | alerts 추가 / 해제 / assign / comments | 위 §4.2 | comment | `LINK` / `UNLINK` / `ASSIGN` / `COMMENT` |
| INVESTIGATING | CLOSED | `POST /api/episodes/{id}/close` | L2 | outcome, comment | `EPISODE_CLOSE` |
| CLOSED | — | 모든 변경 불가 → 409 | | | |

- 역할 요약: L1 = Alert 종결·심층 요청(Episode 생성·기존 연결). L2 = Episode 조사(연결·해제·재배정·의견·종결). ADMIN = 조사 액션 없음, 전체 조회만.

## 5. 인증·사용자 (W4 [인증] — 초안, 방식은 미정)

- **POST /api/auth/login** `{ username, password }` → 200 `{ userId, name, role }` / 401. 세션 쿠키 또는 토큰 `[미정: 인증 방식]`.
- **POST /api/auth/logout** → 204.
- **GET /api/me** → `{ userId, name, role }`.
- **GET /api/users?role=L2** [전 역할] — 재배정·담당자 선택용 `[{ userId, name, role }]`. 사용자 생성·수정은 11월 [권한관리].
- MVP 시드 사용자: L1 1명, L2 2명, ADMIN 1명(비밀번호는 환경변수 시드).

## 6. 감사 이력

행 스키마(단일 테이블):
```
{ id, actor: { userId, name, role }, action, targetType: ALERT|EPISODE, targetId,
  relatedIds: [], from, to, comment, at }
```
- `action` enum: `CLOSE, ESCALATE, LINK, UNLINK, ASSIGN, COMMENT, EPISODE_CREATE, EPISODE_CLOSE` (10월 예약: `SPLIT, MERGE, MOVE`).
- `relatedIds`: LINK/UNLINK 시 episodeId·alertId 쌍, ASSIGN 시 이전·이후 userId.
- **GET /api/alerts/{id}/history**, **GET /api/episodes/{id}/history** — Episode 이력은 소속 Alert의 ESCALATE/LINK/UNLINK 행을 포함.
- **GET /api/history?actor={userId}** [ADMIN·본인] — 사용자별 처리 이력(기획서 요구, 11월 [권한관리]에서 구현, 시그니처 예약).

## 6.5 대시보드 (W5 [대시보드·동결] — 최소판)

- **GET /api/dashboard/summary** [전 역할] — `{ alertsByStatus: { OPEN, CLOSED_NORMAL, CLOSED_FALSE_POSITIVE, ESCALATED }, alertsByType: [{ code, name, count }], episodes: { investigating, closed }, latestJob: { jobId, analysisDate, status, suspiciousTxCount, alertCount, finishedAt }, reductionRate }` — `reductionRate = 1 - alertCount / suspiciousTxCount`(최근 job). 지표 추가는 `[미정: FE — 시연 화면]`.

## 7. 화면별 제공 항목 (FE 통보용 — 회신 요청)

FE는 아래에서 **표시할 항목을 고르고, 빠진 항목을 요구**한다. 항목 추가는 W3 [스키마]·[API] 전(9/14)까지 회신하면 마이그레이션 없이 반영된다.

| 화면 | API | 제공 항목 |
|---|---|---|
| 업로드·처리현황 | §1.1, §1.2 | bankId·파일명·행 수·상태·오류 사유·시각 / 작업 목록(type·status·attempt·analysisDate·모델 버전·임계) / "분석 실행" 버튼 = `POST /api/batch-jobs/analysis` |
| Alert 목록 (L1 큐) | §3.2 | 위험도, 대표 유형(코드·명), 거래 수, 금액 합계, 기간(첫·마지막 거래), 참여 은행, 상태, 소속 Episode, 분석 날짜, 생성 시각 / 정렬 5종 / 필터 6종 |
| Alert 상세 (L1) | §3.2, §3.3 | 목록 항목 + 구성 거래 표(§2.4 15개 필드) + 유형 구성비 + 묶음 근거 + 참여 계좌 + 관계 그래프(노드 위험 등급·엣지 거래 수·금액·최대 점수·유형) + 이력 / 액션: 종결(정상·오탐, 의견 필수)·심층 요청(신규 Episode + L2 지정 / 기존 Episode 연결) |
| Episode 조사 (L2) | §4 | 목록: 위험도·Alert 수·거래 수·금액·유형들·담당자·상태·결론·생성자·시각 / 상세: 소속 Alert 목록 행 + 이력 / 액션: Alert 연결·해제·재배정·조사 의견·종결(결론 NORMAL/SUSPICIOUS + 의견) |
| 관계 그래프 | §3.2 graph | Alert 단위 계좌·은행 그래프. 다기관 전체 그래프는 11월 |
| 대시보드 | §6.5 | 상태별 Alert 수, 유형 분포, Episode 진행/종결, 최근 배치, 감소율 |
| 로그인 | §5 | 사용자·역할 반환. L1·L2 계정 전환 시연 |
| 모델 성능·버전 / 사용자·권한 | — | 시연 이후(10~11월) |

## 8. 미정 목록 (회신 주체별)

**FE**: ① 금액·통화 표기 ② 그래프 응답 포함 vs 분리, 노드·엣지 포맷 ③ 유형 한글 표시 명칭·'의심 거래' 표시 명칭 ④ §7 회신(빠진 항목) ⑤ 인증 방식 결정 기한(로그인 착수 시점) ⑥ 대시보드 추가 지표.
**Data**: ① 시연 CSV 시각 형식·인코딩·은행별 분할(9/7 전) ② 이진 모델 피처 세트 동일 여부 ③ Σp 보장·dtype ④ `link_basis` 산출 가능 여부 ⑤ 처분된 Alert 거래 제외 여부 ⑥ Episode 위험도 = max Alert riskScore 동의.
**사용자**: ① `is_laundering` 원장 보관 여부.
해소됨(v0.2): 점수 필드명, 유형 매핑표, 페이지네이션·정렬, 에러 응답, 배치 상태, 상태 전이, 역할 표, 감사 이력 행, 임계 저장(threshold_value 스냅샷).
