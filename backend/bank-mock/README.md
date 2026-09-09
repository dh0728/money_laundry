# 은행 목업 프로그램

은행을 대신해 CSV 한 파일을 AML API에 전송한다. API.md §1.1의 URL 발급 → 파일 전송 → 완료 통지를 순서대로 수행한다. Python 3.13 표준 라이브러리만 사용한다.

## 실행 준비

PowerShell에서 `conda activate aml`로 Python 환경을 활성화한다. 서버는 PostgreSQL 17에 연결되어 있어야 하며, 보고 은행의 API 키를 설정한 후 기동해야 한다.

서버 프로세스에 설정할 환경변수:

```powershell
$env:BANK_API_KEYS = '70:<은행70키>,12:<은행12키>,21174:<은행21174키>'
```

각 `<...키>`를 실제 사용하는 값으로 바꾼다. 키는 커밋하지 않는다. 서버는 API 키로 은행을 식별한다. `--bank`는 출력에 표시하는 값이며 서버 권한을 바꾸지 않는다. `021174`와 `21174`는 같은 정수 코드로 표시된다.

## CSV 한 파일 전송

저장소 루트에서 실행:

```powershell
conda activate aml
$env:BANK_API_KEY = '<은행70키>'
python -B backend/bank-mock/bank_mock.py --bank 70 --file backend/bank-mock/fixtures/bank_70.csv
$LASTEXITCODE
```

`--api-url` 기본값은 `http://localhost:8080`이다. 다른 서버 주소를 지정할 수 있다. `--api-key` 인자로도 키를 전달할 수 있지만 환경변수를 사용하면 키가 명령 인자에 남지 않는다.

- `file:` 업로드 URL: 파일을 해당 로컬 경로에 복사한다. API 서버와 목업이 같은 파일시스템에 접근할 수 있어야 한다. 로컬 PC에서 EC2의 `file:` 경로로 업로드할 수는 없다.
- `http:`/`https:` 업로드 URL: 발급 응답의 URL과 헤더로 파일을 PUT한다. 은행 API 키는 저장소 PUT에 전달하지 않는다. 리다이렉트는 자동으로 따라가지 않는다.
- 파일 전체를 메모리에 올리지 않고 SHA-256 계산과 PUT을 수행한다. HTTP 요청별 타임아웃은 30초이며 자동 재시도는 하지 않는다.

성공 시 `{"bank":70,"response":{...}}` 형식의 JSON을 출력하고 종료 코드 0을 반환한다. 응답의 `bankId`가 서버에서 식별한 은행이다. 실패 시 단계와 가능한 경우 `uploadId`를 표준 오류로 출력하고 0이 아닌 코드로 종료한다.

**종료 코드 0은 완료 통지가 접수됐다는 뜻이다. 원장 적재 성공까지 의미하지 않는다.** 적재는 비동기로 진행되므로 출력된 `uploadId`로 결과를 확인한다.

```powershell
Invoke-RestMethod 'http://localhost:8080/api/uploads/<uploadId>'
```

`COMPLETED`는 적재 완료, `VALIDATION_FAILED`는 CSV 검증 실패, `FAILED`는 적재 오류다. 전송 또는 완료 통지 중 실패했다면 출력된 `uploadId`로 상태를 확인한 뒤 대응한다.

## 은행 3곳 관통 확인

`fixtures/`는 개발자가 작성한 최소 합성 데이터로, 각 은행 CSV에 거래가 1건씩 있다. 원본 데이터나 모델팀의 최종 시연 CSV를 추출한 것이 아니다. 탐지 모델 품질 검증용으로 사용하지 않는다.

```powershell
$env:BANK_API_KEY = '<은행70키>'
python -B backend/bank-mock/bank_mock.py --bank 70 --file backend/bank-mock/fixtures/bank_70.csv

$env:BANK_API_KEY = '<은행12키>'
python -B backend/bank-mock/bank_mock.py --bank 12 --file backend/bank-mock/fixtures/bank_12.csv

$env:BANK_API_KEY = '<은행21174키>'
python -B backend/bank-mock/bank_mock.py --bank 021174 --file backend/bank-mock/fixtures/bank_21174.csv

Remove-Item Env:BANK_API_KEY
```

각 실행의 종료 코드와 최종 상태를 확인한다. 신규 DB 기준 완료 작업 3개, 원장 거래 3개, 평가 라벨 3개가 생성돼야 한다. `GET /api/banks/arrivals`는 도착 현황을 보여준다. 이미 적재 완료한 동일 파일을 다시 보내면 URL 발급 단계에서 409 `DUPLICATE_FILE`이 발생한다. 재검증을 위해 기존 DB 데이터를 임의 삭제하지 않는다.

## 테스트

저장소 루트에서:

```powershell
conda activate aml
python -B -m unittest discover -s backend/bank-mock -p 'test_*.py' -v
```

임시 폴더와 로컬 HTTP 서버로 파일 복사·PUT·해시·인증 헤더·실패 종료를 검증하고 자동 정리한다. 실제 S3 인증 및 EC2 네트워크 연결은 이 테스트 범위에 포함되지 않는다.
