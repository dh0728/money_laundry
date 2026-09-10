# 은행 목업 프로그램

설계 `BANK-IDENTITY-20260910-v1`(업로드 흐름 `INGEST-S3-RESULT-20260909-v2` 유지). 은행의 하루치 거래 CSV를 S3에 올린 뒤 서버의 전체 검수·원장 적재 결과를 확인한다. Python 3.13 표준 라이브러리만 사용한다.

## 준비와 실행

서버에 실제 S3 설정과 활성 `dev` 프로파일이 준비되어 있어야 한다. API 키 없이 필수 `--bank-id`로 은행 코드(0~2147483647)를 전달한다. 현재는 해당 은행 직원으로 로그인했다고 가정하는 테스트용 동작이며 누구든 은행 코드를 지정할 수 있다. `local`도 허용하지만 `prod`가 함께 활성화되면 차단한다. 기본/미지정/그외 프로파일도 차단한다. PowerShell에서 저장소 루트 기준으로 실행한다.

```powershell
conda activate aml
python -B backend/bank-mock/bank_mock.py --api-url https://api.example.com --bank-id 12 --file ./transactions_2026-09-08.csv --business-date 2026-09-08
$LASTEXITCODE
```

`--api-url`에는 서버 주소만 넣는다. `/api/v1`은 목업이 붙이며 프록시는 경로를 그대로 백엔드에 전달한다. `--business-date`는 전송일이 아닌 파일의 거래 기준일(`YYYY-MM-DD`)이다. 한 파일은 서울 날짜로 하루치다. 목업은 파일이 읽을 수 있고 비어 있지 않은지 확인하고 크기·체크섬을 계산한다. CSV 내용·중복·거래일 검증은 서버가 한다. 송신·수신 계좌번호에 `|`가 있으면 서버가 파일 전체를 검증 실패로 거절한다. 전송 중 파일을 수정하지 않는다.

기존 업로드 결과만 다시 확인하려면 파일·기준일 없이 실행한다.

```powershell
python -B backend/bank-mock/bank_mock.py --api-url https://api.example.com --bank-id 12 --upload-id 123
```

재조회에도 동일한 `--bank-id`를 전달한다. 요청한 은행 코드와 작업의 은행 코드가 다르면404다. 이 검사는 실제 사용자 인증을 대신하지 않는다. 재조회 모드와 파일 업로드 모드는 함께 사용할 수 없다.

## Cloudflare Access가 있는 개발 환경

인프라팀에서 받은 Service Token은 목업을 실행하는 **같은 PowerShell**의 환경변수로 주입한다. 아래 값은 자리표시자이며 실제 값을 코드·명령 인자·문서에 넣지 않는다.

```powershell
$env:CF_ACCESS_CLIENT_ID = '<redacted>'
$env:CF_ACCESS_CLIENT_SECRET = '<redacted>'
python -B backend/bank-mock/bank_mock.py --api-url https://dev.aiaml.co.kr --bank-id 12 --file ./transactions_2026-09-08.csv --business-date 2026-09-08
Remove-Item Env:CF_ACCESS_CLIENT_ID
Remove-Item Env:CF_ACCESS_CLIENT_SECRET
```

API 발급 POST·완료 POST·결과 조회 GET에는 고정 `User-Agent: AML-Bank-Upload-Mock/1.0`을 보낸다. S3 PUT에는 이 API용 User-Agent를 추가하지 않는다.

두 값이 있으면 발급 POST·완료 POST·결과 조회 GET에만 `CF-Access-Client-Id`와 `CF-Access-Client-Secret`을 추가한다. `X-Bank-Id`는 그대로 보낸다. 두 값이 모두 없거나 빈 문자열이면 기존 방식으로 요청한다. 한 값만 있거나 HTTP 헤더로 사용할 수 없는 값이면 어떤 네트워크 요청도 보내지 않고 설정 오류(종료2)를 출력한다. 재조회 모드에도 같은 규칙을 적용한다.

S3 PUT에는 Cloudflare 토큰·은행 식별·Authorization·Cookie를 보내지 않는다. 서버가 이 헤더를 서명 헤더에 포함해도 PUT 전에 거절한다. HTTP 리다이렉트를 따라가지 않으므로 Access 로그인 화면 등으로302가 반환되면 요청 실패로 종료한다. 토큰 값과 원시 오류 본문은 출력하지 않으며 출력할 결과에 토큰이 반사돼도 가린다.

EC2에서 환경변수를 export해 실행할 경우 해당 셸과 자식 프로세스에만 상속된다. 별도 SSH/SSM 세션 또는 로컬 PC에는 자동 전달되지 않으므로 실행하는 환경에 다시 주입해야 한다. 목업은 AWS/SSM에서 토큰을 직접 조회하지 않는다. Cloudflare 인증 추가와 별개로 백엔드의 prod 임시 은행 식별 차단은 유지된다. 실제 Cloudflare 정책·토큰을 통한 연결 검증은 별도로 수행해야 한다.

## 요청과 결과

1. `POST /api/v1/bank/uploads`: `X-Bank-Id`, JSON `{fileName, businessDate, sizeBytes, checksumSha256}`. 체크섬은 SHA-256 digest의 Base64다.
2. 서버의201 응답 `{uploadId, bankId, url, method, expiresAt, headers}`를 받아 CSV 바이트를 S3로 PUT한다. `Content-Type`, `x-amz-checksum-sha256` 및 나머지 서명 헤더를 보내며 은행 식별·인증 헤더는 넣지 않는다. 파일을 나누어 읽어 전송한다.
3. 동일한 `X-Bank-Id`로 S3 성공 응답 후 `POST /api/v1/bank/uploads/{uploadId}/complete`로 완료를 알린다. 서버는 실제 객체 크기·체크섬을 확인하고 비동기 처리를 시작한다. 중복 완료 요청은 현재 상태를 반환한다.
4. 동일한 `X-Bank-Id`로 `GET /api/v1/bank/uploads/{uploadId}`를 호출하여 2초마다 최대30분 처리 결과를 확인한다. 완료 응답이 이미 최종 상태면 추가 조회 없이 결과를 출력한다.

성공 결과 예:

```text
파일명: transactions_2026-09-08.csv / 기준일: 2026-09-08
업로드 시각: 2026-09-09T15:00:00+09:00 / 처리 완료 시각: 2026-09-09T15:00:01+09:00
파일 행 수: 100 / 적재 행 수: 100
결과: 원장 적재 완료
```

`receivedAt`은 서버가 객체 수신을 확인한 시각, `finishedAt`은 처리 종료 시각이다. 확인할 수 없는 행 수·시각은 '확인되지 않음'으로 표시한다. S3 PUT 성공만으로 최종 성공을 보고하지 않는다.

- `COMPLETED`: 전체 검수·원장 적재 성공, 종료0.
- `VALIDATION_FAILED`: 오류의 행·컬럼·사유를 표시하고 수정 후 재업로드 안내, 종료1. 파일 내부중복·기존 원장중복·필수결측·형식·기준일 불일치는 파일 전체를 거절한다. 선택 라벨 결측은 허용한다. 오류행0은 정확한 행을 특정할 수 없는 파일 단위 오류다.
- `FAILED`: 서버 처리 오류로 관리자에게 작업번호로 상태 확인 요청, 종료1. 과거 실패 작업에 적재 행이 있을 수 있어 임의로 0건이라고 표시하지 않는다.
- 이미 완료된 동일 파일:409 `DUPLICATE_FILE`, 기존 파일명·업로드 시점만 안내, 종료1. 진행중 동일파일은 별도409 `UPLOAD_IN_PROGRESS`로 알린다.
- 입력/파일 오류: 요청 없이 종료2. 통신 오류·응답 유실·결과 확인 시간 초과: 종료1. 시간 초과는 서버 작업 실패를 뜻하지 않는다.

응답이 유실되면 저장·처리가 이미 진행됐을 수 있다. 출력된 uploadId로 재조회한다. `URL_ISSUED`는 서버가 수신 확인을 하지 않은 상태다. 재조회는 완료 통지를 자동 재시도하지 않으므로 PUT 응답 유실·완료 통지 전 중단 상태는 서버 담당자가 객체와 작업을 확인해야 한다. 자동 재전송·자동 재발급은 하지 않는다.

URL 만료만으로 완료 통지가 차단되지는 않는다. 새 URL을 재발급받았다면 최신 uploadId로 전송·완료해야 한다. 이전 URL_ISSUED 번호의 완료 요청은409 `UPLOAD_SUPERSEDED`로 거절된다. 이미 접수된 작업의 완료 요청을 반복하면 현재 상태를 돌려준다.

서명 URL 전체·raw 서버 오류 본문은 출력하지 않는다. 허용된 결과 필드만 읽고 URL을 가린다. 발급·결과 응답의 은행 코드가 요청과 다르면 실패로 처리한다. HTTP 요청별 소켓 대기 제한은30초이며 전체 파일 전송 시간의 총 상한은 아니다. 실제 최대파일/네트워크 환경 검증은 배포 후 필요하다.

## 백엔드 S3 설정과 배포 후 확인

서버는 AWS SDK v2의 기본 자격증명 체인을 사용한다. EC2 인스턴스 역할을 사용하며 키·역할 이름을 코드에 넣지 않는다.

- 서버 환경변수: `S3_BUCKET`, 환경별 `S3_PREFIX`(`dev/` 또는 `prod/`), `AWS_REGION`(기본 `ap-northeast-2`). 실제 키는 `{prefix}uploads/{bankId}/{uploadId}/{fileName}`이다.
- API 키 환경변수는 서버와 목업 모두 필요 없다. 최초 URL 발급에서 보고 은행을 자동 등록하므로 사전 DB 등록도 필요 없다. 최초 발급 전 은행은 도착 현황에 표시되지 않는다.
- `BANK_IDENTITY_DISABLED`(403)는 허용되지 않은 서버 프로파일, `VALIDATION_FAILED`(400)는 잘못된 은행 코드 등 요청 오류다. 운영에서는 임시 식별을 사용할 수 없다.
- 향후 직원 로그인과 소속 은행·업로드 권한 확인으로 요청 경계만 교체한다. 직원이 파일을 선택하는 수동 업로드가 최종 흐름이다.
- dev/prod 프로필에서 S3 설정이 누락되면 기동 실패한다. 기본/local의 로컬 폴더 저장소는 백엔드 테스트용이며 현재 목업은 `file:` 복사를 지원하지 않는다.
- 배포 후 컨테이너의 IAM 자격증명 접근과 환경별 prefix의 PUT/HEAD/GET 권한을 확인한다. `HeadObject checksumMode=ENABLED`로 체크섬을 확인하며 ETag로 대체하지 않는다. 버킷이 SSE-KMS를 사용하면 추가 KMS 권한이 필요할 수 있다. 실제 암호화 설정은 미확인이다.
- 실제 AWS·배포 검증은 사용자 commit/push/dev merge 이후 수행한다. 로컬 테스트 통과를 실제 S3 관통 성공으로 해석하지 않는다. 저장 파일 대조·체크섬 거절·권한·만료·전체 적재 결과 확인이 필요하다.

[AWS Presigned URL](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html), [HeadObject 체크섬·권한](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html).

## 개발자 테스트

```powershell
conda activate aml
python -B -m unittest discover -s backend/bank-mock -p 'test_*.py' -v
```

`test_bank_mock.py`는 목업이 제대로 요청하고 결과를 해석하는지 확인하는 개발용 테스트다. 은행 직원이 수행하는 서버 업무 검증이 아니다. 로컬 HTTP 서버·임시 파일·가짜 시계로 발급/PUT/완료/조회/실패/시간초과를 검사하고 자원을 정리한다. 백엔드 검수·트랜잭션은 PostgreSQL Testcontainers, S3 서명 설정은 오프라인 SDK 테스트로 검증한다.

`fixtures/`의 기존 합성 파일은 보존되어 있다. HI-Small 분할·데이터 생성·예약 전송은 이 프로그램에 포함되지 않는다.
