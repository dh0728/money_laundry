# BP↔STACK 혼동 케이스 분석 — 피처 기여도(SHAP)

작성: 2026-08-27. 대상: run_011b, val 의 BIPARTITE 49건·STACK 150건.
구조 시각화는 [confusion_case_visualize.html](confusion_case_visualize.html), 이 노트는
"모델이 실제로 어떤 피처를 보고 표를 던졌는가"를 LightGBM 기여도(pred_contrib)로
분해한다. STACK 정답은 걸침/포함 블록을 분리했다(걸침 정답 32건은 암기 성분
포함 — run_013 참고).

## 결론 요약

1. **혼동의 정체 = 공유 신호가 표의 대부분을 차지한다.** BP→STACK 오분류가 받은
   STACK 표의 상위 피처(payment_format +1.39, log_amount_usd +0.51, edge_cnt,
   u_in_deg_72h, v_age_min)는 STACK 정답(포함 블록)의 상위 피처와 **순서까지 거의
   동일**하다. 이 피처들은 "세탁답다"는 증거이지 "어느 패턴이냐"의 증거가 아니다
   — 두 클래스가 같은 피처 영역에 살고, 다수 클래스(STACK)가 그 영역을 가져간다는
   뷰어의 가설이 피처 수준에서 확인됐다.
2. **실제로 두 클래스를 가르는 스위치는 수신계좌(v)의 기존 활동 유무다.** 원값
   비교(마지막 표)가 극적이다: BP 정답 케이스의 수신계좌는 최근 72h 에 이미
   활동이 있고(v_sent_cnt_72h 중앙값 8, v_recv_cnt_72h 8), BP→STACK 오분류
   케이스의 수신계좌는 **완전 백지**(전부 0, u_flow_ratio 도 음전환)다. 즉 모델은
   "받는 쪽이 평소 활동 있는 기존 계좌면 BIPARTITE, 막 개설된/휴면 계좌면
   STACK(신설 중계층)" 이라는 규칙을 배웠다 — 생성기의 계좌 사용 습관을 학습한
   것으로, 구조 인식이 아니다.
3. **STACK→BP 오분류(21건)는 정확히 대칭이다.** BIPARTITE 표를 만든 피처가 BP
   정답과 동일(v_since_last_min, v_recv_cnt 등 "v 가 활동 있는 계좌" 신호) —
   스택의 간선이 기존 활동 있는 계좌로 향하면 BP 로 넘어간다.
4. **BP→NORMAL(19건)은 다른 실패다.** payment_format -3.36, edge_cnt -1.73 —
   결제수단이 정상형이고 거래쌍에 이력이 있으면 세탁 신호 자체가 꺼진다.
   클래스 혼동이 아니라 탐지 실패.
5. **진짜 판별 증거는 인과적으로 부재.** ST/BP 를 구조로 가르는 결정적 사실
   ("수신자가 이후에 또 보내는가")은 예측 시점엔 아직 일어나지 않았다. 거래 단위
   argmax 로 이 쌍을 가르는 것은 원리적 한계가 있다.

## 시사점

- **features_v2 후보**: 수신계좌의 단기 수신/송신 비율·휴면 기간 같은 "중계층
  후보" 신호를 명시 피처로 — 지금은 v_age_min·v_since_last_min 이 간접 대리.
  단, 이 축은 생성기 습관 의존이라 과신 금지.
- **근본 해법은 판정 층위 이동**: 블록 재구성 후 형태(중간계좌 비율·층 수·기간)로
  패턴을 판정하면 인과 제약이 없다(사후 조사 시점). 뷰어 분석의 결론과 일치.
- 혼동행렬 개선을 목표로 한 파라미터 튜닝은 무익 — 신호 자체가 겹쳐 있다.

## 기여도 표 (평균 기여, 상위 8)

### BP→STACK 오분류: STACK 점수를 만든 피처 (13건)
| 피처 | 평균 기여 |
|---|---|
| payment_format | +1.389 |
| log_amount_usd | +0.505 |
| edge_cnt | +0.269 |
| v_age_min | +0.181 |
| u_in_deg_72h | +0.181 |
| pass_speed_24h | +0.168 |
| v_since_last_min | +0.147 |
| u_age_min | +0.134 |

### STACK 정답(포함 블록만): STACK 점수를 만든 피처 (22건)
| 피처 | 평균 기여 |
|---|---|
| payment_format | +1.337 |
| log_amount_usd | +0.461 |
| edge_cnt | +0.268 |
| u_in_deg_72h | +0.214 |
| v_age_min | +0.189 |
| v_since_last_min | +0.162 |
| u_age_min | +0.156 |
| pass_speed_24h | +0.145 |

### STACK 정답(걸침 블록): STACK 점수를 만든 피처 (32건)
| 피처 | 평균 기여 |
|---|---|
| payment_format | +1.363 |
| log_amount_usd | +0.488 |
| edge_cnt | +0.255 |
| u_in_deg_72h | +0.195 |
| v_age_min | +0.189 |
| pass_speed_24h | +0.156 |
| u_age_min | +0.155 |
| v_recv_usd_log_72h | +0.128 |

### BP 정답: BIPARTITE 점수를 만든 피처 (9건)
| 피처 | 평균 기여 |
|---|---|
| payment_format | +0.964 |
| log_amount_usd | +0.550 |
| v_since_last_min | +0.404 |
| edge_cnt | +0.317 |
| u_age_min | +0.291 |
| v_recv_cnt | +0.273 |
| v_sent_cnt | +0.165 |
| u_recv_usd_log | +0.153 |

### BP→STACK 오분류: BIPARTITE 점수(못 받은 표)의 피처 (13건)
| 피처 | 평균 기여 |
|---|---|
| payment_format | +0.934 |
| v_since_last_min | +0.442 |
| log_amount_usd | +0.404 |
| edge_cnt | +0.290 |
| u_age_min | +0.213 |
| v_age_min | -0.156 |
| v_burst_72h | -0.136 |
| u_recv_usd_log | +0.117 |

### STACK→BP 오분류: BIPARTITE 점수를 만든 피처 (21건)
| 피처 | 평균 기여 |
|---|---|
| payment_format | +0.948 |
| v_since_last_min | +0.482 |
| log_amount_usd | +0.454 |
| edge_cnt | +0.315 |
| v_recv_cnt | +0.229 |
| u_recv_usd_log | +0.194 |
| v_sent_cnt | +0.171 |
| u_age_min | +0.168 |

### BP→NORMAL 오분류: NORMAL 점수를 만든 피처 (19건)
| 피처 | 평균 기여 |
|---|---|
| payment_format | -3.355 |
| edge_cnt | -1.731 |
| log_amount_usd | -0.801 |
| u_age_min | -0.476 |
| u_since_last_min | -0.312 |
| payment_currency | -0.221 |
| v_age_min | -0.206 |
| v_since_last_min | -0.180 |

### BP 정답 vs BP→STACK — 피처 원값 중앙값 차이 상위 8 (수치형)
| 피처 | BP정답 중앙값 | BP→ST 중앙값 |
|---|---|---|
| u_flow_ratio | 0.117 | -0.203 |
| v_sent_cnt_72h | 8 | 0 |
| v_sent_cnt_24h | 2 | 0 |
| v_recv_cnt_72h | 8 | 0 |
| v_recv_cnt_24h | 2 | 0 |
| v_out_deg_72h | 2 | 0 |
| v_out_deg_24h | 1 | 0 |
| v_in_deg_72h | 2 | 0 |
