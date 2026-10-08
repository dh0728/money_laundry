# AML API 계약

현재 Spring 컨트롤러·서비스와 흐름 기반 Alert 생애주기 구현을 기준으로 한다. 요청·응답 이름은 실제 구현을 따르며, 구조는 [ERD](ERD.md), DB 컬럼·제약은 [단일 V1](src/main/resources/db/migration/V1__initial_schema.sql)을 참조한다. 배포 절차는 [DB 전환 안내](../../deploy/DB_TRANSITION.md)에 별도로 둔다.

거래, 모델의 의심 거래, Alert, Episode를 구분한다. 모델 결과와 직원 판정은 별개이며 정답 라벨을 생성기·업무 판정에 사용하지 않는다.

## 0. 공통 규칙

- 기본 경로는 `/api/v1`이다. 인증(`/api/auth`, `/api/me`)과 은행 도착 현황(`/api/banks/arrivals`)은 아래에 적힌 경로를 그대로 사용한다.
- uploadId/jobId/txId/alertId/episodeId/userId는 서버 발급 숫자 ID다. Alert의 caseId는 alertId, Episode의 caseId는 episodeId이며 두 사건 종류는 공통 ID 시퀀스를 사용한다. 계좌·소유주 ID는 별도 가명 UUID다.
- 일반 페이지는 `{content,page,size,totalElements,totalPages}`. page는 0부터, size 기본20·범위1~200이다. 알림은 page 대신 number를 반환하고 size 최대100이다. 정렬은 각 API에 명시한 것만 지원한다. 빈 목록은200과 빈 content다.
- 날짜형 필터는 KST 시작일00시 이상/종료일 다음날00시 미만이다. 작업 목록의 from/to는 날짜가 아닌 ISO-8601 Instant이며 양끝 포함이다. timestamp는 ISO-8601의 오프셋 또는 Z를 해석해 표시한다. 모든 응답이 `+09:00` 문자열이라고 가정하지 않는다. CSV의 시간대 없는 시각은 KST다.
- JSON 이름은 엔드포인트별 응답 표를 따른다. 제안 상세·동결 scores에는 snake_case가 있다. 대시보드는 camelCase DTO를 사용한다. 요청 필드명을 임의 변환하지 않는다.
- 금액은 원통화와 명시된 USD 환산값을 구분한다. 원장 amountUsd는 고정 환율 버전으로 계산한 송금액이며 실시간 환율이 아니다. 미분석·결측·표본 없음의 null을0이나 정상 판정으로 바꾸지 않는다.
- 업무 오류는 ProblemDetail `{type,title,status,detail,instance,code}`이며 일부 오류에 errors/uploadId 등 확장 필드가 있다. 보안 필터 오류는 `{status,code}`다. 400 형식/선택 오류, 401 미인증, 403 권한, 404 없음, 409 상태·개정 충돌, 413 파일 한도를 사용한다. INVALID_PARAMETER/VALIDATION_FAILED, UNAUTHENTICATED/INVALID_CREDENTIALS, FORBIDDEN/FORBIDDEN_ROLE, NOT_FOUND, INVALID_TRANSITION 등이 사용된다.
- 직원 조회는 dev/local의 로그인 STAFF/ADMIN, 조사 변경은 해당 사건 담당 STAFF, 시연 제어·분석 등록/재개·초기화는 ADMIN이다. prod가 활성화된 직원 작업 환경은 허용하지 않는다. 은행 업로드·정정 API는 별도 X-Bank-Id 경계다. 인증·CSRF 상세는 §5를 따른다.
- 변경 명령은 comment와 기대 revision, requestId를 해당 계약대로 보낸다. GET은 조사 착수·범위·판정을 변경하지 않는다. 원문 식별자·암호문·검색 토큰·비밀번호·서명 URL을 직원 조회에 제공하지 않는다.

`GET /actuator/health`와 하위 상태 검사 경로는 인증 없이 제공한다. 상세 구성 노출 여부는 Actuator 설정을 따른다. 직원 API의 로그인·CSRF를 생략하는 용도로 사용하지 않는다.

## 1. 수집·통합·분석 작업

### 1.1 은행 수집 API

은행 측은 데이터 공급 목업만 제공한다. 은행 직원 웹·로그인·외부 통지는 구현 범위가 아니다. 상위기관 분석팀이 웹에서 결과를 조회한다.

- 보고 은행은 운영자가 `banks.is_reporting=true`와 `bank_reporting_periods`의 거래 기준일 적용 기간을 사전 등록한다. URL 요청으로 자격을 만들지 않는다. 참조 은행과 보고 은행은 별개다. 미등록 은행·기준일은403 `REPORTING_NOT_REGISTERED`다. `banks.report_format=AML17` 설정에 따라 현재 공통 CSV 규칙을 선택한다.
- `X-Bank-Id`는 dev/local에서만 허용하는 테스트 대역이다. prod 혼합·미지정 프로파일은403 `BANK_IDENTITY_DISABLED`, 잘못된 정수는400이다. 실제 인증 연동을 대체하지 않는다. 은행 업로드·정정 경로는 자기 은행 신원을 확인한다.
- **POST /api/v1/bank/uploads** `{fileName,sizeBytes,checksumSha256,businessDate}` + 정정 시 `{correctionRequestId,correctionSubmissionId}` →201 `{uploadId,bankId,url,method:"PUT",expiresAt,headers,uploadRequired}`. 기본4개 필드는 필수이며 정정2개 필드는 함께 지정한다. 한 파일은 서울 거래 기준일 하루치, 최대200MiB, 기본 URL TTL 15분. 체크섬은 실제 파일 바이트 SHA-256 Base64다. 파일명 경로 문자는 거절한다.
- 은행은 응답의 서명 헤더를 유지해 S3에 PUT한다. 은행 식별 헤더를 S3로 전달하지 않는다. S3 SDK·비공개 객체·IAM 설정 계약은 기존 저장소 설정을 유지하며 실제 배포 권한은 별도 검증한다. dev/prod는 S3 설정 누락시 시작 실패, local/default만 폴더 저장소를 허용한다.
- **POST /api/v1/bank/uploads/{uploadId}/complete** →202 처리현황. 객체 존재·크기·실제 SHA-256 확인 후 수신을 커밋하고 비동기 검수한다. ETag를 체크섬으로 대체하지 않는다. 은행 행 잠금 후 최신 URL/상태를 다시 확인한다. 같은 번호 완료 재시도는 기존 상태를 반환한다.
- 복구: 중복/진행 중 409의 `uploadId`는 인증된 은행의 동일 SHA-256 파일에 해당한다. 은행 상태 조회로 기준일·크기·처리 결과를 확인한 뒤 완료본은 건너뛰고 진행 중인 건은 조회를 이어간다. URL 발급 상태만으로 전송 완료로 간주하지 않는다. 다른 기준일 파일이나 검수 실패는 자동 성공 처리하지 않는다.
- 일반 동일 파일 완료본은409 `DUPLICATE_FILE`, 진행 중은409 `UPLOAD_IN_PROGRESS`, 새 URL이 발급된 옛 번호는409 `UPLOAD_SUPERSEDED`다. 명시적인 correctionRequestId·correctionSubmissionId 제출만 별도 정정 문맥으로 접수한다. 일반 업로드는 기존 보고를 임의 교체하지 않는다.
- 검수 성공은 **은행 보고 저장 완료**다. `COMPLETED`를 통합·추론 완료로 해석하지 않는다. 반복 동일 행은 원천 발생 건수로 보존한다. 파일 자체 오류는 전체 보류하고 정상 개체·계좌·거래를 만들지 않는다. 정상 확정은 별도 통합 서비스에서 수행한다.
- 목업은 업로드 또는 `--upload-id` 재조회, 2초/최대30분 폴링을 유지한다. 종료0은 보고 수신 처리의 종료이며 `integrationStatus`로 통합 대기/정상/보류를 별도 표시한다. 시간초과는 서버 실패로 단정하지 않는다.

### 정정 및 실행 세대 계약

- `GET /api/v1/bank/corrections?page=0&size=20&status=OPEN`: 자기 은행만 조회한다. status 생략은 모든 미해결 요청이며 OPEN, REPLACEMENT_RECEIVED, VALIDATING, WAITING_COUNTERPART, WAITING_ANALYSIS_RELEASE, RESOLVED를 선택할 수 있다. 응답은 공통 페이지 형식이다.
- `GET /api/v1/bank/corrections/{id}`: 자기 은행의 요청만 반환하며 다른 은행/없는 ID는404다. 보고 자격이 없는 은행은403 REPORTING_NOT_REGISTERED다. 각 요청에는 correctionRequestId, businessDate, uploadId(미도착이면 null), reportVersionId, status, revision, replacementUploadId, replacementVersionId, errors가 있다. 오류는 {row,column,code,reason}이며 파일 수준 오류의 row는 null이다. 원문·다른 은행 파일명은 노출하지 않는다.
- 업로드 URL 요청에 선택 `correctionRequestId`를 추가한다. 같은 은행·기준일의 미해결 요청이어야 하며 정정은 새 전체 보고 버전이다. 일반 중복과 구분하여 과거와 동일 바이트도 제출할 수 있다. 정정 제출은 correctionSubmissionId(UUID)를 반드시 함께 보낸다. 같은 요청/제출 ID는 완료 후에도 같은 upload/version을 반환하며 다른 파일명·크기·체크섬이면409 CORRECTION_SUBMISSION_MISMATCH다. 새 후보는 새 제출 ID다. 이미 수신한 제출 응답은 uploadRequired=false이며 URL/PUT을 재사용하지 않고 uploadId로 조회한다. 미수신 URL 만료는409 UPLOAD_URL_EXPIRED이며 새 제출 ID가 필요하다. 서로 다른 정정 문맥의 URL은 상대를 supersede하지 않는다. RESOLVED 요청은409 CORRECTION_RESOLVED다.
- 수신만으로 해결하지 않는다. 자체 오류는 OPEN, 정상 후보의 상대 대기는 WAITING_COUNTERPART, 실행 해제 대기는 WAITING_ANALYSIS_RELEASE다. 공동 대조·원자 교체 이후 RESOLVED다. 후보 재제출은 RESOLVED 이외 상태에서 허용한다.
- 업로드 조회에 reportVersionId, correctionRequired, correctionRequestId, replacementUploadId, nextAnalysisDate를 추가한다. integrationStatus는 WAITING_COUNTERPART/WAITING_ANALYSIS_RELEASE/SUPERSEDED를 포함한다. nextAnalysisDate는 수신시각 기준 예정 컷오프 날짜이며 분석 완료 약속이 아니다.
- 정정 교체는 고정 cutoff 내 가장 높은 자체 검수 통과 version과 기존 채택본을 대조한다. 구/신 보고의 은행·계좌·개체 영향 묶음을 함께 검증한다. 동일 내용/반복 발생 건은 tx_id를 보존하며 완료 TARGET의 수정·삭제는 COMPLETED_TARGET_CHANGE_OUT_OF_SCOPE로 전체 후보 묶음을 거절한다. 완료 CONTEXT의 구 입력은 값 스냅샷으로 보존한다.
- 분석은 WAIT_INGEST → INTEGRATE → FREEZE_INPUT → FEATURES → INFERENCE → SCORES → ALERTS → COMPLETE다. runId UUID는 입력 세대, executionId는 단계 시도다. 정정 취소는 결과/재시도/후속 진입을 차단하고 별도 run으로 대체한다. 취소된 모든 미완료 TARGET을 재검토하며 이전 날짜 TARGET도 누락시키지 않는다. 입력0은 EMPTY_INPUT이다.
- 결과 완료와 취소는 같은 실행 잠금에서 판정한다. BINARY/TYPE의 모든 게시 가능한 요청/회차를 취소 outbox로 추적하고 STOPPED 또는 ALREADY_FINISHED 확인 전 대체 추론을 대기한다. 전달 실패·미응답을 종료로 취급하지 않는다. cancel_id와 메시지는 재전달에도 불변이다. Python 실행측과 취소 전달을 연결한다. 실제 S3·외부 추론 서버의 종료 확인은 배포 환경에서 별도로 검증한다.
- 취소 contract_version은 숫자2다. `INFERENCE_API_URL`(HTTPS 기본 주소)과 `INFERENCE_API_TOKEN`(추론 워커 INFERENCE_TOKEN과 같은 전용 토큰)을 함께 설정하면 Java 전달 담당이 `PUT /api/v1/inference-requests/{requestId}/rounds/{round}/cancellation`으로 기존 불변 취소 메시지를 보내고 같은 회차의 `GET`으로 상태를 조회한다. Bearer 인증을 사용하며 리다이렉트를 따르지 않는다. 접수 응답은 중단 완료가 아니다. job/run/model/request/round/cancel 전체 식별자와 contract_version을 대조한 뒤 `cancellation_status=STOPPED`와 `status=STOPPED`, 또는 `cancellation_status=ALREADY_FINISHED`와 `status=COMPLETED` 조합만 종료 확인으로 인정한다. RECOVERY_REQUIRED·미응답·404는 종료 확인이 아니다.
- 두 API 설정이 모두 없으면 기존 S3/local 취소 파일 전달을 유지한다. S3는 `requests/{job}/{model}/{request}/rounds/{round}/cancel.json` 조건부 불변 게시와 `results/.../cancel_ack.json` 조회를 사용한다. local은 storage-dir/analysis-transport에 원자 게시한다. API 설정 일부 누락은 기동 시 거절하며 API 전달 실패 시 파일 방식으로 우회하지 않는다. 기존 2스레드 TaskScheduler에서 Python 단계와 별도로 5초 스캔하고, outbox의 재시도 정책을 그대로 사용한다. 실제 EC2–KubeSphere HTTPS 통신은 별도 배포 검증 대상이다.
- 전달 실패는30초/2분 간격으로 총3회까지 게시를 시도하고 미확인은 계속 대기한다. 3회 후에도 늦은 ack는 조회하며 작업 상세 cancellations의 actionRequired로 게시 재개 필요를 알린다. 취소된 작업의 기존 resume API는 outbox 시도만 재개하고 취소 run을 계산 재개하지 않는다(응답 status는 FAILED 유지). 실제 S3 권한/외부 프로세스 중단은 이 로컬·SDK 대역 검증과 구별한다.
- 더미 모델은 TARGET만 입력받고 Alert 구성은 달력 이동 탐색용 고정 CONTEXT도 사용한다. Python FEATURES→INFERENCE→SCORES→ALERTS가 연결되어 있으며 구체적인 Alert 정책은 §3.1을 따른다.
- 시연 분석은 `demo-random-v1/demo-input-v1` 시연 변환기를 사용한다. 입력은 TARGET의 `tx_id,demo_value`, 출력은 `tx_id,p_laundering` 또는 `tx_id,p_0,...,p_8`이다. 라벨·패턴 대응표를 읽지 않는다. 이진 값은 [0,1) 균등 난수, 유형 값은 9개 균등 난수를 합계1로 정규화한다. 거래 ID·모델 종류·버전별 seed로 재시도·순서·분할에 무관한 값을 만든다. 탐지 성능을 의미하지 않는다.

### 1.2 처리현황과 분석 제어
- **GET /api/v1/bank/uploads/{uploadId}** — 자기 은행만 조회. 다른 은행/없는 작업404. 응답은 `{uploadId,bankId,fileName,businessDate,sizeBytes,rowCount,insertedCount,missingCount,duplicateCount,status,errorCode,errorMessage,errors:[{row,column,reason}],urlIssuedAt,receivedAt,startedAt,finishedAt,integrationStatus,reportVersionId,correctionRequired,correctionRequestId,replacementUploadId,nextAnalysisDate}`다. `insertedCount`는 해당 보고에서 정상 통합 거래에 연결된 보고 행 수이며 통합 전에는0이다. 같은 내용 반복은 중복 오류가 아니므로 `duplicateCount=0`이다. `errors`는 자기 파일의 정제된 오류 최대100건이며 원문 식별정보를 포함하지 않는다. `finishedAt`은 보고 저장/검수 종료 시각이다.
- `integrationStatus`: `null`(보고 저장 전), `VALIDATED_WAITING_INTEGRATION`, `ACTIVE`, `PARTIALLY_HELD`(의존 보류와 독립 정상 행 공존), `HELD`(직접 오류 파일 전체 보류), `WAITING_COUNTERPART`(상대 후보 대기), `WAITING_ANALYSIS_RELEASE`(분석 해제 대기), `SUPERSEDED`(교체된 구 버전). 대표 사유는 `INVALID_SELF`, `IDENTITY_CONFLICT`, `PAYMENT_FORMAT_CONFLICT`, `COUNTERPART_MISSING`, `COUNTERPART_HELD`다. 기존 정상 DB와의 소유 충돌은 `INVALID_SELF_OR_CONFIRMED_IDENTITY`로 보류한다.
- **GET /api/banks/arrivals?date=** [로그인 STAFF/ADMIN] — **은행별 도착 현황**(수집·처리현황 화면의 중심): 보고 은행(`is_reporting`) 전부에 대해 `{ bankId, name, country, status: NOT_ARRIVED | URL_ISSUED | RECEIVED | RUNNING | COMPLETED | VALIDATION_FAILED | FAILED | EXPIRED, uploadId, fileName, rowCount, receivedAt, finishedAt }` 를 `banks` 배열에 담아 `{date,cutoffAt,remainingSeconds,arrivedCount,totalBanks,banks}`로 반환. `date` = 컷오프 기준일: 창은 (D−1 컷오프, D 컷오프], 기본값은 **다음 컷오프의 날짜**(지금 도착하는 파일이 속하는 창). 은행당 창 안 최신 업로드 1건.
- **GET /api/v1/batch-jobs** — 페이지 목록. `type=INGEST|ANALYSIS`, `status`, `from/to`(ISO-8601 Instant, 최초 startedAt 양끝 포함) 필터. jobId 내림차순. 행은 기존 작업 메타데이터와 `currentStage, stageAttemptCount, consecutiveFailures, retryAt, actionRequired, cutoffAt, completionReason, counters`를 포함한다. 미완료 분석의 의심 거래·Alert 카운터는0이다.
- **GET /api/v1/batch-jobs/{jobId}** — 위 행과 `uploads: [{ uploadId, excluded, status, fileName }]`, `failures: [{ stage, errorCode, failedAt, consecutiveCount, retryAt, actionRequired }]`.
  - `models: [{ modelKind, phase, status, requestId, executionRound, remoteStatus, remoteRevision, errorCode, actionRequired, retryAt, nextPollAt, remoteDeadlineAt, modelVersion, featureVersion }]`는 현재 run의 모델별 작업 상태다. 이전 run·토큰·서명 URL·로컬 경로·원격 응답 원문은 반환하지 않는다. 모델별 조치 필요 여부는 상위 작업의 FAILED 여부와 독립적이다.
  - INFERENCE 원격 대기는 상위 `RETRY_WAIT`로 재관측을 예약하며 실패 횟수를 올리지 않는다. 모델 하나가 실패해도 다른 모델의 상태 관측을 계속한다. 원격 대기 기한 초과/종료 불명은 조치 필요로 표시하고 새 요청 회차를 자동 생성하지 않는다.
  - 현재 연결은 직접 PUT 게시·GET 관측→COLLECT 파일 검증→두 모델 SCORES 저장이다. 원격 COMPLETED만으로 완료되지 않으며 크기/hash/버전/정확한 TARGET/확률 검증 후 모델 DONE/SUCCEEDED를 기록한다. 두 모델 수집 후 INFERENCE 완료, 점수와 거래 연결 및 SCORES 완료는 원자 저장한다. ALERTS는 준비 계획을 저장하고 Spring의 완료 트랜잭션에서 점수·Alert를 공개한다. 상태 확인은 GET 폴링을 사용한다.
- **POST /api/v1/batch-jobs/analysis** — 본문 없이 서버 Clock 현재 시각을 cutoff로 오늘의 새 분석만 등록한다.202 `{ jobId, status: "QUEUED" }`. 같은 날짜 진행중409 `JOB_ALREADY_RUNNING`, 완료409 `JOB_ALREADY_COMPLETED`, 실패409 `JOB_REQUIRES_RESUME`.

- 시연 업무 시각(`ops.business_clock.business_at`)이 설정되어 있으면 일반 분석 실행과 일일 자동 예약의 신규 등록은409 `INVALID_TRANSITION`으로 차단한다. 조작패널의 날짜 지정 분석을 사용한다. 검사는 시연 시각 설정과 같은 수신 잠금 안에서 수행하며, 기존 작업의 처리·재시도·기동 복구는 유지한다. 시연 시계가 설정되지 않았으면 기존 실제 날짜 기준 등록을 유지한다. 이미 생성된 작업을 자동 삭제하거나 분석일을 변경하지 않는다.

- **POST /api/v1/demo/analysis** — dev/local 날짜순 시연 전용. ADMIN 서버 세션·CSRF가 필요하다. 본문 `{businessDate:"YYYY-MM-DD"}`는 전송한 과거 거래 기준일이다. 분석 구분 날짜는 그 다음 날, 수신 cutoff는 실제 요청 시각으로 기록한다. PC 시각·수신 시각·파일 내용을 변경하지 않는다. 응답202 `{jobId,status:"QUEUED"}`. 기존 WAIT_INGEST부터 실제 파이프라인을 실행하며 검수·통합·입력 고정·실패/재개를 건너뛰지 않는다. `dev` 또는 `local` 프로파일에서 허용하며 `prod`가 함께 활성화되면403 `DEMO_CONTROL_DISABLED`다. 날짜가 없거나 시연 업무 시각 기준 오늘/미래이면400 `INVALID_DEMO_DATE`. 이전 미완료 분석409 `DEMO_PREVIOUS_JOB_PENDING`, 이전 날짜로 역행409 `DEMO_DATE_OUT_OF_ORDER`, 뒤 날짜 수신 자료409 `DEMO_FUTURE_INPUT`, 해당 날짜 수신 자료 없음409 `DEMO_INPUT_REQUIRED`, 같은 날짜 완료409 `JOB_ALREADY_COMPLETED`. 날짜순으로 파일을 전송하는 시연 DB에서 사용하며 운영 예약 API의 의미를 변경하지 않는다. PC에서 dev를 조작하는 실행 방법은 [조작패널 안내](demo/README.md#배포된-dev-서버-조작패널)를 따른다.
- **POST /api/v1/batch-jobs/{jobId}/resume** — FAILED 작업만 실패 단계부터 새 실패 주기로 재개한다.202 `{ jobId, status: "QUEUED" }`. 이력·정상 산출물·최초 startedAt은 유지한다. 완료 작업 재분석은 허용하지 않는다.
  - 현재 run의 로컬 `PUBLISH/FAILED` 또는 `COLLECT/FAILED` 모델은 같은 요청·회차로 재개한다. 수집 재시도는 모델을 재실행하지 않으며 결과 전송의 일시 오류는30초/120초 간격·총3회 후 명시 재개를 기다린다. 준비/관측 완료된 다른 모델은 초기화하지 않는다. 원격 모델의 최종 실패를 새 회차로 재실행하는 기능은 아직 미연결이며 이 API가 모델 재시작 성공을 보장하지 않는다.
- 분석 등록/재개는 ADMIN 세션·CSRF가 필요하다. dev/local 활성·prod 비활성이어야 하며, 환경 위반은403 `ANALYSIS_CONTROL_DISABLED`다.
- 운영 등록은 `app.ingest.cutoff`(기본03:00), `app.zone`(기본 Asia/Seoul)의 매일 cron이다. 수신전이와 등록은 공유 advisory transaction lock을 사용하고 잠금 이후 수신 시각을 기록한다. cutoff 이하 전체 수신 업로드를 analysis.receipts에 고정한다. 검수 진행중도 대상에 남고 늦은 파일은 다음 날 편입한다. 기동 시 놓친 날짜를 보충 등록하지 않는다. URL 발급만 된 파일은 제외한다.
- 도착 현황의 창·최신 순서는 수신 후 received_at, 수신 전 created_at을 사용한다.

### 1.3 작업 상태 (ingest.uploads와 analysis.jobs 분리)

| API 작업 유형 | 상태 | 뜻 | 다음 |
|---|---|---|---|
| INGEST | `URL_ISSUED` | Presigned URL 발급, 파일 대기(완료 통지 전) | RECEIVED / EXPIRED |
| INGEST | `RECEIVED` | 완료 통지 수신·객체 확인, 적재 대기 | RUNNING |
| INGEST | `RUNNING` | 파일 검수·보고 적재 중 | COMPLETED / VALIDATION_FAILED / FAILED |
| INGEST | `COMPLETED` | 은행 보고 검수·저장 완료, integrationStatus 별도 | — |
| INGEST | `VALIDATION_FAILED` | 검증 실패(영구, `errors[]` 최대 100건) — 은행이 고쳐 재업로드(새 작업) | — |
| INGEST | `FAILED` | 적재 중 오류(영구) | — |
| INGEST | `EXPIRED` | 완료 통지 전 업로드 URL 만료 | 새 업로드 요청 |
| ANALYSIS | `QUEUED` | 실행 대기 | RUNNING |
| ANALYSIS | `RUNNING` | 실행 토큰을 가진 단계 처리 중 | COMPLETED / RETRY_WAIT / FAILED |
| ANALYSIS | `RETRY_WAIT` | 적재 완료 또는 retryAt 대기(5초 스캔) | RUNNING |
| ANALYSIS | `COMPLETED` | 점수·Alert 적재 완료 | — |
| ANALYSIS | `FAILED` | 영구 실패 또는 3회 소진 | 명시 resume만 허용 |

- 작업 상태와 errorCode는 별개다. 오류 코드로 실패 원인을 확인하고, 원문 저장 컬럼은 [ERD](ERD.md)를 참조한다.
- `WAIT_INGEST → INTEGRATE → FREEZE_INPUT → FEATURES → INFERENCE → SCORES → ALERTS → COMPLETE`. 등록 시 `analysis.receipts`에 cutoff 이하의 전체 수신 ID를 고정하여 이전 날짜 대기 후보도 포함하며, 검수중인 고정 수신 대상의 종료를 기다린다. 기술적 INGEST 실패는 `INGEST_FAILED`이며 TARGET0이고 후속 Alert 맥락 보완도 없으면 `EMPTY_INPUT`으로 종료한다. 후속 보완이 있으면 모델 실행을 건너뛰고 ALERTS로 진행한다.
- INTEGRATE의 선택 version/generation은 FREEZE_INPUT에서 재확인한다. cutoff 안의 참조 변경은 같은 receipts로 INTEGRATE부터 재준비한다. 이미 cutoff 밖의 더 최신 현재본으로 교체되면 `CUTOFF_SUPERSEDED`·FAILED/조치 필요로 남긴다. 현재 포인터 역행이나 최신본의 과거 입력 몰래 편입은 없다. 이 경우 운영 확인이 필요하며 과거 cutoff를 자동 확장하지 않는다.

- 같은 단계·오류 최초 포함3연속 실패에서FAILED. 연결(DB/S3)은30초/2분, 계산은1분/5분 뒤 재시도한다. 설정·계약 오류는 즉시FAILED. 교대 오류 전체 상한은 없다. 정상 단계/명시resume만 연속 실패 주기를 끝내며 이력은 보존한다. 
- 단일 BE 기준으로 전용 연결의 DB 세션 advisory lock을 Runner 생존기간 유지하고 소유자만 실행/잔여 RUNNING 복구한다. 종료 시 잠금을 해제하고 연결 상실 시 재획득한다. 실행 UUID 확인과 DB 쓰기로 오래된 실행을 차단한다. 정상 prepare 결과는 실행중 JVM에서 유지하고 DB 복구 시 단계 결과·이력을 저장한다. DB 장애 중 미저장 실패 횟수/산출물은 프로세스까지 종료되면 소실될 수 있다. 정확한 횟수 영속성을 보장하지 않는다.
- Python `worker/analysis_entry.py`는 INTEGRATE/FEATURES/INFERENCE/SCORES/ALERTS를 연결한다. 현재 모델은 명시적 demo이며 실제 GNN이 아니다. 설정 없는 모델 실행은 `PIPELINE_NOT_CONFIGURED`이고, Alert 저장에는 원격 추론 설정이 필요하지 않다.
- Python은 수집·통합 및 analysis 산출물의 DB 읽기/쓰기를 담당한다. Alert는 준비 계획까지만 저장하고 review 공개는 Spring이 분석 완료 트랜잭션에서 수행한다. 자신의 트랜잭션에서 실행 토큰 확인·데이터 저장·단계 완료를 원자 처리하고 Runner가 DB로 확인해야 한다. Java JDBC 트랜잭션에 별도 프로세스가 참여하지 않는다. 원격 추론은 고정 job/request/round 식별자로 상태·결과를 조회하며, 새 executionId만으로 모델을 다시 실행하지 않는다.

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
- `private.bank_reports`는 version·source_row별 실제 행을 보존한다. `core.owners/accounts`의 서비스 UUID는 정상 확정 때 만들고 동일 개체와 (은행,계좌)에 재사용한다. 가명은 최초 통합 때 core.owners.display_name에 이름+코드로 저장하여 목록에서 바로 조회한다. 원문 식별자·이름은 private.owner_identities/account_identities에 분리한다. Python 원문은 AES-256-GCM, 검색 토큰은 별도 키의 HMAC-SHA256이다. 외부 공급 `app.ingest.encryption-key`, `search-key`는 서로 다른32바이트 Base64이며 `key-version` 필수다. 값은 문서·저장소에 넣지 않는다. 누락·변조·잘못된 버전이면 원문 처리 실패다.
- 고정 수신 upload ID 집합·cutoff·거래 기준일을 받는 Python `report_integration.integrate_job` 경계에서 정확 매칭한다. 원천 송수신 은행/계좌·시각·양쪽 금액/통화 전체를 대조한다. 해시만 같다고 통합하지 않는다. 같은 키에서는 Payment Format별로 report_id순 대응한다. 1+1→1, 2+2→2이며 은행내 거래와 수집범위 밖 상대는 단독 행 그대로 보존한다.
- 직접 오류 파일은 전체 HELD, 그 파일에 의존하는 다른 파일의 해당 행만 DEPENDENCY_HELD다. 다른 파일의 독립 정상 행은 확정할 수 있다. 정상 관계는 오류로 덮어쓰지 않는다. 통합 확정과 출처 연결·개체/계좌·상태 전이는 한 트랜잭션이며 중단시 롤백한다.
- 송수신 통화·원천 금액은 그대로 저장한다. USD 표시는 기존 `amount_paid / units_per_usd`, scale6 HALF_UP과 환율 버전을 사용하며 매칭 기준이 아니다. `transactions`에는 단일 보고 bank_id·row_hash UNIQUE·ingest_job_id를 두지 않고 `transaction_reports`로 출처를 연결한다.
- Python에서 최초 통합·정정 버전 교체를 수행하고 Spring이 입력 고정·실행 조정·취소 전달을 담당한다. 초기 스키마 전환은 [DB 전환 안내](../../deploy/DB_TRANSITION.md)를 따른다.

## 2. 추론과 거래 점수

### 2.1 실행·산출물 경계

BINARY와 TYPE은 각각 고정 TARGET에 대한 별도 요청이다. 요청·상태 API는 `PUT/GET /api/v1/inference-requests/{requestId}/rounds/{round}`이며 전용 Bearer 토큰을 사용한다. 취소는 같은 경로의 `/cancellation`이다. 직원 세션 API와 구분한다.

입력·결과는 `requests|results/{jobId}/{BINARY|TYPE}/{requestId}/` 아래에서 manifest·Parquet·결과 표식을 사용한다. 요청 ID·run·회차·모델/피처 버전, 행 수·정확한 tx_id 집합·파일 크기·SHA-256·유한 확률을 검증한다. 원격 COMPLETED만으로 분석을 공개하지 않는다. 구체적인 전송·프로세스 계약은 [worker 문서](worker/README.md), [게시](worker/model_publication.py), [수집](worker/result_collection.py), [추론 서비스](worker/inference_service.py)를 따른다.

현재 모델은 `demo-random-v1/demo-input-v1` 시연용이다. `tx_id,demo_value` 입력에 결정적 난수 점수를 만들며 이진 결과는 p_laundering, 유형 결과는 p_0~p_8이다. 실제 그래프 패턴 모델 연결은 구현된 계약에 포함하지 않는다. 파일 운반과 모델 추론 품질을 동일시하지 않는다.

### 2.2 점수의 의미

- 점수는 (run_id,tx_id)로 저장하며 TARGET만 해당 run에서 채점한다. CONTEXT는 고정한 과거 점수를 사용하거나 미채점으로 남는다. 분석 전체 완료 전에는 현재 점수로 공개하지 않는다.
- launderingScore=p_laundering, typeClass=argmax(p_0..p_8), typeScore=해당 값. 동점은 작은 코드다.
- isSuspicious는 해당 실행에 동결된 threshold_value 이상인지다. 원장 최신 조회는 analysis.current_scores를 사용한다. 의심 거래 API의 jobId/analysisDate는 해당 완료 분석 결과를 선택한다.
- scorePercentile은 같은 실행에서 `100 × percent_rank(p_laundering)`. 동점은 최저 공동 순위이며 단일/전부 동점은0이다. thresholdRatio는 점수/임계값이다.
- typeCandidates는 상위 두 확률 차이가 app.type.ambiguity-delta(기본0.10) 미만이면2개, 아니면1개다.
- agreement는 STRONG(이진 의심·패턴 있음), ATYPICAL(이진 의심·코드0), PATTERN_ONLY(이진 정상·패턴 있음), WEAK(이진 정상·코드0). 미분석은 여기에 넣지 않는다.

### 2.3 유형 코드

| 코드 | 의심 거래 API 이름 | 원장·조사 유형 이름 |
|---|---|---|
| 0 | NON_PATTERN | NON_PATTERN |
| 1 | FAN-OUT | Fan-out |
| 2 | FAN-IN | Fan-in |
| 3 | G-SCATTER | Gather-scatter |
| 4 | S-GATHER | Scatter-gather |
| 5 | CYCLE | Cycle |
| 6 | RANDOM | Random |
| 7 | BIPARTITE | Bipartite |
| 8 | STACK | Stack |

코드0은 패턴 없음이며 이진 정상/직원 NORMAL 판정과 다르다. 이름 문자열을 숫자 코드나 직원 판정 대신 사용하지 않는다.

### 2.4 의심 거래 조회

`GET /api/v1/suspicious-transactions`: page,size,jobId,analysisDate,typeClass,minScore,bankId,sort. bankId는 송신 또는 수신 은행이다. sort는 launderingScore 또는 txId의 asc/desc이며 기본 launderingScore,desc·동률 txId,asc다.

행은 `txId,txAt,fromBank,fromAccount,toBank,toAccount,amountReceived,receivingCurrency,amountPaid,paymentCurrency,amountUsd,paymentFormat,launderingScore,scorePercentile,thresholdRatio,isSuspicious,typeClass,typeName,typeScore,typeCandidates,agreement,jobId`다. 계좌는 가명 UUID다. 이 응답을 Alert의 동결 transactions와 동일 DTO로 가정하지 않는다.

## 3. Alert 생성·생애주기·근거 조회

### 3.1 생성과 공개

통합 거래와 거래별 이진 점수 → 제한된 흐름 그래프 구성 → 기존 사건 대응 계획 → Spring 완료 트랜잭션에서 공개한다. worker는 review를 읽기만 하고 analysis.alert_plans에 canonical JSON 계획을 쓴다. Spring은 실행 토큰·입력 유효성·사건 개정·계획 digest를 확인한 뒤 공개 버전·현재 범위·요약·계보·이력·알림을 한 번에 반영한다. 별도 업무 ‘후보’ 상태는 없다.

- 씨앗은 해당 점수 실행의 임계 이상 거래다. 과거 미소속 씨앗도 검토하며 TARGET0이어도 고정 과거 점수/사건이 있으면 재추론 없이 검토한다.
- flow-evidence-2는 씨앗 ±72시간·시간 방향별2홉, 흐름/분기/반복 witness를 사용한다. 핵심 SEED/CONNECTION을 먼저 만들고 CONTEXT를 붙인다. 연결 근거 없는 단독 씨앗은 발행하지 않는다. 정책 버전이며 DB 마이그레이션은 단일 V1을 유지한다.
- 일반·씨앗 이웃64·씨앗별 맥락100·신규 그래프 맥락200·핵심 기간240시간. 활동512건 이상/의심 비율20% 미만 허브는 이웃16으로 제한한다. 핵심4096거래를 초과하는 연결은 여러 관련 Alert로 분할하고 `CORE_PARTITION`과 `boundaryWitnesses`를 보존한다. 경계 연결만으로 다시 자동 병합하지 않는다. 검사위치2000만·핵심별 보존 관계20만 등 계산 예산 초과는 전체 실패하며 부분 공개하지 않는다.
- 다음 분석에서는 기존 OPEN 사건의 씨앗 소속·핵심·저장된 거래 공간을 먼저 확보한다. 기존 거래는 보존하며 새 맥락은 남은 맥락 공간만 채운다. 병합 시 과거 맥락 합계는200을 넘을 수 있지만 핵심4096·전체4296 한도는 유지한다.
- Alert 근거 상세와 조사 상세의 `relatedFlows`는 `{kind, txIds, relatedAlertIds}` 배열이다. `txIds`는 고정된 분할 경계 근거이고, `relatedAlertIds`는 그 거래를 씨앗으로 갖는 현재 공개 대표 사건 ID다. 따라서 과거 버전에서도 이동 대상 ID는 현재 기준이며 자기 자신은 제외한다. `boundaryWitnesses` 원본은 `{kind, tx_ids}` 형태로 근거 버전에 보존한다. 경계 거래는 다른 Alert의 CONNECTION으로 중복될 수 있지만 새 그래프의 씨앗 소속은 하나다.
- 거래는 여러 Alert의 맥락이 될 수 있지만 맥락 공유만으로 사건을 합치지 않는다. 그래프의 패턴 모델 추론은 현재 생성 기준이 아니다.

### 3.2 사건 전이

| 상황 | 처리 |
|---|---|
| 같은 흐름의 OPEN Alert 하나에 새 거래 연결 | 조사 중에도 자동 편입. 신규 거래만 PENDING, 기존 판정·제외·직원 역할 유지 |
| 미착수 Alert 여러 개가 같은 흐름 | 자동 병합. 최초 생성·동률 최소ID를 대표로 유지, 대표 담당자 유지, 양쪽 담당자에게 중복 없는 알림 |
| 조사 중 사건이 포함된 여러 Alert 병합 | 영향 담당자의 공동 변경 제안. 전원 동의 전 범위/공개 버전 유지 |
| 종결·Episode 편입 사건에 새 핵심/새 강한 관계 | 신규 생성 기준 충족 시 후속 Alert. 같은 후속 흐름은 열린 후속에 반영 |
| 종결 근거 반복 또는 맥락만 증가 | 후속 Alert를 새로 만들지 않음 |
| 정정으로 확인된 유효 핵심 소멸 | 미착수 SCOPE_CLEARED 자동 종료, 조사 중 철회 제안 |
| 점수 재평가·기존 근거 제거 | 조사 보호 정책에 따라 제안. 보고 정정과 점수 하락을 혼용하지 않음 |
| 같은 근거 재실행 | 새 버전·알림 없이 성공 검사만 갱신 |

병합 원본은 삭제하지 않고 canonicalAlertId로 대표를 안내한다. 별칭은 목록에서 제외하고 수정은409다. 종결/편입 판정은 자동 재개하거나 덮어쓰지 않는다. 후속 계보는 단일 parent 열이 아닌 관계로 보존한다.

직원 판단이 있던 거래가 정정으로 빠져도 저장 판정·역할·당시 버전은 보존한다. 현재 범위·요약은 공개 버전과의 교집합이며 상세 withdrawnMembers로 과거 판정을 별도 조회한다. 미수신·HELD·탐색 한도는 무효 근거로 단정하지 않는다.

공개 포인터가 가리키는 버전만 현재 근거다. 제안 버전은 일반 버전 목록/상세에 노출하지 않는다. 원자 공개 전 취소·실행 교체·입력 변경은 전체 공개를 막는다. 사건 개정 충돌은 재계획하고, 고정 거래/점수 입력 변경은 STALE_INPUT으로 중단한다. 옛 입력의 단순 resume이 새 snapshot을 자동 생성하지 않는다.

### 3.3 Alert 근거 API

| 요청 | 계약 |
|---|---|
| GET /api/v1/alerts | page,size,status(OPEN/CLOSED/ESCALATED),assigneeId,jobId. 현재 씨앗 위험도 내림차순·alertId 오름차순 |
| GET /api/v1/alerts/{alertId} | version 선택. 생략하면 publishedVersion, 지정하면 공개 완료된 불변 버전. 없거나 숨겨진 버전404 |
| GET /api/v1/alerts/{alertId}/versions | 공개 완료된 version,runId,createdAt 목록 |
| GET /api/v1/alerts/{alertId}/graph | version 선택. 같은 버전의 graph |

목록은 `alertId,status,resolution,assigneeId,parentAlertId,createdAt,version,runId,summary`와 생애주기 식별 필드를 제공한다. canonicalAlertId/publishedVersion/reviewStartedAt은 현재 사건 기준이다. jobId는 현재 공개 근거 생성 작업을 뜻한다. 작업 alertCount는 신규 사건 수이므로 이 목록 건수와 다를 수 있다.

상세에는 policyVersion/policy/witnesses,seeds,transactions,limits,graph,coverage,dataAsOf,lastCheckedAt을 제공한다. seeds는 `{txId,occurredAt,score,threshold}`. transactions는 `{txId,occurredAt,fromAccountId,toAccountId,fromBankId,toBankId,amountReceived,receivingCurrency,amountPaid,paymentCurrency,amountUsd,paymentFormat,role,includedReasons,scores}`이며 role은 SEED/CONNECTION/CONTEXT, 미채점 scores는 null이다. 근거의 금액은 정밀도를 보존하는 decimal 문자열이며 숫자로 파싱한다. policy 필드명과 witnesses의 tx_ids, scores의 p_laundering 등은 snake_case다.

근거 summary는 txCount,seedCount,totalAmountUsd,scoreMax,firstTxAt,lastTxAt이다. scoreMax는 포함 거래의 최대 관측 점수다. 현재 조사 summary.riskScore(현재 씨앗 최대값)와 구분한다.

graph.nodes는 계좌 id,kind,bankId,inCount,outCount,inAmountUsd,outAmountUsd, graph.edges는 id,txId,from,to,amountUsd,occurredAt,role,includedReasons다. 같은 계좌쌍의 반복 거래도 별도 edge다.

dataAsOf는 근거 생성 run cutoff, lastCheckedAt은 성공한 검사 시각이다. 최신 조회는 최신 성공 검사, 명시 버전 조회는 해당 버전 생성 run의 검사만 사용한다. coverage는 businessDate,complete,expectedBanks,completeBanks,reports의 날짜별 배열이다. 등록 은행0·미수신·부분 보류는 수신 완료가 아니며 미래 수신 완료를 추정하지 않는다.

### 3.4 배정

Alert와 일반 Episode 생성은 비밀번호 해시가 등록된 STAFF에 공통 라운드로빈 배정한다. last_assigned_at NULL 우선·오래된 순·동률 userId순이다. 배정 대상이 없으면 ALERT_ASSIGNEE_UNAVAILABLE로 실패한다. 관리자 재배정 API는 제공하지 않는다.

### 3.5 변경 제안 API

자동 거래 추가에는 투표가 필요 없다. 조사 중 사건의 병합·근거 철회·재평가 제안에만 아래 API를 사용한다. 화면 연결은 현재 백엔드 검증 범위에 포함하지 않는다.

- `GET /api/v1/review/alert-proposals/{id}`: 영향 사건의 **현재 STAFF 담당자**만 접근한다. 타인·ADMIN 또는 접근 가능한 사건이 없는 제안은403 FORBIDDEN_ROLE이다.
- 상세는 저장 필드명을 유지한 snake_case다. 주요 필드는 `proposal_id,revision,status,action,target_alert_id,proposed_version,generation,source_run_id,evidence,cases`. evidence는 제안된 비공개 근거이며 payload는 반환하지 않는다. cases에는 사건별 `alert_id,expected_revision,expected_published_version,assignee_id,response,response_actor,response_at`가 있다. response는 PENDING/APPROVED/REJECTED다.
- `POST /api/v1/review/alert-proposals/{id}/votes`: 같은 담당자 권한과 CSRF가 필요하다. 아래 본문의 caseRevisions에는 **자기 담당 영향 사건 전체**의 scopeRevision을 보낸다. 조사 명령용 합성 revision과 혼용하지 않는다. comment는 공백 제외 필수·최대4000자다.

```json
{"requestId":"UUID","expectedProposalRevision":1,"decision":"ACCEPT","caseRevisions":{"101":1,"102":2},"comment":"연결 근거 확인"}
```

- decision은 ACCEPT/REJECT. 성공200 `{proposalId,status,revision}`. 일부 동의는 OPEN을 유지하고 마지막 영향 담당자의 동의로 ACCEPTED 및 원자 공개된다. 한 명의 거절은 REJECTED다. 투표 후 proposal revision이 바뀌므로 다른 담당자는 최신 상세를 재조회한다.
- 같은 사용자·requestId·본문 재전송은 최초 응답을 반환한다. 같은 requestId의 다른 본문이나 낡은 expectedProposalRevision은409 INVALID_TRANSITION이다.
- 사건 개정·담당자·공개 버전·거래 유효성·선택 점수 출처가 바뀌면 제안을 SUPERSEDED로 만료한 뒤409 INVALID_TRANSITION을 반환한다. REJECTED를 제외하고 낡아진 제안을 새로 분석하면 generation·revision과 비공개 근거 버전을 새로 만들고 이전 동의는 감사 이력에만 보존한다. 같은 근거에 대한 거절을 반복 제안하지 않는다.
- 숨겨진 제안 버전은 일반 Alert 상세·버전 목록에서404/제외다. 사건 상세의 pendingProposalIds로 열린 제안을 찾는다. 종결·병합 이력은 §6, 현재 조사 범위는 §9를 따른다.

## 4. Episode

서로 다른 Alert 전체2개 이상을 묶는 조사 사건이다. Alert 하나는 최대 한 Episode에 소속되며 부분 이관·SPLIT·MOVE는 제공하지 않는다. 편입 시점 거래·조사 역할·판정을 고정 보존하고 원본 Alert를 CLOSED/TRANSFERRED로 처리한다. Episode 판정·종결·연결 해제는 §9의 명령 API를 사용한다.

## 5. 인증·사용자 — 서버 세션 (dev/local)

직원은 `STAFF`(일반직원)와 `ADMIN`(관리자)다. 일반직원은 본인 담당 Alert와 Episode를 모두 처리한다. 사건 종류별 판정 단위는 §9.1을 유지한다. 회원가입·계정 CRUD·관리자 재배정 API는 제공하지 않는다. 테스트 계정은 DB에 직접 등록하며 비밀번호는 해시로 저장한다. 등록 방법은 demo/README.md를 따른다.

1. `GET /api/auth/csrf` → `{headerName: "X-CSRF-TOKEN", token: "..."}`. 로그인 전에도 호출하며 응답의 세션 쿠키를 보존한다.
2. `POST /api/auth/login`, `Content-Type: application/x-www-form-urlencoded`, 본문 `username`, `password`. 1번 토큰을 지정된 헤더에 보낸다. 성공200 `{id,username,name,role}`, 실패401 `INVALID_CREDENTIALS`. 비밀번호 미등록 계정도 실패한다. 성공 시 세션 ID와 CSRF 토큰을 교체하므로 1번을 다시 호출한다. JSON 로그인 본문은 받지 않는다.
3. `GET /api/me` → 동일 사용자 정보. 로그인하지 않았거나 세션이 만료됐으면401 `UNAUTHENTICATED`.
4. `POST /api/auth/logout` + CSRF 헤더 →204. 서버 세션 무효화·쿠키 삭제. 로그인·로그아웃을 포함한 변경 요청에는 CSRF 헤더가 필요하며 누락·불일치는403이다.

FE는 동일 출처(`/api/...`)로 쿠키를 유지하여 호출한다. `X-Demo-User-Id`로 직원을 지정할 수 없다. dev 쿠키는 HttpOnly·Secure·SameSite=Lax이며 HTTPS에서 사용한다. local은 loopback HTTP 테스트를 위해 Secure=false다. CORS 임의 개방은 하지 않는다. 프록시가 Cookie/Set-Cookie 및 CSRF 헤더를 전달해야 한다. 세션 유휴 만료는 실제 시간30분이며 API 서버 재기동 시 재로그인한다. 업무 시각을 과거로 설정해도 인증 만료 시간이 바뀌지 않는다. 다중 서버 세션 저장소는 시연 범위 밖이다.

- 직원 조회 API는 로그인한 STAFF/ADMIN에게 허용한다. 직접 조사 변경은 STAFF의 본인 담당 OPEN 사건만 허용한다. Alert 이관 명령의 목적지 편입은 §9.1을 유지하며 다른 담당자의 OPEN Episode에도 편입할 수 있다. 해당 Episode의 판정·이동 권한까지 얻는 것은 아니다.
- 업무 시각 변경·분석 등록/재개·시연 트리거는 ADMIN 전용이다. 관리자라는 이유로 다른 직원 사건을 수정할 수 없다.
- dev/local에서만 직원 API를 제공하며 prod가 포함된 프로파일은 차단한다. 은행 업로드 API의 기존 `X-Bank-Id` 경계와 상태 검사 엔드포인트는 직원 세션 인증과 별도다.
- 직원 역할은 STAFF/ADMIN이다. 기본 비밀번호를 제공하지 않고 초기화 전환 시 기존 계정 ID와 비밀번호 해시를 복원한다.

## 6. 감사 이력

`GET /api/v1/review/cases/{caseId}`의 history를 사용한다. 행은 `{eventId,action,comment,businessAt,recordedAt,actor}`다. businessAt은 업무 시각, recordedAt은 실제 저장 시각이다. REVIEW_START는 명시 명령이며 GET은 이력을 생성하지 않는다.

범위 변경·판정·편입·해제·종결은 변경 전후 근거를 이벤트 snapshot에 보존한다. 자동 편입은 추가 거래 ID·업무 시각·전후 버전을 comment에 표시하고 연결 이유는 저장 snapshot에 남긴다. 사용자 판정과 모델 결과는 서로 덮어쓰지 않는다. 공개/범위/요약/이력/수신자 저장은 같은 트랜잭션이다.

## 7. 대시보드

### 조회 계약

- `GET /api/v1/dashboard/summary?from=2023-09-01&to=2023-09-10`: 작은 카드/차트 요약. 로그인 STAFF/ADMIN, 본인 지표는 인증 사용자 기준이다. 기존 `GET /api/v1/dashboard`는 제거했다. 이번 웹 앱 API 어댑터는 아래 계약에 연결했다. 이전 웹 앱 빌드는 호환되지 않으므로 함께 갱신한다.
- from/to 필수, KST 포함 날짜, from<=to 및 최대2년. 같은 응답의 businessAt은 하나다. 업무시각(시연 포함)과 실제 집계 실행시각을 혼동하지 않는다.
- 정상200, `Cache-Control: private, no-store`. ETag/304, 차분 응답, SSE/WebSocket은 없다. GET은 집계/변경 명령을 실행하거나 아직 진행 중인 집계를 기다리지 않는다.
- `businessAt`: ISO timestamp. `range`: `{from,to}` 날짜. `pipeline`/`investigation`: 각각 `{computedAt,data}`. computedAt은 실제 마지막 성공 집계 시각이고 원본의 최신 커밋까지 처리했다는 뜻은 아니다. 첫 공개가 없을 때만 두 필드가null이다. 원래 데이터가 빈 DB는 정상0으로 초기화한다. 이미 성공한 값은 재집계 중에도 제공한다. 화면에 ‘갱신중’ 표시나 상태 확인 후 별도 과거값 조회를 요구하지 않는다.
- 모든 필드는 명시적 DTO이며 camelCase다. 각 data 객체의 필수 필드는 다음과 같다. 건수는 비음수 정수, 빈 범주/유형은 빈 배열, 표본 없는 평균은null이다.

| 경로(data 내부) | 의미·타입·기간 |
|---|---|
| pipeline.detection | `{received,analyzed,suspicious,deliveryDates}`. 오늘 분석 대상 거래일의 수신/통합 수, 그중 오늘 완료된 최신 유효 점수가 있는 거래, 그중 이진 의심 수. deliveryDates는 YYYY-MM-DD 배열. 선택기간 무관 |
| pipeline.pendingReports | deliveryDates에 속한 미완료 보고 수. 선택기간 무관 |
| pipeline.agreements | `[{agreement,count}]`. STRONG/ATYPICAL/PATTERN_ONLY/WEAK, 최신 유효 점수의 탐지 업무일이 선택기간 안인 거래. 미분석 제외 |
| pipeline.types | `[{type,count}]`. 위 기간의 이진 의심 거래의 유형별 수. Alert 개수가 아님 |
| investigation.personal | `{pending,aged,closed}`. 본인 현재 OPEN, 배정 후 정확히72시간 이상 OPEN, 본인 담당이며 본인이 기간 내 종결한 사건 |
| investigation.institution | `{alerts,episodes,aged,today,yesterday}`. 현재OPEN Alert/Episode, 전체OPEN 중72시간 이상, 오늘/어제 생성 Alert |
| investigation.openAlertsAgedOver3Days | OPEN Alert만 배정 후72시간 이상. 기간 무관 |
| investigation.daily | `[{date,incoming,completed}]`. Alert 생성/종결 업무일별 수. 0건 날짜 포함, 날짜 오름차순 |
| investigation.dailyAlertStatus | `[{date,pending,inProgress,done}]`. 최초 생성일별 현재 Alert 상태, 날짜 오름차순·0건 날짜 포함 |
| investigation.episodeWork.current | `{open,aged,unreviewed,createdToday,closedToday}`. 현재/오늘, 선택기간 무관 |
| investigation.episodeWork.firstReview | `{samples,averageSeconds}`. 선택기간의 최초 검토, 표본0이면 평균null |
| investigation.episodeWork.completion | `{samples,averageSeconds}`. 선택기간의 종결, 표본0이면 평균null |

지표 불변식:
- dailyAlertStatus.pending은 Episode 소속 없는 OPEN Alert, inProgress는 OPEN Episode 소속, done은 직접 종결 또는 CLOSED Episode 소속이다. 각 날짜 상태의 합은 같은 날짜 daily.incoming과 같다. 근거 버전·거래·Episode 수를 세지 않는다.
- daily.completed는 종결일 기준이며 같은 날 생성된 사건의 종결만 세지 않는다. 상태 차트는 과거 시점의 판정 이력을 복원한 것이 아니라 마지막 공개 집계의 현재 상태다.
- STRONG=이진 의심+패턴 있음, ATYPICAL=이진 의심+패턴 없음, PATTERN_ONLY=이진 정상+패턴 있음, WEAK=이진 정상+패턴 없음. 유형0은 패턴 없음. agreements 합이 분모이고0이면 데이터 없음이다. 누락 범주를 표시할 때0으로 채울 수 있다.
- PIPELINE은 거래/모델·대상 거래일·보고 집계를 같은 스냅샷에서 갱신한다. INVESTIGATION은 별도로 공개한다. 두 영역의 원본 반영 시각이 동일하다는 보장은 없다. 조회 중 원본 거래/점수/큰 근거 JSON 재계산은 하지 않지만, 준비된 집계의 선택기간 합산과 업무시각/72시간 조건 계산은 수행한다.

### 분리된 목록

- `GET /api/v1/dashboard/activities?from=...&to=...`: 본인 최근20건, businessAt 내림차순·eventId 내림차순. `[{eventId,caseId,action,comment,businessAt}]`. ID는 문자열, 시각은ISO timestamp. 요약에 활동 본문을 포함하지 않는다.
- `GET /api/v1/dashboard/queues`: `{businessAt,priority,oldestOpen}`. priority는 본인OPEN 최대10건 위험도 내림차순·생성시각·ID순, `[{caseId,kind,alertId,createdAt,risk}]`. oldestOpen은 현재OPEN Episode 최대20건 배정순·ID순, `[{caseId,assignee,ageSeconds,awaitingReview}]`. ID는 문자열이며 Episode의 alertId는null이다. 최초 계약과 같은 직원 조회 범위를 유지한다.
- 두 목록도 인증과 no-store/조회 기한을 적용한다. 목록·상세 갱신 주기를 요약의1초에 자동으로 묶지 않는다. 새 프런트 소비 시 별도 주기를 결정한다.

### 1초 조회 소비자 규칙

- 최초 진입 즉시 조회, 이후1초 차례마다 같은 키의 진행 중 요청이 없을 때만 조회한다. 진행 중이면 차례를 버리고 큐에 쌓지 않는다. 응답 본문·해석·검증 완료까지 진행 중이다. 예:0초 시작/2.4초 완료면1·2초 생략/3초 재요청이다.
- 수동 버튼은 진행 중 요청을 공유한다. 조회조건/로그인 사용자가 바뀌면 이전 요청 취소를 시도하고 키·세대가 다른 늦은 응답/finally를 무시한다. 숨겨진 탭·오프라인에서 신규 요청 중지, 복귀 시1회 재조회, 로그아웃 시 캐시 삭제다.
- 클라이언트 전체 기한은5초를 초기 계약으로 한다. 네트워크/5xx 실패 후2→4→8→16→30초 상한과 작은 무작위 지연으로 재시도, 성공 시1초로 돌아온다. Retry-After보다 이른 수동/자동 재시도는 하지 않는다.401은 로그인 복구 전 중지,403은 접근 중지,400은 조건 수정 전 중지다.
- 성공값이 있으면 다음 응답까지 유지한다. 첫 조회 실패나 지속적인 통신 장애는0으로 표시하지 않는다. 정상 집계 중 상태 배지는 요구하지 않는다. 현재 웹 앱 대시보드 요약은 이 1초 조회 규칙을 적용한다. 기존 카드·차트·문구·배치는 유지하며 수동 버튼은 진행 중 요청을 공유한다. 업무 목록·고위험 건수 등 별도 요청과 다른 페이지의 자동 주기는 이번 변경 대상이 아니다.

### 서버 기한·집계 실행·오류

- 인증/권한 확인 이후 대시보드 DB 읽기는 전용 최대4연결 풀을 사용한다. 풀 연결 대기 최대750ms, 읽기 전체 예산3초다. 같은 읽기 전용 REPEATABLE READ 스냅샷으로 조회하고 detached DTO를 반환한다. 예산 초과 시 실행 SQL에 취소를 보내고 연결을 종료한다. 취소 전파/연결 정리 시간은 추가될 수 있다. 인증·프록시·JSON 직렬화·인터넷 전송까지3초 안이라는 보장은 아니며 클라이언트5초 기한과 구분한다.
- 읽기 시간 초과/연결 부족은503 `DASHBOARD_READ_TIMEOUT`/`DASHBOARD_READ_UNAVAILABLE`, `Retry-After: 2`. 정상 빈 결과와 구분한다. 입력 오류400·로그인401·권한403은 §0/§5를 따른다. 요청 제한 계층이429를 반환하면 같은 재시도 규칙을 따른다.
- `DASHBOARD_REFRESH_DELAY_MS` 기본5000: 경량 확인과 실제 집계는 별도 실행기다. 확인 자체는1초 예산이며 늦어진 확인 차례를 몰아서 실행하지 않는다. 영역당 실행/예약 최대1개, 전체집계 작업자2개다. 다른 API 인스턴스는 DB advisory lock으로 동일 영역 중복 실행을 막는다.
- 같은 영역이5초를 넘으면 다음 확인에서 건너뛴다. 집계 중 발생한 변경은 DB에 남아 완료 후 다음 확인에서 처리한다. 집계와 처리한 요청 삭제는 원자적이다. 실패하면 기존값/요청 유지, 실패 후5→10→20→40→60초 상한으로 해당 영역만 재시도한다. 새 변경으로 대기 시간을 우회하지 않는다.
- 집계 트랜잭션 제한120초, 개별문장110초/잠금2초. 이는 실행 제한이며 완료 성능 보장이 아니다. 큐 대기 없는 데이터 반영은 대략5초 확인 대기+집계시간+다음 화면조회 대기+HTTP/렌더시간이다.
- 조회 GET이 빠른 것, 원본 반영이 빠른 것, 일별 전송/분석6시간 달성은 별도 검증 대상이다. 운영 상태는 ops.dashboard_refresh_state 및 dashboard_dirty로 감시하며 사용자 화면에 내부 실패 원문/SQL/시크릿을 노출하지 않는다.

## 8. 거래 탐색

소유주→계좌→거래를 한 화면에 배치하되 선택에 따라 아래 세 목록을 각각 조회한다. 

```http
GET /api/v1/ledger/owners?from=2023-09-01&to=2023-09-10&page=0&size=20
GET /api/v1/ledger/accounts?from=2023-09-01&to=2023-09-10&owner={ownerId}&page=0&size=20
GET /api/v1/ledger/transactions?from=2023-09-01&to=2023-09-10&account={accountId}&page=0&size=20
```

**dev/local 로그인 필수**이며 prod 포함 프로파일은 차단한다. 세션 쿠키로 인증하며 X-Demo-User-Id는 사용하지 않는다.

| 쿼리 | 현행 동작 |
|---|---|
| from, to | 각각 선택값, YYYY-MM-DD KST 거래 발생일. 둘 다 있으면 from≤to. from00시 이상/to 다음날00시 미만. 서버 최대 기간 제한은 현재 없음 |
| owner, account | 선택 가명 UUID. 위 예시처럼 선택 단계에 전달 |
| judgement | 복수 허용: SUSPICIOUS,NORMAL,UNANALYZED. 사람 판정이 아닌 최신 유효 모델 점수 기준 |
| payments | 복수 결제 수단, 최대30개. `/api/v1/review/payment-formats`의 실제 값 사용 |
| query | 최대200자. 가명 표시명/번호·UUID·거래 ID 부분 검색 |
| directions | IN/OUT 복수, account 선택 필수. 같은 계좌 송수신도 중복 반환하지 않음 |
| page, size | page≥0, size1~200. 기본0/20 |

복수값은 `judgement=SUSPICIOUS&judgement=NORMAL`처럼 반복 전달할 수 있다. 같은 종류는 OR, 다른 필터는 AND. 세 목록에 동일 기간·판정·결제 필터를 전달해야 상위 목록도 조건에 맞는 거래가 있는 항목만 보여준다. 서버 필수 기간으로 바뀐 것은 아니지만 FE에서는 기본 기간을 지정해 조회하는 것을 권장한다.

모든 응답은 `{content: [...], page, size, totalElements, totalPages}`다. owners/accounts는 id순, transactions는 occurredAt 내림차순·txId순. sort 파라미터는 지원하지 않는다. 빈 결과는200+빈 content, totalPages=0이다.

| 목록 | content 항목의 실제 필드 |
|---|---|
| owners | `{id: UUID, name: string}`. name은 통합 때 저장한 가명 표시명 |
| accounts | `{id: UUID, ownerId: UUID, ownerName: string, bankId: number}` |
| transactions | 아래 필드 표 참조 |

| 거래 필드 | 타입·의미 |
|---|---|
| txId | number, 거래 ID |
| occurredAt | timestamp, 거래 시각. txAt이라는 키가 아님. 오프셋을 해석해 KST 표시 |
| fromAccountId, toAccountId | UUID string, 송·수취 가명 계좌 |
| fromOwnerId, toOwnerId | UUID string, 송·수취 가명 소유주 |
| fromOwnerName, toOwnerName | 통합 시 저장한 가명 소유주 이름 |
| fromBankId, toBankId | number, 은행 코드 |
| amountPaid, amountReceived | number, 송금액·수취액 |
| amountUsd | number, 원장에 저장된 USD 환산액 |
| alertIds | number[], 현재 조사 구성에 포함된 원본 Alert ID. 중복 제거·오름차순, 없으면 [] |
| episodeIds | number[], 현재 조사 구성에 포함된 Episode의 caseId. 중복 제거·오름차순, 없으면 [] |
| paymentCurrency, receivingCurrency | string, 각 금액의 통화 |
| paymentFormat | string, 결제 수단 |
| launderingScore, threshold | number 또는 null, 이진 점수·해당 분석 임계값 |
| isSuspicious | boolean 또는 null. 미분석은 null이며 false로 바꾸지 않음 |
| typeClass | number0~8 또는 null, 패턴 최다 확률 코드 |
| typeName | string, 점수 있을 때 제공. 코드0은 NON_PATTERN. 미분석에서는 키가 없을 수 있음 |
| probabilities | 9개 원소 배열, 코드0~8 순서. 미분석은 null 원소 배열이며0점 배열이 아님 |
| judgement | SUSPICIOUS / NORMAL / UNANALYZED |

최신 유효 점수는 완료된 분석/유효 run 기준이며 미완료 결과를 노출하지 않는다. 수신·통합 ACTIVE 원장의 정상·의심·미분석을 모두 조회한다.

소유주는 통합 시 저장한 `이름#번호` 가명을 반환한다. 번호는 최소5자리이며 초과 자릿수는 유지한다. 이름으로 개체를 병합하지 않고 전체 UUID로 선택·필터한다. 계좌 UUID는 원문 계좌번호가 아니다.

**소속 의미:** 조사 구성의 SUBJECT와 CONTEXT를 모두 포함한다. EXCLUDED/TRANSFERRED 거래는 해당 사건의 소속 배열에서 제외한다. 전체 편입은 원본 member를 TRANSFERRED로 바꾸지 않으므로 해당 거래는 원본 alertIds와 목적지 episodeIds 양쪽에 나타난다. 정상·의심 DECIDED 및 CLOSED 사건은 제외하지 않는다. 아직 저장된 조사 범위가 없는 Alert는 최신 완료 근거를 사용한다. OPEN의 새 거래는 공개 트랜잭션에서만 편입한다. GET이 거래를 추가하지 않으며 직원 제외를 자동 복구하지 않는다. 정정으로 현재 공개 근거에서 빠진 거래와 병합 원본은 현재 소속에서 제외한다. CLOSED의 저장 범위에는 새 근거를 추가하지 않는다. 미완료 분석의 근거는 사용하지 않는다. 원본 Alert 출처 이력과 현재 소속은 다르며 과거 이력 전체를 이 배열에 넣지 않는다.

alertIds는 원본 alertId, episodeIds는 kind=EPISODE인 caseId다. Alert caseId는 alertId와 같고 Episode caseId는 episodeId다. 원문 계좌번호는 반환하지 않는다.

## 9. 조사 범위와 명령

### 9.1 조회·명령 계약

다음 API는 **dev/local 서버 세션 인증**을 사용한다. 접근·권한·CSRF는 §5를 따른다. 직원 식별 헤더는 사용하지 않는다. 사건 ID는 kind와 함께 해석한다. Alert caseId=alertId, Episode caseId=episodeId다.

| 요청 | 입력 / 응답 |
|---|---|
| GET /api/v1/review/cases | kind=ALERT/EPISODE 필수; status=OPEN/CLOSED,assigneeId,from,to(생성 업무일),query,types,minAgeDays,risk,statuses,assignees,page,size. 위험도·생성 시각·caseId 내림차순 |
| GET /api/v1/review/cases/{caseId} | caseId,kind,alertId,status,outcome,revision,assigneeId/Name,createdAt,assignedAt,closedAt,groups,summary,pendingCount,sourceAlertIds,primaryTypes,history,relatedDecisions |
| GET /api/v1/review/account-nodes | ids=가명 계좌 UUID 목록. 소유주 박스/계좌 노드 연결용; 원문 이름·계좌번호 제외 |
| GET /api/v1/review/payment-formats | 원장에 존재하는 결제 수단 목록 |
| POST /api/v1/review/commands | 로그인 세션·CSRF 헤더와 아래 명령. 성공 200; 동일 요청 재전송은 저장 응답 재사용 |

목록과 상세의 공통 필드는 `caseId,kind,alertId,status,outcome,revision,scopeRevision,assigneeId,assigneeName,episodeId,createdAt,assignedAt,closedAt,ageDays,pendingCount,sourceAlertIds,primaryTypes,summary`다. Alert에는 `publishedVersion,reviewStartedAt,canonicalAlertId,resolution`이 추가된다. **목록 summary는 `txCount,subjectCount,seedCount,riskScore,primaryType,totalAmountUsd,amountsByCurrency,firstTxAt,lastTxAt`만 제공한다.** SQL에서 이 필드만 추출하며 거래·계좌별 집계·근거·이력은 목록 응답에 포함하지 않는다. 상세는 선택한 caseId의 전체 summary 및 groups/history/relatedDecisions/detachments와 Alert의 pendingProposalIds/relations/withdrawnMembers를 추가로 제공한다. relations의 키는 source_alert_id,target_alert_id,kind,event_id다.

**검색·필터**
- 검색·필터는 서버에서 적용한 뒤 `totalElements`와 페이지를 계산한다. 현재 페이지 20건만 검색하지 않는다.
- 사건 `query`: 최대 200자. Alert 원본 `A-{alertId}` / Episode `E-{caseId}`, 담당자 표시 이름, 대표 유형의 부분 문자열 검색. `%`, `_`는 와일드카드가 아니라 문자로 취급한다. 두 ID의 의미를 바꾸지 않는다.
- 사건 `types`: 반복 전달하는 대표 유형 이름. `Fan-out`, `Fan-in`, `Gather-scatter`, `Scatter-gather`, `Cycle`, `Random`, `Bipartite`, `Stack`, `패턴 미특정`, `혼합`. Alert는 제외된 거래를 빼고 현재 상세와 같은 씨앗 투표 결과를 사용한다. Episode는 유효 구성의 출처 Alert 유형 중 하나가 일치하면 포함한다. `패턴 미특정`을 거래 모델의 코드 0과 동일한 판정으로 해석하지 않는다.
- `statuses=OPEN&statuses=ESCALATED`: 화면 상태의 OR 조건. 편입된 Alert는 ESCALATED, 미편입 사건은 OPEN/CLOSED다. 기존 단일 `status`와 함께 보내면 AND로 적용하므로 FE는 중복 지정하지 않는다.
- `assignees`: 담당자 ID 반복 전달, OR. `minAgeDays`: 사건 생성 업무 시각부터 경과한 일수(0~36500). 배정 후 72시간을 세는 대시보드 카드와 기준이 다르다.
- `risk`: `high`(0.8 이상), `medium`(0.5 이상·0.8 미만), `low`(0.5 미만). 복수는 `high,medium`처럼 쉼표로 전달하여 OR 적용한다. 필터 종류 사이는 AND다.

명령 본문:

```json
{
  "requestId": "UUID",
  "action": "TRANSFER",
  "selections": [
    {"caseId": 1, "revision": 1000001, "groupId": 0, "txIds": []},
    {"caseId": 2, "revision": 1, "groupId": 0, "txIds": []}
  ],
  "targetCaseId": null,
  "targetRevision": null,
  "targetGroupId": null,
  "decision": null,
  "comment": "두 Alert가 연관된 시나리오로 판단되어 전체 편입"
}
```

- groupId와 revision은 GET 값을 그대로 전달한다. 최초 미저장 Alert 묶음의 0도 유효하다. Alert revision은 업무 개정과 완료 근거 버전을 결합한 불투명 값이다. 재계산하지 않는다.
- action: SUBJECT,CONTEXT,EXCLUDE,DECIDE,TRANSFER,UNLINK,RECONSIDER,COMMENT,REVIEW_START,CLOSE. SPLIT/MOVE는 409로 거절한다.
- **Alert 정상/단독 의심 종결:** `action=CLOSE`, `decision=NORMAL` 또는 `SUSPICIOUS`, `selections=[{caseId,revision,groupId:0,txIds:[]}]`. 사건의 제외되지 않은 SUBJECT 전체에 최종 판정을 적용하고 같은 요청에서 종결한다. 이전 범위 판정은 BEFORE_RESOLUTION 감사 스냅샷으로 보존한다. CONTEXT/EXCLUDED에는 판정을 전파하지 않는다. 대상이 없으면409.
- **새 Episode:** 예시처럼 `action=TRANSFER`, 서로 다른 본인 담당 OPEN Alert의 caseId 2개 이상. **기존 Episode:** Alert 1개 이상과 `targetCaseId`, GET에서 받은 `targetRevision`을 보낸다. targetGroupId/decision은 null이다.
- TRANSFER의 `txIds:[]`는 전체 Alert를 뜻한다. 명시적 거래 목록은 맥락·제외·기존 판정 포함 구성 거래 전체와 정확히 같을 때만 허용한다. 부분 목록은409, 중복 caseId는400. groupId는 전체 편입에서는 사용하지 않으며0으로 보낸다. 편입은 원본 Alert를 CLOSED/TRANSFERRED(Alert 근거 API의 status는 ESCALATED)로 종결하므로 별도 CLOSE를 보내지 않는다.
- TRANSFER 성공200: `{caseIds:[원본 조사 사건 ID...], targetCaseId:Episode 사건 ID}`. 일반 명령은 targetCaseId=null. 실패는 전체 롤백, 같은 requestId/본문 재전송은 최초 응답을 반환한다.
- 상세·목록의 `episodeId`는 Alert가 속한 Episode caseId 또는 null이다. Episode의 `sourceAlertIds`는 거래 제외/판정과 무관한 전체 소속 Alert ID 목록이다. Episode의 각 groups 항목은 하나의 Alert 편입 시점 범위이며 sourceAlertId로 원본 Alert를 식별한다(Alert 자체의 group에는 null일 수 있음). 편입된 원본 Alert도 구성 거래와 요약을 계속 조회할 수 있다.
- 초기 SEED/CONNECTION은 SUBJECT, CONTEXT는 참고 맥락이다. members에는 txId,reviewRole,state,decision,transaction,sources가 있다. 편입은 사건의 outcome으로 표현하고 원본 member 상태·판정은 보존한다. CLOSED 사건 pendingCount는0이다.
- **연결 거래 자동 추가:** 열린 Alert는 조사 착수 여부와 무관하게 같은 흐름의 새 거래를 분석 완료 시 자동 편입한다. 기존 거래의 판정·제외·직원 지정 역할은 유지하고 신규 거래만 PENDING으로 추가한다. GET은 범위를 바꾸지 않는다. 공개 버전과 사건 revision이 함께 바뀌므로 오래된 화면의 변경 요청은 기존 revision 검사로 충돌을 반환한다. 종결·Episode 편입 사건의 고정 범위는 이 동작으로 변경하지 않는다.
- **정정과 판정 보존:** 현재 `groups`·`summary`·거래 소속은 공개 버전에 남아 있는 거래만 포함한다. 정정으로 빠진 거래의 저장 판정·역할·당시 근거 버전은 변경하지 않으며, 상세의 `withdrawnMembers`에 `{txId,evidenceVersion,reviewRole,state,decision}`로 별도 제공한다. 미착수 근거 소멸은 자동 SCOPE_CLEARED, 조사 중에는 철회 제안 수락 후 SCOPE_CLEARED다. 정상 판정을 자동 생성하지 않는다.
- 자동 추가는 `ADDED_EVIDENCE` 이력과 담당자 알림을 한 번 기록한다. 이력의 `businessAt`은 업무 시각, `recordedAt`은 실제 저장 시각이며 `comment`에 추가 거래 ID·업무 시각·전후 근거 버전을 표시한다. 동일 근거 재실행은 버전·이력·알림을 추가하지 않는다. 조사 중인 여러 Alert의 병합, 기존 근거 제거 및 점수 재평가에 대한 제안은 거래 추가와 구분한다.
- **Alert 거래 제외:** `action=EXCLUDE`, `selections=[{caseId,revision,groupId,txIds:[거래 ID...]}]`, 필수 comment. 본인 담당 OPEN Alert의 PENDING 또는 DECIDED 거래를 선택한다(SUBJECT/CONTEXT 모두 가능). 원장·모델 근거를 삭제하지 않고 조사 member를 EXCLUDED로 바꾸며 이전 상태/판정은 BEFORE_EXCLUDE 이력에 보존한다. 제외 거래는 현재 요약·그래프·소속에서 빠진다. 이후 근거 갱신으로 자동 복구하지 않는다.
- **Episode Alert 연결 해제:** `action=UNLINK`, `selections=[{caseId:Episode caseId,revision,groupId:해제할 Alert 묶음 ID,txIds:[]}, ...]`. 한 요청은 한 Episode만 대상으로 하며 동일 groupId 중복·부분 거래 선택은400. targetCaseId/targetRevision/targetGroupId/decision은 모두 null. comment는 해제 사유(공백 제외 필수, 최대4000자). Episode 담당 STAFF만 요청할 수 있고 소속 Alert 담당자가 달라도 원래 담당자에게 복원한다.
- 해제 후 Alert 2개 이상이 남으면 선택 Alert만 해제한다. 2개 미만이면 **선택하지 않은 잔여 Alert도 모두 해제**하고 Episode를 `CLOSED / DISSOLVED`로 보존한다. 모든 해제 Alert의 조사 사건은 OPEN/outcome=null/closedAt=null, alerts는 OPEN/resolution=null, episodeId=null로 바뀐다. 원래 담당자·배정 시각·Alert 자신의 거래 제외/판정은 유지하며 Episode 판정을 Alert에 덮어쓰지 않는다.
- 해제·해체·Alert 복원·revision 증가·사유/구성/판정 스냅샷·멱등 응답은 하나의 트랜잭션이다. 정상·의심 종결된 Episode에서 UNLINK는409. 해체 사건은 다시 편입 목적지가 될 수 없다. 해제된 Alert는 새 Episode에 다시 편입할 수 있다.
- UNLINK 성공200: `{caseIds:[Episode caseId,복원 Alert caseId...],targetCaseId:null,dissolved:boolean,reopenedCaseIds:[복원 Alert caseId...]}`. 상세의 `detachments`는 `{eventId,action:UNLINK|DISSOLVE,comment,businessAt,snapshot}` 목록이다. Episode snapshot은 selectedAlertIds/removedAlertIds/groups(해제 당시 거래·판정·sourceAlertId)를 포함한다. 복원 Alert snapshot은 episodeCaseId/dissolved/groups다. 이력은 현재 소속이 아니다. 해체 후 groups/sourceAlertIds는 빈 배열이며 summary는 빈 현재 범위다. 자금 지표는 해체 시점 MONEY_SNAPSHOT을 반환한다.
- DECIDE는 NORMAL/SUSPICIOUS로 범위 판정만 저장한다. Episode는 해당 묶음의 미판정 SUBJECT 전체 선택이 필요하다. RECONSIDER는 OPEN Episode 묶음 판정을 다시 미판정으로 열며 이전 감사 기록은 보존한다.
- `CLOSE`에 decision이 없으면 기존 범위 판정을 집계해 종결한다. Episode는 이 방식만 허용한다. 미판정 SUBJECT/상충 판정은409. 업무 상태 OPEN/CLOSED, outcome NORMAL/SUSPICIOUS/TRANSFERRED/SCOPE_CLEARED/MIXED/DISSOLVED. DISSOLVED는 UNLINK에 따른 Episode 해체만 사용한다.
- 요청 UUID는 동일한 재시도에 유지한다. 같은 UUID의 다른 본문, 오래된 개정/근거, 처리 완료 범위, 닫힌 목적지 등은 409 INVALID_TRANSITION, 타 담당자/역할은 403 FORBIDDEN_ROLE, 형식/잘못된 선택은 400 계열 ProblemDetail이다. 화면은 재조회 후 범위를 다시 선택한다.
- review 목록·상세의 `summary.totalAmountUsd`: 현재 소속 전체 거래(SUBJECT+CONTEXT)에서 EXCLUDED/TRANSFERRED 제외·txId 중복 제거 후 저장 `amountUsd` 합계. Episode 내 여러 Alert에 겹친 거래는 한 번만 센다. 환산액 누락/잘못된 값이 하나라도 있으면 null, 거래가 없으면 0. 기존 `amountsByCurrency`의 SUBJECT 집계 의미는 유지한다. Alert·Episode 목록의 거래 총액은 이 필드를 소수 최대 2자리 USD로 표시하며 미제공 시 원통화 합계로 대체하지 않는다.
- 목록 summary는 위에서 명시한 기본 건수·위험도·대표 유형·금액·거래 기간만 제공한다. 상세 summary는 여기에 `typeShare,netFlows,topReceiverShare,topSenders,paymentFormats,dailySuspiciousCount,dailySuspiciousAmount,typeDistribution`을 더해 현재 범위의 상세 집계를 제공한다. 관련 사건 판정 relatedDecisions는 참조 정보이며 현재 결론을 덮지 않는다.

### 9.2 조사 계좌 기준 자금 지표

Alert/Episode 개요 공통. summary.amountsByCurrency는 기존 사건 SUBJECT 거래 합계로 유지하고, 아래 자금 지표는 **S와 T에 해당하는 수신 원장 전체**를 조회한다. 사건 밖 거래를 조회해도 사건 소속/판정에 추가하지 않는다. 기존 summary.netFlows/topReceiverShare는 구 소속 거래 요약이며 새 지표로 해석하지 않는다. 화면은 아래 money 응답만 사용한다.

OPEN 자금 조회는 읽기 전용 REPEATABLE READ 트랜잭션의 한 스냅샷을 사용한다. 수신·분석 공개용 잠금을 기다리지 않으며 조회 시작 후 커밋된 변경은 다음 조회에 반영된다. 범위 수정·종결·공개 쓰기의 기존 잠금과 원자성은 유지한다.

**live 개요 카드 표시:** Alert는 외부 유입액·거래 총액·순유입·근거 거래·의심 거래 참여 계좌·거래 기간의 6개, Episode는 참여 계좌 카드를 제외한 5개다. 외부 유입액/순유입은 money.external의 in/net을 통화별로 표시하며, 프로토타입의 추정 ‘투입 원금’ 또는 대표 계좌 순유입과 구분한다. 산출 대기/조회 실패는 0으로 표시하지 않는다. 카드의 거래 총액은 상세 groups.members에서 EXCLUDED/TRANSFERRED를 제외하고 txId로 중복 제거한 **전체 현재 소속 거래(SUBJECT+CONTEXT)**의 amountPaid를 paymentCurrency별로 합산한다. 이는 기존 summary.amountsByCurrency의 SUBJECT 합계와 다르며 기존 응답 의미는 유지한다. 근거 거래는 같은 집합의 거래 수, 참여 계좌는 그 송·수취 계좌의 고유 수(정상 분류·맥락 거래 포함, 계좌 자체의 세탁 판정 아님), 거래 기간은 첫~마지막 occurredAt을 KST 시·분으로 표시한다. Episode의 여러 Alert에 겹친 거래는 한 번만 센다.

- S 초기값: 현재 사건에서 제외/이관되지 않은 SEED 거래의 송·수취 계좌. 담당자가 가명 계좌를 추가/제외할 수 있고 직접 설정 후에는 해당 선택을 유지한다. 새 Episode의 자동 초기값도 이관받은 범위의 씨앗 기준이며 씨앗이 없으면 계좌 선택이 필요하다.
- T: 현재 SUBJECT 거래의 첫날00시~마지막날 다음00시(KST). 사전 등록 은행의 current ACTIVE 보고가 모두 있는 연속 날짜까지만 관측한다. 첫날부터 미완료면 산출 대기, 중간 미완료면 그 전 날짜까지 계산한다. 업무 시각의 당일·미래는 완료 날짜로 보지 않는다. 마지막 거래 시각을 수신 완료 시각으로 추정하지 않는다.
- 외부 유입=송금 계좌∉S, 수취 계좌∈S의 수취액. 외부 유출=송금 계좌∈S, 수취 계좌∉S의 송금액. 각각 해당 통화 사용. 순유입=외부 유입−외부 유출. S 내부 이체 제외.
- 계좌 순유입=in−out, 내부 이체 포함. 집중도=max(in−out,0)/같은 통화에서 S 내 양의 순유입 합계×100. 분모0은 null(화면 ‘산출 불가’). 실제 잔액 비중이 아니다.
- 단시간 유출은 계좌·통화별 FIFO 추정. 출금은 앞선 입금의 잔여액부터 한 번만 소진하며 Δt를 지난 입금도 먼저 소진한다. 대응 입금 중 입금+Δt≤T 종료인 것만 분모/분자에 포함한다. 분자=Δt 이내 대응액, 분모=평가 가능 입금액. 관측 끝의 미성숙 입금은 excludedIn으로 별도 제공한다. 잔액을 모르는 기간 시작점부터의 추정이지 동일 자금 추적 사실이 아니다.
- 같은 시각의 거래에는 순서 근거가 없어 출금 먼저 처리한다. 자기 계좌 이체는 순유입 집계에는 반영하지만 FIFO 평가에서는 제외한다. 반복 거래는 서로 다른 tx_id면 보존하며 이중 보고/복수 소속은 한 거래로 센다. 환산 없이 통화를 합치지 않는다.
- 초기 Δt=180분. 비교 선택 5/15/30/60/180/360/1440분. 탐색용 시간 범위이며 정상/세탁 판정 임계가 아니다.

`GET /api/v1/review/cases/{caseId}/money?minutes=180` (dev/local 로그인 필수):

- selectedAccounts,candidateAccounts,customScope,revision,delayMinutes,requestedFrom/To,observedAt(실제 조회시각).
- available=false이면 reason=EMPTY_SUBJECT_SCOPE/EMPTY_ACCOUNT_SCOPE/WAITING_RECEIPTS/NO_CLOSED_SNAPSHOT이며 비율을0으로 만들지 않는다.
- available=true이면 start,endExclusive,complete,ledgerCount,method=FIFO_ESTIMATE,external[],accounts[].
- externalUsd: {in,out,net}은 동일 S/T의 USD 보조 합계다. 외부 유입은 각 거래 amount_received를 거래 fx_rate_version의 receiving_currency 환율(units_per_usd)로 나누고 소수6자리 반올림 후 합산한다. 외부 유출은 원장의 amount_usd 합계, 순유입은 in−out이다. 내부이체는 제외한다. 필요한 수취 환율이 없으면 in/net은 null이며 부분합을 완전 합계로 표시하지 않는다. 실시간 환율이 아니다. 종결 스냅샷에 함께 보존되며 스냅샷에 값이 없으면 null 의미를 유지한다.
- 외부 유입액·거래 총액·순유입 카드의 원통화 값 아래에 작은 USD 값을 추가한다. 총액 USD는 원통화 총액과 동일한 현재 소속 거래(SUBJECT+CONTEXT, EXCLUDED/TRANSFERRED 제외)를 txId로 중복 제거한 amountUsd 합계다. 환산값 미제공은 `USD 환산액 미제공`으로 표시한다.
- external 행: currency,in,out,net. accounts 행: accountId,currency,in,out,net,positiveNet,concentrationPercent,eligibleIn,excludedIn,matchedIn,rapidOutflowPercent. 비율은0~100 또는 null이다.

`POST /api/v1/review/cases/{caseId}/money-scope`:

```json
{"requestId":"UUID","revision":1000001,"accounts":["가명 계좌 UUID"],"comment":"조사 중심 계좌 조정"}
```

로그인 세션·CSRF 헤더 필수. 본인 담당 OPEN 사건·기대 revision·실재 가명 계좌를 검증한다. accounts는 최대1000개, 빈 배열은 빈 S를 명시한다. 멱등 요청은 review.requests를 사용하고 MONEY_SCOPE 이력·사건 개정과 원자 저장한다. 상태/HTTP 오류 원칙은 §9.1과 같다.

종결할 때 180분 지표를 MONEY_SNAPSHOT 이벤트에 저장하며 이후 수신/원장 정정에도 바꾸지 않는다. CLOSED 조회는 minutes와 무관하게 그 스냅샷을 반환한다. 과거 종결 사건에 기록이 없으면 현재 원장으로 과거를 재구성하지 않는다. 원문 정보/정답 라벨은 조회·계산에 사용하지 않는다.

## 10. 시연 제어와 초기화

### 10.1 시각·직원·분석

- GET /api/v1/demo/clock → businessAt,configured,revision.
- POST /api/v1/demo/clock → {businessAt,revision}. ADMIN·CSRF, 진행 작업·개정·역방향 검사. 업무 날짜를 바꾸며 인증·수신 cutoff·실행 타임아웃은 실제 시각을 유지한다.
- GET /api/v1/demo/users → id,name,role. 목록으로 로그인 신원을 바꾸지 않는다.
- POST /api/v1/demo/analysis는 §1.2의 날짜순 분석 계약을 따른다.

### 10.2 데이터 초기화

**ADMIN 서버 세션 전용**, 변경 요청 CSRF 필수. dev/local에서만 허용하고 prod 혼용은403이다. 배포 자체는 데이터를 지우지 않는다. 관리자의 확인된 POST 요청만 삭제를 실행한다.

| 요청 | 계약 |
|---|---|
| GET /api/v1/demo/reset/preview | `{counts:{테이블명:건수},snapshot,clock}`. `snapshot`은 초기화 대상 건수·최신 jobId·업무 시각 revision의 확인값 |
| POST /api/v1/demo/reset | `{requestId:UUID,snapshot,confirmation:"시연 데이터 초기화"}`. 응답200은 **DB 초기화 접수 결과**이며 파일 정리까지 완료했다는 뜻이 아님 |
| GET /api/v1/demo/reset/latest | 최신 접수 상태. 기록이 없으면 `{status:"NONE"}` |
| GET /api/v1/demo/reset/{resetId} | 접수 상태 |
| POST /api/v1/demo/reset/{resetId}/cleanup | 본문 없음. 남은 대상 하나의 파일 정리 실행. 추론 디렉터리는 최대100개 객체씩 삭제하고 다음 호출에서 남은 목록 확인. 응답 상태를 보고 계속/재시도 |

상태 응답: `{resetId,status,databaseReset:true,totalTargets,remainingTargets}`. status는 FILES_PENDING·FILES_FAILED·COMPLETED. targets는 업로드 객체 또는 추론 요청 디렉터리 수이며 개별 파일 수와 다를 수 있다. 진행률은 `(totalTargets-remainingTargets)/totalTargets`. DB 초기화는 완료됐지만 파일 정리가 실패하면 FILES_FAILED이며 성공으로 표시하지 않는다. 파일 정리 API는 멱등이며 새 DB 초기화를 실행하지 않는다.

DB 원자 범위: receipt 잠금·명시 테이블 잠금 → 대상 확인 → 파일 정리 대상/접수 기록 → 허용 목록 TRUNCATE RESTRICT CONTINUE IDENTITY → 업무 시각 null·revision 증가. 예상 밖 FK가 생기면 전체 롤백하며 CASCADE로 범위를 늘리지 않는다. 동일 ADMIN의 같은 requestId 재요청은 기존 결과를 반환하고 이후 들어온 데이터를 삭제하지 않는다. 초기화 접수 기록은 삭제 대상에서 제외한다.

삭제 범위: 보고·정정·통합·가명 계좌/소유주·거래·분석 입력/점수/피처/작업·Alert/조사 사건/이력·평가 라벨·대시보드 집계/갱신 요청. 파생 집계는 preview 건수/확인값에서 제외하되 원본과 같은 초기화 트랜잭션에서 비운다. 보존: users, banks, bank_reporting_periods, fx_rates, 스키마·Flyway, 초기화 기록. 원본 CSV는 서버가 접근하지 않으며 변경하지 않는다. ID 시퀀스도 유지한다.

파일은 DB 커밋 후 별도로 정리한다. 현재 설정의 환경 접두어 아래 기록된 `uploads/{bank}/{job}/{file}` 및 `requests|results/{job}/{BINARY|TYPE}/{requestId}/`만 허용한다. 추론 publication 목적지나 파일 정리 재시도 시 저장소가 달라졌으면 삭제하지 않는다. 과거 S3 버전·기록되지 않은 고아 파일·다른 환경은 대상 밖이다. 파일 대상/저장소 경로·원시 S3 오류·토큰은 상태 API에 노출하지 않는다.

| 오류 코드 | HTTP | 의미 |
|---|---|---|
| RESET_CONFIRMATION_REQUIRED | 400 | 확인 문구·requestId·snapshot 누락 |
| RESET_PREVIEW_STALE | 409 | 조회 이후 삭제 대상 확인값 변경; 다시 preview |
| RESET_BUSY | 409 | 다른 DB 작업 사용 중, 실행/예약/재시도/수신 처리, 종료 미확인 추론 요청 |
| RESET_UPLOAD_URL_ACTIVE | 409 | 만료되지 않은 업로드 URL 존재; 실제 만료 후 재시도 |
| RESET_CLEANUP_PENDING | 409 | 이전 초기화 파일 정리 미완료; cleanup 재개 |
| RESET_STORAGE_CHANGED | 409 | 기존 추론 저장소와 현재 설정 불일치 |
| RESET_REQUEST_CONFLICT | 409 | 다른 관리자의 requestId 재사용 |

파일 정리 실패는 cleanup 응답의 FILES_FAILED로 구분한다. 새 초기화는 파일 정리가 끝날 때까지 거절한다. 패널도 파일 정리 중 새 전송/분석/시각 변경을 비활성화한다. 다른 클라이언트의 이후 신규 데이터는 이전 초기화에 포함되지 않으며, 기존 요청 재전송이나 cleanup으로 삭제하지 않는다.

## 11. 업무 알림

세션 STAFF/ADMIN은 본인에게 배정되거나 본인이 수신자로 기록된 알림만 조회한다. 병합으로 담당자가 달라져도 당시 양쪽 담당자의 알림을 보존한다. ADMIN도 기관 전체 알림으로 확장하지 않는다. 사용자 ID를 요청으로 받지 않는다. 브라우저 목업과 구분하며 실재하지 않는 검수 결과는 생성하지 않는다.

### GET /api/v1/notifications

- 선택 쿼리: `from`, `to`(YYYY-MM-DD, KST 업무 발생일, 양끝 포함), `query`(제목·본문·표시 코드 부분 검색, 최대200자), `page`(0부터), `size`(기본20, 1~100).
- 기간 생략 시 전체 업무 이력. 날짜 역전·잘못된 페이지/크기는400. 날짜는 조회 시각이 아닌 배정/행동의 업무 시각 기준이다.
- 응답: `{content, number, size, totalElements, totalPages, unreadCount}`. unreadCount는 같은 검색·기간의 전체 미확인 알림 수이며 현재 페이지에 한정하지 않는다.
- 행: `{id, kind, title, description, code, count, at, read, caseId, caseKind}`.
- `id`는 불투명 문자열. `at`은 KST ISO8601. `caseId`는 사건 종류에 따라 review.alerts.alert_id 또는 review.episodes.episode_id다. 공통 review.case_id 시퀀스로 중복을 방지한다. `caseKind`는 ALERT/EPISODE.
- 정렬은 업무 시각 내림차순, 동일 시각은 id 내림차순. 알림 하나가 여러 Alert를 나타내면 count>1이며 caseId=null이다. 배정1건도 분석 묶음 알림이므로 caseId=null일 수 있다.
- ALERT_ASSIGNED: 최초 증거(version1)의 분석 run과 담당자별 묶음. 분석 run·batch가 모두 COMPLETED인 건만 표시. 이후 같은 Alert의 증거 갱신은 새 배정 알림을 만들지 않는다.
- ADDED_EVIDENCE/MERGED/CHANGE_PROPOSED/FOLLOWUP_CREATED/EVIDENCE_WITHDRAWN은 공개 이벤트의 고정 수신자에게 제공한다. 동일 사건·공개 이벤트당 한 번이며 병합에 편입이 포함되면 MERGED 하나다.
- EPISODE_ASSIGNED: Episode 배정 이력. COMMENT/CLOSE/TRANSFER/UNLINK/DISSOLVE: 기존 조사 이벤트. 본인 행동도 본인 담당 사건 이력으로 표시한다. MONEY_SNAPSHOT 등 내부 저장 이벤트는 제외한다.
- 배정 표시 코드 ANALYSIS-{jobId}, 사건 코드 A-{alertId}/E-{caseId}. 현재 저장된 업무 이력을 조회하므로 기존 데이터도 제공되며 과거 알림 레코드의 별도 복제/전송은 없다.

### GET /api/v1/notifications/{id}/cases

본인이 소유한 알림에 연결된 사건 목록. 병합 알림은 대표 사건을 포함하며 대표의 현재 담당자가 다르더라도 당시 알림 수신자가 조회할 수 있다. page/size는 위와 동일. 응답 `{content:[{caseId,kind,alertId,status}],number,size,totalElements,totalPages}`. 묶음 알림은 해당 run에서 본인에게 배정된 Alert만 포함한다. 상세 화면 이동은 caseId 사용. 없는 알림과 다른 사용자의 알림은 동일404.

### POST /api/v1/notifications/read

CSRF 필요. `{ids: string[], read: boolean}`. 1~100개, 중복 ID는 한 번 처리. 모든 ID가 자기 알림인지 확인한 후 한 트랜잭션에서 적용한다. 타인/없는 ID 포함 시404, 전체 변경 없음. 응답 `{updated: 중복 제거한 ID 개수}`. 같은 읽음 처리는 멱등, read=false는 안 읽음 복구.

읽음 시각은 실제 서버 시각이며 업무 시각 조작의 영향을 받지 않는다. 로그아웃·브라우저 변경 후에도 계정별로 유지. UI의 일괄 처리는 현재 페이지의 미확인 ID만 전달하며 '현재 페이지 모두 읽음'으로 표시한다. 조회하지 않은 다른 페이지나 신규 도착 알림을 암묵적으로 읽음 처리하지 않는다.

`review.notification_reads`와 `review.notifications` 뷰를 사용한다. 시연 초기화는 읽음 기록도 제거하며 계정은 보존한다. FE live에서는 해당 API를 사용하고 mock 모드는 기존 목업을 유지한다. 5분 갱신·수동 갱신, 데이터가 없으면 빈 목록. WebSocket/이메일/푸시 전송은 포함하지 않는다.

### Episode 편입 알림 집계

TRANSFER는 Episode 측 이벤트 하나만 알림으로 제공한다. 같은 명령으로 저장된 원본 Alert별 TRANSFER 이력은 조사 이력으로 보존하되 알림에서 제외한다. TRANSFER 이력이 있는 Episode의 최초 EPISODE_ASSIGNED 알림도 별도로 노출하지 않는다. 따라서 새 Episode에 Alert5개 편입 시 편입 알림1건이며, 이후 추가 편입은 이벤트ID가 다른 별도1건이다. 시연 업무 시각이 동일해도 시간으로 합치지 않는다. Episode 담당자 범위는 유지한다. 기존 Episode 이벤트ID와 읽음 상태는 유지되고 기존 중복은 재조회부터 숨겨진다.
