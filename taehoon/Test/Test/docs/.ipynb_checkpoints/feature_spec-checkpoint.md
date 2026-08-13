# 피처 명세서 — 모델 입력 99차원 상세

- 작성일: 2026-08-13 · 기준 모델: G31 (HGB), G37m (PNA GNN) — 동일 피처 파이프라인
- 구성: **엣지 피처 81개 + 노드 피처 9개 × 2(송금·수취) = 99차원**
- 생성: `train_gnn_exp.py` (EDGE_NUM/EDGE_CAT/NODE_NUM, compute_* 함수) + 2차 캐시
- 공통 규칙: 모든 표준화는 **train 분할 통계**로, 모든 시계열 집계는 **타깃 시각 이전(과거)만** 사용

## 1. 엣지 피처 81개 — 블록별 구성

| 블록 | 개수 | 누적 위치 |
|---|---|---|
| A. 기본 엣지 (수치 6 + 원핫 37) | 43 | 0~42 |
| B. 시간/빈도 | 10 | 43~52 |
| C. 통화 robust z | 1 | 53 |
| D. USD 환산 금액 | 1 | 54 |
| E. 패턴 근사 | 8 | 55~62 |
| F. 사이클 모티프 | 8 | 63~70 |
| G. 자금통과 | 4 | 71~74 |
| H. 쌍 집계 | 6 | 75~80 |

### A. 기본 엣지 43개

수치 6개 (train 평균/표준편차 표준화):
- `log1p_amount_paid` — 송금액 log
- `is_exchange` — 환전 여부 (송금통화 ≠ 수취통화)
- `is_self_transfer` — 자기 이체 여부
- `hour_sin`, `hour_cos` — 시각 주기 인코딩
- `dayofweek` — 요일

원핫 37개 (범주 집합은 train 기준 고정):
- `payment_format` 7종: ACH, Bitcoin, Cash, Cheque, Credit Card, Reinvestment, Wire
- `payment_currency` 15종 / `receiving_currency` 15종: US Dollar, Euro, UK Pound, Yen, Yuan, Bitcoin, Swiss Franc, Canadian Dollar, Australian Dollar, Brazil Real, Mexican Peso, Ruble, Rupee, Saudi Riyal, Shekel

### B. 시간/빈도 10개 (`compute_timefreq_feats`, 전부 과거만, log1p)

| 피처 | 의미 |
|---|---|
| pair_prior_count | 동일 송금→수취 쌍의 과거 거래 횟수 |
| pair_dt | 동일 쌍 직전 거래와의 간격(분) |
| pair_c1 / pair_c24 | 동일 쌍 과거 1h/24h 거래 수 |
| src_dt | 송금자 직전 출금과의 간격 |
| src_c1 / src_c24 | 송금자 과거 1h/24h 출금 수 |
| dst_dt | 수취자 직전 입금과의 간격 |
| dst_c1 / dst_c24 | 수취자 과거 1h/24h 입금 수 |

### C. 통화 robust z 1개 (`compute_currency_z`)

- train의 통화별 log1p 금액 **중앙값/IQR**로 robust z-score, ±8 클립
- 목적: 통화마다 스케일이 다른 금액을 같은 척도로 (이상치에 강건)

### D. USD 환산 금액 1개 (`compute_currency_usd`)

- train의 환전 거래에서 통화쌍 중앙값 비율 산출 → BFS로 전 통화의 USD 환산율 도출
- `log1p(amount_paid × USD 환산율)` — 통화가 달라도 금액 크기 비교 가능

### E. 패턴 근사 8개 (`compute_pattern_feats`, 전부 과거만, log1p)

| 피처 | 의미 | 노리는 패턴 |
|---|---|---|
| rpair_pc / rpair_dt | 역방향(v→u) 거래 이력 횟수/간격 | 1-hop 왕복·사이클 |
| newcp_src_1h / 24h | 송금자의 신규 수취 상대 수 (1h/24h) | FAN-OUT·scatter |
| newcp_dst_1h / 24h | 수취자의 신규 송금 상대 수 (1h/24h) | FAN-IN·gather |
| cycle2_pc / cycle2_dt | 양방향 이력 공존(왕복 쌍) 빈도/간격 | 2-hop 사이클 근사 |

### F. 사이클 모티프 8개 (`cycle3_*.parquet`, GPU 산출)

- 윈도우 2종(24h, 1주) × 모티프 4종 = 8개, 전부 타깃 시각 이전 윈도우 내 unique 카운트
- `c3`: 수신자의 최근 송금처 ∩ 송금자의 최근 수취처 (3노드 순환)
- `cn_send`: 송금자 수취처 ∩ 수신자 수취처 / `cn_recv`: 송금처 ∩ 송금처 / `cn_med`: 매개 경유 근사
- log1p 후 표준화

### G. 자금통과 4개 (`passthru_*.parquet`) — 레이어링 핵심 신호

| 피처 | 의미 |
|---|---|
| pt_dt_log | 송금자의 직전 입금과의 시간 간격 log (받은 즉시 전달하는가) |
| pt_dt_none | 직전 입금 없음 플래그 |
| pt_ratio | 금액 / 직전 입금액 (log, 수수료 제외 전달 비율) |
| pt_sum_ratio | 과거 24h 출금합/입금합 비율 (log, 유출/유입) |

### H. 쌍 집계 6개 (`pairagg_*.parquet`) — train 고정 집계

- 학습 구간 거래만으로 (송금→수취) 쌍 통계를 집계 후 valid/test에 **고정 매핑** (롤링 아님 — 드리프트·누수 없음)
- `pa_cnt` 횟수 / `pa_amt_sum` 합 / `pa_amt_max` 최대 / `pa_rev_cnt` 역방향 횟수 / `pa_recency` 마지막 거래 시각 / `pa_new` train에 없던 신규 쌍 플래그

## 2. 노드 피처 9개 × 2 (송금 계좌 + 수취 계좌)

`NODE_NUM` 9개, **노드×split 3행 구조** (해당 split 구간의 계좌 행동), train 통계로 표준화:

| 피처 | 의미 |
|---|---|
| log1p_in_degree / log1p_out_degree | 입금/출금 차수 |
| log1p_total_sent / log1p_total_received | 총 송금/수취액 |
| log1p_tx_count | 거래 수 |
| log1p_self_transfer_count | 자기이체 수 |
| n_currencies | 사용 통화 종류 수 |
| n_payment_formats | 사용 결제형식 수 |
| net_flow_log1p | 순자금 흐름 (부호 보존 log) |

## 3. 실험으로 확인된 피처 관련 사실

- **전체 81개가 최적**: T3(시간·빈도+통화z) 부분집합 대비 전체 피처가 medium GNN에서도 우위 (G37m vs G36m)
- **쌍 집계(H)가 PDF GBT 베이스라인 최대 중요도 피처** (pair_prior_count)라는 기록이 pairagg 도입 근거
- **허브 한계**: 허브 관여 거래는 그래프 계열 피처(E·F·G)가 17만 이웃에 희석되어 신호 소실 — hub 플래그 추가(G40)로도 회복 안 됨. 허브 전용 가상 경유 피처가 필요한 상태 (`hub_subgraph_spec.md` §5)
- 합성 데이터셋(hili)은 82번째에 `is_li` 도메인 플래그 추가 (`hili_combine_design.md`)
