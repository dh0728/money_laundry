# AML API 계약

현재 Spring 컨트롤러·서비스와 흐름 기반 Alert 생애주기 구현을 기준으로 한다. 요청·응답 이름은 실제 구현을 따르며, 구조는 [ERD](ERD.md), DB 컬럼·제약은 [단일 V1](src/main/resources/db/migration/V1__initial_schema.sql)을 참조한다. V1이 바뀌었을 때 dev DB를 다시 만드는 절차는 [배포 안내](../../deploy/split/README.md#dev-업무-db-재생성-초기-스키마-v1이-바뀐-경우)에 둔다.

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
- 일반 동일 파일 완료본은409 `DUPLICATE_FILE`, 진행 중은409 `UPLOAD_IN_PROGRESS`(단, URL이 아직 유효한 같은 파일명·기준일·크기 재요청은 발급 응답을 놓친 재시도로 보고 같은 `uploadId`·만료 시각의 URL을201로 다시 준다), 새 URL이 발급된 옛 번호는409 `UPLOAD_SUPERSEDED`다. 명시적인 correctionRequestId·correctionSubmissionId 제출만 별도 정정 문맥으로 접수한다. 일반 업로드는 기존 보고를 임의 교체하지 않는다.
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
- 취소 contract_version은 숫자2다. `INFERENCE_API_URL`(HTTPS 기본 주소)과 `INFERENCE_API_TOKEN`(추론 서버 INFERENCE_TOKEN과 같은 전용 토큰)을 함께 설정하면 Java 전달 담당이 `PUT /api/v1/inference-requests/{requestId}/rounds/{round}/cancellation`으로 기존 불변 취소 메시지를 보내고 같은 회차의 `GET`으로 상태를 조회한다. Bearer 인증을 사용하며 리다이렉트를 따르지 않는다. 접수 응답은 중단 완료가 아니다. job/run/model/request/round/cancel 전체 식별자와 contract_version을 대조한 뒤 `cancellation_status=STOPPED`와 `status=STOPPED`, 또는 `cancellation_status=ALREADY_FINISHED`와 `status=COMPLETED` 조합만 종료 확인으로 인정한다. RECOVERY_REQUIRED·미응답·404는 종료 확인이 아니다.
- 두 API 설정이 모두 없으면 기존 S3/local 취소 파일 전달을 유지한다. S3는 `requests/{job}/{model}/{request}/rounds/{round}/cancel.json` 조건부 불변 게시와 `results/.../cancel_ack.json` 조회를 사용한다. local은 storage-dir/analysis-transport에 원자 게시한다. API 설정 일부 누락은 기동 시 거절하며 API 전달 실패 시 파일 방식으로 우회하지 않는다. 기존 2스레드 TaskScheduler에서 Python 단계와 별도로 5초 스캔하고, outbox의 재시도 정책을 그대로 사용한다. 실제 EC2–KubeSphere HTTPS 통신은 별도 배포 검증 대상이다.
- 전달 실패는30초/2분 간격으로 총3회까지 게시를 시도하고 미확인은 계속 대기한다. 3회 후에도 늦은 ack는 조회하며 작업 상세 cancellations의 actionRequired로 게시 재개 필요를 알린다. 취소된 작업의 기존 resume API는 outbox 시도만 재개하고 취소 run을 계산 재개하지 않는다(응답 status는 FAILED 유지). 실제 S3 권한/외부 프로세스 중단은 이 로컬·SDK 대역 검증과 구별한다.
- 모델 요청은 TARGET ID(targets)와 재료(transactions: 고정 입력 거래 전체, accounts: 계좌별 엔티티 유형·은행 국가)를 함께 보낸다. Alert 구성은 달력 이동 탐색용 고정 CONTEXT도 사용한다. Python FEATURES→INFERENCE→SCORES→ALERTS가 연결되어 있으며 구체적인 Alert 정책은 §3.1을 따른다.
- 새 분석의 이진 모델은 `multi280_hgb36_v1/materials-v1`(팀원 Multi-FraudGT + HGB, 추론 서버가 재료에서 피처·그래프를 만든다), 유형 모델은 `demo-random-v1/demo-input-v1` 시연 변환기다. 이진 모델을 바인딩한 실행은 의심 기준을 모델 권장값 0.194997844로 기록한다. 시연 변환기의 입력은 TARGET의 `tx_id,demo_value`, 출력은 `tx_id,p_laundering` 또는 `tx_id,p_0,...,p_8`이다. 라벨·패턴 대응표를 읽지 않는다. 이진 값은 [0,1) 균등 난수, 유형 값은 9개 균등 난수를 합계1로 정규화한다. 거래 ID·모델 종류·버전별 seed로 재시도·순서·분할에 무관한 값을 만든다. 탐지 성능을 의미하지 않는다.

### 1.2 처리현황과 분석 제어
- **GET /api/v1/bank/uploads/{uploadId}** — 자기 은행만 조회. 다른 은행/없는 작업404. 응답은 `{uploadId,bankId,fileName,businessDate,sizeBytes,rowCount,insertedCount,missingCount,duplicateCount,status,errorCode,errorMessage,errors:[{row,column,reason}],urlIssuedAt,receivedAt,startedAt,finishedAt,integrationStatus,reportVersionId,correctionRequired,correctionRequestId,replacementUploadId,nextAnalysisDate}`다. `insertedCount`는 해당 보고에서 정상 통합 거래에 연결된 보고 행 수이며 통합 전에는0이다. 같은 내용 반복은 중복 오류가 아니므로 `duplicateCount=0`이다. `errors`는 자기 파일의 정제된 오류 최대100건이며 원문 식별정보를 포함하지 않는다. `finishedAt`은 보고 저장/검수 종료 시각이다.
- `integrationStatus`: `null`(보고 저장 전), `VALIDATED_WAITING_INTEGRATION`, `ACTIVE`, `PARTIALLY_HELD`(의존 보류와 독립 정상 행 공존), `HELD`(직접 오류 파일 전체 보류), `WAITING_COUNTERPART`(상대 후보 대기), `WAITING_ANALYSIS_RELEASE`(분석 해제 대기), `SUPERSEDED`(교체된 구 버전). 대표 사유는 `INVALID_SELF`, `IDENTITY_CONFLICT`, `PAYMENT_FORMAT_CONFLICT`, `COUNTERPART_MISSING`, `COUNTERPART_HELD`다. 기존 정상 DB와의 소유 충돌은 `INVALID_SELF_OR_CONFIRMED_IDENTITY`로 보류한다.
- **GET /api/banks/arrivals?date=** [로그인 STAFF/ADMIN] — **은행별 도착 현황**(수집·처리현황 화면의 중심): 보고 은행(`is_reporting`) 전부에 대해 `{ bankId, name, country, status: NOT_ARRIVED | URL_ISSUED | RECEIVED | RUNNING | COMPLETED | VALIDATION_FAILED | FAILED | EXPIRED, uploadId, fileName, rowCount, receivedAt, finishedAt }` 를 `banks` 배열에 담아 `{date,cutoffAt,remainingSeconds,arrivedCount,totalBanks,banks}`로 반환. `date` = 컷오프 기준일: 창은 (D−1 컷오프, D 컷오프], 기본값은 **다음 컷오프의 날짜**(지금 도착하는 파일이 속하는 창). 은행당 창 안 최신 업로드 1건.
- **GET /api/v1/batch-jobs** — 페이지 목록. `type=INGEST|ANALYSIS`, `status`, `from/to`(ISO-8601 Instant, 최초 startedAt 양끝 포함) 필터. jobId 내림차순. 행은 기존 작업 메타데이터와 `currentStage, stageAttemptCount, consecutiveFailures, retryAt, actionRequired, cutoffAt, completionReason, counters`를 포함한다. 미완료 분석의 의심 거래·Alert 카운터는0이다.
- **GET /api/v1/batch-jobs/{jobId}** — 위 행과 `uploads: [{ uploadId, excluded, status, fileName }]`, `failures: [{ stage, errorCode, failedAt, consecutiveCount, retryAt, actionRequired }]`.
  - `models: [{ modelKind, phase, status, requestId, executionRound, remoteStatus, remoteRevision, errorCode, actionRequired, retryAt, nextPollAt, remoteDeadlineAt, modelVersion, featureVersion }]`는 현재 run의 모델별 작업 상태다. 이전 run·토큰·서명 URL·로컬 경로·원격 응답 원문은 반환하지 않는다. 모델별 조치 필요 여부는 상위 작업의 FAILED 여부와 독립적이다.
  - INFERENCE 원격 대기는 상위 `RETRY_WAIT`로 재관측을 예약하며 실패 횟수를 올리지 않는다. 모델 하나가 실패해도 다른 모델의 상태 관측을 계속한다. 원격 대기 기한 초과/종료 불명은 조치 필요로 표시하고 새 요청 회차를 자동 생성하지 않는다.
  - 현재 연결은 직접 PUT 게시·GET 관측→COLLECT 파일 검증→두 모델 SCORES 저장이다. 원격 COMPLETED만으로 완료되지 않으며 크기/hash/버전/정확한 TARGET/확률 검증 후 모델 DONE/SUCCEEDED를 기록한다. 두 모델 수집 후 INFERENCE 완료, 점수와 거래 연결 및 SCORES 완료는 원자 저장한다. ALERTS는 준비 계획을 저장하고 Spring의 완료 트랜잭션에서 점수·Alert를 공개한다. 상태 확인은 GET 폴링을 사용한다.
- **POST /api/v1/batch-jobs/analysis** — 본문 없이 현재 업무 시각(업무 시계가 없으면 실제 시각)을 cutoff로 오늘의 새 분석만 등록한다.202 `{ jobId, status: "QUEUED" }`. 같은 날짜 진행중409 `JOB_ALREADY_RUNNING`, 완료409 `JOB_ALREADY_COMPLETED`, 실패409 `JOB_REQUIRES_RESUME`.

- 시각의 의미: 업무 의미가 있는 시각은 모두 업무 시각이다. 대상은 수신(`receivedAt`), 업로드 발급, 분석 기준(`cutoffAt`·`dataAsOf`), 작업·적재 시작/종료, 실패, Alert·버전·이벤트·커버리지 확인, 대시보드 갱신, 화면의 오늘이다. 업무 시각은 dev/local에서 시연 업무 시계(설정값 + 그 뒤 흐른 시간), prod 발표 모드에서 복사된 시계값, 그 밖에는 실제 시각이다. 실제 시각은 URL 만료·재시도·timeout 같은 운영 타이머(`retryAt`, `nextPollAt`, `remoteDeadlineAt`, `expiresAt`)에만 쓴다.
- 시연 업무 시각(`ops.business_clock.business_at`)이 설정되어 있으면 일반 분석 실행의 신규 등록은409 `INVALID_TRANSITION`으로 차단한다. 조작패널의 날짜 지정 분석을 사용한다. 실제 시각으로 울리는 일일 자동 예약은 dev/local에서 등록하지 않는다. 검사는 시연 시각 설정과 같은 수신 잠금 안에서 수행하며, 기존 작업의 처리·재시도·기동 복구는 유지한다. 시연 시계가 설정되지 않았으면 업무 시각이 실제 시각이므로 기존 등록과 같다. 이미 생성된 작업을 자동 삭제하거나 분석일을 변경하지 않는다.

- **POST /api/v1/demo/analysis** — dev/local 날짜순 시연 전용. ADMIN 서버 세션·CSRF가 필요하다. 본문 `{businessDate:"YYYY-MM-DD"}`는 전송한 과거 거래 기준일이다. 분석 구분 날짜는 그 다음 날, 수신 cutoff는 요청 시점의 업무 시각으로 기록한다. 수신 시각도 업무 시각이므로 cutoff 뒤에 수신된 보고는 이 분석에 들어가지 않는다. PC 시각·파일 내용을 변경하지 않는다. 응답202 `{jobId,status:"QUEUED"}`. 기존 WAIT_INGEST부터 실제 파이프라인을 실행하며 검수·통합·입력 고정·실패/재개를 건너뛰지 않는다. `dev` 또는 `local` 프로파일에서 허용하며 `prod`가 함께 활성화되면403 `DEMO_CONTROL_DISABLED`다. 날짜가 없거나 시연 업무 시각 기준 오늘/미래이면400 `INVALID_DEMO_DATE`. 이전 미완료 분석409 `DEMO_PREVIOUS_JOB_PENDING`, 이전 날짜로 역행409 `DEMO_DATE_OUT_OF_ORDER`, 뒤 날짜 수신 자료409 `DEMO_FUTURE_INPUT`, 해당 날짜 수신 자료 없음409 `DEMO_INPUT_REQUIRED`, 같은 날짜 완료409 `JOB_ALREADY_COMPLETED`. 본문에 `backfill:true`를 주면 백필 작업이다. 검수·통합·입력 고정까지만 하고 `completionReason=BACKFILL`로 완료한다. 그날 거래는 이후 분석의 TARGET이 되지 않고 CONTEXT 이력으로만 쓰이며 점수·Alert가 없다. 백필이 아닌 분석 작업이 하나라도 있으면409 `DEMO_BACKFILL_AFTER_ANALYSIS`다. 날짜순으로 파일을 전송하는 시연 DB에서 사용하며 운영 예약 API의 의미를 변경하지 않는다. PC에서 dev를 조작하는 실행 방법은 [조작패널 안내](demo/README.md#배포된-dev-서버-조작패널)를 따른다.
- **POST /api/v1/batch-jobs/{jobId}/resume** — FAILED 작업만 실패 단계부터 새 실패 주기로 재개한다.202 `{ jobId, status: "QUEUED" }`. 이력·정상 산출물·최초 startedAt은 유지한다. 완료 작업 재분석은 허용하지 않는다.
  - 현재 run의 로컬 `PREPARE/FAILED`·`PUBLISH/FAILED`·`COLLECT/FAILED` 모델은 같은 요청·회차로 재개한다. 수집 재시도는 모델을 재실행하지 않으며 결과 전송의 일시 오류는30초/120초 간격·총3회 후 명시 재개를 기다린다. 준비/관측 완료된 다른 모델은 초기화하지 않는다. 추론 서버가 실패로 끝낸 모델(WAIT_REMOTE/FAILED)은 같은 요청의 다음 회차로 새로 게시한다. 준비된 입력을 그대로 쓰고, 이전 회차 요청은 ALREADY_FINISHED로 닫으며, 다른 모델의 상태는 바꾸지 않는다. 실패한 회차는 점수·Alert를 남기지 않는다. 추론 서버가 계산 도중 재기동돼 이전 계산 종료를 확인하지 못한 동안(RECOVERY_REQUIRED)은 실패로 끝내지 않고 관측을 계속하며, 서버가 종료를 확인하면(WORKER_SHUTDOWN) 실패로 끝나 재개 대상이 된다. 재개가 같은 원인의 재실패를 막지는 않는다. 추론 서버는 고정 입력 장부의 사본을 들고 백엔드는 지난 위치 이후 바뀐 거래만 보낸다(요청의 `replica`, inference-server README "원장 사본"). 사본 위치가 맞지 않으면(REPLICA_MISMATCH) 그 모델만 전체 입력을 새 요청으로 자동 재전송하며 조치 필요로 표시하지 않는다.
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
- `WAIT_INGEST → INTEGRATE → FREEZE_INPUT → FEATURES → INFERENCE → SCORES → ALERTS → COMPLETE`. 등록 시 `analysis.receipts`에 cutoff 이하의 전체 수신 ID를 고정하여 이전 날짜 대기 후보도 포함하며, 검수중인 고정 수신 대상의 종료를 기다린다. 기술적 INGEST 실패는 `INGEST_FAILED`이며 TARGET0이고 후속 Alert 맥락 보완도 없으면 `EMPTY_INPUT`으로 종료한다. 후속 보완이 있으면 모델 실행을 건너뛰고 ALERTS로 진행한다. 시연 백필 작업은 TARGET이 있어도 FREEZE_INPUT 직후 `BACKFILL`로 완료한다.
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
- `private.bank_reports`는 version·source_row별 행의 출처와 상태를, `private.bank_report_payloads`는 그 행의 암호문을 1:1로 보존한다. `core.owners/accounts`의 서비스 UUID는 정상 확정 때 만들고 동일 개체와 (은행,계좌)에 재사용한다. 가명은 최초 통합 때 core.owners.display_name에 이름+코드로 저장하여 목록에서 바로 조회한다. 원문 식별자·이름은 private.owner_identities/account_identities에 분리한다. Python 원문은 AES-256-GCM, 검색 토큰은 별도 키의 HMAC-SHA256이다. 외부 공급 `app.ingest.encryption-key`, `search-key`는 서로 다른32바이트 Base64이며 `key-version` 필수다. 값은 문서·저장소에 넣지 않는다. 누락·변조·잘못된 버전이면 원문 처리 실패다.
- 고정 수신 upload ID 집합·cutoff·거래 기준일을 받는 Python `integrate/report_integration.integrate_job` 경계에서 정확 매칭한다. 원천 송수신 은행/계좌·시각·양쪽 금액/통화 전체를 대조한다. 해시만 같다고 통합하지 않는다. 같은 키에서는 Payment Format별로 report_id순 대응한다. 1+1→1, 2+2→2이며 은행내 거래와 수집범위 밖 상대는 단독 행 그대로 보존한다.
- 직접 오류 파일은 전체 HELD, 그 파일에 의존하는 다른 파일의 해당 행만 DEPENDENCY_HELD다. 다른 파일의 독립 정상 행은 확정할 수 있다. 정상 관계는 오류로 덮어쓰지 않는다. 통합 확정과 출처 연결·개체/계좌·상태 전이는 한 트랜잭션이며 중단시 롤백한다.
- 송수신 통화·원천 금액은 그대로 저장한다. USD 표시는 기존 `amount_paid / units_per_usd`, scale6 HALF_UP과 환율 버전을 사용하며 매칭 기준이 아니다. `transactions`에는 단일 보고 bank_id·row_hash UNIQUE·ingest_job_id를 두지 않고 `transaction_reports`로 출처를 연결한다.
- Python에서 최초 통합·정정 버전 교체를 수행하고 Spring이 입력 고정·실행 조정·취소 전달을 담당한다. 초기 스키마가 바뀐 dev DB의 재생성은 [배포 안내](../../deploy/split/README.md#dev-업무-db-재생성-초기-스키마-v1이-바뀐-경우)를 따른다.

## 2. 추론과 거래 점수

### 2.1 실행·산출물 경계

BINARY는 고정 TARGET 전체, TYPE은 BINARY 결과가 의심(`p_laundering>=analysis.jobs.threshold_value`, 의심 판정과 같은 값)인 TARGET만 대상으로 하는 별도 요청이다. TYPE 요청은 BINARY 결과를 수집한 뒤 만든다. 의심 TARGET이 없으면 TYPE 요청 없이 끝난다. 요청·상태 API는 `PUT/GET /api/v1/inference-requests/{requestId}/rounds/{round}`이며 전용 Bearer 토큰을 사용한다. 취소는 같은 경로의 `/cancellation`이다. 직원 세션 API와 구분한다.

입력·결과는 `requests|results/{jobId}/{BINARY|TYPE}/{requestId}/` 아래에서 manifest·Parquet·결과 표식을 사용한다. 요청 ID·run·회차·모델/피처 버전, 행 수·정확한 tx_id 집합·파일 크기·SHA-256·유한 확률을 검증한다. 원격 COMPLETED만으로 분석을 공개하지 않는다. 구체적인 전송·프로세스 계약은 [worker 문서](worker/README.md), [게시](worker/inference/model_publication.py), [수집](worker/scores/result_collection.py), [추론 서버](../inference-server/README.md)를 따른다.

현재 이진 모델은 `multi280_hgb36_v1/materials-v1`(팀원 Multi-FraudGT + HGB, 결과 p_laundering), 유형 모델은 `demo-random-v1/demo-input-v1` 시연용(결정적 난수, 결과 p_0~p_8)이다. 버전 선택은 [등록표](worker/models/registry.py), 모델 실행은 추론 서버 `models/`에 있다. 파일 운반과 모델 추론 품질을 동일시하지 않는다.

### 2.2 점수의 의미

- 점수는 (run_id,tx_id)로 저장하며 TARGET만 해당 run에서 채점한다. CONTEXT는 고정한 과거 점수를 사용하거나 미채점으로 남는다. 분석 전체 완료 전에는 현재 점수로 공개하지 않는다.
- launderingScore=p_laundering, typeClass=argmax(p_0..p_8), typeScore=해당 값. 동점은 작은 코드다.
- isSuspicious는 해당 실행에 동결된 threshold_value 이상인지다. 원장 최신 조회는 analysis.current_scores를 사용한다. 의심 거래 API의 jobId/analysisDate는 해당 완료 분석 결과를 선택한다.
- scorePercentile은 같은 실행에서 `100 × percent_rank(p_laundering)`. 동점은 최저 공동 순위이며 단일/전부 동점은0이다. thresholdRatio는 점수/임계값이다.
- typeCandidates는 상위 두 확률 차이가 app.type.ambiguity-delta(기본0.10) 미만이면2개, 아니면1개다.
- agreement는 STRONG(이진 의심·패턴 있음), ATYPICAL(이진 의심·코드0), PATTERN_ONLY(이진 정상·패턴 있음), WEAK(이진 정상·코드0). 미분석은 여기에 넣지 않는다. 유형 모델은 의심 거래만 판정하므로 이진 정상 거래는 유형이 없어 모두 WEAK이고 PATTERN_ONLY는 0이다.

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

- 씨앗은 해당 점수 실행의 임계 이상 거래와, 묶기 전에 그 씨앗에서 보강한 거래(이중 임계값·금액 비율 연결, worker README의 Alert 구성 참조)다. 보강한 씨앗은 임계 미만이라 `isSuspicious`가 false다. 과거 미소속 씨앗도 검토하며 TARGET0이어도 고정 과거 점수/사건이 있으면 재추론 없이 검토한다.
- 생성 정책은 block-pin-3이다(block-pin-2의 시간 상한만 늘림. 간격 7일·기간 14일은 실데이터 연구 범위를 덮는 넉넉한 상한이며, 합성 패턴에 맞춘 값이 아니다). 씨앗 사이의 구조 관계(witness)로 Alert 핵심을 만든다. witness는 PASS(한 계좌를 1:1로 통과, 금액 비0.8~1.25·지연168시간 이내), STAR_OUT/STAR_IN(한 계좌의 송금·수취 부채꼴), RELAY(입금 부채꼴 뒤 출금 부채꼴), PATH(비씨앗2홉 이내로 이어진 두 씨앗), BRIDGE(두 씨앗 계좌 사이 경유 계좌2개 이상), CLOSURE(열린 사슬이 블록 계좌로 돌아옴), SHAPE_CYCLE/SHAPE_BRIDGE(씨앗 하나가 이루는 순환·경유 모양)다. 구조 근거일 뿐 유형 판정이 아니다. 핵심 SEED/CONNECTION은 채택 witness 거래의 합집합이며 새 근거에는 CONTEXT 멤버가 없다. 관계 없는 단독 씨앗은 발행하지 않는다. block-pin-2부터 BRIDGE 묶음·비씨앗 걷기(PATH·CLOSURE)·단독 모양을 모두 블록 기간(block-pin-3 최대 336시간) 안에서만 판단하므로 한 거래가 볼 수 있는 시간은 블록 기간 안이며, 동률은 작은 거래 ID로 정한다. 정책 버전이며 DB 마이그레이션은 단일 V1을 유지한다.
- 핵심은 과거 핵심을 포함해64건·기간336시간(14일) 이하이고, 이어지는 두 거래 간격은 168시간(7일) 이하다(정책 block-pin-3). 넘치는 연결은 별도 Alert로 두고 `BOUNDARY_CAP`/`BOUNDARY_SPAN` 링크를 남긴다. 링크(`boundaryWitnesses`, kind는 `BOUNDARY_PASS`/`BOUNDARY_SAME_FOCAL`/`BOUNDARY_OPEN_PAIR`/`BOUNDARY_CAP`/`BOUNDARY_SPAN`/`BOUNDARY_STAR_CHUNK`)는 다른 Alert와의 관계이며 소속이 아니다. 링크는 근거 지문에서 제외하고 매 실행의 현재 값으로 교체하므로 링크만 바뀌면 새 버전·알림을 만들지 않는다. 링크만으로 자동 병합하지 않는다. 활동이 많고 의심 비율이 낮은 허브 계좌는 관계 근거로 쓰지 않는다(`AMBIGUOUS_HUB`). 계산 예산 초과는 전체 실패하며 부분 공개하지 않는다.
- 맥락은 소속 거래가 아니라 조회 조건이다. 근거의 `contextQuery`는 `{firstAt,lastAt,focalAccounts:[{bankId,accountId}]}`이며 핵심 기간±24시간과 블록의 초점 계좌(부채꼴 중심 등)다. accountId는 가명 계좌 UUID다. 맥락 거래 수는 조회 시 원장에서 계산한다(§3.3 contextCount).
- 다음 분석에서는 기존 OPEN·비병합 Alert의 씨앗·핵심·채택 witness를 고정 입력으로 넘겨 같은 Alert가 이어서 자란다. 다른 Alert가 소유한 씨앗은 가져오지 않는다. 핵심 멤버가 같고 witness만 달라지면 새 버전을 만들지 않는다. 핵심 최초 시각+336시간(`sealedAfter`)이 지나면 늦은 보고 외에는 자라지 않는다. 정책 버전이 다른 기존 Alert(block-pin-1·block-pin-2·flow-evidence-2 등)는 동결되어 자라지도 씨앗을 내주지도 않으므로, 정책 전환 시 시연 데이터를 초기화한다(§10.2).
- Alert 근거 상세와 조사 상세의 `relatedFlows`는 `{kind, txIds, relatedAlertIds}` 배열이다. `txIds`는 링크 근거 거래이며 **링크는 양쪽 Alert의 씨앗을 하나씩 포함한다.** `relatedAlertIds`는 그 거래를 씨앗으로 갖는 현재 공개 대표 사건 ID다. 따라서 과거 버전에서도 이동 대상 ID는 현재 기준이며 자기 자신은 제외한다. `boundaryWitnesses` 원본은 `{kind, tx_ids}` 형태로 근거 버전에 보존한다. 씨앗 소속은 한 Alert뿐이다.
- 맥락 조회 범위가 겹쳐도 사건을 합치지 않는다. 그래프의 패턴 모델 추론은 현재 생성 기준이 아니다. flow-evidence-2 이전 버전의 근거에는 CONTEXT 멤버가 남아 있을 수 있으며 조회 계약은 그대로 읽는다.

### 3.2 사건 전이

| 상황 | 처리 |
|---|---|
| 같은 흐름의 OPEN Alert 하나에 새 거래 연결 | 조사 중에도 자동 편입. 신규 거래만 PENDING, 기존 판정·제외·직원 역할 유지 |
| OPEN Alert 여러 개가 같은 흐름 | 조사 중이어도 바로 병합. 최초 생성·동률 최소ID를 대표로 유지, 대표 담당자 유지. 사라지는 Alert는 `merged_into_alert_id`로 대표를 가리키고 목록에서 빠지며, 그 Alert에서 직원이 뺀·옮긴 거래 기록(`alert_tx_edits`)은 대표로 옮긴다. 양쪽 담당자에게 MERGED 알림 |
| 종결·Episode 편입 사건의 씨앗이 다시 묶이고 새 씨앗을 포함한 witness가 있음 | 후속 Alert. 같은 후속 흐름은 열린 후속에 반영 |
| 종결 근거 반복, 연결 거래만 증가 또는 관계만 변경 | 후속 Alert를 새로 만들지 않음 |
| 정정으로 확인된 유효 핵심 소멸 | 조사 중이어도 SCOPE_CLEARED 자동 종료 |
| 점수 재평가·기존 근거 제거 | 조사 중이어도 새 버전으로 바로 반영(사유 SCORE_OR_POLICY_REASSESSMENT). 변경 제안·동의 절차는 없다 |
| 같은 근거 재실행 | 새 버전·알림 없이 성공 검사만 갱신 |

병합 원본은 삭제하지 않고 canonicalAlertId로 대표를 안내한다. 별칭은 목록에서 제외하고 수정은409다. 종결/편입 판정은 자동 재개하거나 덮어쓰지 않는다. 다시 여는 길은 관리자의 재검토 승인·지시(§9 업무 요청)뿐이며, 후속 Alert가 이미 있는 Alert는 다시 열지 않는다. 후속 계보는 단일 parent 열이 아닌 관계로 보존한다.

직원 판단이 있던 거래가 정정으로 빠져도 저장 판정·역할·당시 버전은 보존한다. 현재 범위·요약은 공개 버전과의 교집합이며 상세 withdrawnMembers로 과거 판정을 별도 조회한다. 미수신·HELD·탐색 한도는 무효 근거로 단정하지 않는다.

공개 포인터가 가리키는 버전만 현재 근거다. 

### 3.3 Alert 근거 API

| 요청 | 계약 |
|---|---|
| GET /api/v1/alerts | page,size,status(OPEN/CLOSED/ESCALATED),assigneeId,jobId. 현재 씨앗 위험도 내림차순·alertId 오름차순 |
| GET /api/v1/alerts/{alertId} | version 선택. 생략하면 publishedVersion, 지정하면 공개 완료된 불변 버전. 없거나 숨겨진 버전404 |
| GET /api/v1/alerts/{alertId}/versions | 공개 완료된 version,runId,createdAt 목록 |
| GET /api/v1/alerts/{alertId}/graph | version 선택. 같은 버전의 graph |

목록은 `alertId,status,resolution,assigneeId,parentAlertId,createdAt,version,runId,summary`와 생애주기 식별 필드를 제공한다. canonicalAlertId/publishedVersion/reviewStartedAt은 현재 사건 기준이다. jobId는 현재 공개 근거 생성 작업을 뜻한다. 작업 alertCount는 신규 사건 수이므로 이 목록 건수와 다를 수 있다.

상세에는 policyVersion/policy/witnesses,boundaryWitnesses,contextQuery,seeds,transactions,limits,graph,coverage,dataAsOf,lastCheckedAt을 제공한다. seeds는 `{txId,occurredAt,score,threshold}`. transactions는 `{txId,occurredAt,fromAccountId,toAccountId,fromBankId,toBankId,amountReceived,receivingCurrency,amountPaid,paymentCurrency,amountUsd,paymentFormat,role,includedReasons,scores}`이며 role은 SEED/CONNECTION/CONTEXT(block-pin 정책 근거는 SEED/CONNECTION만), 미채점 scores는 null이다. 근거의 금액은 정밀도를 보존하는 decimal 문자열이며 숫자로 파싱한다. policy 필드명과 witnesses의 tx_ids, scores의 p_laundering 등은 snake_case다.

근거 summary는 txCount,seedCount,totalAmountUsd,scoreMax,firstTxAt,lastTxAt이다. txCount·totalAmountUsd·firstTxAt·lastTxAt은 근거 transactions 기준이며 block-pin 정책에서는 곧 핵심(SEED+CONNECTION) 기준이다. scoreMax는 포함 거래의 최대 관측 점수다. 현재 조사 summary.riskScore(현재 씨앗 최대값)와 구분한다.

상세(`GET /api/v1/alerts/{alertId}`)의 summary에는 다음 두 값을 더한다. 목록 summary에는 없다.
- `sealedAfter`: 핵심 최초 occurredAt + policy.span_max_us(block-pin-3은 336시간)의 ISO-8601 UTC 시각. 이 시각 뒤에는 늦은 보고 외에는 Alert가 자라지 않는다. span_max_us가 없는 이전 정책 근거는 null.
- `contextCount`: 그 버전의 contextQuery 조건(초점 계좌가 송금 또는 수취 쪽, occurredAt이 firstAt~lastAt 양끝 포함)에 맞는 현재 ACTIVE 원장 거래 중 근거 transactions 밖의 거래 수. 조회할 때마다 현재 원장으로 계산하므로 늦은 보고가 들어오면 같은 버전이라도 늘 수 있다. 초점 계좌가 없으면0, contextQuery가 없는 이전 정책 근거는 null.

graph.nodes는 계좌 id,kind,bankId,inCount,outCount,inAmountUsd,outAmountUsd, graph.edges는 id,txId,from,to,amountUsd,occurredAt,role,includedReasons다. 같은 계좌쌍의 반복 거래도 별도 edge다.

dataAsOf는 근거 생성 run cutoff, lastCheckedAt은 성공한 검사 시각이다. 최신 조회는 최신 성공 검사, 명시 버전 조회는 해당 버전 생성 run의 검사만 사용한다. coverage는 businessDate,complete,expectedBanks,completeBanks,reports의 날짜별 배열이다. 등록 은행0·미수신·부분 보류는 수신 완료가 아니며 미래 수신 완료를 추정하지 않는다.

### 3.4 배정

Alert와 일반 Episode 생성은 비밀번호 해시가 등록된 STAFF에 공통 라운드로빈 배정한다. last_assigned_at NULL 우선·오래된 순·동률 userId순이다. 배정 순서는 업무 시각과 분리하며, 공통 트랜잭션 잠금 안에서 DB 현재 시각과 기존 최대 배정 시각+1마이크로초 중 큰 값으로 갱신한다. 같은 업무 시각의 대량 생성·동시 요청에서도 순환하고 실패하면 배정 순서도 롤백한다. 사건 createdAt/assignedAt은 업무 시각을 유지한다. 시연 초기화와 설정 복원에서는 last_assigned_at을 NULL로 초기화한다. 배정 대상이 없으면 ALERT_ASSIGNEE_UNAVAILABLE로 실패한다. 관리자 재배정 API는 제공하지 않는다.

### 3.5 변경 제안 없음

새 분석 결과(거래 추가·병합·정정 삭제·재평가)는 OPEN Alert에 바로 반영한다. 제안 테이블과 투표 API는 없다.

## 4. Episode

서로 다른 Alert 전체 2개 이상을 묶는 조사 사건이다. Alert 하나는 최대 한 Episode에 소속된다. Episode의 거래는 소속 Alert의 현재 거래 합집합이고, 편입된 Alert는 CLOSED/TRANSFERRED다. 만들기·편입·연결 해제·판정은 §9의 API를 사용한다.

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

이력은 `review.events`에 남는다. 화면용 판정 기록은 `GET /api/v1/review/board`의 `judgment`, 거래 변경 기록은 `edits`로 내려간다. 행의 businessAt은 업무 시각, recordedAt은 실제 저장 시각이다.

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

`GET /api/v1/dashboard/transaction-days?from&to`(로그인 필수): 거래일 기준 화면용 집계. `days[{date,total,suspicious,newAccounts,newOwners}]`, `types[{type,count}]`(type은 유형 이름), `hours[{hour,total,suspicious}]`, `scores[{scorePct,count}]`. `ops.dashboard_model_counts`와 `dashboard_tx_hours`·`dashboard_score_points`·`dashboard_first_seen`을 읽는다.

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
| typeClass | number0~8 또는 null, 패턴 최다 확률 코드. 유형 모델은 의심 거래만 판정하므로 미분석·이진 정상 거래는 null |
| typeName | string, 점수 있을 때 제공. 코드0은 NON_PATTERN. 미분석에서는 키가 없을 수 있음 |
| probabilities | 9개 원소 배열, 코드0~8 순서. 미분석·이진 정상 거래는 null 원소 배열이며0점 배열이 아님 |
| judgement | SUSPICIOUS / NORMAL / UNANALYZED |

최신 유효 점수는 완료된 분석/유효 run 기준이며 미완료 결과를 노출하지 않는다. 수신·통합 ACTIVE 원장의 정상·의심·미분석을 모두 조회한다.

소유주는 통합 시 저장한 `이름#번호` 가명을 반환한다. 번호는 최소5자리이며 초과 자릿수는 유지한다. 이름으로 개체를 병합하지 않고 전체 UUID로 선택·필터한다. 계좌 UUID는 원문 계좌번호가 아니다.

**소속 의미:** 조사 구성의 SUBJECT와 CONTEXT를 모두 포함한다. EXCLUDED/TRANSFERRED 거래는 해당 사건의 소속 배열에서 제외한다. 전체 편입은 원본 member를 TRANSFERRED로 바꾸지 않으므로 해당 거래는 원본 alertIds와 목적지 episodeIds 양쪽에 나타난다. 정상·의심 DECIDED 및 CLOSED 사건은 제외하지 않는다. 아직 저장된 조사 범위가 없는 Alert는 최신 완료 근거를 사용한다. OPEN의 새 거래는 공개 트랜잭션에서만 편입한다. GET이 거래를 추가하지 않으며 직원 제외를 자동 복구하지 않는다. 정정으로 현재 공개 근거에서 빠진 거래와 병합 원본은 현재 소속에서 제외한다. CLOSED의 저장 범위에는 새 근거를 추가하지 않는다. 미완료 분석의 근거는 사용하지 않는다. 원본 Alert 출처 이력과 현재 소속은 다르며 과거 이력 전체를 이 배열에 넣지 않는다.

alertIds는 원본 alertId, episodeIds는 kind=EPISODE인 caseId다. Alert caseId는 alertId와 같고 Episode caseId는 episodeId다. 원문 계좌번호는 반환하지 않는다.

## 9. 조사 화면 API

**dev/local 서버 세션 인증**을 사용한다. 접근·권한·CSRF는 §5를 따른다. 사건 ID는 kind와 함께 해석한다. Alert caseId=alertId, Episode caseId=episodeId다.

| 요청 | 입력 / 응답 |
|---|---|
| GET /api/v1/review/board | `{businessAt,cases,transactions,nextEpisodeId}`. 화면이 Alert·Episode 목록·카드·상세·대시보드 업무 지표를 이 응답 하나로 그린다 |
| POST /api/v1/review/cases/{caseId}/read | 담당자가 처음 열면 `read_at` 기록(열람 전 → 처리 전). 담당자가 아니면 변화 없음 |
| POST /api/v1/review/cases/{caseId}/start | 담당자만. Alert를 처리 중으로 바꾼다 |
| POST /api/v1/review/cases/{caseId}/judgment | `{verdict:NORMAL/SUSPICIOUS,reasonCategory:pattern/rule/normal-business/etc,evidence,observations,rationale}`. rationale 필수, evidence·observations 선택. 담당자만, Alert는 처리 중이어야 한다. 유효한 판정은 사건당 하나이며 저장과 함께 CLOSED(재검토로 다시 열린 사건은 새로 판정한다). 응답 `{id:"J-yyMMdd-NNNNNN",...}` |
| POST /api/v1/review/cases/{caseId}/transaction-edits | Alert만. `{txIds,targetAlertId,reason}`. targetAlertId가 null이면 제외, 있으면 그 OPEN Alert로 이동. STAFF는 본인 담당(대상 포함), ADMIN은 모든 OPEN Alert. 원래 Alert로 되돌리면 기록을 지운다 |
| POST /api/v1/review/episodes | `{alertIds,reason,episodeId}`. 본인 담당 OPEN·미판정·미편입 Alert 2건 이상. episodeId는 board의 `nextEpisodeId`(선택) |
| POST /api/v1/review/episodes/{episodeId}/alerts | `{alertIds,reason}`. OPEN Episode에 Alert 편입 |
| POST /api/v1/review/episodes/{episodeId}/unlink | `{alertIds,reason}`. Episode 담당자만. 남는 Alert가 2건 미만이면 Episode를 해체(DISSOLVED)하고 Alert를 다시 연다 |
| GET /api/v1/review/work-requests | `{admin,staff,requests}`. 내가 보냈거나 받은 요청, 담당 변경으로 내 담당이 바뀐 요청. admin·staff는 요청 화면이 고르는 직원(`username,name,role`) |
| POST /api/v1/review/work-requests | `{type,caseId,recipient,reason,deadline,reviewStatus,related}`. 응답 `{id}` |
| POST /api/v1/review/work-requests/{id}/resolve | `{action,note,assignee,reviewStatus}`. 보낸 사람: `cancelled`(적용 전 요청만). 받은 사람: ADMIN `approved/declined`, STAFF `completed/needs-discussion`, note 필수 |
| POST /api/v1/review/work-requests/read | `{ids}`. 내 읽지 않음 표시를 지운다 |
| GET /api/v1/review/account-nodes | ids=가명 계좌 UUID 목록. 원문 이름·계좌번호 제외 |
| GET /api/v1/review/payment-formats | 원장에 존재하는 결제 수단 목록 |

board의 사건 행은 `caseId,kind,status,outcome,assigneeId,assigneeName,assigneeUsername,dueOn,createdAt,assignedAt,closedAt,ageDays,readAt,reviewStartedAt,episodeId(Alert)/linkedAlertIds(Episode),pendingCount,sourceAlertIds,primaryTypes,summary,members,judgment,edits`다. 현재 거래는 뷰 `review.current_members`(공개 버전 거래 − `alert_tx_edits` + 옮겨 온 거래)로 계산한다. 거래 판정은 사건 판정(Alert 자신 또는 소속 Episode)을 따른다. reason은 4000자 이하다.

### 업무 요청

요청 유형과 보내는 역할, 사건에 적용되는 효과는 다음과 같다. STAFF가 보낸 요청은 ADMIN(받는 사람)이 승인할 때, ADMIN이 보낸 지시는 보내는 즉시 적용된다. 효과가 없는 유형은 의견 교환만 한다.

| type | 보내는 역할 | 효과 |
|---|---|---|
| reopen / reviewAgain | STAFF / ADMIN | 다시 열기 |
| changeAssignee / assign | STAFF / ADMIN | 담당 변경 |
| extension / deadline | STAFF / ADMIN | 처리 기한(`deadline` yyyy-MM-dd 필수) |
| changeStatus | ADMIN | 처리 상태(처리 전 ↔ 처리 중, Alert만) |
| opinion, relationReview, evidenceRequest | STAFF | 없음 |
| investigate, evidence | ADMIN | 없음 |

- STAFF는 본인 담당 사건에만 요청한다(relationReview는 예외이며 `related`에 비교 후보와 공통 거래·계좌를 담는다). 받는 사람은 ADMIN이다. ADMIN의 지시는 현재 담당자에게, 담당 변경은 새 담당자(`recipient`)에게 보낸다.
- 다시 열기는 판정(NORMAL/SUSPICIOUS)으로 닫힌 사건만 대상이다. Episode로 옮겨진 Alert, 해체된 Episode, 후속 Alert가 이미 만들어진 Alert는 409다. 다시 열면 OPEN·미판정이 되고 이전 판정은 `judgments.superseded_at`을 채워 기록으로 남는다. `reviewStatus`(PENDING/IN_PROGRESS)로 처리 전·처리 중을 정하며 Episode는 IN_PROGRESS만 된다.
- 담당 변경은 OPEN 사건만. 승인할 때 `assignee`(새 담당자 username)가 필요하다. 처리 기한은 OPEN 사건의 `due_on`에 저장한다.
- 같은 사람이 같은 사건에 같은 유형으로 보낸 요청이 처리 대기 중이면 409다.
- 요청 행은 `id,type,caseId,caseKind,caseCreatedAt,sender,recipient,related,reason,deadline,sentAt,at,state,unreadFor,appliedAt,reviewStatus,assignee,before,note`다. 사람은 username으로 적는다. `before`는 적용 직전의 `outcome,reviewStatus,assignee,judgment,completedAt`이다. state는 pending/approved/declined/completed/needs-discussion/cancelled.
- 적용된 변경은 `review.events`에 REOPEN/ASSIGN/STATUS/DEADLINE으로 남는다.

댓글·오탐 표시·변경 제안 API는 없다(화면에 없는 기능).

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

## 12. 룰엔진

룰은 이름표(`ruleId`, 화면 번호 `code` = `RULE-NNN`)이고 조건은 버전(`versionId`)이 갖는다. 한 룰은 운영 버전(ACTIVE·PAUSED) 최대 1개와 작업 중 버전(DRAFT·SHADOW·PENDING) 최대 1개를 가진다. 조회·명령 모두 STAFF·ADMIN 세션과 CSRF 가 필요하다.

| 요청 | 입력 / 응답 |
|---|---|
| GET /api/v1/rule-templates | 템플릿 카탈로그(`resources/rules/catalog.json`)에 `backtestTemplates[]`(평가기가 있어 백테스트를 돌릴 수 있는 템플릿 키)를 더한 것. `{schema,templates[{key,name,group(PATTERN/GENERAL),available,pattern,evaluator,subject,subjectLabel,trigger,side,directionSelectable,windowRequired,maxWindowMinutes,alert,references,filterFields[],requiredFilterFields[],metrics[],whereMin,sweep,defaults,performance,note}],filterFields{},metrics{},path{},windows[],comparators[],directions[],then[{key,label,enabled}],limits{}}`. `available=false` 는 이후 제공 템플릿이다. `note` 는 그 템플릿의 세는 방식이다. 값이나 조건을 바꿔도 달라지지 않는 것만 적는다(이후 제공 템플릿은 제공하지 않는 이유). `performance`(기본값을 고른 실험의 정밀도·재현율)와 `oracle`(대응하는 업계 시나리오 이름)은 기본값의 근거 기록이고 화면에는 쓰지 않는다 |
| GET /api/v1/rules | 목록. `{content[{ruleId,code,name,template,templateName,summary,status,then,versionNo,versionId,operatingVersionNo,operatingStatus,operatingSummary,workingVersionNo,workingStatus,owner,changedAt,hitCount,lastHitDate,shadowHitCount,linkedAlertCount,normalRate,alertedHitCount,skippedBusySubjects,lastRunFailed}],counts{ACTIVE,SHADOW,PENDING,PAUSED,DRAFT}}`. `status`·`versionNo`·`summary` 는 작업 중 버전이 SHADOW·PENDING 이면 그 버전, 아니면 운영 버전, 운영 버전이 없으면 작성 중 버전의 값이다. 적중 숫자의 뜻은 아래 "목록의 적중 숫자"에 있다 |
| GET /api/v1/rules/{ruleId} | 상세. `{ruleId,code,name,template,templateName,owner,createdAt,status,operating,working,commands[{action,versionId,revision,enabled,reason,commentRequired}],versions[{versionId,versionNo,status,summary,author,createdAt,submittedAt,decidedAt,decidedBy}],executions[{versionNo,mode(LIVE/SHADOW),status(COMPLETED/FAILED),analysisDate,triggerCount,hitCount,skippedBusySubjects,errorCode(TIMEOUT/BUDGET/INTERNAL/INTERRUPTED),finishedAt}],events[{at,actor,action,comment,versionNo,selfApproved,clonedFrom{code,versionNo}?}]}`. `operating`·`working` 은 `versions` 한 줄에 `{revision,definition,digest,sentence,editable,deletable,backtest{backtestId,status,currentDefinition,finishedAt}?}` 를 더한 것이고 없으면 null. `commands` 는 지금 상태에서 있는 명령과 요청한 사람이 할 수 있는지(`enabled`, 못 하면 `reason`)다. 상태 명령 말고 `NEW_VERSION`(POST …/versions)과 `CLONE`(POST …/clone)도 여기에 온다. `CLONE` 의 `versionId` 는 따로 고르지 않을 때 복제될 버전이다. `executions` 는 최근 일일 실행 20건, `events` 는 최근 200건이다. `action` 은 CREATED·EDITED·DRAFT_DELETED·SHADOW_STARTED·SUBMITTED·WITHDRAWN·APPROVED·REJECTED·PAUSED·RESUMED·BACKTEST_DONE |
| POST /api/v1/rules | 룰과 v1 초안. `{name(1~80자),template,definition?}`. `definition` 을 안 주면 템플릿 기본값. `{ruleId,code,versionId,revision}` |
| PUT /api/v1/rules/{ruleId}/versions/{versionId} | 초안 저장. `{name,definition,revision}`. DRAFT 를 작성자만. 응답은 `{ruleId,code,name,versionId,versionNo,status,revision,definition}` 에 검증 결과(아래 validate 응답)를 더한 것 |
| POST /api/v1/rules/{ruleId}/versions | 운영 버전을 복사해 새 초안을 만든다. 본문 없음. `{ruleId,code,versionId,versionNo,revision}`. 운영 버전이 없거나 작업 중 버전이 이미 있으면 409 |
| POST /api/v1/rules/{ruleId}/clone | 복제. 그 룰의 한 버전의 조건을 그대로 가진 **새 룰**의 v1 초안(DRAFT)을 만든다. 본문은 없어도 되고 `{versionId?,name?}` 를 줄 수 있다. `versionId` 가 없으면 운영 버전, 없으면 작업 중 버전, 그것도 없으면 가장 나중 버전이다(어느 상태의 버전이든 된다). `name` 이 없으면 `원래 이름 복사본` 이고 80자를 넘으면 원래 이름의 뒤를 자른다. 새 룰의 담당자와 작성자는 요청한 사람이다. 조건은 다시 검증하지 않고 옮기며 백테스트·적중·변경 기록은 옮기지 않는다. 원래 룰은 바뀌지 않는다. 새 룰의 첫 변경 기록(CREATED)에 `clonedFrom{code,versionNo}` 가 남는다. `{ruleId,code,name,versionId,revision}`. 없는 룰·그 룰의 것이 아닌 버전 404, 이름 규칙 위반 400 |
| POST /api/v1/rules/{ruleId}/commands | 상태 명령. `{requestId?,action,versionId,revision,comment?}` → 바뀐 룰 상세(GET /rules/{ruleId} 와 같다). `action` 은 START_SHADOW·SUBMIT·WITHDRAW·APPROVE·REJECT·PAUSE·RESUME. 표는 아래 "상태 명령" |
| GET /api/v1/review/cases/{caseId}/rule-hits | Alert·Episode 의 현재 거래에 걸린 운영 룰 적중. `[{alertId,ruleId,code,name,template,templateName,pattern,versionId,versionNo,versionStatus,summary,subjectType,subjectLabel,subject,hitDates[],windowMinutes,measured{},conditions[{metric,label,cmp,value,unit,measured}],roles[{role,label,accountId}],matchedTxIds[],evidenceTxCount}]`. 없는 사건은 404 |
| POST /api/v1/rules/validate | 저장 없이 검증. `{template,definition,ruleId?}` → `{items[{key,label,ok,message,errors[]}],warnings[],canSave,canRun,sentence,summary}`. `items` 는 FORMAT·CONDITIONS·DATA·COST 순서. 형식을 통과하지 못하면 `sentence`·`summary` 는 null |
| DELETE /api/v1/rules/{ruleId}/versions/{versionId} | 초안 삭제. 204. 시험 운영·승인 요청을 한 적이 없는 DRAFT 를 작성자와 ADMIN 만. 그 룰에 다른 버전이 없으면 룰과 변경 기록도 지우고, 있으면 버전만 지우고 DRAFT_DELETED 를 남긴다 |
| POST /api/v1/rule-backtests | 백테스트 접수. `{versionId,baselineVersionId?,from?,to?}` → 202 `{backtestId,status}`. `baselineVersionId` 를 안 주면 그 룰의 운영 버전(있으면)과 비교한다. 기간을 안 주면 원장 첫날 + `app.rules.warmup-days`(기본 7)일부터 원장 마지막 날까지이고 90일을 넘으면 마지막 90일이다. 같은 버전·조건·기간이 이미 줄에 있거나 돌고 있으면 그 `backtestId` 를 돌려준다. 평가기가 없는 템플릿, 체크리스트를 통과하지 못한 조건, 검사할 날짜가 없는 기간은 400 |
| GET /api/v1/rule-backtests/{backtestId} | 상태와 결과. `{backtestId,status(QUEUED/RUNNING/COMPLETED/FAILED/CANCELLED),progress(0~100),cancelRequested,errorCode(TIMEOUT/INTERNAL/INTERRUPTED),ruleId,code,name,template,versionId,versionNo,summary,currentDefinition,baseline{versionId,versionNo,summary}?,period{from,to,days},requestedBy,requestedAt,startedAt,finishedAt}`. `currentDefinition=false` 면 백테스트 뒤에 조건을 고친 것이다. COMPLETED 면 `{kpis{hits,added,dropped,precision,judged,baseHits,basePrecision,baseJudged},txCount,evidenceTxCount,evidenceShare,hitDays,alertOverlap,expectedNewAlerts,chunkedCount,skippedBusySubjects,busy{maxTransactions,windowMinutes},sweep{metric,label,unit,rows[{value,current,hits,txCount,alertOverlap,expectedNewAlerts}]}?,cases[{subjectType(ACCOUNT/TX),subject,txId?,occurredAt?,state(HIT/ADDED/DROPPED/KEPT),measured,txCount,alertId,judgement}]}` 가 같이 온다 |
| GET /api/v1/rule-backtests?ruleId= | 그 룰의 백테스트 기록. 최근 20건. 위 응답의 머리 부분 + `txCount` |
| POST /api/v1/rule-backtests/{backtestId}/cancel | 취소 요청. 202 와 현재 상태. 줄에 서 있으면 바로 CANCELLED, 돌고 있으면 지금 쿼리가 끝난 뒤 멈춘다. 이미 끝났으면 409 |

- 정의(`definition`): `{schema:2,template,direction?,windowMinutes?,filter,path?,where,then}`. `filter`(세는 거래)는 `{op:"ALL",items[]}` 이고 항목은 `{field,cmp?,value?}` 또는 `{op:"ANY",items[]}` 하나까지다. `where`(적중 조건)는 `{op:"ALL"|"ANY",items[]}` 이고 항목은 `{metric,cmp?,value?}` 또는 한 단계 안쪽 그룹이다. `path` 는 CYCLE·RANDOM 의 `{minHops,maxHops,stepRatioMin,stepRatioMax}`, `direction` 은 STRUCTURING·SAME_AMOUNT 의 `IN`/`OUT`, `then` 은 `ATTACH_EVIDENCE`(`CREATE_ALERT` 는 아직 고를 수 없다). 쓸 수 있는 항목·비교·범위는 카탈로그가 정한다.
- 저장은 형식(FORMAT)만 통과하면 된다. 값이 빈 초안도 저장된다(`canSave=true, canRun=false`). 저장 때 키 순서를 고정하고 null 을 뺀 정의의 SHA-256 을 `digest` 로 같이 저장한다.
- 오류: 형식 실패·이름 길이·필수 값 누락 400 `VALIDATION_FAILED`(`detail` 에 첫 사유), 작성자가 아님 403 `FORBIDDEN_ROLE`, 없는 룰·버전 404, DRAFT 가 아니거나 `revision` 이 다름 409 `INVALID_TRANSITION`.
- 백테스트: 지금 고를 수 있는 템플릿 열 개(유형 여섯 FAN_OUT, FAN_IN, GATHER_SCATTER, SCATTER_GATHER, CYCLE, RANDOM + 일반 넷 LARGE_TX, STRUCTURING, SAME_AMOUNT, PASS_THROUGH)에 모두 평가기가 있다. 전용 스레드 하나가 접수 순서대로 한 번에 하나씩 돌리고, 쿼리 하나는 120초를 넘으면 끊긴다(`errorCode=TIMEOUT`). 서버가 돌던 중에 꺼지면 `INTERRUPTED` 로 남는다.
  - 검사 시점은 대상 계좌의 거래이고, 그 시각(분)을 포함해 직전 기간 안에서 세는 거래를 통과한 거래만 센다. 적중은 대상 × 거래 기준일이고, 사례(`cases`)는 대상마다 한 줄이다(근거 거래는 기간 전체의 것을 합친다). `cases` 는 200줄까지 싣는다. `subject` 는 가명 계좌 ID 앞 8자리다.
  - `kpis.added`·`dropped` 는 비교 기준에 없다가 생긴 대상 수와 있다가 빠진 대상 수다. 비교 기준이 없으면 null 이고 `state` 는 전부 `HIT` 다.
  - `judgement` 는 대상의 근거 거래와 가장 많이 겹치는 Alert 의 사람 판정(SUSPICIOUS/NORMAL)이다. Episode 에 편입된 Alert 는 그 Episode 의 판정을 따른다. `precision` 은 판정이 붙은 대상 가운데 의심의 비율(%)이고 판정이 없으면 null 이다. 정답 라벨은 쓰지 않는다.
  - `expectedNewAlerts` 는 어느 Alert 와도 겹치지 않고 근거 거래가 2건 이상인 대상 수로, 추정값이다. `chunkedCount` 는 근거 거래가 32건을 넘는 대상 수다. `evidenceShare` 는 검사한 거래 가운데 근거 거래의 비율(%)이다.
  - `sweep` 은 템플릿이 정한 항목 하나의 값만 바꿔 다시 돌린 결과다(최대 5개 값). 경로형(CYCLE, RANDOM)은 `sweep.metric` 이 `minHops` 이고 그 룰의 `path.maxHops` 를 넘는 값은 돌리지 않는다. 바쁜 계좌(`app.rules.busy.*`)는 대상에서 빼고 그 수를 `skippedBusySubjects` 로 준다.
  - SCATTER_GATHER: 대상은 도착 계좌, 검사 시점은 경유 → 도착 입금이다. 같은 출발 계좌에서 받은 뒤(같은 분 포함) 도착 계좌로 보낸 경유 계좌를 (출발, 도착) 쌍마다 세고, 출발 → 경유 → 도착이 모두 기간 안이어야 한다. 출발 = 도착은 세지 않는다. `measured.MID_COUNT` 가 경유 계좌 수다.
  - CYCLE · RANDOM: 받는 계좌 = 다음 거래의 보내는 계좌로 이어지고, 시각이 거꾸로 가지 않고(같은 분 허용), 이어지는 두 거래의 금액 비(뒤 ÷ 앞)가 `path.stepRatioMin ~ stepRatioMax` 안이고, 첫 거래부터 마지막 거래까지가 기간 안인 경로를 `path.maxHops` 건까지 따라간다. 같은 계좌를 두 번 지나지 않는다(출발 계좌로 돌아오면 닫힌다). CYCLE 은 닫힌 경로, RANDOM 은 닫히지 않은 경로만 보고 거래 수가 `path.minHops` 이상이면 걸린다. 대상은 CYCLE 이 출발 계좌(돈이 돌아온 계좌), RANDOM 이 경로의 끝 계좌이고 `measured.HOPS` 가 그 날 가장 긴 경로의 거래 수다.
  - SCATTER_GATHER · CYCLE · RANDOM 은 대상뿐 아니라 경로 어느 자리에도 바쁜 계좌가 없는 거래만 본다. 집계형은 대상만 본다.
  - LARGE_TX: 돌아보는 기간도 적중 조건도 없다. 세는 거래를 통과한 거래 하나하나가 적중이고 **대상이 거래**다(`subjectType=TX`). 바쁜 계좌를 빼지 않는다(`skippedBusySubjects=0`). `measured.TX_USD` 가 그 거래의 금액이다. `cases[]` 는 거래마다 한 줄이고 `subject` 는 거래 ID(문자열), 거래 코드를 만들 수 있게 `txId` · `occurredAt` 이 같이 온다. `sweep.metric` 은 `TX_USD`(세는 거래의 맨 위 첫 건당 금액 줄)이고 값을 바꿀 때마다 세는 거래부터 다시 거른다.
  - STRUCTURING: FAN 과 같은 집계다. 금액 띠(하한 ≤ 금액 < 상한)는 세는 거래의 건당 금액 두 줄이고, `direction` 이 OUT 이면 보낸 쪽, IN 이면 받은 쪽 계좌가 대상이다. 그날의 측정값은 거래 건수가 가장 많은 검사 시점의 것이다.
  - SAME_AMOUNT: 검사 시점은 대상 계좌의 그 방향 거래 하나하나다(같은 분이어도 금액이 다르면 따로 검사). 기간 안 같은 방향 거래 가운데 금액이 **검사 거래 금액의 ±N%**(`NEAR_TRIGGER_AMOUNT`, 경계 포함) 안인 것만 센다. 검사 거래 자신도 센다. 범위는 나중 거래의 금액으로 정하므로 2,000 뒤의 2,105 는 걸리고(±5% 하한 1,999.75) 2,105 뒤의 2,000 은 안 걸린다(상한 2,100). 금액이 0 인 거래는 보지 않는다.
  - PASS_THROUGH: GATHER_SCATTER 와 같은 집계(검사 시점은 대상 계좌의 출금, 출금은 기간 안 첫 입금 시각부터)에서 상대 계좌 수를 보지 않고 받은 합계(`SUM_USD`)와 출금 ÷ 입금(`OUT_IN_RATIO`, %)만 본다. 그날의 측정값은 통과한 금액(받은 합계와 내보낸 합계 가운데 작은 쪽)이 가장 큰 검사 시점의 것이다.
  - 끝나면 룰 변경 기록에 `BACKTEST_DONE` 이 남는다.
- 상태 명령: 한 번에 버전 하나의 상태를 바꾸고 변경 기록에 남긴다. `revision` 은 그 버전의 현재 값이어야 하고 명령마다 1 오른다. `requestId` 를 주면 같은 요청이 다시 와도 한 번만 적용한다.

  | action | 누가 | 전 → 후 | 조건 | 사유(`comment`) |
  |---|---|---|---|---|
  | START_SHADOW | 작성자·ADMIN | DRAFT → SHADOW | 지금 조건으로 끝낸 백테스트 | |
  | SUBMIT | 작성자 | DRAFT·SHADOW → PENDING | 지금 조건으로 끝낸 백테스트 | |
  | WITHDRAW | 작성자 | SHADOW·PENDING → DRAFT | | |
  | APPROVE | ADMIN | PENDING → ACTIVE. 기존 운영 버전(ACTIVE·PAUSED)은 RETIRED | | 필수 |
  | REJECT | ADMIN | PENDING → DRAFT | | 필수 |
  | PAUSE | ADMIN | ACTIVE → PAUSED | | 필수 |
  | RESUME | ADMIN | PAUSED → ACTIVE | | 필수 |

  - 오류: 모르는 명령·사유 누락·사유 2,000자 초과 400, 권한 없음 403 `FORBIDDEN_ROLE`, 없는 룰·버전 404, 상태가 맞지 않음·`revision` 이 다름·백테스트 없음 409 `INVALID_TRANSITION`.
  - ADMIN 은 자기가 쓴 버전도 승인할 수 있고 그때 변경 기록의 `selfApproved` 가 true 다. `app.rules.self-approval=false` 면 403 이다.
  - 매일 실행할지는 버전의 `eval_from_seq` 로 정한다. SHADOW·ACTIVE 가 되는 순간의 가장 큰 분석 입력 순번(`analysis.runs.input_seq`)을 적고, 그보다 뒤에 입력이 고정된 분석부터 돈다. DRAFT 로 돌아가거나 PAUSED·RETIRED 가 되면 비운다. DRAFT 에서 바로 승인 요청한 PENDING 은 돌지 않는다.
- 일일 실행: 분석이 ALERTS 단계에 들어와 워커를 띄우기 직전에 돈다(`RuleRunStep`). SHADOW·PENDING·ACTIVE 버전 가운데 `eval_from_seq` 가 그 분석의 입력 순번보다 작은 것을 순서대로 돌린다.
  - 검사 날짜는 그 분석의 TARGET 거래가 있는 거래 기준일이다. 원장 첫날부터 `app.rules.warmup-days` 안의 날짜는 뺀다. 그 날짜의 거래 전체를 검사 시점으로 삼으므로 같은 날짜를 백테스트한 결과와 같다.
  - 실행 기록은 분석 × 버전에 한 줄(`rules.executions`)이다. 단계가 다시 돌아도 끝났거나 실패한 버전은 다시 돌리지 않는다. 적중(`rules.hits`)은 버전 × 대상 × 거래 기준일에 한 줄이고, 같은 날짜를 다시 검사하면 그 날짜의 적중을 새 결과로 바꾼다. 실행 당시 ACTIVE 였으면 `LIVE`, 아니면 `SHADOW` 다.
  - 버전 하나가 실패하면 `FAILED`(`TIMEOUT`·`INTERNAL`)로 남기고 다음 버전으로 넘어간다. 한 분석에서 룰 전체에 쓰는 시간은 10분이고 넘으면 남은 버전은 `BUDGET` 이다. 룰 때문에 ALERTS 단계가 실패하지는 않는다.
  - 룰 쿼리는 서버 한 대 안에서 한 번에 하나만 돈다. 일일 실행과 백테스트가 같은 줄에 선다.
- 사건의 룰 적중(`rule-hits`): 연결을 저장하지 않고, 사건의 현재 거래(`review.current_members`)와 적중의 근거 거래에 같은 거래가 있으면 걸린 것으로 본다. 운영 중일 때 만든 적중(`LIVE`)이고 실행과 그 분석이 끝난 것만 나온다. 시험 운영의 적중은 나오지 않고, 지금은 중지했거나 물러난 버전이 운영 중에 만든 적중은 나온다(`versionStatus`).
  - 카드 한 장은 Alert × 룰 버전 × 대상 계좌다. `hitDates` 는 걸린 거래 기준일들, `measured` · `conditions[].measured` 는 가장 최근 날의 측정값, `matchedTxIds` 는 사건의 거래 가운데 근거 거래인 것, `evidenceTxCount` 는 그 적중들의 근거 거래 수다. `conditions` 는 적중 조건을 그룹 구분 없이 순서대로 편 것이다. 경로형은 적중 조건이 없으므로 `{metric:"minHops",label:"순환 거래 수"|"경로 거래 수",cmp:"GTE",value,unit:"건",measured}` 한 줄이 온다(`measured` 는 `HOPS`).
  - 대상이 거래인 룰(LARGE_TX)은 걸린 거래마다 카드를 만들지 않고 **Alert × 룰 버전으로 한 장**에 모은다. `subjectType` 은 `TX`, `subject` 는 null 이고 걸린 거래는 `matchedTxIds` 에 있다. 조건 줄은 세는 거래의 건당 금액 줄(`{metric:"TX_USD",label:"건당 금액",cmp,value,unit:"USD",measured}`)이고 `measured` 는 그 Alert 에서 걸린 거래 가운데 가장 큰 금액이다.
  - `roles[{role,label,accountId}]` 는 대상 말고 보여 줄 계좌다. 따로 저장하지 않고 근거 거래에서 읽는다. SCATTER_GATHER 는 `SOURCE`(출발 계좌: 경유 계좌에 보낸 계좌) 다음에 `MID`(경유 계좌: 대상에 보낸 계좌), CYCLE · RANDOM 은 `PATH`(경로 계좌: 근거 거래에 나오는 대상 아닌 계좌)다. `accountId` 는 `subject` 와 같은 가명 계좌 ID 앞 8자리이고, 순서는 그 계좌가 처음 보낸 근거 거래의 시각 순이다(경로가 하나면 지나간 순서). 집계형 템플릿에서는 비어 있다.
- 목록의 적중 숫자: 끝난 실행, 끝난 분석의 적중만 센다.
  - `hitCount` · `lastHitDate`: 그 룰의 운영 적중(`LIVE`) 수(대상 × 날짜)와 가장 최근 거래 기준일. `shadowHitCount`: 지금 시험 운영(SHADOW·PENDING) 중인 버전이 쌓은 적중 수, 그런 버전이 없으면 null.
  - `linkedAlertCount`: 운영 적중의 근거 거래와 공개된 거래가 하나라도 겹치는 Alert 수(병합돼 사라진 Alert 제외). `normalRate`: 그 가운데 사람이 종결한 것에서 정상 ÷ (정상 + 의심) (%), 종결한 것이 없으면 null. Episode 에 편입된 Alert 는 그 Episode 의 판정을 따른다.
  - `skippedBusySubjects` · `lastRunFailed`: 가장 최근 일일 실행에서 바쁜 계좌라 평가하지 않은 대상 수와 그 실행이 실패했는지. 실행한 적이 없으면 null. `alertedHitCount` 는 Alert 생성을 제공할 때까지 null 이다.
