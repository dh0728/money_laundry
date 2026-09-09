# 은행 목업 프로그램

설계 `BANK-MOCK-20260909-v2`. 실제 은행을 대신해 하루치 CSV의 업로드 URL을 요청하고, 응답받은 Presigned URL로 S3에 직접 PUT하는 명령행 프로그램이다. Python 3.13 표준 라이브러리만 사용한다.

## 현재 서버와의 연결 상태

이 목업은 아래 새 계약을 구현한다. **현재 api-server/API.md v0.4 및 서버 구현과는 호환되지 않는다.** 서버의 S3 발급 기능·계약 변경은 별도 작업이며, 이 목업 구현에 포함되지 않는다.

| 항목 | 현재 서버 | 이 목업이 요구하는 계약 |
|---|---|---|
| 발급 경로 | `/api/bank/uploads` | `/api/v1/bank/uploads` (프록시가 경로를 그대로 백엔드에 전달) |
| 체크섬 | `sha256`, 64자리 소문자 hex | `checksumSha256`, SHA-256 digest의 Base64 |
| 기준일 | `businessDate` 선택 | 필수 |
| 발급 응답 | `bankId` 없음 | 인증된 `bankId` 포함 |
| 저장소 | `file:` 로컬 폴더 | HTTP(S) Presigned PUT |
| 체크섬 검증 | 실제 파일 체크섬 비교 미구현 | 체크섬 헤더를 서명에 연결하고 S3에서 대조 |
| 업로드 이후 | 완료 API를 통한 적재 시작 | 목업은 S3 업로드 응답 후 종료 |

완료 통지·원장 적재·도착 상태 연계는 이번 범위에 없다. S3에 저장됐다는 결과와 거래 내용 검증·DB 적재 성공은 다르다.

## 실행

새 계약의 API 서버, S3 업로드 권한 및 은행별 API 키가 준비되어 있어야 한다. 은행은 API 키로 식별하므로 `--bank`는 받지 않는다. 키는 환경변수로만 제공한다.

저장소 루트에서 PowerShell로 실행한다.

```powershell
conda activate aml
$env:BANK_API_KEY = '<은행에 발급된 API 키>'
python -B backend/bank-mock/bank_mock.py --api-url https://api.example.com --file ./transactions_2026-09-08.csv --business-date 2026-09-08
$LASTEXITCODE
Remove-Item Env:BANK_API_KEY
```

`--api-url`, `--file`, `--business-date`는 필수다. `--api-url`에는 예시처럼 서버 주소만 넣고 `/api/v1`은 붙이지 않는다. 목업이 `/api/v1/bank/uploads`를 붙인다. 기준일은 업로드 날짜가 아니라 CSV 거래내역의 날짜이며 `YYYY-MM-DD` 형식이다. 파일의 모든 거래가 그날에 속하는지, 거래 내용이 유효한지는 서버의 검증 책임이다. 목업은 파일이 읽을 수 있고 비어 있지 않은지만 확인한다. 파일은 체크섬 계산 시작부터 전송이 끝날 때까지 수정하지 않는다.

## 통신 계약

1. 파일 크기와 SHA-256을 계산한다. 파일 전체를 메모리에 올리지 않는다.
2. `POST /api/v1/bank/uploads`에 `X-Api-Key`와 다음 JSON을 보낸다.

```json
{
  "fileName": "transactions_2026-09-08.csv",
  "businessDate": "2026-09-08",
  "sizeBytes": 1048576,
  "checksumSha256": "<Base64 SHA-256>"
}
```

3. 서버는 은행 인증·요청 검사 후 저장 위치를 결정하고 다음 형태로 `201`을 응답해야 한다.

```json
{
  "uploadId": 123,
  "bankId": 70,
  "url": "https://storage.example.com/object?signature=...",
  "method": "PUT",
  "expiresAt": "2026-09-09T15:15:00+09:00",
  "headers": {
    "Content-Type": "text/csv",
    "x-amz-checksum-sha256": "<요청과 같은 Base64 SHA-256>"
  }
}
```

4. 목업은 응답 헤더를 사용하고 `Content-Length`를 설정해 CSV 바이트를 URL로 PUT한다. 은행 API 키는 넣지 않는다. 체크섬 헤더가 누락되거나 계산값과 다르면 전송하지 않는다. URL 만료·서명 유효성은 저장소에서 판정한다.
5. S3의 HTTP 2xx 응답을 받으면 성공을 출력하고 종료한다. `file:` 복사, 완료 API 호출, 자동 재시도는 하지 않는다. 리다이렉트도 따라가지 않는다.

서버가 `x-amz-checksum-sha256`을 서명 조건에 연결해야 한다. 목업이 헤더를 보낸다는 사실만으로 서버 서명과 실제 S3 검증이 완성되는 것은 아니다. [AWS PutObject 계약](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html), [Presigned URL 안내](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).

## 출력과 실패 대응

```text
[1/3] 파일 확인 완료: transactions_2026-09-08.csv
      기준일: 2026-09-08 / 크기: 1,048,576 bytes
[2/3] 업로드 URL 발급 완료: 은행 70 / uploadId 123
[3/3] S3 업로드 성공
결과: 성공 — 거래내역 CSV 전송 완료
```

종료 코드: `0` S3 업로드 성공, `2` 입력·파일 오류, `1` 통신·계약 오류 또는 결과 불명. 실패 단계와 가능한 경우 `uploadId`를 표준 오류에 표시한다. 서버 오류 본문·예외 원문은 서명 URL과 인증 정보 노출을 막기 위해 출력하지 않고 HTTP 상태를 보여준다.

인증 실패는 키를 확인하고, 용량 거절은 파일 한도를 확인한다. S3 403은 만료 또는 서명·권한 오류일 수 있으므로 서버 측에서 원인을 확인한다. 전송 중 연결이 끊기면 파일은 저장됐지만 응답만 유실됐을 수도 있다. 결과 불명일 때는 출력된 업로드 식별자로 서버/저장소 담당자가 저장 여부를 확인한 뒤 재전송 여부를 결정한다. 목업에는 상태 조회나 자동 재발급 기능이 없다.

요청별 소켓 대기 제한은 초기값 30초다. 전체 파일 전송의 총 소요 시간 상한을 뜻하지 않는다. 실제 최대 파일 크기·네트워크에서 충분한지는 아직 검증하지 않았다.

## 개발자 테스트

`test_bank_mock.py`는 목업의 요청·실패 처리를 확인하는 개발용 자동 테스트이며 은행 직원이 실행하는 업무 검증 프로그램이 아니다.

```powershell
conda activate aml
python -B -m unittest discover -s backend/bank-mock -p 'test_*.py' -v
```

임시 폴더와 로컬 HTTP 서버에서 날짜·크기·Base64 체크섬·실제 전송 바이트·API 키 분리·거절·응답 유실·잘못된 응답·입력 오류·비밀정보 비노출을 검사하고 자원을 정리한다. 실제 S3 서명, 만료, 체크섬 대조, HTTPS 및 EC2 관통은 이 테스트로 검증되지 않는다. 실제 API와 S3 연결 뒤 저장 파일 대조·만료 URL·체크섬 불일치 거절을 별도로 검증해야 한다.

`fixtures/`의 기존 합성 CSV는 보존되어 있으며 HI-Small 원본 분할 결과가 아니다. HI-Small 은행별·날짜별 분할은 목업 완료 후 별도 작업으로 진행한다.
