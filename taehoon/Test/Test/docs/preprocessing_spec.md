# 데이터 전처리 명세서

- 작성일: 2026-08-13 · 대상: IBM AML 합성 데이터 (HI/LI, Small/Medium)
- 코드: `src/preprocessing/` (1차) + `src/gnn/` (2차 캐시, 3차 피처화)
- 피처 상세는 별도 문서: `feature_spec.md`

## 1. 전체 흐름

```
원시 CSV (/workspace/IBM/HI-*_Trans.csv, *_accounts.csv, *_Patterns.txt)
  └─ [1차] build_dataset*.py            → edges/nodes/node_features/patterns parquet
       └─ [2차] cycle/passthru/pairagg 피처 캐시 (row-aligned parquet)
            └─ [3차] prepare_dataset / prep_feat_matrix.py → 모델 입력 81차원 (+노드 9×2)
```

## 2. 1차 전처리 — 원시 → parquet

| 항목 | Small | Medium |
|---|---|---|
| 스크립트 | `src/preprocessing/build_dataset.py` | `src/preprocessing/build_dataset_medium.py` |
| 입력 | `/workspace/IBM/{HI,LI}-Small_*.csv` | `/workspace/IBM/{HI,LI}-Medium_*.csv` |
| 산출 | `data/processed/*_v2.parquet` | `data/processed/*_medium.parquet` |

처리 내용:
- 거래(Trans) → `edges_*.parquet`: timestamp, from_id/to_id(계좌 문자열 → 정수 노드 ID), 금액, 통화, 결제형식, 파생 플래그(is_exchange, is_self_transfer, hour/dayofweek, hour_sin/cos, log1p_amount_paid)
- 계좌 → `nodes_*.parquet`, `node_mapping_*.parquet` (bank/account ↔ node_id)
- 노드 기초 피처 → `node_features_*.parquet`: **노드×split 3행 구조** (split별 구간 피처, node_id는 전역 ID)
- 패턴 라벨: `*_Patterns.txt` 파싱 → 세탁 엣지에 pattern_type·attempt_id 조인 (Medium 조인 성공률 100%, 매칭 로그는 preprocessing_summary 참조)

### 분할 (시간 기반 60/20/20)

- 원칙: **타임스탬프 순 train → valid → test 순차 분할** (랜덤 셔플 없음) — 미래 정보가 과거로 새는 것을 구조적으로 차단
- 유틸: `resplit_602020.py`

| 데이터셋 | train | valid | test |
|---|---|---|---|
| HI-Small (v2) | 3,046,861 (세탁 2,297) | 1,015,602 (1,082) | 1,015,882 (1,798) |
| HI-Medium | 14,935,512 (11,360) | 4,551,614 (4,353) | 12,411,112 (19,517) |
| LI-Medium | 14,641,266 (6,174) | 4,459,106 (2,101) | 12,151,111 (7,766) |

## 3. 2차 전처리 — 그래프 피처 캐시

엣지 행과 1:1 정렬된 parquet 캐시. 전부 **과거(타깃 시각 이전) 거래만 사용**하는 롤링/고정 집계.

| 캐시 | 스크립트 | 피처 수 | 특징 |
|---|---|---|---|
| `cycle3_*.parquet` | `src/gnn/cycle_feats_gpu.py` (GPU) | 8 | 윈도우 24h·1주 × 모티프 4종. CPU 대조 검증 통과 |
| `passthru_*.parquet` | `src/gnn/passthru_feats.py` | 4 | 자금 통과(레이어링) 신호 |
| `pairagg_*.parquet` | `src/gnn/pairagg_feats.py` | 6 | 학습 구간 고정 집계 → valid/test에 고정 매핑 (드리프트 없음) |

## 4. 3차 전처리 — 모델 입력 피처화

- 온라인: `train_gnn_exp.prepare_dataset` (GNN·인메모리 학습)
- 오프라인: `prep_feat_matrix.py` → `featmat_*.npy` memmap (HGB 저메모리 학습)
- 공통 규칙:
  - **표준화·원핫 통계는 전부 train 분할만으로 계산** → valid/test에 고정 적용
  - 범주 원핫: payment_format(7) + receiving_currency(15) + payment_currency(15) = 37열
  - 누수 방지 4중 장치: ① 시간 순차 분할 ② 롤링 피처는 과거만 ③ pairagg는 train 고정 집계 ④ 임계값은 valid에서만 결정 (test는 1회 평가)

## 5. 데이터셋별 주의사항 (실험으로 확인된 사실)

- **HI ↔ LI는 별개 도메인**: HI→LI 전이(G33) AP 0.06 실패, HI+LI 합성(G38/G39)도 오히려 성능 하락 — 합성 시 계좌 ID 오프셋·is_li 플래그·split 유지 필수 (`hili_combine_design.md`)
- **허브 계좌 15개** (노드 515073~515087, small 기준): 차수 절벽으로 기계 탐지 가능, 그래프 피처 희석 주의 (`hub_subgraph_spec.md`)
- Small↔Medium은 같은 도메인(HI)이라 전이가 부분적으로 성립 (G34→small F1 0.6081)하나 직접 학습(G31 0.7471)이 상회

## 6. 검증 문서

- `preprocessing_summary.md` (Small) / `preprocessing_summary_medium.md` (Medium): 기간·건수·세탁 비율·패턴 조인 검증·분할별 구성
