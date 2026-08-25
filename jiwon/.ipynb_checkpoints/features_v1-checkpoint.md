# 피처 명세 v1 — 단일 모델 트랙 (10클래스)

대상: HI-Small, `ts < 2022-09-11` (꼬리 제외, 팀 합의). 총 59개 = 단건 7 + 그래프 52.

## 공통 원칙
- 거래 = `u → v` (u 송금, v 수취 계좌). 계좌 키 = (은행, 계좌번호).
- 모든 집계는 해당 거래 시각 **t 미만** 데이터만 사용 (같은 분은 파일 순서상 앞 행까지).
- 금액은 환율표(`fx_rates_usd.txt`)로 USD 환산.
- 이력 없으면 0 (콜드 스타트).

## 단건 피처 (7)
| 피처 | 정의 |
|---|---|
| payment_format | 결제수단 (범주) |
| log_amount_usd | log1p(USD 환산 송금액) |
| amount_mismatch | 송금액 ≠ 수취액 |
| payment_currency / receiving_currency | 통화 (범주) |
| same_bank | 송금·수취 은행 동일 |
| self_account | 송금 계좌 = 수취 계좌 |

제외: hour(약함+0시 덤프 인공물), 요일(10일 데이터라 분할과 얽힘), 은행·계좌 ID(암기), 라운드 금액(표본 부족).

## 그래프 Tier 1 — 누적 이력 (u, v 각 9개)
| 피처 | 정의 |
|---|---|
| sent_cnt / recv_cnt | 과거 송신·수신 수 |
| sent_usd_log / recv_usd_log | 과거 송신·수신 USD 합 (log1p) |
| out_deg / in_deg | 고유 수신 상대 수 / 송신 상대 수 |
| age_min | 첫 등장 후 경과 분 |
| since_last_min | 직전 활동 후 경과 분 |
| flow_ratio | log((송신합+1)/(수신합+1)) — 패스스루 |

## 그래프 Tier 2 — 윈도우 24h/72h (u, v × 윈도우당 7개)
sent_cnt, recv_cnt, out_deg, in_deg, sent_usd_log, recv_usd_log,
burst = 윈도우 거래수 / (누적 거래수+1)

v의 송신 계열도 유지 — "받는 계좌가 배분 허브인가"가 FAN-IN vs GATHER-SCATTER 구분 근거.

## 그래프 Tier 3 — 엣지·2-hop (6)
| 피처 | 정의 |
|---|---|
| edge_cnt / edge_rev_cnt | 과거 u→v / v→u 거래 수 |
| edge_rev_cnt_72h | 72h 내 v→u |
| cycle3_flag_72h | 72h 내 시간순 v→x→u 경로 존재 (3홉 사이클 근사) |
| pass_speed_24h | 이번 금액 / (u의 24h 수신합+1) |
| amt_vs_hist | 이번 금액 / (u의 과거 평균 송금액+1) |

한계: edge_rev_cnt_72h·cycle3_flag_72h는 계좌당 최근 송신 50건 캡. 긴 사이클(4홉+) 탐지는 v2 후보.

## 산출물
`data_work/HI-Small_features_v1.parquet` — 컬럼 `orig_row`(원본 csv 0-기준 행 번호) + 피처 52. 단건 7개는 원본 컬럼에서 학습 시 파생. 라벨: `data_work/HI-Small_labels_10class.csv` (원본 행 순서 정렬, label 0=정상 1~8=패턴 9=패턴외 세탁, attempt_id).
