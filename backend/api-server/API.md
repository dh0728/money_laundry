# API 계약 v0.8 — 2026-09-17

변경 v0.8: 정정 요청·전체 보고 교체, INTEGRATE/FREEZE_INPUT, 실행 세대·취소 결과 차단. Python 실행측·실 S3 관통은 후속.

변경 v0.7: ANALYSIS-ENTRY-20260910-v2 — 일별 대상 고정, 단계별 재시도·복구, 작업 상태 API와 완료된 의심 거래 DB 페이지 조회. 실제 피처/추론/Alert 연결은 후속 태스크.

변경 v0.6: BANK-IDENTITY-20260910-v1 — API 키 인증을 dev/local 임시 은행 코드 식별로 교체. 은행 측은 데이터 공급 목업을 사용한다.

변경 v0.5: INGEST-S3-RESULT-20260909-v2 — 실제 S3·체크섬·은행 결과 조회·파일 전체 검수·원장/완료 상태 원자화. 기존 중복 건너뛰기 정책은 폐기한다.

지위: **BE 결정 통보 + 팀 합의 대상.** 표시 없는 항목은 BE가 정해 통보하는 컨벤션이며, `[미정: X]`만 X의 회신이 필요하다(목록은 §8). 합의 결과는 이 문서를 갱신하고 kickoff §4.5에 기록. 구현된 API의 정본은 Swagger(springdoc)이고 이 문서는 사전 합의·설계 결정 기록이다.
용어: kickoff §2.5 — `거래 → (임계 선별) 의심 거래 → (자동 묶음) Alert → (조사·연결) Episode`. 구 명칭 혼용 금지.
V1·[원장 적재] 반영 완료 — 이후 변경은 마이그레이션·코드와 같은 커밋으로 갱신. 변경 이력: v0.1(09-02, 층1~4 초안) → v0.2(09-03, 외부 검수 반영 — 배치 상태·추론 파일 계약·전이 표·역할·감사 이력·인증·대시보드·화면별 제공 항목 추가) → **v0.3(09-04, 화면 리서치 반영 — 파생 데이터 원칙: USD 환산·거래 점수 파생(백분위·복합 후보·합의)·거래 편입 역할·Alert 요약·대표 계좌·참여 계좌 표·점수 통계·설명 요인. 근거 `worktable/AML_화면_데이터_리서치_2026-09-04.md` §5·§6)** → **v0.3 추가(09-06, 화면 피드백): Alert·Episode 공통 상태 모델 `OPEN → IN_REVIEW → CLOSED` + `resolution`(Alert만 `ESCALATED` 추가). `CLOSED_NORMAL/CLOSED_FALSE_POSITIVE` → `CLOSED + resolution`, Episode `INVESTIGATING` → `OPEN/IN_REVIEW`, `outcome` → `resolution`, 이력 `REVIEW_START`(§3.1·§3.3·§4·§6·§6.5·§7)** → **v0.3 추가(09-07): 배정 모델 A — Alert·Episode 생성 시 라운드로빈 자동 배정 + ADMIN 재배정(§3.4 신설, §0·§3.1·§3.2·§4·§5·§6.5·§7). 9/3에 근거 없이 기록됐던 "단일 공용 큐"·"L1이 L2 지정" 폐기** → **v0.3 추가(09-07): 수집 구조 — 은행 API 키 + Presigned PUT + 완료 API + 자동 적재, MVP 편입, 은행 목업 프로그램, 도착 현황 API, 상태 `URL_ISSUED`(§0·§1.1·§1.2·§1.3·§7·§8). 멀티파트 `POST /api/uploads` 폐기** → **v0.3 추가(09-07, 화면 피드백): `IN_REVIEW` 상태 제거 — 배정이 있으면 열람 여부로 상태를 쪼갤 이유가 없음. 열람은 `firstOpenedAt`(미열람 표시)로만 기록(§3.2·§3.3·§4·§6·§6.5·§7)** → **v0.3 추가(09-07): Alert→Episode 연결은 Alert 화면에서 L1만(`POST /api/episodes/{id}/alerts` [L1]), Episode 화면은 해제만; 재배정 ADMIN 전용 유지(§3.3·§4.2·§4.3·§7)** → **v0.3 추가(09-07): Episode 상세 조사 블록 6종(baseline·flow·patternEvidence·counterparties·accountHistory·accounts) + `/transactions`·`/context-transactions`·`/graph?hops=` — 전부 MVP(§4.1·§7). 리서치 §2.11 근거** → **v0.3 추가(09-07, DB 착수 결정 4건): 컬럼 명명 `tx_id`+팀 이름(§0), 라벨은 평가 스키마 분리(§1.4), 은행 테이블 = 전 코드 + `is_reporting`(§1.1·§1.2), 구성 거래 `UNIQUE(tx_id)` + 처분 거래 재묶음 제외(§3.1)** → **v0.3 추가(09-07): 피처 세트는 모델별로 다르고 구성 변동 — `features_binary/type.parquet`, `feature_version_binary/type`(§1.3·§2.1); 최종 모델 형태는 질문 제외(§8)** → **v0.4(09-08): 미열람 표시 제거 + `first_opened_at` 컬럼 제거(열람은 이력 `REVIEW_START`로만 — §3.2·§3.3·§3.4·§4·§6·§6.5·§7) · 시각 서울 표준시(§0) · 수집 로컬 저장소 구현·결정 A Java 단일 적재 경로·검증 단계·도착 현황 기본 날짜·조회 필드(§1.1~§1.4) · 에러 응답 `id` 확장 필드 제거(§0) · V1 반영(§1.3·§1.4·§2.2·§5)** → **v0.4 추가(09-08, 설계 검토): 일별 분석 날짜당 1회 — COMPLETED 재실행 불가·FAILED만 재시도·대상 술어 `scored_job_id IS NULL OR = :jobId`·"OPEN Alert 삭제·재생성" 폐기·MVP `@Scheduled` 컷오프 자동 실행(§0·§1.2·§1.3·§2.2·§3.1·§3.3) · `score_pct` BE 자체 확정(§2.2·§8) · IN_REVIEW 잔재 정리(§1.4·§3.1·§3.4·§4.2)**.

- **파생 데이터 원칙 (2026-09-04 사용자 확정)**: 화면을 현 계약에 맞추지 않는다. 원장·점수·피처·이력에서 계산할 수 있는 항목은 파생해 제공한다. 불가 판정은 원천 부재(실명·KYC 등)일 때만. 모델 형태(전체 GNN / GNN 임베딩 + 후단 모델 / LightGBM)에 의존하는 항목은 **결정 보류**(§8 사용자 ②) — 계약은 어느 모델이든 맞도록 필수 열 + 선택 확장 열로 둔다.

## 0. 공통 규칙

- **식별자**: `uploadId`(INGEST 작업, bigint), `jobId`(ANALYSIS 작업, bigint — 같은 batch_jobs 시퀀스), `txId`(원장 거래, bigint), `alertId`·`episodeId`·`userId`(bigint). 전부 서버 발급. W1의 `uploadId`(uuid)는 W2 [원장 적재]에서 bigint로 교체.
- **DB 컬럼 명명(2026-09-07 사용자 확정)**: 거래 식별자는 DB·S3 파일 모두 `tx_id`(§2.1 파일 계약과 일치 — Python 파이프라인이 DB를 직접 읽으므로 이름 하나). 그 외는 팀 ERD 이름(`occurred_at`, `amount_paid`, `bank_id INT`). API는 camelCase 경계 변환(`txId`, `txAt`).
- **표기**: JSON 필드는 camelCase. Python 파이프라인·S3 산출물은 snake_case — BE가 경계에서 변환. 점수는 전부 0~1 실수. **시각은 ISO-8601에 서울 표준시 오프셋(`+09:00`)을 붙여 낸다**(2026-09-08 사용자 확정, 프로퍼티 `app.zone`). 시간대 표기가 없는 입력 시각(CSV Timestamp)도 서울 시간으로 해석한다.
- **금액·통화(BE 결정 2026-09-04)**: 통화는 ISO 4217 코드로 정규화해 내보낸다(IBM 통화명 15종 → 코드 매핑표 §1.4, Bitcoin = `BTC`). 모든 금액 필드에 **원 통화 금액 + `…Usd` 환산액**을 병기한다. 환산은 모델 학습에 쓴 고정 환율표(`data_work/fx_rates_usd.txt` 스냅샷 → V1 `fx_rates` 테이블 `fx_rates_usd_v1`, 2026-09-07)로 적재 시 계산. 합계는 `totalAmountUsd` + `amountsByCurrency[{ currency, total }]`. 화면 표기 방식(축약·자릿수)만 FE 소관.
- **페이지네이션(BE 결정)**: 목록은 `{ content: [], page, size, totalElements, totalPages }`. 쿼리 `page`(0부터)·`size`(기본 20, 최대 200)·`sort=field,asc|desc`(복수 허용). 빈 목록 = 200 + 빈 `content`.
- **에러 응답(BE 결정)**: RFC 9457 ProblemDetail `{ type, title, status, detail, instance }` + 확장 `code`(문자열 enum, 아래 표). `id` 확장 필드는 두지 않는다(2026-09-08 — 관련 식별자는 경로·`detail`로 충분). 상태 코드: 400 검증·형식, 401 미인증, 403 역할 불가, 404 없음, 409 상태 충돌·중복, 413 파일 한도, 500 서버·워커 실패.

| code | status | 뜻 |
|---|---|---|
| `VALIDATION_FAILED` | 400 | 요청·파일 검증 실패(`errors[]`에 행·컬럼·사유) |
| `UPLOAD_MISMATCH` | 400 | 완료 통지 시 S3 객체 없음 또는 크기·체크섬 불일치 |
| `UNAUTHENTICATED` | 401 | |
| `BANK_IDENTITY_DISABLED` | 403 | dev/local 외 프로파일에서 임시 은행 식별 불가(prod 혼합 포함) |
| `FORBIDDEN_ROLE` | 403 | 역할이 액션을 허용하지 않음 |
| `NOT_FOUND` | 404 | |
| `INVALID_TRANSITION` | 409 | 전이 표에 없는 상태 전이 |
| `DUPLICATE_FILE` | 409 | 같은 은행의 동일 파일이 이미 적재됨. 추가 필드는 기존 `fileName`, `uploadedAt`만 |
| `UPLOAD_IN_PROGRESS` | 409 | 같은 은행의 동일 파일이 업로드·처리 중 |
| `UPLOAD_SUPERSEDED` | 409 | 같은 은행·파일의 새 업로드 번호가 발급되어 이전 URL_ISSUED 번호의 완료 통지 거절 |
| `JOB_ALREADY_RUNNING` | 409 | 같은 analysisDate의 작업이 QUEUED·RUNNING |
| `JOB_ALREADY_COMPLETED` | 409 | 같은 analysisDate의 작업이 이미 COMPLETED — 일별 분석은 날짜당 1회(§1.2) |
| `FILE_TOO_LARGE` | 413 | |
| `WORKER_FAILED` | 500 | 워커 프로세스 실패·시간 초과 |
| `INTERNAL` | 500 | 그 외 |

- **역할**: `L1`·`L2`·`ADMIN`. 엔드포인트마다 `[허용 역할]` 표기. ADMIN은 사용자·모델 관리와 **배정·재배정** 전용이며 조사 액션(종결·심층 요청·연결·의견) 불가. MVP는 데이터 범위 제한 없음(모든 역할이 전체 조회, 허용된 액션은 전체에 대해). "담당자만 처분" 강제는 10월.
- **은행 주체 `BANK`**: 현재 목업의 임시 은행 식별(§1.1). 은행 웹·직원 로그인은 프로젝트 범위 밖이며 실제 인증 연결은 배포 전 별도 과제다.
- **배정(2026-09-07 사용자 확정, 모델 A)**: Alert·Episode 모두 생성 시 시스템이 라운드로빈으로 담당자를 정한다(§3.4). L1이 L2를 고르지 않는다. 재배정은 ADMIN. 인증 *방식*(세션 vs JWT) `[미정: FE 로그인 착수 전, 늦어도 9/18]`.
- **감사 이력**: 모든 처분 액션은 §6 이력 행을 부수효과로 기록. 처분 액션의 `comment`는 **필수**(빈 값 400).
- **유형 코드**: 0~8, 매핑표 §2.3. 명칭은 `{ code, name }` 객체로 내보낸다(한글 표시명은 FE 소관).

## 1. 층 1 — 수집·배치

### 1.1 은행 수집 API

은행 측은 데이터 공급 목업만 제공한다. 은행 직원 웹·로그인·외부 통지는 구현 범위가 아니다. 상위기관 분석팀이 웹에서 결과를 조회한다.

- 보고 은행은 운영자가 `banks.is_reporting=true`와 `bank_reporting_periods`의 거래 기준일 적용 기간을 사전 등록한다. URL 요청으로 자격을 만들지 않는다. 참조 은행과 보고 은행은 별개다. 미등록 은행·기준일은403 `REPORTING_NOT_REGISTERED`다. `banks.report_format=AML17` 설정에 따라 현재 공통 CSV 규칙을 선택한다.
- `X-Bank-Id`는 dev/local에서만 허용하는 테스트 대역이다. prod 혼합·미지정 프로파일은403 `BANK_IDENTITY_DISABLED`, 잘못된 정수는400이다. 실제 인증 연동을 대체하지 않는다. 모든 은행 경로는 자기 은행 신원을 확인한다.
- **POST /api/v1/bank/uploads** `{fileName,sizeBytes,checksumSha256,businessDate}` + 정정 시 `{correctionRequestId,correctionSubmissionId}` →201 `{uploadId,bankId,url,method:"PUT",expiresAt,headers,uploadRequired}`. 기본4개 필드는 필수이며 정정2개 필드는 함께 지정한다. 한 파일은 서울 거래 기준일 하루치, 최대200MiB, 기본 URL TTL15분. 체크섬은 실제 파일 바이트 SHA-256 Base64다. 파일명 경로 문자는 거절한다.
- 은행은 응답의 서명 헤더를 유지해 S3에 PUT한다. 은행 식별 헤더를 S3로 전달하지 않는다. S3 SDK·비공개 객체·IAM 설정 계약은 기존 저장소 설정을 유지하며 실제 배포 권한은 별도 검증한다. dev/prod는 S3 설정 누락시 시작 실패, local/default만 폴더 저장소를 허용한다.
- **POST /api/v1/bank/uploads/{uploadId}/complete** →202 처리현황. 객체 존재·크기·실제 SHA-256 확인 후 수신을 커밋하고 비동기 검수한다. ETag를 체크섬으로 대체하지 않는다. 은행 행 잠금 후 최신 URL/상태를 다시 확인한다. 같은 번호 완료 재시도는 기존 상태를 반환한다.
- 일반 동일 파일 완료본은409 `DUPLICATE_FILE`, 진행 중은409 `UPLOAD_IN_PROGRESS`, 새 URL이 발급된 옛 번호는409 `UPLOAD_SUPERSEDED`다. 명시적인 correctionRequestId·correctionSubmissionId 제출만 별도 정정 문맥으로 접수한다. 일반 업로드는 기존 보고를 임의 교체하지 않는다.
- 검수 성공은 **은행 보고 저장 완료**다. `COMPLETED`를 통합·추론 완료로 해석하지 않는다. 반복 동일 행은 원천 발생 건수로 보존한다. 파일 자체 오류는 전체 보류하고 정상 개체·계좌·거래를 만들지 않는다. 정상 확정은 별도 통합 서비스에서 수행한다.
- 목업은 업로드 또는 `--upload-id` 재조회, 2초/최대30분 폴링을 유지한다. 종료0은 보고 수신 처리의 종료이며 `integrationStatus`로 통합 대기/정상/보류를 별도 표시한다. 시간초과는 서버 실패로 단정하지 않는다.

### 정정 및 실행 세대 계약 (V4)

- `GET /api/v1/bank/corrections?page=0&size=20&status=OPEN`: 자기 은행만 조회한다. status 생략은 모든 미해결 요청이며 OPEN, REPLACEMENT_RECEIVED, VALIDATING, WAITING_COUNTERPART, WAITING_ANALYSIS_RELEASE, RESOLVED를 선택할 수 있다. 응답은 공통 페이지 형식이다.
- `GET /api/v1/bank/corrections/{id}`: 자기 은행의 요청만 반환하며 다른 은행/없는 ID는404다. 보고 자격이 없는 은행은403 REPORTING_NOT_REGISTERED다. 각 요청에는 correctionRequestId, businessDate, uploadId(미도착이면 null), reportVersionId, status, revision, replacementUploadId, replacementVersionId, errors가 있다. 오류는 {row,column,code,reason}이며 파일 수준 오류의 row는 null이다. 원문·다른 은행 파일명은 노출하지 않는다.
- 업로드 URL 요청에 선택 `correctionRequestId`를 추가한다. 같은 은행·기준일의 미해결 요청이어야 하며 정정은 새 전체 보고 버전이다. 일반 중복과 구분하여 과거와 동일 바이트도 제출할 수 있다. 정정 제출은 correctionSubmissionId(UUID)를 반드시 함께 보낸다. 같은 요청/제출 ID는 완료 후에도 같은 upload/version을 반환하며 다른 파일명·크기·체크섬이면409 CORRECTION_SUBMISSION_MISMATCH다. 새 후보는 새 제출 ID다. 이미 수신한 제출 응답은 uploadRequired=false이며 URL/PUT을 재사용하지 않고 uploadId로 조회한다. 미수신 URL 만료는409 UPLOAD_URL_EXPIRED이며 새 제출 ID가 필요하다. 서로 다른 정정 문맥의 URL은 상대를 supersede하지 않는다. RESOLVED 요청은409 CORRECTION_RESOLVED다.
- 수신만으로 해결하지 않는다. 자체 오류는 OPEN, 정상 후보의 상대 대기는 WAITING_COUNTERPART, 실행 해제 대기는 WAITING_ANALYSIS_RELEASE다. 공동 대조·원자 교체 이후 RESOLVED다. 후보 재제출은 RESOLVED 이외 상태에서 허용한다.
- 업로드 조회에 reportVersionId, correctionRequired, correctionRequestId, replacementUploadId, nextAnalysisDate를 추가한다. integrationStatus는 WAITING_COUNTERPART/WAITING_ANALYSIS_RELEASE/SUPERSEDED를 포함한다. nextAnalysisDate는 수신시각 기준 예정 컷오프 날짜이며 분석 완료 약속이 아니다.
- 정정 교체는 고정 cutoff 내 가장 높은 자체 검수 통과 version과 기존 채택본을 대조한다. 구/신 보고의 은행·계좌·개체 영향 묶음을 함께 검증한다. 동일 내용/반복 발생 건은 tx_id를 보존하며 완료 TARGET의 수정·삭제는 COMPLETED_TARGET_CHANGE_OUT_OF_SCOPE로 전체 후보 묶음을 거절한다. 완료 CONTEXT의 구 입력은 값 스냅샷으로 보존한다.
- 분석은 WAIT_INGEST → INTEGRATE → FREEZE_INPUT → FEATURES → INFERENCE → SCORES → ALERTS → COMPLETE다. runId UUID는 입력 세대, executionId는 단계 시도다. 정정 취소는 결과/재시도/후속 진입을 차단하고 별도 run으로 대체한다. 취소된 모든 미완료 TARGET을 재검토하며 이전 날짜 TARGET도 누락시키지 않는다. 입력0은 EMPTY_INPUT이다.
- 결과 완료와 취소는 같은 실행 잠금에서 판정한다. BINARY/TYPE의 모든 게시 가능한 요청/회차를 취소 outbox로 추적하고 STOPPED 또는 ALREADY_FINISHED 확인 전 대체 추론을 대기한다. 전달 실패·미응답을 종료로 취급하지 않는다. cancel_id와 메시지는 재전달에도 불변이다. Python 실행측 연결/실제 S3 관통 검증은 후속 태스크이며 Java의 저장·차단 경계만으로 실제 외부 종료를 주장하지 않는다.
- 취소 contract_version은 숫자2다. `INFERENCE_API_URL`(HTTPS 기본 주소)과 `INFERENCE_API_TOKEN`(추론 워커 INFERENCE_TOKEN과 같은 전용 토큰)을 함께 설정하면 Java 전달 담당이 `PUT /api/v1/inference-requests/{requestId}/rounds/{round}/cancellation`으로 기존 불변 취소 메시지를 보내고 같은 회차의 `GET`으로 상태를 조회한다. Bearer 인증을 사용하며 리다이렉트를 따르지 않는다. 접수 응답은 중단 완료가 아니다. job/run/model/request/round/cancel 전체 식별자와 contract_version을 대조한 뒤 `cancellation_status=STOPPED`와 `status=STOPPED`, 또는 `cancellation_status=ALREADY_FINISHED`와 `status=COMPLETED` 조합만 종료 확인으로 인정한다. RECOVERY_REQUIRED·미응답·404는 종료 확인이 아니다.
- 두 API 설정이 모두 없으면 기존 S3/local 취소 파일 전달을 유지한다. S3는 `requests/{job}/{model}/{request}/rounds/{round}/cancel.json` 조건부 불변 게시와 `results/.../cancel_ack.json` 조회를 사용한다. local은 storage-dir/analysis-transport에 원자 게시한다. API 설정 일부 누락은 기동 시 거절하며 API 전달 실패 시 파일 방식으로 우회하지 않는다. 기존 2스레드 TaskScheduler에서 Python 단계와 별도로 5초 스캔하고, outbox의 재시도 정책을 그대로 사용한다. 실제 EC2–KubeSphere HTTPS 통신은 별도 배포 검증 대상이다.
- 전달 실패는30초/2분 간격으로 총3회까지 게시를 시도하고 미확인은 계속 대기한다. 3회 후에도 늦은 ack는 조회하며 작업 상세 cancellations의 actionRequired로 게시 재개 필요를 알린다. 취소된 작업의 기존 resume API는 outbox 시도만 재개하고 취소 run을 계산 재개하지 않는다(응답 status는 FAILED 유지). 실제 S3 권한/외부 프로세스 중단은 이 로컬·SDK 대역 검증과 구별한다.
- 더미 모델은 TARGET만 입력받고 Alert 구성은 달력 이동 탐색용 고정 CONTEXT도 사용한다. Python FEATURES→INFERENCE→SCORES→ALERTS가 연결되어 있으며 구체적인 Alert 정책은 §3.1을 따른다.

### 1.2 처리현황 (W2 [원장 적재]·[일별 분석 진입점])
- **GET /api/v1/bank/uploads/{uploadId}** — 자기 은행만 조회. 다른 은행/없는 작업404. 응답은 `{uploadId,bankId,fileName,businessDate,sizeBytes,rowCount,insertedCount,missingCount,duplicateCount,status,errorCode,errorMessage,errors:[{row,column,reason}],urlIssuedAt,receivedAt,startedAt,finishedAt,integrationStatus,reportVersionId,correctionRequired,correctionRequestId,replacementUploadId,nextAnalysisDate}`다. `insertedCount`는 해당 보고에서 정상 통합 거래에 연결된 보고 행 수이며 통합 전에는0이다. 같은 내용 반복은 중복 오류가 아니므로 `duplicateCount=0`이다. `errors`는 자기 파일의 정제된 오류 최대100건이며 원문 식별정보를 포함하지 않는다. `finishedAt`은 보고 저장/검수 종료 시각이다.
- `integrationStatus`: `null`(보고 저장 전), `VALIDATED_WAITING_INTEGRATION`, `ACTIVE`, `PARTIALLY_HELD`(의존 보류와 독립 정상 행 공존), `HELD`(직접 오류 파일 전체 보류), `WAITING_COUNTERPART`(상대 후보 대기), `WAITING_ANALYSIS_RELEASE`(분석 해제 대기), `SUPERSEDED`(교체된 구 버전). 대표 사유는 `INVALID_SELF`, `IDENTITY_CONFLICT`, `PAYMENT_FORMAT_CONFLICT`, `COUNTERPART_MISSING`, `COUNTERPART_HELD`다. 기존 정상 DB와의 소유 충돌은 `INVALID_SELF_OR_CONFIRMED_IDENTITY`로 보류한다.
- 익명 우회 조회 **GET /api/uploads/{uploadId}**는 제공하지 않는다.
- **GET /api/banks/arrivals?date=** [전 역할] — **은행별 도착 현황**(수집·처리현황 화면의 중심): 보고 은행(`is_reporting`) 전부에 대해 `{ bankId, name, country, status: NOT_ARRIVED | URL_ISSUED | RECEIVED | RUNNING | COMPLETED | VALIDATION_FAILED | FAILED, uploadId, fileName, rowCount, receivedAt, finishedAt }` + 헤더 `{ date, cutoffAt, remainingSeconds, arrivedCount, totalBanks }`. `date` = 컷오프 기준일: 창은 (D−1 컷오프, D 컷오프], 기본값은 **다음 컷오프의 날짜**(지금 도착하는 파일이 속하는 창). 은행당 창 안 최신 INGEST 작업 1건.
- **GET /api/v1/batch-jobs** — 페이지 목록. `type=INGEST|ANALYSIS`, `status`, `from/to`(최초 startedAt) 필터. 행은 기존 작업 메타데이터와 `currentStage, stageAttemptCount, consecutiveFailures, retryAt, actionRequired, cutoffAt, completionReason, counters`를 포함한다. 미완료 분석의 의심 거래·Alert 카운터는0이다.
- **GET /api/v1/batch-jobs/{jobId}** — 위 행과 `uploads: [{ uploadId, excluded, status, fileName }]`, `failures: [{ stage, errorCode, failedAt, consecutiveCount, retryAt, actionRequired }]`.
  - `models: [{ modelKind, phase, status, requestId, executionRound, remoteStatus, remoteRevision, errorCode, actionRequired, retryAt, nextPollAt, remoteDeadlineAt, modelVersion, featureVersion }]`는 현재 run의 모델별 작업 상태다. 이전 run·토큰·서명 URL·로컬 경로·원격 응답 원문은 반환하지 않는다. 모델별 조치 필요 여부는 상위 작업의 FAILED 여부와 독립적이다.
  - INFERENCE 원격 대기는 상위 `RETRY_WAIT`로 재관측을 예약하며 실패 횟수를 올리지 않는다. 모델 하나가 실패해도 다른 모델의 상태 관측을 계속한다. 원격 대기 기한 초과/종료 불명은 조치 필요로 표시하고 새 요청 회차를 자동 생성하지 않는다.
  - 현재 연결은 직접 PUT 게시·GET 관측→COLLECT 파일 검증→두 모델 SCORES 저장이다. 원격 COMPLETED만으로 완료되지 않으며 크기/hash/버전/정확한 TARGET/확률 검증 후 모델 DONE/SUCCEEDED를 기록한다. 두 모델 수집 후 INFERENCE 완료, 점수와 거래 연결 및 SCORES 완료는 원자 저장한다. ALERTS는 V6 근거 저장 이후 전체 분석을 완료한다. 콜백 수신은 아직 미연결이며 GET 상태 확인을 사용한다.
- **POST /api/v1/batch-jobs/analysis** — 본문 없이 서버 Clock 현재 시각을 cutoff로 오늘의 새 분석만 등록한다.202 `{ jobId, status: "QUEUED" }`. 같은 날짜 진행중409 `JOB_ALREADY_RUNNING`, 완료409 `JOB_ALREADY_COMPLETED`, 실패409 `JOB_REQUIRES_RESUME`.
- **POST /api/v1/batch-jobs/{jobId}/resume** — FAILED 작업만 실패 단계부터 새 실패 주기로 재개한다.202 `{ jobId, status: "QUEUED" }`. 이력·정상 산출물·최초 startedAt은 유지한다. 완료 작업 재분석은 허용하지 않는다.
  - 현재 run의 로컬 `PUBLISH/FAILED` 또는 `COLLECT/FAILED` 모델은 같은 요청·회차로 재개한다. 수집 재시도는 모델을 재실행하지 않으며 결과 전송의 일시 오류는30초/120초 간격·총3회 후 명시 재개를 기다린다. 준비/관측 완료된 다른 모델은 초기화하지 않는다. 원격 모델의 최종 실패를 새 회차로 재실행하는 기능은 아직 미연결이며 이 API가 모델 재시작 성공을 보장하지 않는다.
- 두 POST는 활성 dev/local이 있고 prod가 없을 때만 허용한다. 기본/기타/prod 혼합은403 `ANALYSIS_CONTROL_DISABLED`. 로그인 권한 검증은 후속 작업이다.
- 운영 등록은 `app.ingest.cutoff`(기본03:00), `app.zone`(기본 Asia/Seoul)의 매일 cron이다. 수신전이와 등록은 공유 advisory transaction lock을 사용하고 잠금 이후 수신 시각을 기록한다. cutoff 이하 수신한 미편입 업로드를 고정한다. 검수 진행중도 대상에 남고 늦은 파일은 다음 날 편입한다. 기동 시 놓친 날짜를 보충 등록하지 않는다. URL 발급만 된 파일은 제외한다.
- 도착 현황의 창·최신 순서는 수신 후 received_at, 수신 전 created_at을 사용한다.

### 1.3 배치 상태 (batch_jobs — 테이블 1개 + job_type)

| job_type | 상태 | 뜻 | 다음 |
|---|---|---|---|
| INGEST | `URL_ISSUED` | Presigned URL 발급, 파일 대기(완료 통지 전) | RECEIVED / (10월 EXPIRED) |
| INGEST | `RECEIVED` | 완료 통지 수신·객체 확인, 적재 대기 | RUNNING |
| INGEST | `RUNNING` | 검증·표준화·가명화·적재 중 | COMPLETED / VALIDATION_FAILED / FAILED |
| INGEST | `COMPLETED` | 은행 보고 검수·저장 완료, integrationStatus 별도 | — |
| INGEST | `VALIDATION_FAILED` | 검증 실패(영구, `errors[]` 최대 100건) — 은행이 고쳐 재업로드(새 작업) | — |
| INGEST | `FAILED` | 적재 중 오류(영구) | — |
| ANALYSIS | `SCHEDULED` | 미리 예약된 작업(10월 SQS; MVP는 생략 — 컷오프 `@Scheduled`가 QUEUED로 바로 만든다) | QUEUED |
| ANALYSIS | `QUEUED` | 실행 대기 | RUNNING |
| ANALYSIS | `RUNNING` | 실행 토큰을 가진 단계 처리 중 | COMPLETED / RETRY_WAIT / FAILED |
| ANALYSIS | `RETRY_WAIT` | 적재 완료 또는 retryAt 대기(5초 스캔) | RUNNING |
| ANALYSIS | `COMPLETED` | 점수·Alert 적재 완료 | — |
| ANALYSIS | `FAILED` | 영구 실패 또는 3회 소진 | 명시 resume만 허용 |

- 공통 컬럼: `attempt_count, claimed_at, heartbeat_at, started_at, finished_at, error_code, error_message`. ANALYSIS 전용: `analysis_date UNIQUE, threshold_value, model_version_binary, model_version_type, feature_version_binary, feature_version_type, suspicious_tx_count, alert_count`. INGEST 전용: `bank_id, business_date, file_name, file_hash(sha256), size_bytes, s3_key, url_issued_at, url_expires_at, received_at, row_count, missing_count, duplicate_count, validation_errors(JSONB errors[])`. `error_code`는 상태와 별개의 원인 코드: INGEST `VALIDATION_FAILED`·`LOAD_FAILED`, ANALYSIS `SCORES_MISMATCH`(§2.1) 등.
- `WAIT_INGEST → INTEGRATE → FREEZE_INPUT → FEATURES → INFERENCE → SCORES → ALERTS → COMPLETE`. 등록 시 `analysis_receipts`에 cutoff 이하의 전체 수신 ID를 고정하여 이전 날짜 대기 후보도 포함하며, 검수중인 고정 수신 대상의 종료를 기다린다. `analysis_uploads`는 기존 최초 수신 귀속 이력으로 유지한다. 기술적 INGEST 실패는 `INGEST_FAILED`이며 TARGET0이고 후속 Alert 맥락 보완도 없으면 `EMPTY_INPUT`으로 종료한다. 후속 보완이 있으면 모델 실행을 건너뛰고 ALERTS로 진행한다.
- INTEGRATE의 선택 version/generation은 FREEZE_INPUT에서 재확인한다. cutoff 안의 참조 변경은 같은 receipts로 INTEGRATE부터 재준비한다. 이미 cutoff 밖의 더 최신 현재본으로 교체되면 `CUTOFF_SUPERSEDED`·FAILED/조치 필요로 남긴다. 현재 포인터 역행이나 최신본의 과거 입력 몰래 편입은 없다. 이 경우 운영 확인이 필요하며 과거 cutoff를 자동 확장하지 않는다.

- 같은 단계·오류 최초 포함3연속 실패에서FAILED. 연결(DB/S3)은30초/2분, 계산은1분/5분 뒤 재시도한다. 설정·계약 오류는 즉시FAILED. 교대 오류 전체 상한은 없다. 정상 단계/명시resume만 연속 실패 주기를 끝내며 이력은 보존한다. 09시 조건은 없다.
- 단일 BE 기준으로 전용 연결의 DB 세션 advisory lock을 Runner 생존기간 유지하고 소유자만 실행/잔여 RUNNING 복구한다. 종료 시 잠금을 해제하고 연결 상실 시 재획득한다. 실행 UUID 확인과 DB 쓰기로 오래된 실행을 차단한다. 정상 prepare 결과는 실행중 JVM에서 유지하고 DB 복구 시 단계 결과·이력을 저장한다. DB 장애 중 미저장 실패 횟수/산출물은 프로세스까지 종료되면 소실될 수 있다. 정확한 횟수 영속성을 보장하지 않는다.
- Python `worker/analysis_entry.py`는 FEATURES/INFERENCE/SCORES/ALERTS를 연결한다. 현재 모델은 명시적 demo이며 실제 GNN이 아니다. 설정 없는 모델 실행은 `PIPELINE_NOT_CONFIGURED`이고, Alert 저장에는 원격 추론 설정이 필요하지 않다.
- 후속 Python은 직접 DB 읽기/쓰기를 소유한다. 자신의 트랜잭션에서 실행 토큰 확인·데이터 저장·단계 완료를 원자 처리하고 Runner가 DB로 확인해야 한다. Java JDBC 트랜잭션에 별도 프로세스가 참여하지 않는다. 원격 추론은 고정 job/request 식별자로 실행중/기존 결과를 확인하여 재기동이나 새 executionId가 모델 재실행으로 이어지지 않게 연결해야 한다.

### 1.4 거래 보고 CSV와 통합

헤더 이름으로 필드를 매핑하며 순서는 자유다. 중복 헤더·필수 헤더 누락·구11열은 거절한다. 16개 필수 필드와 선택 평가 라벨을 사용한다.

| 헤더 | 검증·저장 의미 |
|---|---|
| Timestamp | `yyyy/MM/dd HH:mm[:ss]` 또는 ISO 로컬 시각, 서울 시간·거래 기준일 일치 |
| From Bank / To Bank | 0 이상 정수 은행 코드. 보고 은행이 양쪽 중 하나여야 함 |
| From Account / To Account | 문자열·앞자리0 보존, trim후 최대100 Unicode code point, 파이프 문자 불허 |
| From Bank Name / To Bank Name | 필수 이름 최대100 code point |
| From Entity ID / To Entity ID | 은행 간 공통 원천 개체 키, 최대100 code point |
| From Entity Name / To Entity Name | 필수 이름 최대200 code point |
| Amount Received / Amount Paid | BigDecimal, 0 이상, NUMERIC(24,6), 유효 소수6자리·정수18자리. 반올림·절삭 없음 |
| Receiving Currency / Payment Currency | 아래 고정 원천 통화명 매핑 |
| Payment Format | 필수 최대30 code point |
| Is Laundering | 선택0/1. 비어도 허용. evaluation에만 보관, API·분석 입력 제외 |

- UTF-8/BOM과 CSV 인용 쉼표·이스케이프 따옴표·인용 개행을 지원한다. 오류 행 번호는 논리 레코드가 시작한 물리 행이다. 잘못된 UTF-8은 파일 전체 보류, 저장소 IO 오류는 FAILED다. 헤더 오류·UTF-8 오류·복구 불가 인용 손상으로 전수 검수를 못 끝내면 rowCount는 null이다. 정상 헤더만 있는 파일은 실제0행의 EMPTY_FILE로 구분한다. 오류 사유에는 원문 값을 넣지 않는다. 이름만 바깥 공백 제거와 Unicode NFC를 적용하고 철자·대소문자를 임의 동일시하지 않는다.
- 통화명→ISO: Australian Dollar AUD, Bitcoin BTC, Brazil Real BRL, Canadian Dollar CAD, Euro EUR, Mexican Peso MXN, Ruble RUB, Rupee INR, Saudi Riyal SAR, Shekel ILS, Swiss Franc CHF, UK Pound GBP, US Dollar USD, Yen JPY, Yuan CNY. 알 수 없는 통화는 오류다.
- `private.bank_reports`는 version·source_row별 실제 행을 보존한다. `private.entities/accounts`의 서비스 UUID는 정상 확정 때 만들고 동일 개체와 (은행,계좌)에 재사용한다. 원문은 AES-256-GCM, 검색 토큰은 별도 키의 HMAC-SHA256이다. 외부 공급 `app.ingest.encryption-key`, `search-key`는 서로 다른32바이트 Base64이며 `key-version` 필수다. 값은 문서·저장소에 넣지 않는다. 누락·변조·잘못된 버전이면 원문 처리 실패다.
- 고정 수신 upload ID 집합·cutoff·거래 기준일을 받는 `TransactionIntegrationService.integrate` 서비스 경계에서 정확 매칭한다. 원천 송수신 은행/계좌·시각·양쪽 금액/통화 전체를 대조한다. 해시만 같다고 통합하지 않는다. 같은 키에서는 Payment Format별로 report_id순 대응한다. 1+1→1, 2+2→2이며 은행내 거래와 수집범위 밖 상대는 단독 행 그대로 보존한다.
- 직접 오류 파일은 전체 HELD, 그 파일에 의존하는 다른 파일의 해당 행만 DEPENDENCY_HELD다. 다른 파일의 독립 정상 행은 확정할 수 있다. 정상 관계는 오류로 덮어쓰지 않는다. 통합 확정과 출처 연결·개체/계좌·상태 전이는 한 트랜잭션이며 중단시 롤백한다.
- 송수신 통화·원천 금액은 그대로 저장한다. USD 표시는 기존 `amount_paid / units_per_usd`, scale6 HALF_UP과 환율 버전을 사용하며 매칭 기준이 아니다. `transactions`에는 단일 보고 bank_id·row_hash UNIQUE·ingest_job_id를 두지 않고 `transaction_reports`로 출처를 연결한다.
- 최초 통합·정정 버전 교체·운영03시 통합/입력 고정·Java 실행 취소 전달 경계를 구현한다. Python 실행측 및 실제 S3 추론 연결은 후속이다. 기존 DB는 비우지 않으며 V3는 거래/계좌/작업이 있는 DB 전환을 거절한다.

## 2. 층 2 — 추론·거래 점수·의심 거래

### 2.1 추론 에이전트 파일 계약 (S3, 후속 연결)

아래 파일 운반은 아직 연결되지 않았다. 재시도 요청 식별·실행중/기존 결과 재사용·늦은 응답 차단을 [모델 래핑]에서 함께 구현해야 하며 현재 Java fixture 테스트가 이를 검증한 것은 아니다.

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
- 정리: 재시도에 필요한 정상 추론 산출물은 보존한다. 실패 즉시 삭제하지 않는다. 완료 이후 보존기간/Lifecycle은 후속 운영 정책이다.
- MVP 운반: 실제 AWS S3(9/7 기한 경과·미도착). 추론 운반은 수집 S3 구현과 별개이며 해당 환경을 [모델 래핑 ②](9/11) 착수 시 확인 후 같은 경로로 관통, 클라이언트만 교체.

### 2.2 거래별 점수 테이블·파생 규칙
- 저장: 테이블 `inference_results`(V1) — `(job_id, tx_id) PK, p_laundering, p_0..p_8, score_pct`. 고정된 upload 목록 중 **`scored_job_id IS NULL OR scored_job_id = :jobId`**인 원장 행만 사용한다. 점수 정상 완료 후 Alert 단계가 실패하면 점수는 보존하고 Alert 단계만 재개한다. 현재 Python은 V4 고정 TARGET과 현재 run을 기준으로 점수·`scored_job_id`·모델/피처 버전·카운터·단계 완료를 토큰 확인과 함께 한 트랜잭션으로 저장하고, 응답 유실 때 DB 완료 기록을 확인한다. CONTEXT는 점수 적재에서 제외한다. 취소된 선행 run의 점수 연결은 명시된 대체 run에 한해서 갱신하며 기존 점수 행은 보존한다. 작업 전체 결과를 무조건 삭제·재생성하지 않는다.
- 파생(BE, 조회 시 계산): `launderingScore = p_laundering`, `typeClass = argmax(p_0..p_8)`(p_0이 최대면 0 그대로), `typeScore = 그 확률`. 동점 시 낮은 코드.
- 의심 거래 = `p_laundering >= threshold_value(그 job의 스냅샷)`. 저장 플래그가 아니라 파생. 임계는 프로퍼티 `app.suspicious-tx.threshold`(env `SUSPICIOUS_TX_THRESHOLD`), job 실행 시 batch_jobs에 스냅샷. `threshold_version`은 10월 thresholds 테이블에서.
- `ruleHits[]`는 룰 기반(향후 확장) 전까지 항상 빈 배열 — 추론 산출물이 아니라 BE 룰 엔진 산출. 점수 테이블에 룰 컬럼을 두지 않는다.
- **점수 파생 확장 (2026-09-04 채택, 모델 형태와 무관 — 확률 벡터만 사용)**:
  - `scorePercentile`: 같은 job 안에서 `p_laundering`의 백분위(0~100, 높을수록 상위). job 전체 분포가 필요하므로 **점수 적재 스텝(BE 소유 Python 진입 스크립트)에서 계산해 점수 테이블 `score_pct`에 저장**(2026-09-08 BE 확정 — 적재 스텝이 BE 소유라 Data 동의 불요, 추론 에이전트 산출물과 무관). 현재 계산은 `100 × percent_rank(p_laundering)`이며 동점은 같은 최저 순위를 공유한다. 단일 거래/전부 동점은0, 예를 들어 `[0.5,0.5,0.9]`는 `[0,0,100]`이다. 점수 저장 워커가 임시 적재 데이터에 대해 계산하며 모델 출력 확률을 변경하지 않는다. 화면은 절대값과 백분위를 병기한다(원값은 캘리브레이션되지 않음: run_114 recall 0.5 운영점 임계 0.9938).
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
- `fromAccount`·`toAccount`는 별도 서비스 계좌 UUID 문자열이며 원문 계좌번호가 아니다. 통화는 ISO 코드(§0). 파생 필드 정의는 §2.2.
- Alert 상세 `transactions[]`에서는 행에 현재 구현은 §3.2의 동결 거래 스키마와 `role: SEED|CONNECTION|CONTEXT`, `includedReasons[]`를 사용한다.
- 상세에서 `explanation: { thresholdValue, factors[] }`(§2.2)를 거래 행에 붙일지 별도 조회로 둘지는 [W3 API]에서 성능 보고 결정(피처 테이블 조인 비용).

### 2.5 GET /api/v1/suspicious-transactions (W2 DB 조회)
- 임계 이상 거래 목록. 기본 정렬 `launderingScore,desc` (2차 `txId,asc`). 필터 `jobId`, `analysisDate`, `typeClass`, `minScore`, `bankId`.
- 행: §2.4 거래 행. COMPLETED 분석만 공개한다. `bankId`는 송신 또는 수신 계좌의 은행이며 보고 은행 필터가 아니다. 정렬은 launderingScore 또는 txId의 asc/desc를 지원한다. 타입 동점은 낮은 코드, 후보 차이는 `app.type.ambiguity-delta` 기본0.10 미만일 때 상위2개다. 과거 결과는 유지하고 미완료 날짜 필터는 빈 페이지를 반환한다.
- 주의: 이건 **의심 거래** 목록이다. Alert(묶음) 목록은 §3.

## 3. 층 3 — Alert

### 3.1 Alert 산출물 — 고정 맥락·근거 버전

현재 구현은 V6와 `worker/alert_pipeline.py`다. `analysis_entry.py`의 ALERTS 단계는 SCORES 이후 고정 TARGET·CONTEXT와 동결 점수만 읽어 저장하고 실행 토큰·현재 run을 확인한 트랜잭션 안에서 체크포인트·카운터를 기록한다. 그 후 Spring이 run/job을 COMPLETED로 전환한다. 0개 씨앗은 정상 완료다. L1 사용자가 필요한데 없으면 `ALERT_ASSIGNEE_UNAVAILABLE` 조치 필요 오류이며 가짜 담당자는 만들지 않는다.

- 씨앗은 TARGET의 `p_laundering >= threshold_value`다. 보고 버전·개정·통합 세대·수집 범위가 마지막 성공 검사 이후 바뀌고, 변경 날짜가 기존 구성 거래일 전후2일에 해당하는 Alert는 원래 씨앗·점수를 보존하여 다시 탐색한다. 현재 선정은 날짜 기반 보수적 후보 검색이며 계좌 관련성/실제 편입은 탐색에서 확인한다. TARGET이 없어도 영향 Alert가 있으면 재추론 없이 ALERTS를 실행한다.
- 정책 `calendar-event-v4`: 서울 업무일 기준 각 탐색 거래일 전2일~후2일 중 cutoff까지 수신·동결된 거래를 조회한다. 최신 거래에서는 사실상 과거2일+당일이며 미래 자료를 기다리는 상태는 없다. 직접 경로를 따라 발견한 거래마다 날짜 창이 이동한다. 깊이2·최대100거래·계좌활동100 한도 유지. 전체 Alert의48시간 상한은 제거했다. 공유 계좌 주변 거래는 포함하되 그 이유만으로 추가 확장하지 않는다. 직접 상류/하류 경로나 별도 씨앗은 탐색한다. 씨앗 교차 포함만 병합하며 패턴 확률은 구성 기준이 아니다.
- 신규 씨앗별 후보는 실제 공유 거래·연결 씨앗 기준으로 병합한다. 기존 별도 사건은 삭제·합병하지 않으며 같은 거래는 여러 Alert에 속할 수 있다. `alert_transactions`의 PK는 `(alert_id, version, tx_id)`이고 `UNIQUE(tx_id)`는 없다.
- OPEN은 새 거래·씨앗·연결 이유가 생기면 새 근거 버전을 저장한다. 조사 중 기존 구성은 보존하며 한도를 초과한 추가는 제한으로 표시한다. CLOSED/ESCALATED는 기존 버전을 바꾸지 않고 `parentAlertId`로 연결된 OPEN 후속 Alert를 생성한다. 후속 Alert가 있으면 다음 탐색은 그 사건에서 이어간다. 사건별 사용자 판정·판정 버전 연결과 상태 변경 API는 후속 태스크다.
- 후속 자료 미수신, 은행 일부 미수신, 확인했지만 새 연결 없음은 구분한다. `analysis.input_coverage`는 날짜별 사전 등록 은행과 cutoff 이전 ACTIVE 보고를 동결한다. 예상 은행0·미수신·PARTIALLY_HELD는 complete가 아니다. 완결 여부는 원장 최대 시각이나 벽시계에서 추정하지 않는다.
- 새 근거가 없으면 버전을 늘리지 않고 검사 시각만 갱신한다. 상세의 `dataAsOf`는 선택한 근거 버전을 만든 완료 실행의 수신 cutoff, `lastCheckedAt`은 마지막 완료 실행에서 기록한 검사 시각이다(ISO-8601 UTC). 최신 조회는 최신 성공 검사, version 지정 조회는 해당 근거 생성 run의 검사만 반환한다. 과거 검사 시각이 기록되지 않은 행은 null이며 현재 시각으로 대체하지 않는다. `coverage`는 검사 run cutoff의 서울 날짜 이하 실제 검사 날짜를 중복 제거해 정렬한 배열로, 각 항목은 `businessDate,complete,expectedBanks,completeBanks,reports`다. 수신 완결과 검사 성공은 별개이며 탐색 제한은 상세 `limits`를 사용한다. `forwardComplete`는 최상위와 coverage에서 제거했다. 내부 재검토 대상 선정은 V8의 실행별 보고·수집 범위 스냅샷 차이를 사용한다. forward_complete 값과 무관하며 성공한 run/job의 검사만 비교 기준이다. 실제 탐색도 날짜별 이동 정책을 사용하며 미래 수신 완료 플래그는 V9에서 제거했다.
- 다른 READY/ACTIVE run의 미공개 근거와 충돌하면 `RUN_FENCED`로 차단한다. 동결 시점의 완료 근거 기준선이 달라졌으면 `WORKER_INPUT_INVALID`로 거절한다. 동일 frozen input의 단순 resume으로 해결되지 않으며 경쟁 실행 정리·새 스냅샷이 필요하다. 자동 재동결과 다중 분석의 동일 사건 동시 갱신은 이번 범위 밖이다.
- 공개 조회는 **run과 job 모두 COMPLETED인 버전만** 사용한다. 저장 뒤 취소·실패한 버전은 공개하지 않고 이전 완료 버전을 유지한다. 점수·계좌 식별자·금액·그래프는 해당 버전에 고정되어 최신 원장으로 과거 근거를 다시 만들지 않는다.

### 3.2 현재 Alert 읽기 API

인증·판정 워크플로는 후속 태스크이며 다음 GET은 현행 공통 접근 설정을 따른다.

- `GET /api/v1/alerts?page=0&size=20&status=OPEN&assigneeId=1&jobId=10`: 필터는 선택, size1~200. `jobId`는 **최신 공개 근거 버전을 만든 작업** 기준이다. `summary.scoreMax` 내림차순·alertId 오름차순. 페이지 응답은 batch-jobs와 동일한 content/page/size/totalElements/totalPages다.
- 목록 항목: `alertId,status,resolution,assigneeId,parentAlertId,createdAt,version,runId,summary`.
- 작업의 `alertCount`는 신규 사건 생성 수이며 기존 사건의 근거 버전 갱신은 포함하지 않는다. 따라서 최신 버전 생성 작업 기준인 `jobId` 목록 건수와 다를 수 있다. 단계 체크포인트에는 createdAlertCount/updatedAlertCount/checkedAlertCount를 구분해 저장한다.
- `GET /api/v1/alerts/{alertId}?version=1`: version 생략 시 최신 완료 근거. 존재하지 않거나 미완료 버전은404. 목록 필드에 `policyVersion,seeds,transactions,limits,graph,coverage,dataAsOf,lastCheckedAt`를 추가한다. 명시 버전 조회는 해당 버전을 만든 run의 coverage를 반환하고, 최신 조회는 최신 완료 coverage를 반환한다.
- `seeds[]`: `txId,occurredAt,score,threshold`. `transactions[]`: `txId,occurredAt,fromAccountId,toAccountId,fromBankId,toBankId,amountReceived,receivingCurrency,amountPaid,paymentCurrency,amountUsd,paymentFormat,role,includedReasons,scores`. 계좌 ID는 서비스용 UUID이며 원문 이름·계좌번호는 반환하지 않는다. role은 SEED/CONNECTION/CONTEXT다. scores는 미채점 맥락에서 null, 그 외 `p_laundering,p_0..p_8,score_pct`다. null을 정상 점수0으로 치환하지 않는다.
- summary: `txCount,seedCount,totalAmountUsd,scoreMax,firstTxAt,lastTxAt`. scoreMax는 포함 거래 중 관측 점수의 최댓값이며 별도 모델 위험 확률이 아니다.
- `GET /api/v1/alerts/{alertId}/versions`: 완료 버전의 `version,runId,createdAt` 목록.
- `GET /api/v1/alerts/{alertId}/graph?version=1`: 동일 근거의 graph. nodes는 가명계좌 `id,kind,bankId,inCount,outCount,inAmountUsd,outAmountUsd`, edges는 거래별 `id,txId,from,to,amountUsd,occurredAt,role,includedReasons`다. 같은 계좌쌍의 반복 거래도 별도 edge로 유지한다.
- coverage는 씨앗별 `txId,windowStart,windowEnd,days,forwardComplete,explorationLimits`다. days는 `businessDate,expectedBanks,completeBanks,complete,reports`. 한도와 누락이 있는 결과를 완전한 세탁 경로라고 표시하지 않는다.

### 3.3 Alert 상태 전이 표

아래 상태 변경·판정·열람 이력 표는 **후속 미구현 계약**이다. 이번 `/api/v1/alerts` GET은 읽기 전용이며 REVIEW_START 기록이나 상태 변경을 수행하지 않는다.

**공통 상태 모델 (2026-09-06 사용자 확정 — Alert·Episode 통일, 09-07 `IN_REVIEW` 제거)**: 생애는 `OPEN`(담당자에게 배정되어 처리 중) → `CLOSED`(종결). 종결 결과는 상태에 넣지 않고 별도 필드 **`resolution`**(`CLOSED`일 때만 값, 그 외 NULL). Alert만 `ESCALATED`(Episode 귀속, `episodeId != null`과 항상 일치)를 추가로 가진다 — Episode에는 "넘김" 단계가 없다(감독기관형 범위, 보고 단계 없음). 열람은 상태를 바꾸지 않는다: 담당자의 첫 열람은 **이력 행 `REVIEW_START`로만** 남긴다(2026-09-08 사용자 확정 — `first_opened_at` 컬럼 없음, 화면 표시 없음). "첫 열람" 판정 = 현재 담당자의 `REVIEW_START`가 마지막 `ASSIGN`(없으면 생성) 이후에 없을 때 기록. 재배정되면 새 담당자의 첫 열람이 다시 기록된다. dberd 정합 메모 결정 2(`NEW/CLOSED + resolution`) 해소.

Alert 상태: `OPEN` / `ESCALATED` / `CLOSED`. `resolution: NORMAL | FALSE_POSITIVE`.

| from | to | 액션 / 엔드포인트 | 허용 역할 | 필수 입력 | 이력 action |
|---|---|---|---|---|---|
| OPEN | (유지) | `GET /api/alerts/{id}` — 담당 L1(assignee)의 첫 열람이면 이력 기록(다른 사용자 열람은 기록 없음) | L1(assignee) | — | `REVIEW_START` |
| OPEN | OPEN | `POST /api/alerts/{id}/assign` `{ userId, comment }` — 재배정(L1 사용자) | ADMIN | userId, comment | `ASSIGN` |
| OPEN | CLOSED (`resolution: NORMAL`) | `POST /api/alerts/{id}/close` `{ resolution: NORMAL, comment }` | L1 | resolution, comment | `CLOSE` |
| OPEN | CLOSED (`resolution: FALSE_POSITIVE`) | 같은 엔드포인트 `{ resolution: FALSE_POSITIVE, comment }` | L1 | resolution, comment | `CLOSE` |
| OPEN | ESCALATED | `POST /api/episodes` `{ alertIds[], comment }` (신규 Episode — 담당 L2는 라운드로빈 자동 §3.4) | L1 | alertIds ≥1, comment | `ESCALATE` |
| OPEN | ESCALATED | `POST /api/episodes/{episodeId}/alerts` `{ alertIds[], comment }` (기존 Episode에 연결 — **Alert 화면에서 L1이 수행**, Episode 화면엔 연결 없음 09-07) | L1 | comment | `LINK` |
| ESCALATED | OPEN | `DELETE /api/episodes/{episodeId}/alerts/{alertId}` `{ comment }` — 해제되면 기존 담당 L1에게 돌아감 | L2 | comment; Episode에 Alert가 2개 이상일 때만(빈 Episode 불허) | `UNLINK` |
| CLOSED | — | 어떤 액션도 불가 → 409 `INVALID_TRANSITION` | | | |
| ESCALATED | CLOSED | 불가(Episode 종결로만) → 409 | | | |
| OPEN | ESCALATED (CLOSED Episode에) | 불가 → 409 | | | |

- 대시보드 처리 흐름은 ① **L1 조사 중**(`OPEN`) ② 조사 경과일 ③ L2 조사 중(`ESCALATED` = Episode `OPEN`) ④ 처분(`CLOSED` + resolution). 화면에 "미열람" 표시는 두지 않는다(2026-09-07 사용자 — 배정됐는데 안 열어본 것을 구분해 보여줄 필요 없음). 열람은 이력 `REVIEW_START`로만 남긴다(컬럼 없음).
- 재실행 규칙(§3.1)과의 관계: 일별 분석은 날짜당 1회이므로 어떤 상태의 Alert도 재실행으로 삭제·재생성되지 않는다(2026-09-08). Alert id·담당자·이력은 생성 뒤 불변.

### 3.4 배정 규칙 (Alert·Episode 공통 — 2026-09-07 사용자 확정, 모델 A)

- **생성 시 자동 라운드로빈**: Alert는 일별 분석이 만든 직후 BE가 L1 사용자 중 한 명에게, Episode는 `POST /api/episodes` 직후 L2 사용자 중 한 명에게 배정. 대상 풀 = 해당 역할의 사용자 전원(부재·비활성 처리는 11월 [권한관리]). 선택 규칙 = `users.last_assigned_at`이 가장 오래된 사용자(NULL 우선, 동률이면 `userId` 오름차순), 배정 후 갱신. 한 job이 Alert N건을 만들면 N번 순환한다.
- **재배정**: `POST /api/alerts/{id}/assign`, `POST /api/episodes/{id}/assign` `{ userId, comment }` — **ADMIN 전용**. 대상은 같은 역할(L1/L2)의 사용자여야 한다(아니면 400). `OPEN`에서만 가능하고 상태는 바뀌지 않는다(`OPEN → OPEN`), 이력 `ASSIGN`(`relatedIds` = 이전·이후 userId). CLOSED는 재배정 불가(409).
- **행위 제한**: MVP는 담당자가 아니어도 같은 역할이면 처분 가능(§0 범위 제한 없음). "담당자만 처분"은 10월. `REVIEW_START` 기록은 담당자 열람에만 걸린다.
- 실무 근거: Oracle AM 배치 배정(사용자·풀, 규칙 기반)·ECM 자동 할당(개인별 최대 건수·부재 시 중단), Sardine 큐 라운드로빈, Unit21 관리자 재배정(500건 일괄) — 리서치 문서 §2.10. 개인별 보유 상한·부재 규칙은 11월 후보.

- `resolution` `NORMAL` = 정상 거래로 판단, `FALSE_POSITIVE` = 모델 오탐(둘 다 평가 지표 라벨로 쓰인다). 종결 필터는 `status=CLOSED&resolution=…`.
- 이동(다른 Episode로) = UNLINK + LINK 두 요청(MVP 비원자). 원자적 `move`·분리·병합은 10월: `POST /api/alerts/{id}/split`, `POST /api/alerts/merge`, `POST /api/episodes/{id}/alerts/move`.
- 재오픈·보류·반려는 MVP·10월 범위 밖.

## 4. 층 4 — Episode·조사

### 4.1 조회
- **GET /api/episodes** [전 역할] — 목록(페이지네이션). 기본 정렬 `riskScore,desc`(riskScore = 소속 Alert riskScore 최대값 `[미정: Data 동의]`). 정렬 키 `riskScore, createdAt, updatedAt, alertCount, ageDays`. 필터 `status`, `resolution`, `assigneeId`, `from/to`(createdAt). "내 담당" 뷰 = `assigneeId=me`(§7과 같이 내 담당·전체 두 뷰).
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
- **GET /api/episodes/{id}** — 담당 L2(assignee)의 첫 열람이면 이력 `REVIEW_START`(판정 규칙 §3.3). 상태 변화 없음. 다른 사용자 열람은 기록 없음.
- **POST /api/episodes/{id}/alerts** [L1] `{ alertIds[], comment }` — `OPEN` Alert만 연결 가능. **진입점은 Alert 상세의 "심층 요청 → 기존 Episode에 연결"뿐**(2026-09-07 사용자 확정). L2는 다른 담당의 Alert를 끌어오지 않는다 — Episode 화면의 "관련 Alert 후보"는 정보 표시만, 연결은 그 Alert의 담당 L1이 한다. 대상 Episode는 `CLOSED`가 아니어야 한다(409).
- **DELETE /api/episodes/{id}/alerts/{alertId}** [L2] `{ comment }` — 연결 해제. Alert `OPEN` 복귀, 기존 담당 L1 유지. 마지막 Alert면 409.
- **POST /api/episodes/{id}/assign** [ADMIN] `{ userId, comment }` — 재배정(L2 사용자, §3.4). `OPEN`에서만 가능하고 상태는 바뀌지 않는다. 새 담당자의 첫 열람은 `REVIEW_START`로 다시 기록된다(§3.3).
- **POST /api/episodes/{id}/comments** [L2] `{ comment }` — 조사 의견. 상태 변화 없음, 이력 `COMMENT`.
- **POST /api/episodes/{id}/close** [L2] `{ resolution: NORMAL | SUSPICIOUS, comment }` — 종결. 소속 Alert는 `ESCALATED` 유지(조회는 Episode 상태로 판단).

### 4.3 Episode 상태 전이 표

상태: `OPEN`(담당 L2 조사 중) / `CLOSED`. `resolution: NORMAL | SUSPICIOUS`(`CLOSED`일 때만). Alert와 같은 공통 모델(§3.3) — `ESCALATED`만 없다. 열람은 이력 `REVIEW_START`로만.

| from | to | 액션 | 허용 역할 | 필수 입력 | 이력 action |
|---|---|---|---|---|---|
| — | OPEN | `POST /api/episodes` (담당 L2는 라운드로빈 자동) | L1 | alertIds, comment | `ESCALATE`(각 Alert) + `EPISODE_CREATE` + `ASSIGN`(SYSTEM) |
| OPEN | (유지) | `GET /api/episodes/{id}` — 담당 L2 첫 열람이면 이력 기록 | L2(assignee) | — | `REVIEW_START` |
| OPEN | (유지) | alerts 추가(Alert 화면에서) | L1 | comment | `LINK` |
| OPEN | (유지) | alerts 해제 / comments | L2 | comment | `UNLINK` / `COMMENT` |
| OPEN | OPEN | assign(재배정) | ADMIN | userId, comment | `ASSIGN` |
| OPEN | CLOSED | `POST /api/episodes/{id}/close` | L2 | resolution, comment | `EPISODE_CLOSE` |
| CLOSED | — | 모든 변경 불가 → 409 | | | |

- 역할 요약: L1 = Alert 종결·심층 요청(신규 Episode 생성 / 기존 Episode에 연결 — 둘 다 Alert 화면). L2 = Episode 조사(해제·의견·종결; 10월 분리·병합). ADMIN = 배정·재배정 + 전체 조회, 조사 액션 없음.
- Episode 상태 표시 관점: 대시보드 "L2 조사 중" 칸 = Episode `OPEN`(Alert로는 `ESCALATED`). 미배정 상태는 존재하지 않고(생성 즉시 배정), 열람 여부는 화면에 표시하지 않는다(이력 `REVIEW_START`만).

## 5. 인증·사용자 (W4 [인증] — 초안, 방식은 미정)

- **POST /api/auth/login** `{ username, password }` → 200 `{ userId, name, role }` / 401. 세션 쿠키 또는 토큰 `[미정: 인증 방식]`.
- **POST /api/auth/logout** → 204.
- **GET /api/me** → `{ userId, name, role }`.
- **GET /api/users?role=L1|L2** [ADMIN·전 역할 조회] — 재배정 대상 선택용 `[{ userId, name, role, lastAssignedAt }]`. 사용자 생성·수정은 11월 [권한관리].
- 사용자 테이블에 `last_assigned_at`(§3.4 라운드로빈 포인터). MVP 시드 사용자: **L1 2명, L2 2명**, ADMIN 1명(V1 시드 `l1a`·`l1b`·`l2a`·`l2b`·`admin`, 비밀번호는 W4에서 환경변수로 채움) — 라운드로빈이 시연에서 보이려면 역할당 2명 이상 필요.

## 6. 감사 이력

행 스키마(단일 테이블):
```
{ id, actor: { userId, name, role }, action, targetType: ALERT|EPISODE, targetId,
  relatedIds: [], from, to, resolution, comment, at }
```
- `from`/`to`는 상태(공통 모델 §3.3), `resolution`은 `CLOSE`·`EPISODE_CLOSE` 행에만 값(그 외 null).
- `action` enum: `REVIEW_START, CLOSE, ESCALATE, LINK, UNLINK, ASSIGN, COMMENT, EPISODE_CREATE, EPISODE_CLOSE` (10월 예약: `SPLIT, MERGE, MOVE`). `REVIEW_START`는 조회가 만드는 유일한 행 — `comment` 없음(§0 "처분 액션 comment 필수"의 예외), 상태 변화 없음(`from = to = OPEN`), 담당자당 1회(판정 규칙 §3.3 — 마지막 `ASSIGN` 이후 현재 담당자의 행이 없을 때).
- `relatedIds`: LINK/UNLINK 시 episodeId·alertId 쌍, ASSIGN 시 이전·이후 userId.
- **GET /api/alerts/{id}/history**, **GET /api/episodes/{id}/history** — Episode 이력은 소속 Alert의 ESCALATE/LINK/UNLINK 행을 포함.
- **GET /api/history?actor={userId}** [ADMIN·본인] — 사용자별 처리 이력(기획서 요구, 11월 [권한관리]에서 구현, 시그니처 예약).

## 6.5 대시보드 (W4 [Episode 조사 데이터 ⑥ + 대시보드], 09-29 — 처리 흐름 4칸 + 담당자별)

- **GET /api/dashboard/summary** [전 역할] — `{ alertsByStatus: { OPEN, ESCALATED, CLOSED }, alertsByResolution: { NORMAL, FALSE_POSITIVE }, alertsByType: [{ code, name, count }], episodesByStatus: { OPEN, CLOSED }, episodesByResolution: { NORMAL, SUSPICIOUS }, alertsByAssignee: [{ userId, name, open, closedToday, escalatedToday, maxAgeDays }], episodesByAssignee: [{ userId, name, open, closedLast7Days, maxAgeDays }], latestJob: { jobId, analysisDate, status, suspiciousTxCount, alertCount, finishedAt }, reductionRate }` — `reductionRate = 1 - alertCount / suspiciousTxCount`(최근 job). 지표 추가는 `[미정: FE — 시연 화면]`.

## 7. 화면별 제공 항목 (FE 통보용 — 회신 요청)

FE는 아래에서 **표시할 항목을 고르고, 빠진 항목을 요구**한다. 항목 추가는 W3 [스키마]·[API] 전(9/14)까지 회신하면 마이그레이션 없이 반영된다.

| 화면 | API | 제공 항목 |
|---|---|---|
| 수집·처리현황 (은행별 도착 현황) | §1.1, §1.2 | **은행별 도착 현황**(`GET /api/banks/arrivals`: 은행·상태 7종·파일명·행 수·도착 시각·컷오프 잔여·도착 n/N) / 적재 작업 목록·오류 표(`errors[]`) / 분석 작업 목록(status·attempt·analysisDate·모델 버전·임계·의심 거래·Alert) / "분석 실행" 버튼 = `POST /api/batch-jobs/analysis` / 현재 목업이 전송 / 향후 은행 직원 로그인·파일 선택·수동 업로드 화면 연결 |
| Alert 목록 (L1 큐) | §3.2 | 위험도, **요약문**, 대표 유형(코드·명), **대표 계좌·계좌 수·은행 수**, 거래 수, **USD 합계 + 통화별 합계**, **점수 통계(평균·최고·초과 비율)·점수 가중 금액·묶음 순도**, 기간(첫·마지막 거래), 참여 은행, 상태, **담당자(자동 배정)**, 소속 Episode, 분석 날짜, 생성 시각, **경과일** / 정렬 8종 / 필터 7종("내 담당" 기본 뷰) / ADMIN: 재배정 |
| Alert 상세 (L1) | §3.2, §3.3 | 목록 항목 + 구성 거래 표(§2.4 — 금액 USD·**백분위·임계 배율·의심 여부·복합 유형 후보·두 모델 합의·편입 역할·방향** 포함) + 유형 구성비 + 묶음 근거 + **참여 계좌 표(역할·in/out 건수·USD·최대 점수·상대방 수·첫 거래일)** + **시각순 점수 추이** + **설명 요인(피처 기준선 편차 상위 3, 포함 방식은 W3)** + 관계 그래프(노드 역할·금액·위험 등급, 엣지 id·거래 수·USD·최대 점수·유형·기간) + 이력 / 액션: 종결(정상·오탐, 의견 필수)·심층 요청(신규 Episode — L2 자동 배정 / 기존 Episode 연결) / ADMIN: 재배정 |
| Episode 목록 (L2 큐) | §4.1 | 위험도·자동 제목·Alert 수·거래 수·USD·유형들·담당자·상태(OPEN/CLOSED)·결과·요청 L1·경과일 / 뷰: 내 담당·전체 / 정렬·필터 §4.1 |
| Episode 상세 (L2 조사) | §4 | 상세(조사 순서): 소속 Alert 표 → ① 기준선 배율 → ② 자금 흐름 요약 → ③ 패턴 증거 체크 → ④ 상대방 표(다른 Alert 포함) → ⑤ 자금 경로 그래프(hops=0/1) + 연계 거래 → ⑥ 관련 계좌 이력 → ⑦ 의견·이력 → ⑧ 결론(who/what/when/where/why/how 템플릿 + resolution + 서술) / 액션: Alert 해제·조사 의견·종결 — 연결은 Alert 화면(L1) / ADMIN: 재배정 |
| (관계 그래프) | §3.2 graph · §4.1 graph | 독립 화면이 아니라 Alert 상세·Episode 상세 안의 패널(노드 = 계좌). Alert = 구성 거래 그래프, Episode = 합집합 + Alert 밖 1 hop. 다기관 전체 그래프는 11월 |
| 대시보드 | §6.5 | 처리 흐름 4칸(L1 조사 중 OPEN → 조사 경과일 → L2 조사 중 ESCALATED/Episode OPEN → 처분 CLOSED + resolution 분포), 유형 분포, 담당자별(L1·L2), 최근 배치, 감소율. 미열람 표시 없음 |
| 로그인 | §5 | 사용자·역할 반환. 역할별 첫 화면(L1 → Alert 목록 "내 담당", L2 → Episode 목록 "내 담당", ADMIN → 대시보드). 시연은 L1·L2 계정 전환 + ADMIN 재배정 1회(선택) |
| 모델 성능·버전 / 사용자·권한 | — | 시연 이후(10~11월) |

## 8. 미정 목록 (회신 주체별)

**FE**: ① 금액 **화면 표기 방식**(축약·자릿수 — 데이터 형태는 §0 BE 결정으로 해소) ② 그래프 응답 포함 vs 분리(BE 추천: 분리), 시각화 라이브러리 ③ 유형 한글 표시 명칭·'의심 거래' 표시 명칭(초안: 리서치 문서 §4.6) ④ §7 회신(빠진 항목) ⑤ 인증 방식 결정 기한(로그인 착수 시점) ⑥ 대시보드 추가 지표(후보: 위험 밴드 분해·미결 경과일 중앙/최대·처분 결과 분포·은행별·담당자별 부하·Alert→Episode 전환율).
**Data**: ① 시연 CSV 시각 형식·인코딩·은행별 분할(9/7 기한 경과·미회신 — IBM 원본 형식으로 진행 중, §1.4) ② ~~이진 모델 피처 세트 동일 여부~~ → 다름·구성 변동으로 확정(09-07, §2.1) — 각 세트의 현재 컬럼 목록은 [모델 래핑] 때 피처 빌더에서 읽는다 ③ Σp 보장·dtype ④ `link_basis` 산출 가능 여부(+ 거래별 `role`/허브 계좌 산출 가능 여부) ⑤ ~~처분된 Alert 거래 제외 여부~~ → 제외로 확정(09-07, §3.1) — 알고리즘 입력 = 미소속 거래만 ⑥ Episode 위험도 = max Alert riskScore 동의 ⑦ ~~점수 적재 스텝에서 job 내 백분위(`score_pct`) 계산 추가 동의~~ → BE 자체 확정(09-08, §2.2 — 적재 스텝은 BE 소유) ⑧ 학습 산출물(run json: 검증 PR-AUC, recall별 임계·precision·알람 수, 유형별 OVR PR-AUC, 피처 중요도) 인도 형식·시점 — 10월 [모델 관리] `model_versions` 입력, W2 캘리브레이션에도 사용.
**Infra**: 배포 후 EC2 역할의 환경별 S3 prefix PUT/HEAD/GET 권한·컨테이너 자격증명 접근 확인. SSE-KMS 사용 시 체크섬 HEAD용 추가 KMS 권한 확인. dev 프로파일 적용 및 실제 S3 관통은 배포 후 검증. 웹 업로드 CORS는 향후 별도 구성.
**Data 추가(09-07)**: ⑨ Episode 조사 블록 패턴 증거 항목·통과 기준 초안 검토(§4.1) ⑩ 시연 CSV 은행별 분할 형식(은행 목업이 파일 단위로 전송).
**사용자**: ① ~~`is_laundering` 원장 보관 여부~~ → 평가 스키마 분리로 확정(09-07, §1.4) ② **최종 모델 형태 — 지금 답할 수 없음(2026-09-07 사용자)**: 모델 개선 결과에 따라 정해진다. 질문 목록에서 제외하고, 계약은 필수 열 + 무시되는 확장 열 규칙(§2.1)·모델별 피처 파일·`feature_version_*`로 어느 형태든 수용한다. 형태가 정해지면 그때 엣지 파일·`pred_contrib`·run 지표 인도 형식을 추가한다.
해소됨(v0.2): 점수 필드명, 유형 매핑표, 페이지네이션·정렬, 에러 응답, 배치 상태, 상태 전이, 역할 표, 감사 이력 행, 임계 저장(threshold_value 스냅샷). 해소됨(v0.3): 금액·통화 데이터 형태(USD 환산 병기·ISO 코드), Alert 요약·대표 계좌·참여 계좌·점수 통계·거래 편입 역할·점수 파생 확장.
