# 백엔드·추론 워커 배포

백엔드 워커는 API 컨테이너에서 Spring이 실행한다. 추론 워커는 별도 프로세스 `inference_server.py`이며 dev에서는 동일 이미지의 별도 컨테이너다.

### 라벨 독립 임시 추론

새 분석은 `demo-random-v1/demo-input-v1` 임시 변환기를 사용한다. 입력은 TARGET의 `tx_id,demo_value`, 출력은 `tx_id,p_laundering` 또는 `tx_id,p_0,...,p_8`이다. 라벨·패턴 대응표를 읽지 않는다. 이진 값은 [0,1) 균등 난수, 유형 값은 9개 균등 난수를 합계1로 정규화한다. 거래 ID·모델 종류·버전별 seed로 재시도·순서·분할에 무관한 값을 만든다. 탐지 성능을 의미하지 않는다.

- API와 추론 워커를 함께 배포한다. CSV를 다시 만들 필요는 없다.
- 기존 일반 더미 바인딩은 유지한다. 삭제된 demo-labels 버전의 미완료 실행은 새 실행이 필요하며 완료 이력은 그대로 둔다.
- 실제 모델 도입 시 계산기와 입력 피처를 모델 계약에 맞춰 교체한다. 요청·결과 전달과 검증 구조는 유지한다.

연결 범위는 입력 준비 → S3 게시 → 추론 API → 결과 수집/검증 → 점수 DB 저장이다.
Spring은 GET으로 상태를 확인한다. 콜백 환경변수는 비워 둔다. 점수 저장 다음 ALERTS에서
고정 맥락 기반 근거를 저장한 뒤 `COMPLETE / COMPLETED`로 종료한다. 현재 모델은 demo이며
실제 GNN의 탐지 성능을 검증한 것은 아니다.

## DB 역할과 초기 구조

기본 Flyway는 `db/migration/V1__initial_schema.sql` 하나다. Alert 거래에 당시 SEED 위험도를 함께 저장하여 목록 정렬의 JSON 반복 전개를 제거한다. 기존 V1이 적용된 dev는 사용자 결정에 따라 설정 백업 후 재초기화한다. 구 누적 이력이 있는 DB에 이 파일을 덮어 적용하지 않는다. [현재 ERD](../ERD.md)의 역할별 테이블과 [dev 전환 절차](../../../deploy/DB_TRANSITION.md)를 따른다.

- 수신 `ingest_entry.py`와 `analysis_entry.py --stage INTEGRATE`는 원문 보호·보고 통합·정정을 수행하므로 API의 데이터 작업 계정을 사용한다. `cryptography`는 이 단계의 AES-GCM 암호화/복호화와 Java 호환 검증에 필요하다. 조회 속도를 높이기 위한 라이브러리가 아니다.
- FEATURES/INFERENCE/SCORES/ALERTS는 `ANALYSIS_DB_USERNAME`·`ANALYSIS_DB_PASSWORD`의 별도 로그인으로 같은 DB에 접속한다. 누락 시 API 관리자 계정으로 대체하지 않는다. 자식 프로세스에서 원문 암호키와 API DB 환경변수를 제거한다.
- DB 관리자가 새 스키마 적용 후 `configure_analysis_db.py`를 명시 실행한다. 관리자 연결은 `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD`, 생성할 계정은 위 두 분석 환경변수로만 전달한다. 로그인 이름은 환경별로 다르게 지정하고 비밀번호는 24자 이상으로 준비한다. 이 도구는 DB를 만들지 않으며 `analysis_permissions.sql`의 권한만 부여한다.
- 분석 역할은 보호·평가 스키마와 직원 비밀번호 해시를 읽지 못한다. 배정 후보는 `core.assignable_staff` 뷰로 읽고 배정 시각만 갱신한다. 분석 진입점도 보호 스키마 접근 권한이 있으면 실행을 거절한다.
- dev/prod 배포 설정은 `/aml/{환경}/analysis-db/username`, `/aml/{환경}/analysis-db/password`를 읽는다. 비밀번호는 SecureString으로 보관하고 같은 값을 DB 로그인에 설정한다. 스크립트 작성·테스트는 실제 서버 권한 설정이나 배포 완료를 의미하지 않는다.
## 1. 이미지 빌드

빌드 context는 두 이미지 모두 `backend/api-server`다. 다음은 해당 폴더의
PowerShell 명령이다. 기존 CI도 이 context를 사용해야 한다.

```powershell
docker build -f Dockerfile -t aml-api:worker .
docker build -f worker/Dockerfile.inference -t aml-inference:demo .
```

API 이미지는 Java21·Python3.13을 포함한다. 두 이미지는 기존 requirements 버전을
사용하고 운영 모듈만 복사한다. 테스트 스크립트·로컬 설정·작업 데이터는 포함하지 않는다.
추론 이미지는 KubeSphere가 접근 가능한 팀 레지스트리에 게시한 후 그 이미지 주소로
실행한다. 이 문서의 로컬 태그만으로 원격 KubeSphere가 이미지를 가져올 수는 없다.

## 2. 먼저 준비할 인프라 설정

인프라 담당자가 아래 두 Parameter Store 값을 **dev 재배포 전에** 준비한다.
배포 스크립트가 직접 조회하므로 EC2 역할의 해당 경로 읽기/복호화 권한도 필요하다.

| Parameter Store | 내용 |
|---|---|
| `/aml/dev/inference/url` | EC2에서 접근 가능한 추론 워커 HTTPS 기본 주소. API 경로는 붙이지 않음 |
| `/aml/dev/inference/token` | 최소32자 무작위 공유 토큰, SecureString. 추론 워커의 INFERENCE_TOKEN과 동일 |

추론 워커 설정은 KubeSphere 환경변수/Secret으로 주입한다. 토큰을 명령 인수·커밋·채팅에
복사하지 않는다. 추론 워커에 DB 접속 정보나 AWS 장기 접근키를 넣을 필요는 없다.

| 추론 환경변수/설정 | 값 |
|---|---|
| `INFERENCE_TOKEN` | 위 공유 토큰 |
| `INFERENCE_OBJECT_BASE_URL` | 실제 S3 Presigned URL과 **scheme·host·prefix가 같은** 기본 URL, 끝 `/` 필수 |
| `INFERENCE_STATE_DIR` | 이미지 기본 `/state` |
| `INFERENCE_BIND` / `INFERENCE_PORT` | 이미지 기본 `0.0.0.0` / `8090` |
| `/state` 저장소 | 재배포·재시작 후 유지되는 볼륨, UID/GID10001 쓰기 가능 |
| 실행 수 | replica1, Uvicorn workers1. 같은 state를 두 서버가 동시에 열지 않음 |
| health | 내부 HTTP `:8090/health`, 성공 시 `{"status":"UP"}` |
| 외부 노출 | 기존 HTTPS 프록시/Ingress가 내부8090으로 전달. HTTP 우회·TLS 검증 해제는 사용하지 않음 |

예를 들어 virtual-host 방식 S3 주소라면 base는
`https://<bucket>.s3.<region>.amazonaws.com/<prefix>/`다.
path-style 주소를 임의로 섞지 않는다. 정확한 host는 실제 SDK 서명 URL 기준으로 확인하고
URL의 서명 query는 출력·공유하지 않는다. 입력 GET·결과 PUT이 모두 허용되어야 한다.
EC2 API 역할에는 기존 S3 prefix의 입력/결과 GetObject·PutObject 권한이 필요하다.

`/state`에는 SQLite 상태·입력/결과 캐시·서명 URL이 저장될 수 있으므로 일반 공개 파일
경로로 노출하지 않는다. 실행 중인 모델과 서버를 중단한 뒤 같은 저장소로 재기동한다.
비정상 종료 후 `RECOVERY_REQUIRED`는 성공/중단 확인을 대신하지 않는다.

이미지를 사용할 수 없고 기존 Python 환경만 쓸 수 있다면 다음 운영 파일을 같은 폴더에
배치한다: `inference_server.py`, `inference_service.py`, `inference_compute.py`,
`model_adapter.py`, `model_contract.py`, `demo_calculator.py`, `worker_transport.py`,
`requirements.txt`. Python3.13 환경에서 requirements를 설치하고 위 환경변수를 설정한 후
그 환경의 Python으로 `inference_server.py`를 실행한다. 수동 실행의 기본 bind는127.0.0.1이므로
프록시의 연결 방식에 맞게 지정한다. Jupyter 셀 종료/세션 단절에도 운영 서버가 유지되는
기동 방식은 KubeSphere 담당자와 확인한다.

## 3. EC2 API 배포

사용자의 기존 dev 반영/자동 배포 절차를 사용한다. `deploy-dev.sh`는 위 SSM 값을
`DEV_INFERENCE_API_URL/TOKEN`으로 주입한다. Compose는 다음 값을 사용한다.

- `WORKER_MODE=demo`, `WORKER_PYTHON=/usr/local/bin/python`
- `WORKER_SCRIPT=/app/worker/analysis_entry.py`, `WORKER_TIMEOUT=PT30M`
- `STORAGE_DIR=/app/storage`, 새 볼륨 `aml-dev-api-storage`
- DB 접속 정보는 Spring이 실제 datasource 설정에서 자식 프로세스에 전달

기존 `aml-dev-postgres-data`, DB URL, S3 prefix는 바꾸거나 초기화하지 않는다.
API 저장 볼륨은 새로 만들 때 이미지의 UID10001 권한으로 초기화된다. 추론 PVC처럼
빈 디렉터리로 덮어 마운트하는 환경에서는 UID/GID10001 쓰기 권한을 별도로 제공해야 한다.
EC2 IAM 역할 자격증명은 Python boto3에서도 접근 가능해야 한다. Java health 성공만으로
Python의 S3 권한까지 확인된 것은 아니다.

## 4. 실제 왕복 확인

1. KubeSphere HTTPS `/health`가200인지 EC2에서 확인한다. 인증서 신뢰·DNS·라우팅을
   확인하며 `--insecure`로 우회하지 않는다. 추론 API의 무인증 GET은401이어야 한다.
2. dev API `/actuator/health`가 UP인지 확인한다.
3. 아직 제출하지 않은 테스트 보고라면 AML 루트 PowerShell에서 기존 은행 목업으로
   세 파일을 올린다. 활성화한 conda aml 환경을 사용한다.

```powershell
$api = 'https://dev.aiaml.co.kr'
foreach ($bank in 70, 12, 21174) {
    & "$env:CONDA_PREFIX/python.exe" -B money_laundry/backend/bank-mock/bank_mock.py --api-url $api --bank-id $bank --file "money_laundry/backend/bank-mock/fixtures/bank_$bank.csv" --business-date 2022-09-01
    if ($LASTEXITCODE -ne 0) { throw "은행 $bank 업로드 결과를 먼저 확인하세요." }
}
```

동일 파일이 이미 수신됐다면409는 중복 접수 거절이다. 재전송이나 DB 삭제를 반복하지 말고
기존 uploadId/분석 작업을 조회한다. 새 dev 배포 스크립트는 해당 세 은행과 fixture 기간을
준비한다. 목업이 은행을 자동 등록하는 것은 아니다.

4. 신규 테스트 분석을 등록하고 작업 상세를 조회한다. 서비스 접근에 별도 인증이 있다면
   기존 인증 절차로 얻은 헤더를 `$headers`에 설정한다.

```powershell
$headers = @{}
$job = Invoke-RestMethod -Method Post -Uri "$api/api/v1/batch-jobs/analysis" -Headers $headers
$detail = Invoke-RestMethod -Uri "$api/api/v1/batch-jobs/$($job.jobId)" -Headers $headers
$detail | Select-Object jobId, status, currentStage, errorCode
$detail.models | Format-Table modelKind, phase, status, remoteStatus, errorCode, actionRequired
```

조회는 몇 초 뒤 반복한다. 같은 날 작업이 이미 있으면 신규 등록409가 발생한다.
`GET /api/v1/batch-jobs?type=ANALYSIS`로 실제 작업 ID·실패 단계를 확인하고 FAILED 작업만
`POST /api/v1/batch-jobs/{jobId}/resume`한다. 완료 작업을 다시 분석하지 않는다.

5. 두 모델이 `DONE/SUCCEEDED`이고 상위가 `COMPLETE/COMPLETED`까지 도달했는지 확인한다.
   ALERTS는 고정 맥락에서 근거를 구성·저장한 뒤 완료한다. 의심 씨앗0건은 Alert0건으로 정상 완료한다.
   `ALERT_ASSIGNEE_UNAVAILABLE`이면 실제 L1 사용자 등록이 필요하다. `PIPELINE_NOT_CONFIGURED`는
   정상 완료 경계가 아니라 워커 설정 오류다. 공개 점수·Alert API는 전체 완료 전 결과를 숨긴다.
   완료 후 `GET /api/v1/alerts?jobId={jobId}`, 상세 `/{alertId}`, `/{alertId}/versions`,
   `/{alertId}/graph`를 확인한다. jobId는 최신 공개 근거 버전의 생성 작업 기준이다.
6. DB 확인 권한이 있는 담당자는 실제 jobId를 넣어 아래 읽기 전용 SQL로 검증한다.

```sql
SELECT model_kind, phase, status, error_code
FROM analysis.model_tasks
WHERE run_id = (SELECT current_run_id FROM analysis.jobs WHERE job_id = :job_id);
SELECT stage, completed FROM analysis.stage_results
WHERE run_id = (SELECT current_run_id FROM analysis.jobs WHERE job_id = :job_id);
SELECT count(*), min(score_pct), max(score_pct) FROM analysis.scores
WHERE run_id = (SELECT current_run_id FROM analysis.jobs WHERE job_id = :job_id);
```

## 5. 취소·재기동 확인의 경계

- 배포 후 유휴 추론 워커를 같은 `/state`로 재기동하고 health 및 기존 요청의 GET 조회를
  확인한다. 진행 중 모델을 강제 종료하는 테스트와 분리한다.
- 실제 취소는 Spring의 기존 보고 정정 절차가 만든 cancellation을 사용한다. 작업 상세의
  `cancellations`에서 전달과 종료 확인을 구분한다. 운영 상태를 SQL로 임의 수정하지 않는다.
- 더미는 빠르게 끝나므로 늦은 취소의 `ALREADY_FINISHED`는 정상 응답일 수 있다.
  실행 중 중단 성공을 검증했다고 보고하지 않는다. 결정적 실행 중 취소·재시도 경합은
  기존 로컬 테스트가 다루며 실환경에서는 실제 관찰된 상태를 기록한다.
- 이번 패키징만으로 GNN 추론, 콜백, 독립 비동기 실행 슬롯 또는 원격 최종
  실패의 새 회차 재개가 완성된 것은 아니다.


## 고정 맥락·Alert 단계

`analysis_entry.py --stage ALERTS`는 `alert_pipeline.py`를 호출한다. Spring FREEZE_INPUT이
TARGET와 cutoff 이전에 유효하게 수신·통합된 전체 CONTEXT·기존 점수·날짜별 수신 범위를 동결한다.
실행 경로는 `alert_pipeline.py → flow_graph.build_flow_graphs` 하나다. 계좌 UUID는 내부 정수 코드로
변환하고 실제 거래 ID와 UTC microseconds를 보존한다. 과거 점수는 원래 실행의 임계값을 적용한다.
정책 `flow-evidence-2`는 씨앗 기준 ±72시간·방향별2홉으로 연결 근거를 찾고 핵심을 먼저 구성한다.
고립씨앗은 발행하지 않고 점수에 남겨 다음 실행에 재검토한다. 일반 이웃64·씨앗별C100·그래프C200,
핵심기간240시간을 적용하며, 저의심비율 허브는512건/20% 기준·이웃16으로 제한한다.
핵심4096 초과 연결은 관련 그래프로 분할하며 `boundaryWitnesses`와 `CORE_PARTITION`을 보존한다.
경계 관계는 자동 병합 근거와 구분한다. 기존 OPEN 씨앗 소속과 핵심 공간을 먼저 예약하여 재분석 시
분할이 무효화되지 않게 한다. 기존 거래·판정은 유지하며 새 맥락은 남은 공간만 채운다.
검사위치2000만·핵심별 보존 관계20만 초과는 `WORKER_INPUT_INVALID` 오류로 종료하며 부분 공개하지 않는다.
근거 JSON에는 정책 전체와 `witnesses`를 저장한다. 중복 관계를 전부 적재하지 않고 연결과 거래 포함을
설명하는 근거를 보존한다. 패턴 정답·패턴 추론·금액으로 모양을 강제하지 않는다.

OPEN의 추가 근거는 버전으로 보존한다. 종결·이관 사건에는 기존 처리에 없던 핵심/강한 연결 근거가 새 생성 기준을 충족할 때만 후속 Alert를 만들며, 맥락만 추가되거나 같은 근거가 반복되면 만들지 않는다.
기존 판정 대상은 변경하지 않는다. 신규 TARGET가0건이어도 기존 Alert 또는 동결 과거 점수가 있으면
모델을 재실행하지 않고 ALERTS에서 재검토한다. 새 정상 맥락만으로 과거 미소속 씨앗을 묶을 수 있다.
미등록·미수신·일부 보류와 정상 수신 후 연결 없음을 구분한다.

과거 버전 조회는 고정 거래·점수를 사용한다. 새 연결이 없으면 근거 버전을 복제하지 않고
coverage 검사만 남긴다. run/job이 모두 COMPLETED인 버전만 공개한다. 사용자 판정·이력·Episode 변경은 Spring review API가 담당한다. 실제 GNN 연결은 별도이며 현재 모델은 시연용이다. 상세 계약은 API.md §3·§9를 따른다.

동일 사건을 다른 run이 미완료 상태로 쓰고 있으면 `RUN_FENCED`로 차단한다. 동결 후 최신
완료 근거 버전이 바뀌어도 기존 동결 입력을 그대로 적용하지 않는다. 이 충돌은 같은 입력의
단순 resume으로 해결되지 않으며 경쟁 실행 정리와 새 스냅샷이 필요하다. 자동 재동결 정책은
구현하지 않았으므로 여러 분석 실행의 동시 사건 갱신을 정상 지원한다고 간주하지 않는다.

Alert 상태 조회는 `dataAsOf`(공개 근거의 수신 cutoff)와 `lastCheckedAt`(성공한 검사 시각)을 구분한다.
워커는 공개 계획과 체크포인트를 저장하고 Spring이 근거·coverage·checked_at을 완료 트랜잭션에서 공개한다. 재시도 시 성공한 검사 시각을 다시 쓰지 않는다.
API의 `forwardComplete`는 제거했다. Spring은 공개된 사건과 종결/병합 계보를 함께 동결한다.
Python 탐색 창은 각 씨앗에 고정되며 미래 수신 완료 플래그를 사용하지 않는다.

구 정책 근거가 있는 DB는 그대로 이어서 생성하지 않는다. 테스트 업무 데이터를 초기화한 뒤 재분석해야 한다.
구 생성기나 호환 분기를 배포하지 않으며 정책이 다른 근거를 만나면 저장 전에 명시적으로 거절한다.
사건 생애주기는 `alert_lifecycle.py`가 계획하고 `alert_plan_preparation.py`가 `analysis.alert_plans`에 저장한다. worker는 review 영역을 읽기만 하며, Spring `AlertPublisher`가 ALERTS 완료 트랜잭션에서 공개 포인터·업무 범위·요약·이력·수신자를 함께 반영한다. 계획 payload는 Python/Java 간 동일 바이트 SHA-256 검증을 위해 canonical JSON TEXT로 저장한다.

계획 단계는 사건 전체의 상세 JSON을 동시에 보관하지 않고 역할·관계 색인을 유지한 뒤 작업별 문서를 읽는다. NOOP는 근거 JSON을 복사하지 않으며, 완료된 준비 단계 재시도에서는 그래프를 다시 계산하지 않는다. Spring은 전체 계획을 검증한 뒤 작은 묶음으로 읽어 같은 트랜잭션에서 공개한다. `timingsMs`의 `inputRead`, `candidateBuild`, `planPreparation`, `publication`은 각각 입력 읽기·그래프 구성·계획 준비·Spring 공개 작업 시간(ms)이다. 마지막 값은 트랜잭션 commit이나 전체 업로드 시간을 포함하지 않는다.

Spring 분석 완료 경로는 공개 상태 반영 후 `AnalysisRunService.refreshQueryStatistics()`로 조회 관련 테이블의 PostgreSQL 플래너 통계를 수집한다. 작은 jobs/runs 테이블이 autovacuum 임계에 도달하지 않는 시연 환경도 포함한다. API 응답 캐시를 생성하는 작업이 아니다.

열린 Alert 하나에 연결된 새 거래는 조사 중에도 자동 편입하고 기존 직원 판정/제외/역할은 유지한다. 새 거래만 PENDING이다. 조사 중 사건 병합·기존 근거 제거·점수 재평가는 제안이며, 종결/이관 사건은 고정 범위를 보존한다. 자동 추가 이력은 추가 거래 ID·시각·연결 이유·전후 버전을 보존하고 동일 근거 재실행에서는 중복 알림을 만들지 않는다. 생애주기 전체의 배포 준비 여부는 현재 검증 상태 문서를 따른다.

제안 수락은 통합 잠금 → review 잠금 → 업무 시각/영향 사건 잠금 순서를 사용한다. 일부 담당자의 동의만으로 공개하지 않고, 마지막 동의 시 현재 거래 상태와 점수 출처까지 다시 검사한다. 정정으로 근거가 빠져도 저장된 직원 판정을 EXCLUDED로 덮어쓰지 않는다. 현재 범위 투영에서 제외하고 API의 withdrawnMembers와 당시 근거 버전으로 보존한다.

이번 생애주기 변경은 공개 포인터·계획·계보·제안 테이블 및 현재 요약을 V1에 포함한다. **이전 V1을 사용하는 dev에는 코드만 덮어 배포할 수 없다.** 설정 백업/업무 DB 재초기화 → 새 이미지 기동/Flyway V1 → 설정 복원 → configure_analysis_db.py로 분석 역할 권한 재설정 → 전송/분석 순서다. 기존 SSM 값과 원문 보호 키는 유지한다. 로컬 이미지 검증은 AML_TEST_DOCKER와 AML_TEST_API_IMAGE를 설정하고 `test_dev_inference_compose`를 실행한다. 이 검증은 실제 dev Compose를 임의 프로젝트/볼륨/네트워크로 격리해 사용하며 EC2나 S3를 변경하지 않는다.

### 대시보드 집계와 분석 역할

대시보드 조회 집계는 Spring의 `DashboardRefreshWorker`가 관리한다. Python의 통합/분석 쓰기는 DB statement trigger를 통해 같은 트랜잭션에 영향 영역/거래일 갱신 요청을 기록한다. 계산은 원본 커밋 후 백그라운드에서 수행하며 Python이 집계를 직접 갱신하거나 새 프로세스를 호출하지 않는다. 분석 역할의 ops 접근 금지는 유지한다. SECURITY DEFINER 트리거가 요청을 기록하므로 `analysis_permissions.sql`에 ops 쓰기 권한을 추가하지 않는다. 모델 점수 미공개/정정/공개 전환을 집계에서도 구분한다. 조회 API는 집계 작업을 실행하지 않는다.
