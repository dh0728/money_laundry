# API 계약 초안 v0.1 — 2026-09-02

지위: **프론트·팀 합의 전 초안.** `[미정]` = 합의 필요 항목. 합의 결과는 이 문서를 갱신하고 kickoff 체크포인트에 기록.
용어: kickoff §2.5 — `거래 → (임계 선별) 의심 거래 → (자동 묶음) Alert → (조사·연결) Episode`. 구 명칭 혼용 금지.
이 문서는 W2 [DB 설계]의 입력이다.

## 0. 공통 규칙

- 점수는 전부 0~1 실수. 시각은 ISO-8601 UTC. 금액·통화 표기 `[미정: FE 합의]`.
- 유형은 코드(0~8) + 코드명 매핑표(§2 유형 코드 매핑표)로 고정. 모델링(run_114) 라벨 인코딩을 그대로 쓴다 — 모든 파트가 이 번호로 개발한다.
- 식별자는 서버 발급으로 통일: `uploadId`, `alertId`, `episodeId`.
- 모든 처분 액션은 감사 이력을 부수효과로 기록 (actor·action·상태 전이·의견·시각).
- JSON 필드는 camelCase (BE↔FE). 워커 산출물(파일)은 snake_case — BE가 경계에서 변환.
- 에러 응답 모양 `[미정: FE 합의 — ControllerAdvice 도입 시점에 함께 확정]`.
- 페이지네이션·정렬 파라미터 컨벤션 `[미정: FE 합의]`.
- 인증·역할(L1/L2/ADMIN) 검사 방식 `[미정: kickoff §7 미결 — 액션별 권한이 걸림]`.

## 1. 층 1 — 수집 (업로드)

### POST /api/uploads  (W1 구현됨)
- 요청: multipart/form-data, `file` = 은행별 거래 CSV (한도 200MB).
- 응답 200: `{ "uploadId": "<uuid>", "rowCount": <int> }`
- 10월: 은행별 Presigned URL + S3 직행으로 전환 예정(멀티파트는 시연용 지름길). 처리현황·오류 조회 API는 그때 추가.

## 2. 층 2 — 거래 점수·의심 거래

### 추론 에이전트→BE 점수 산출물 (거래 1건당) — 확정 2026-09-03
모델은 이진 분류 + 9클래스 유형 분류 **병렬**. 추론 에이전트는 확률 원값만 내고 파생 점수는 BE가 계산한다. 운반은 S3의 `results/{jobId}/scores.parquet` (kickoff §2 경로 계약).

| 컬럼 | 내용 |
|---|---|
| `tx_id` | 원장 거래 식별자 (W2 DB 설계에서 발급 — W1 더미의 `tx_row`를 대체) |
| `p_laundering` | 이진 모델의 세탁 확률. **의심 거래 임계는 여기에 건다** |
| `p_0` … `p_8` | 9클래스 모델의 클래스별 확률 (코드는 아래 매핑표) |

- BE 파생: `typeClass` = p_0..p_8 중 최대의 코드(p_0이 최대면 **0 그대로** — 확정 2026-09-03), `typeScore` = 그 확률.
- `ruleHits[]`는 룰 기반 도입(10월 이후) 전까지 빈 배열 — 추론 산출물이 아니라 BE 룰 엔진 산출.
- W1 더미 워커(`anomaly_score`/`type_score`/`type_class`)는 이 형식으로 교체 예정(W2 [모델 래핑]).

### 유형 코드 매핑표 (확정 2026-09-03 — 모델링 run_114 라벨 인코딩 그대로)

근거: 학습 스크립트(`train_eval_large.py`) 클래스 순서 · `data_work/HI-Large/prepare_report.txt` 클래스 분포 순서 · run_114 혼동행렬 열 순서 일치. IBM AMLworld 패턴명이 정본이며 API의 `typeClass`(코드)·명칭 필드는 이 표를 따른다.

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

- 코드 0은 "정상"이 아니라 **패턴아님**이다: 정상 거래와 패턴에 속하지 않는 세탁(구 10클래스의 `NONPAT`, 라벨 9)이 병합돼 있다. 세탁 유무 판정은 이단모델 이진 트랙(다른 팀원) 담당이므로 코드 0이면서 점수가 높은 거래가 존재할 수 있다.
- 구 10클래스의 라벨 9(`NONPAT`)는 9클래스 출력에 나오지 않는다. 코드 9를 받으면 오류로 취급한다.

- 배치 메타(`batch_id`, `model_version`, `threshold_version`)는 W2 DB 설계에서 저장 위치 확정.

### GET /api/suspicious-transactions  (W1 구현됨 — 구 경로 /api/alerts에서 개명)
- 임계(`threshold`) 이상 거래 목록, 점수 내림차순. W1은 파일 기반·전체 반환, W2에서 DB 조회 + 페이지네이션.
- 행(W1 현재): `{ "uploadId", "txRow", "anomalyScore", "typeScore", "typeClass", "ruleHits[]" }` → W2 목표: `{ "txId", "laundering"(=p_laundering), "typeClass", "typeScore", "ruleHits[]" }` + 일별 분석 작업 ID. 필드명 최종 표기는 FE 합의 시 함께.
- 주의: 이건 **의심 거래** 목록이다. Alert(묶음) 목록은 층 3 — W3에서 별도 구현.

## 3. 층 3 — Alert

### 워커→BE 적재 계약 (배치 산출물, Alert 1건당)

| 필드 | 내용 |
|---|---|
| `alert_key` | 배치 내 생성 키 (DB가 alertId 발급) |
| `transactions[]` | 구성 거래 식별자 목록 |
| `risk_score` | Alert 위험도 (거래 점수와 별도 산출, 산출식은 Data 파트 소유) |
| `primary_type` | 대표 유형 코드 (+ `type_distribution` 유형별 구성비, 선택) |
| `first_tx_at` / `last_tx_at` | 작전 기간 |
| `accounts[]` / `banks[]` | 참여 계좌·기관 |
| `batch_id`, `model_version`, `threshold_version` | 추적 메타 |

### BE→FE 조회
- **GET /api/alerts** — 목록. 기본 정렬 `riskScore`↓, 필터 status·유형·기간·기관, 페이지네이션 `[미정: 컨벤션]`.
  행: `{ alertId, riskScore, primaryType(코드+명칭), txCount, firstTxAt, lastTxAt, banks 요약, status, episodeId(연결 시) }`
- **GET /api/alerts/{id}** — 상세: 목록 필드 + `transactions`, `typeDistribution`, `graph`.
- 관계 그래프: `graph { nodes[{id, kind: account|bank, label}], edges[{from, to, txCount, totalAmount, direction}] }`
  — 상세에 포함 vs `GET /api/alerts/{id}/graph` 분리 `[미정: FE 시각화 라이브러리 입력 형태에 맞춤]`.

### Alert 상태 enum (제안)
`OPEN`(큐 대기) → `CLOSED_NORMAL` / `CLOSED_FALSE_POSITIVE`(L1 종결) / `ESCALATED`(Episode 귀속됨)

### L1 처분 액션
- **POST /api/alerts/{id}/close** `{ resolution: NORMAL|FALSE_POSITIVE, comment }` → 상태 `CLOSED_*`, 감사 기록.
- 심층 요청 = Episode 생성/연결과 한 동작 (별도 "요청" 리소스 없음):
  - 신규로 묶어 넘기기: **POST /api/episodes** `{ alertIds[], comment }` → Episode 생성 + Alert들 귀속·`ESCALATED`
  - 기존에 붙여 넘기기: **POST /api/episodes/{id}/alerts** `{ alertIds[] }`

## 4. 층 4 — Episode·조사

### 조회
- **GET /api/episodes** — 목록: status·담당자 필터. 정렬 `[미정: Episode 위험도 — 소속 Alert riskScore 최대값 파생 제안, 산출식 팀 확인]`
- **GET /api/episodes/{id}** — 상세: `alerts`, `status`, `assignee`, 생성·종결 정보, 감사 이력.

### Episode 상태 enum (제안)
`INVESTIGATING`(심층 조사 중) → `CLOSED`(종결·사유 필수)

### L2 액션
- **POST /api/episodes/{id}/alerts** — Alert 추가 연결 / **DELETE /api/episodes/{id}/alerts/{alertId}** — 연결 해제 (이동 = 해제+연결)
- **POST /api/episodes/{id}/assign** `{ userId }` — 재배정
- **POST /api/episodes/{id}/close** `{ reason }` — 종결 사유 필수
- Alert 분리·병합(10월 구현, 시그니처만 예약): **POST /api/alerts/{id}/split**, **POST /api/alerts/merge**

### 감사 이력
- **GET /api/alerts/{id}/history**, **GET /api/episodes/{id}/history** — 행: `{ actor, action, from, to, comment, at }`

## 5. 미정 목록 (합의 후 이 문서 갱신)

1. ~~거래 점수 2종의 실제 의미·필드명~~ → 확정 2026-09-03 (§2 산출물 표: p_laundering + p_0..p_8, 파생은 BE). typeClass 파생 규칙 포함
2. ~~유형 코드 0~8 ↔ 명칭 매핑표~~ → 확정 2026-09-03 (§2 매핑표). 한글 표시 명칭만 FE 합의 잔여
3. Episode 위험도 산출식 (파생: max Alert riskScore 제안)
4. 페이지네이션·정렬 파라미터 컨벤션 (FE 합의)
5. 그래프 응답 포맷·분리 여부 (FE 시각화 라이브러리 기준)
6. 에러 응답 모양 (FE 합의)
7. 인증·역할 검사 방식 (kickoff §7 기존 미결)
8. 금액·통화 표기 (FE 합의)
