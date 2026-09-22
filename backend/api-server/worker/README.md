# 백엔드·추론 워커 배포

백엔드 워커는 EC2의 API 컨테이너 안에서 Spring이 `analysis_entry.py`를 실행한다.
추론 워커는 KubeSphere에서 `inference_server.py` 하나를 실행한다. 현재 모델은
`demo-calculator-v1` 더미이며 실제 GNN/학습 모델은 포함하지 않는다.

연결 범위는 입력 준비 → S3 게시 → 추론 API → 결과 수집/검증 → 점수 DB 저장이다.
Spring은 GET으로 상태를 확인한다. 콜백 환경변수는 비워 둔다. 점수 저장 다음 ALERTS에서
고정 맥락 기반 근거를 저장한 뒤 `COMPLETE / COMPLETED`로 종료한다. 현재 모델은 demo이며
실제 GNN의 탐지 성능을 검증한 것은 아니다.

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
FROM analysis_model_tasks
WHERE run_id = (SELECT current_run_id FROM batch_jobs WHERE job_id = :job_id);
SELECT stage, completed FROM analysis_run_stage_results
WHERE run_id = (SELECT current_run_id FROM batch_jobs WHERE job_id = :job_id);
SELECT count(*), min(score_pct), max(score_pct) FROM inference_results
WHERE job_id = :job_id;
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
TARGET와 씨앗 전후24시간의 CONTEXT·기존 점수·날짜별 수신 범위를 동결하며, Python은 패턴
확률로 모양을 강제하지 않고 실제 거래 연결로 후보를 구성한다. 초기 한도는 깊이2/100거래/
계좌 활동100이고 정책 버전은 `daily-peer-leaf-v3`이다. 한 후보에 다른 후보의 씨앗 거래가
포함될 때만 병합하며 비씨앗 거래 공유만으로 합치지 않는다. 정상 예측·미채점 거래의 탐색과
포함은 유지한다. 공유 계좌로 발견한 주변 거래는 그 이유만으로 추가 확장하지 않는다.
직접 상류·하류 흐름으로도 도달하거나 별도 씨앗인 경우에는 해당 경로에서 탐색을 계속한다. 과거 조회·관련 변경 기반 재검토 설계는 아직 적용하지 않았다.

OPEN의 추가 근거는 버전으로 보존한다. 종결·이관 사건의 추가 근거는 연결된 후속 Alert이며,
기존 판정 대상은 변경하지 않는다. 신규 TARGET가0건이어도 이전 씨앗의 미래창 수신이 덜 끝났다면
모델을 재실행하지 않고 ALERTS에서 보완한다. 하루 마지막 씨앗은 다음 날 보고를 받은 뒤
후속24시간까지 확인한다. 미등록·미수신·일부 보류와 정상 수신 후 연결 없음을 구분한다.

과거 버전 조회는 고정 거래·점수를 사용한다. 새 연결이 없으면 근거 버전을 복제하지 않고
coverage 검사만 남긴다. run/job이 모두 COMPLETED인 버전만 공개한다. 실제 GNN 연결,
사용자 판정·이력·Episode 변경 API는 별도 구현 범위다. 상세 계약은 API.md §3과 V6를 따른다.

동일 사건을 다른 run이 미완료 상태로 쓰고 있으면 `RUN_FENCED`로 차단한다. 동결 후 최신
완료 근거 버전이 바뀌어도 기존 동결 입력을 그대로 적용하지 않는다. 이 충돌은 같은 입력의
단순 resume으로 해결되지 않으며 경쟁 실행 정리와 새 스냅샷이 필요하다. 자동 재동결 정책은
구현하지 않았으므로 여러 분석 실행의 동시 사건 갱신을 정상 지원한다고 간주하지 않는다.

Alert 상태 조회는 `dataAsOf`(공개 근거의 수신 cutoff)와 `lastCheckedAt`(성공한 검사 시각)을 구분한다.
워커는 근거·coverage·checked_at·체크포인트를 원자 저장하고 재시도 시 검사 시각을 다시 쓰지 않는다.
API의 `forwardComplete`는 제거했으며 내부 미래창 기반 대상 선정 교체는 후속 작업이다.
