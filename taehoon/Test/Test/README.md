# Medium 학습 모델 패키지 (2026-08-13 기준 복사본)

원본 위치: `/workspace/kimi/src_extracted/` — 여기는 참고·배포용 복사본입니다.

## models/ — 학습된 모델과 지표

| 폴더 | 모델 | 학습 데이터 | test 성능 | 비고 |
|---|---|---|---|---|
| `G34_medium_hgb` | HGB 3시드 앙상블 (`checkpoint_gbt_ens3.joblib`) | HI-medium | AP 0.6756 / F1 0.6328 | medium 대표 모델. small 전이(G35) 시 F1 0.6081 |
| `G36_gnn_pna_t3_med` | PNA GNN (`gnn_hi_best.pt`) | HI-medium (T3 피처) | AP 0.2379 / F1 0.2883 | GNN |
| `G37_gnn_pna_full_med` | PNA GNN (`gnn_hi_best.pt`) | HI-medium (전체 피처) | AP 0.2905 / F1 0.3362 | 최적 GNN |
| `G38_hili_medium_hgb` | HGB 3시드 앙상블 | HI+LI medium 합성 | 합성 AP 0.5040 / F1 0.4493 | 합성 실험 — small 전이(G39) F1 0.5790으로 기각 |

참고: 최종 1단계 모델은 medium이 아니라 **G31 (HI-small HGB, AP 0.7570/F1 0.7471)** 이며
원본 `results/experiments/G31_lr0005_lv63/`에 있습니다.

## code/ — 학습·평가 코드

- `preprocessing/` — 1차 전처리 (원시 CSV → parquet)
  - `build_dataset.py` — HI/LI-Small v2 생성 (시간 60/20/20 분할, 노드 매핑, 라벨·패턴 조인)
  - `build_dataset_medium.py` — Medium 버전
  - `resplit_602020.py` — 분할 비율 재조정 유틸
- `gbt_final_gpu.py` — G34/G38 HGB 학습 (저메모리 memmap, G31 프로토콜)
- `prep_feat_matrix.py` / `prep_feat_matrix_hili.py` — 피처 행렬 생성 (81차원 / 합성 82차원)
- `train_gnn_exp.py` — GNN 학습 (PNA, G36m/G37m)
- `eval_g34_on_small.py` / `eval_g38_on_small.py` — small 전이 평가 (G35/G39)
- `build_dataset_hili.py` — HI+LI 합성 데이터셋 구축

주의: 이 코드들은 `data/processed/`의 데이터와 `train_gnn_exp.py` 내 공통 함수에 의존하므로,
단독 실행보다는 원본 리포지토리(`/workspace/kimi/src_extracted`)에서 실행하는 것을 전제로 합니다.
1차 전처리는 원시 CSV(`/workspace/IBM/HI-*.csv` 등)가 필요합니다.

## docs/ — 실험 기록·명세

- `preprocessing_spec.md` — **전처리 명세서** (원시 CSV→parquet→캐시→피처화 3단계, 분할 규칙, 누수 방지)
- `feature_spec.md` — **피처 상세 명세서** (엣지 81 + 노드 9×2 = 99차원, 블록별 정의·계산식·근거)
- `preprocessing_summary.md` / `preprocessing_summary_medium.md` — 1차 전처리 검증 요약
  (기간·건수·세탁 비율·패턴 조인 검증·분할별 구성)
- `mvp_microbatch_worklog.md` — 전체 실험 작업기록 (G31~G40)
- `hili_combine_design.md` — HI+LI 합성 설계·판정 기록
- `hub_subgraph_spec.md` — 허브 계좌 처리 명세서 (백엔드 전달용)
