# 실험 인덱스 — 단일 모델 트랙 (10클래스)

## 공통 조건 (별도 명시 없으면 전 실험 동일)

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

참고: `../data_notes.md` (데이터 특성, 문헌 벤치마크)
참고: [metrics_summary.md](metrics_summary.md) (전 실험 종합·클래스별 지표, val 재평가)
참고: [metrics_board.html](metrics_board.html) (같은 지표의 히트맵 보드 — 브라우저로 연다)
참고: [confusion_blocks_011b.html](confusion_blocks_011b.html) (run_011b 의 BIPARTITE·STACK·RANDOM 블록별 오분류 뷰어 — BP↔ST 혼동은 경계층 간선의 국소 동일성, RANDOM 은 블록 수준 서명(중계 비율 ~90%)만 존재)

## 다음 후보

파라미터 사다리 종결 — λ(100)·H하한(1.0)·리프(31)·라운드(1000)·점수정의(합) 확정.
현 기준선 run_011b: λ=100, `min_sum_hessian` 1.0, `num_leaves` 31, 상한 1000.

1. 개입 실험 1호: 배경 세탁(NONPAT) train 행 제거 — C 표 분석상 precision 붕괴의
   주범이자 D-4 최약(~3) 클래스. train 만 정제, val/test 원본 유지(§6)
2. (피처 방향) D-4 약체 신호용 피처 — FAN-OUT·FAN-IN(방향·시점), BIPARTITE(양측
   집합), RANDOM. features_v2 후보
3. purge 검증(개입의 일종): val 로 이어지는 블록의 train 거래 535건 제외 후
   재학습 — 완전 포함 블록 성능이 유지되면 경계 걸침은 암기 효과가 아님.
   metrics_summary 관찰 요약의 경계 걸침 편향(+4.7%p/+16.5%p) 후속

