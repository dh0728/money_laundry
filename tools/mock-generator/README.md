# 목업 거래 생성기

IBM AML 거래 CSV를 **은행 API처럼** 재생해 수신 관문에 거래를 1건씩 보낸다.

백엔드 입장에서 이 생성기와 실제 은행 API는 구분되지 않는다. 나중에 은행 연동이
생기면 보내는 쪽만 바뀌고 수신 관문은 그대로다.

- Python 3.9+ / **표준 라이브러리만** 사용 (pip·venv 불필요)
- 원본 CSV는 `open(path, 'rb')` **읽기 전용**으로만 연다
- 중간 파일을 만들지 않는다

## 빠른 시작

수신 관문이 아직 없으므로 스텁 수신기로 확인한다.

```
python stub_receiver.py --port 8080
```

다른 터미널에서:

```
python generator.py --limit 100 --url http://127.0.0.1:8080/api/transactions
```

실제 백엔드가 뜨면 `--url`만 그쪽으로 바꾸면 된다.

## 플래그

| 플래그 | 기본값 | 설명 |
|---|---|---|
| `--csv` | `data/HI-Small_Trans.csv` | 원본 거래 CSV (읽기 전용) |
| `--url` | `http://127.0.0.1:8080/api/transactions` | 수신 관문 URL |
| `--date` | `2022/09/01` | 재생할 날짜(YYYY/MM/DD) 또는 `all` |
| `--speed` | `60` | 시간 배속. `1`이면 실시간 |
| `--max-rate` | `200` | 초당 전송 상한 (안전판) |
| `--limit` | `0` | 최대 전송 건수. 시각순 앞에서부터. `0`은 제한 없음 |
| `--epoch` | `now` | 재생 시작 시각 `YYYY-MM-DDTHH:MM`. 고정하면 페이로드가 재현된다 |
| `--timeout` | `10` | HTTP 타임아웃(초) |
| `--dry-run` | — | 전송하지 않고 페이로드만 출력. 대기 없이 즉시 |

## 보내는 것

```
POST <url>
Content-Type: application/json

{"transaction_id": "HI-Small-000000003", "timestamp": "2026/08/12 14:00",
 "from_bank": "03209", "from_account": "8000F4670",
 "to_bank": "03209", "to_account": "8000F4670",
 "amount_received": "14675.57", "receiving_currency": "US Dollar",
 "amount_paid": "14675.57", "payment_currency": "US Dollar",
 "payment_format": "Reinvestment"}
```

기대 응답은 `202 Accepted` + `{"ingest_id": "..."}`. 4xx는 재시도하지 않고(재전송해도
같은 결과다), 5xx와 연결 오류만 최대 3회 백오프 재시도한다.

### 필드 매핑

| 원본 CSV 열 | 전송 필드 |
|---|---|
| (행 번호에서 생성) | `transaction_id` |
| Timestamp | `timestamp` — 현재 시각축으로 시프트해서 보냄 |
| From Bank / Account | `from_bank` / `from_account` |
| To Bank / Account | `to_bank` / `to_account` |
| Amount Received / Receiving Currency | `amount_received` / `receiving_currency` |
| Amount Paid / Payment Currency | `amount_paid` / `payment_currency` |
| Payment Format | `payment_format` |
| **Is Laundering** | **보내지 않음 (정답 라벨)** |

## 설계 근거

**모든 값은 원문 문자열로 보낸다.** 은행 코드에 선행 0이 있어서(`010`, `001`, `03209`)
숫자로 바꾸면 값이 깨진다. 금액도 원문을 보존해야 수신 관문의 `payload_hash`가 안정적이다.
해석과 정규화는 수신 측 책임이다.

**열은 이름이 아니라 위치로 읽는다.** 원본 헤더에 `Account`가 두 번 나오기 때문에
`csv.DictReader`를 쓰면 뒤 값이 앞을 덮어써서 송신 계좌가 조용히 사라진다.

**시작할 때 원본을 훑어 시각순 인덱스를 만든다.** 원본은 시각순이 아니다(인접 행 역전율
약 48%). 파일 순서대로 보내면 DB에 쌓이는 원장이 "전 기간에서 무작위 표본"이 되는데,
이런 그래프는 운영에서 나오지 않아 그 위의 GNN 판정이 이전되지 않는다.

**거래 시각을 현재 시각축으로 시프트한다.** 원본은 2022년이라 그대로 보내면 거래시각과
수신시각이 4년 벌어지고, 대시보드의 기간 필터·시간대별 차트가 전부 어긋난다. 실제 은행은
두 시각이 거의 같다.

```
보낼 시각 = epoch + (원본시각 − 데이터 시작시각) ÷ 배속
```

`--epoch`를 지정하지 않으면 실행 시각을 쓰고, 종료 시 사용한 값을 출력한다. 같은 페이로드를
다시 만들려면 그 값을 그대로 넣으면 된다.

**정답 라벨은 보내지 않는다.** 실제 은행에는 라벨이 없다. 평가할 때는
`transaction_id`의 행 번호로 원본을 되짚으면 된다.

## 실측치 (HI-Small, 09/01 하루치 1,114,921건)

| 항목 | 값 |
|---|---|
| 인덱스 스캔·정렬 | 2.3초 |
| 메모리 | 인덱스 완성 후 200MB에서 **증가 없음**(재생 중 0.0MB 변동) |
| 단일 keep-alive 연결 처리량 | 약 970건/초 (스텁 수신기 기준) |

`--date all`은 5,078,345건이라 인덱스 메모리가 약 900MB까지 오른다.

## 원본 데이터 보호

이 도구는 원본에 쓰지 않지만, 실수를 구조적으로 막으려면 프로젝트 루트에서:

```
attrib +R "data\*.csv"
attrib +R "data\*.txt"
```

`attrib`은 파일 지정을 하나만 받으므로 한 줄에 하나씩 실행한다. 해제는 `+R`을 `-R`로.
쓰기는 차단되고 읽기는 그대로 된다.

## 아직 정하지 않은 것

- **수신 API 인증** — 팀 협의 미정이라 인증 헤더를 넣지 않았다. 정해지면 한 줄 추가한다.
- **필드명** — 이 이름들은 수신 관문(Spring Boot) DTO와 1:1로 맞아야 하고, 언어 경계 계약이라
  한쪽에서만 바꿀 수 없다.
