# 실험 인덱스 — 단일 모델 트랙 (10클래스)

## 공통 조건 (별도 명시 없으면 전 실험 동일)

데이터: HI-Small, `ts < 2022-09-11` (꼬리 제외)
분할: train 09-01~06 / val 09-07~08 / test 09-09~10 (미개봉)
피처: `features_v1` (61개, `../features_v1.md`)
모델: LightGBM multiclass 10 / 평가: val
세탁점수: `1 - P(정상)`
주지표: recall 0.7 고정 precision (보조: recall 0.5·0.9, PR-AUC, max-F1)
개입: 없음
기본 파라미터: lr 0.1, num_leaves 31, min_data_in_leaf 20, lambda_l2 0, max_bin 255, seed 42, num_threads 4, 라운드 300 + 조기종료 30
기계 기록: `data_work/runs/run_*.json` + 모델 (git 밖)
실행 환경: run_001~007 은 4코어 컨테이너(스레드 4, run_001 만 32). 2026-08-25 부터 Windows 로컬(스레드 12). 스레드 4/8/12/14 에서 PR-AUC 0.646306 동일 — 스레드 수는 결과에 영향 없음

## 인덱스

| run | 단일 변인 | PR-AUC | max-F1 | P@R0.7 | 상태 |
|---|---|---|---|---|---|
| [001](run_001_baseline.md) | (기준선) | 0.1146 | 25.32% | 0.11% | 완료(discard) |
| [002](run_002_lambda_l2.md) | `lambda_l2` 0→10 | 0.6463 | **67.06%** | 28.09% | 완료(keep) |
| [002b](run_002b_thread_check.md) | =002 재현 (스레드 32→4) | 0.6463 | 67.06% | 28.09% | 완료(keep) |
| [003](run_003_min_sum_hessian.md) | `min_sum_hessian` 1e-3→1.0 | 0.4958 | 54.29% | 2.72% | 완료(discard) |
| [004](run_004_min_data_in_leaf.md) | `min_data_in_leaf` 20→200 | 0.0011 | 0.21% | 0.11% | 완료(discard) |
| [005](run_005_class_weight.md) | 클래스 가중치 역빈도 | 0.4497 | 45.40% | 12.40% | 완료(discard) |
| [006](run_006_es_prauc.md) | 조기종료 logloss→PR-AUC | 0.2721 | 46.99% | 11.77% | 완료(discard) |
| [007a](run_007_lambda_l2_sweep.md) | `lambda_l2` 10→1 | 0.4490 | 57.91% | 13.56% | 완료(discard) |
| [007b](run_007_lambda_l2_sweep.md) | `lambda_l2` 10→50 | 0.6502 | 66.38% | 29.54% | 완료(keep) |
| [007c](run_007_lambda_l2_sweep.md) | `lambda_l2` 10→100 | 0.6496 | 66.21% | **32.96%** | 완료(keep) — **현 기준선** |
| [008](run_008_round_cap.md) | 라운드 상한 300→1000 | 0.6495 | 66.35% | 32.93% | 완료(discard) |
| [009a](run_009_lambda_l2_high.md) | `lambda_l2` 100→200 (상한 1000) | **0.6531** | 66.87% | 30.07% | 완료(discard) |
| [009b](run_009_lambda_l2_high.md) | `lambda_l2` 100→500 (상한 1000) | 0.6490 | 66.30% | 30.34% | 완료(discard) |

참고: `../data_notes.md` (데이터 특성, 문헌 벤치마크)
참고: [metrics_summary.md](metrics_summary.md) (전 실험 종합·클래스별 지표, val 재평가)

## 다음 후보 (run_007c 대비 단일 변인)

λ 사다리 종결(1→13.6 / 10→28.1 / 50→29.5 / **100→33.0** / 200→30.1 / 500→30.3) —
λ=100 최적 확정. 남은 축:

1. `lambda_l2` + `min_sum_hessian` 조합
2. `num_leaves` 31 → 127 / 512

이후: 개입(train 정제) 실험 — 1호 후보 = 배경 세탁 행 제거
