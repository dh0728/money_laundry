# 실험 인덱스 — 단일 모델 트랙 (10클래스)

## HI-Large 시리즈 (run_101~)

공통: HI-Large, 분할 train 08-01~09-23 / val 09-24~10-14 / test 10-15~11-05 (미개봉),
꼬리 11-06~ 제외. train = 세탁 전량 + NORMAL RUS 100:1 (시드 42, Large 공통 전처리).
피처: run_101~110 은 features_v1 61개, **run_111 부터 features_v2 84개**.
라벨: run_101~113 은 10클래스, **run_114 부터 9클래스**(NONPAT→패턴아님 병합 —
2026-08-30 팀 확정, 세탁 유무는 이단모델 이진 트랙 담당. CLAUDE.md §6).
모델 run_011b 승계(λ=100, H≥1.0, 리프 31, 상한 1000+ES 30). 평가 계약·Large
적응 2건은 run_101 파일 참조. 9클래스부터 정본 지표는 패턴 축(P@패턴R0.9·포함
닻·8클래스 OVR), 전체 세탁 닻은 참고.

| run | 단일 변인 | PR-AUC | P@R0.7 | 상태 |
|---|---|---|---|---|
| [101](run_101_large_baseline.md) | (Large 기준선, 011b 승계) | **0.6798** | **33.88%** | 완료(keep) — **현 기준선** |
| [102](run_102_sampling_ladder.md) | RUS 시드 42→43 | 0.6798 | 33.50% | 완료(keep) — 노이즈 자 ±0.38pp |
| [103](run_102_sampling_ladder.md) | CSSMC k15 비례 | 0.6795 | 33.67% | 완료 — RUS 와 알고리즘적 동치 |
| [104](run_102_sampling_ladder.md) | CSSMC k15 균등 할당 | 0.6660 | 31.59% | 완료(discard) — 노이즈 6배 악화 |
| [105](run_102_sampling_ladder.md) | K-proto 근사 비례 | =103 | =103 | 완료 — 표본 103 과 완전 동일 |
| [106](run_106_ratio_ladder.md) | 비율 100:1→10:1 | 0.6540 | 32.63% | 완료(discard) — 균형화 전면 악화 |
| [107](run_106_ratio_ladder.md) | 비율 100:1→200:1 | 0.6739 | 34.17% | 완료(discard) — 노이즈 내, 비용 2배 |
| [108](run_108_lambda_mini.md) | λ 100→10 | 0.6449 | 31.27% | 완료(discard) — λ=100 유지 |
| [109](run_109_ovr_probe.md) | 전용 이진 FAN-IN | 이진 0.3104 (p_k 0.304) | — | 완료 — 동률, OvR 기각 |
| [110](run_109_ovr_probe.md) | 전용 이진 BIPARTITE | 이진 0.1449 (p_k 0.143) | — | 완료 — 동률, OvR 기각 |
| [111](run_111_features_v2.md) | 피처 v1→**v2** (84개) | **0.6865** | **34.03%** | 완료(keep) — **현 기준선**, 패턴 OVR 전부 개선 |
| [112](run_112_drop_nonpat.md) | 개입: train NONPAT 제거 | 0.6438 | 15.24% | 완료(discard) — 패턴큐 +0.95pp vs 배경큐 상실, 무개입 유지 |
| [113](run_113_cascade2.md) | 전용 이진 NONPAT | 이진 0.109 (p_NONPAT 0.112) | — | 완료 — 패배, **캐스케이드 폐기 확정** |
| [113b](run_113_cascade2.md) | 〃 + 가중(spw 215) | 이진 0.007 | — | 완료 — 순위 붕괴 |
| [114](run_114_nine_class.md) | 라벨 10→**9클래스** (팀 확정) | P@패턴R0.9 **97.39%** | (패턴 축) | 완료(keep) — **현 기준선** |

종결된 설계 축: 다운샘플링(RUS·100:1, run_102~107) · λ(100, run_108) ·
전용 이진 무용(run_109~110·113) · 피처 v2 채택(run_111) · 라벨 9클래스(run_114).
**현 기준선 = run_114** (9클래스 · features_v2 · RUS 100:1 · λ=100).

종결(추가): 캐스케이드 — run_014(1단 동률)·113(2단 패배)로 폐기 확정,
**서빙 구조 = 평면 10클래스 + 두 점수(Σp_패턴 / p_NONPAT)** 최종.

다음 후보: BP↔STACK 블록 판정 레이어(이월 미결 — 거래 단위 한계의 근본 해법,
블록 재구성 서빙 레이어 설계 포함) · run_111 혼동행렬 소급 계산(보드용, ~50분) ·
test 개봉 준비(사용자 선언 대기 — §7)
팀 안건: 패턴 큐 전용 모델(run_112, +0.95pp) vs 서빙 복잡도 2배 · 분할·이진화
규칙 팀 합의(§6) · CLAUDE.md §6 갱신(전환 완료 조건 충족)

## HI-Small 시리즈 — 공통 조건 (별도 명시 없으면 전 실험 동일)

데이터: HI-Small, `ts < 2022-09-11` (꼬리 제외)
분할: train 09-01~06 / val 09-07~08 / test 09-09~10 (미개봉)
피처: `features_v1` (61개, `../features_v1.md`)
모델: LightGBM multiclass 10 / 평가: val
세탁점수: `1 - P(정상)`
주지표: recall 0.7 고정 precision (보조: recall 0.5·0.9, P@패턴R0.9 — 패턴 8클래스 닻, PR-AUC, max-F1)
진단지표: 클래스별 OVR PR-AUC 9개 — 판정에는 쓰지 않고 피처 방향 진단용. run_011 부터 기계 기록에 포함(이전 run 은 metrics_summary 재평가로 소급)
개입: 없음
기본 파라미터: lr 0.1, num_leaves 31, min_data_in_leaf 20, lambda_l2 0, max_bin 255, seed 42, num_threads 4, 라운드 300 + 조기종료 30
기계 기록: `data_work/runs/run_*.json` + 모델 (git 밖)
실행 환경: run_001~007 은 4코어 컨테이너(스레드 4, run_001 만 32). 2026-08-25 부터 Windows 로컬(스레드 12). 스레드 4/8/12/14 에서 PR-AUC 0.646306 동일 — 스레드 수는 결과에 영향 없음

## 인덱스

| run | 단일 변인 | PR-AUC | max-F1 | P@R0.7 | 상태 |
|---|---|---|---|---|---|
| [001](run_001_baseline.md) | (기준선) | 0.1146 | 25.32% | 0.11% | 완료(discard) |
| [002](run_002_lambda_l2.md) | `lambda_l2` 0→10 | 0.6463 | 67.06% | 28.09% | 완료(keep) |
| [002b](run_002b_thread_check.md) | =002 재현 (스레드 32→4) | 0.6463 | 67.06% | 28.09% | 완료(keep) |
| [003](run_003_min_sum_hessian.md) | `min_sum_hessian` 1e-3→1.0 | 0.4958 | 54.29% | 2.72% | 완료(discard) |
| [004](run_004_min_data_in_leaf.md) | `min_data_in_leaf` 20→200 | 0.0011 | 0.21% | 0.11% | 완료(discard) |
| [005](run_005_class_weight.md) | 클래스 가중치 역빈도 | 0.4497 | 45.40% | 12.40% | 완료(discard) |
| [006](run_006_es_prauc.md) | 조기종료 logloss→PR-AUC | 0.2721 | 46.99% | 11.77% | 완료(discard) |
| [007a](run_007_lambda_l2_sweep.md) | `lambda_l2` 10→1 | 0.4490 | 57.91% | 13.56% | 완료(discard) |
| [007b](run_007_lambda_l2_sweep.md) | `lambda_l2` 10→50 | 0.6502 | 66.38% | 29.54% | 완료(keep) |
| [007c](run_007_lambda_l2_sweep.md) | `lambda_l2` 10→100 | 0.6496 | 66.21% | **32.96%** | 완료(keep) — 기준선이었음 |
| [008](run_008_round_cap.md) | 라운드 상한 300→1000 | 0.6495 | 66.35% | 32.93% | 완료(discard) |
| [009a](run_009_lambda_l2_high.md) | `lambda_l2` 100→200 (상한 1000) | 0.6531 | 66.87% | 30.07% | 완료(discard) |
| [009b](run_009_lambda_l2_high.md) | `lambda_l2` 100→500 (상한 1000) | 0.6490 | 66.30% | 30.34% | 완료(discard) |
| [010](run_010_score_definition.md) | 세탁점수 정의 (007c 모델 고정) | — | — | max 25.55% / argmax 단일점 | 완료 — 현행 합 유지 |
| [011a](run_011_lambda_hessian.md) | `min_sum_hessian` 1e-3→0.1 (λ=100) | 0.6516 | 67.03% | 31.94% | 완료(discard) |
| [011b](run_011_lambda_hessian.md) | `min_sum_hessian` 1e-3→1.0 (λ=100) | **0.6652** | **68.98%** | 32.94% | 완료(keep) — **현 기준선** |
| [012a](run_012_num_leaves.md) | `num_leaves` 31→127 (011b 설정) | 0.6584 | 67.88% | 30.34% | 완료(discard) |
| [012b](run_012_num_leaves.md) | `num_leaves` 31→512 (011b 설정) | 0.6575 | 67.62% | 31.42% | 완료(discard) |
| [013](run_013_purge.md) | 개입: 경계 걸침 블록 purge | 0.6264 | 63.80% | 27.67% | 완료(discard) — 진단: 탐지 우위=이력(정당), 분류 우위=암기 |
| [014](run_014_9class.md) | 라벨 9클래스(NORMAL+NONPAT 합병) | 패턴PR-AUC 0.958 | — | P@패턴R0.9 92.8%(vs 93.1%) | 완료(keep) — 동률, 1단 후보 유효 |

참고: `../data_notes.md` (데이터 특성, 문헌 벤치마크)
참고: [../outputs/metrics_summary.md](../outputs/metrics_summary.md) (전 실험 종합·클래스별 지표, val 재평가)
참고: [../outputs/metrics_board.html](../outputs/metrics_board.html) (같은 지표의 히트맵 보드 — 브라우저로 연다)
참고: [../outputs/bp_stack_case_analysis.md](../outputs/bp_stack_case_analysis.md) (BP↔STACK 혼동의 피처 기여도 분석 — 가르는 스위치는 수신계좌 기존 활동 유무)
참고: [../outputs/split_boundary_note.md](../outputs/split_boundary_note.md) (분할 경계 걸침 편향 — 측정·purge·문헌·정책 종합)
참고: [../outputs/confusion_case_visualize.html](../outputs/confusion_case_visualize.html) (run_011b 의 BIPARTITE·STACK·RANDOM 블록별 오분류 뷰어 — BP↔ST 혼동은 경계층 간선의 국소 동일성, RANDOM 은 블록 수준 서명(중계 비율 ~90%)만 존재)

## 다음 후보

파라미터 사다리 종결 — λ(100)·H하한(1.0)·리프(31)·라운드(1000)·점수정의(합) 확정.
현 기준선 run_011b: λ=100, `min_sum_hessian` 1.0, `num_leaves` 31, 상한 1000.

1. run_015: 캐스케이드 2단 검증 — 전용 이진(교차 라우팅, 가중 변형 포함) vs
   10클래스의 `p_NONPAT`. 지면 캐스케이드 폐기, "평면 + 두 점수 서빙" 확정
2. 패턴 큐 점수 정의 교체 검토 — Σp_패턴 기준 P@패턴R0.9 (run_014 부수 발견:
   79.7→93.1%). 지표 정의 변경이라 소급 재계산 필요, §7 합의 사항
3. 개입 실험 1호: 배경 세탁(NONPAT) train 행 제거 — train 만 정제(§6)
4. (피처 방향) features_v2 — FAN-OUT·FAN-IN(방향·시점), BIPARTITE(양측 집합),
   RANDOM, 중계층 후보 신호(bp_stack_case_analysis 참고)
3. (종결) purge 검증 → run_013: 탐지 우위는 정당(이력 피처), 분류 우위는 암기.
   purged 학습 미채택, 층화 보고 + 판정 시 포함 지표 교차 확인으로 관리

