# MVP 마이크로배치 구현 작업 기록

- 작성일: 2026-08-11
- 목적: HI-medium 학습 모델의 small 전이 검증(G34/G35)과 small 5분 마이크로배치 MVP 시뮬레이션 구현 과정 기록
- 관련 문서: `docs/gnn_feature_experiments_worklog.md`(1~18라운드, ~G32), `results/experiments/final_model_evaluation.html`

## 0. 배경과 방향 결정 (2026-08-11)

- 최종 모델 G31(HI-Small v2, HGB 3시드, F1 0.7471)에 대한 독립 평가 수행
  → `results/experiments/final_model_evaluation.html` 작성. metrics JSON 대조 결과 수치 일치 확인
- G31 모델의 LI-Small 전이 테스트(G33): **실패** (test AP 0.0599 / F1 0.1620)
  → `src/gnn/eval_g31_on_li.py`, `results/experiments/G33_g31_on_li/`
- 사용자 방향 지시:
  1. 성능목표(F1 0.80) 제거
  2. **Medium으로 학습 → Small로 테스트** 가능성 검증
  3. MVP는 **Small 데이터로 5분 마이크로배치** 추론 사용 예정

## 1. medium용 피처 캐시 생성 (G34 선행 작업)

medium은 기본 테이블(edges/node_features)만 있고 모티프 캐시 3종이 없어 생성:

| 캐시 | 스크립트 | 소요 | 비고 |
|---|---|---|---|
| `pairagg_hi_medium.parquet` | `pairagg_feats.py hi medium` | 58초 | 3,190만 건 |
| `passthru_hi_medium.parquet` | `passthru_feats.py hi medium` | 380초 | ~10만 건/s |
| `cycle3_hi_medium.parquet` | `cycle_feats_gpu.py hi medium` | 2,202초 | **GPU 재작성** |

### cycle3 GPU화 경위
- CPU 원본(`cycle_feats.py`): 엣지별 파이썬 루프 + 허브 계좌 교집합 비용 누적으로 초선형 급감 (48k/s→1.5k/s), medium 전체 수십 시간 예상
- 1차 개선(`cycle_feats_par.py`, 24워커 병렬): 효과 있으나 허브 구간 메모리 대역폭 병목으로 여전히 8~12시간 예상
- 2차 개선(`cycle_feats_gpu.py`, torch/CUDA): 세그먼트 인코딩(seg*K+값) + 전역 정렬 키(row*2^31+ts) + searchsorted 배치 교집합으로 파이썬 루프 제거
  - **검증**: 무작위 3,000건을 CPU `_work`와 대조 — 두 윈도우(24h/1주) 모두 완전 일치
  - OOM 대응: 허브 구간 청크가 5.65GB 할당 요구 → 엣지별 슬라이스 총량 기준 적응형 서브배치(`GPU_MAX_ELEM`, 기본 2천만)
  - 결과: **37분** (CPU 대비 약 1,000배 구간 존재)

## 2. G34: HI-medium 재학습 (G31 레시피)

- 스크립트: `src/gnn/gbt_final_gpu.py` (이름과 달리 HGB CPU 학습 — 아래 사유)
- 설정: G31과 동일 (LR 0.005, 63리프, 8000트리 상한, early stopping 30, 음성 40만 다운샘플, 3시드, A모델 교차 임계값, B모델 train+valid 재학습)
- **GPU 학습 불가 판정**: 설치된 XGBoost 3.3이 V100(SM 70) 미지원("not compiled for SM 70"), LightGBM pip 휠은 CPU 전용 → G31과 동일한 sklearn HGB로 결정 (비교 적합성도 유지)

### 메모리 문제와 해결 (3회 실패 → 해결)
- 원인: 컨테이너 **cgroup 메모리 제한 27.3GB** (호스트 503GB와 무관). 피처 행렬 병합 피크(26GB+)와 페이지 캐시 누적(cgroup에 합산)으로 3회 SIGKILL
- 해결:
  1. `prep_feat_matrix.py`: 81컬럼 피처를 memmap .npy에 블록 단위 기록 (피크 ~8GB), 로직·표준화는 `prepare_dataset`과 동일
  2. 학습 스크립트: 상주 배열 valid(1.8GB)만, train은 시드별 선택분 transient, test 예측 200만 건 청크 스트리밍 → RSS ~12GB

### 결과 (`results/experiments/G34_medium_hgb/`)

| 지표 | 값 |
|---|---|
| test AP (3시드 앙상블) | **0.6756** |
| test F1 (교차 임계값 0.827) | **0.6328** |
| 시드별 F1 | 0.6510 / 0.6230 / 0.6115 |
| 트리 수 | A 1329~1567 / B 1445~2180 |

- 참고: small(G31) F1 0.7471 대비 낮음. medium은 28일 기간으로 드리프트가 강하고 분할 간 세탁 비율 차(0.076%→0.157%)가 큼

## 3. G35: medium→small 전이 검증

- 스크립트: `src/gnn/eval_g34_on_small.py` (G34 체크포인트 → HI-Small v2 적용, 범주형 원핫은 medium train 레이아웃에 맞춤)
- 결과 (`results/experiments/G35_g34_on_small/`):

| 시나리오 | AP | F1 | P / R |
|---|---|---|---|
| 순수 전이 (G34 임계값 0.827) | 0.6261 | 0.4494 | 0.940 / 0.295 |
| small valid 임계값 재조정 (0.672) | 0.6261 | **0.6081** | 0.856 / 0.472 |
| (참고) small 직접 학습 G31 | 0.7570 | 0.7471 | 0.907 / 0.635 |

- 결론: 순위 능력(AP)은 전이되나 점수 캘리브레이션이 달라 **임계값 재조정 필수**. small 직접 학습 대비 전이 비용 -0.14 F1

## 4. MVP: 5분 마이크로배치 시뮬레이션

- 스크립트: `src/gnn/mvp_microbatch.py`
- 방식: HI-Small v2 test 구간(101.6만 건, 9/10~)을 timestamp 기준 5분 배치로 시간순 리플레이, 배치별 스코어링·알림·지연시간 기록
- 피처 서빙 동등성:
  - 시간/빈도·패턴 피처는 계산 자체가 과거-only 스트리밍과 동일
  - 사이클/자금통과/쌍집계 캐시는 split 이전 거래만 사용 → 실제 스트리밍 대비 보수적 하한
  - 통화 z/USD는 train 통계 고정 (운영 동일)
- 평가 모델 2종: G31(small 학습, 임계값 0.368) / G34(medium 학습, small valid 임계값 0.672)
- 결과: 아래 §5에 기록 (작성 시점: 실행 중)

## 5. MVP 결과

실행: `MVP_MODEL=g31/g34 python src/gnn/mvp_microbatch.py` (배치 300초, test 1,015,882건, 1,162 배치)

| 항목 | G31 (small 학습) | G34 (medium 학습) |
|---|---|---|
| 전체 AP | **0.7570** | 0.6261 |
| 전체 F1 | **0.7471** | 0.6081 |
| 임계값 | 0.3682 (G31 교차 임계값) | 0.6719 (small valid 최적) |
| 알림(alert) 총량 | 1,259건 (TP 1,142 + FP 117) | 991건 |
| 배치 스코어링 지연 p50 | 295ms | 407ms |
| p95 | 518ms | 700ms |
| max | 876ms | 1,312ms |

- 배치당 거래 건수(실측): 평균 874 / 중앙값 656 / 최대 4,725건
- **5분 제약 검증**: 최대 배치(4,725건)에서도 스코어링 1.3초 — 5분(300초)의 0.4% 수준으로 지연 여유 충분
- **파이프라인 정합성**: G31 리플레이 결과가 G31 공식 지표(AP 0.7570/F1 0.7471)와 정확히 일치 → 시뮬레이션 파이프라인이 기존 평가와 동일함을 확인. G34도 G35 전이 지표와 일치
- 판정: MVP로서 **G31 탑재가 현 시점 최선** (F1 +0.139 우위). medium 학습 모델은 전이 비용(-0.14 F1)을 감수하고 medium 파이프라인만 유지하고 싶을 때의 대안
- 한계(기존 기록 유지): 사이클/자금통과/쌍집계는 split-컷오프 캐시 사용으로 실제 스트리밍(배치 누적 반영)보다 보수적 하한. 실서빙 시 스트리밍 집계로 대체하면 성능은 이보다 같거나 나아질 여지 있음

## 6. 산출물 목록

| 경로 | 내용 |
|---|---|
| `src/gnn/cycle_feats_par.py` | cycle3 CPU 병렬 버전 (GPU로 대체됨) |
| `src/gnn/cycle_feats_gpu.py` | cycle3 GPU 버전 (검증 통과) |
| `src/gnn/prep_feat_matrix.py` | memmap 피처 행렬 생성 (27GB cgroup 대응) |
| `src/gnn/gbt_final_gpu.py` | 저메모리 G31 프로토콜 학습 (HGB/XGB 선택) |
| `src/gnn/eval_g31_on_li.py` | G31→LI 전이 평가 (G33) |
| `src/gnn/eval_g34_on_small.py` | G34→small 전이 평가 (G35) |
| `src/gnn/mvp_microbatch.py` | 5분 마이크로배치 시뮬레이션 |
| `data/processed/{cycle3,passthru,pairagg}_hi_medium.parquet` | medium 캐시 |
| `data/processed/featmat_hi_medium.npy` | medium 피처 행렬 (32M×81) |
| `results/experiments/G33_g31_on_li/` | LI 전이 결과 |
| `results/experiments/G34_medium_hgb/` | medium 재학습 모델·지표 |
| `results/experiments/G35_g34_on_small/` | medium→small 전이 지표 |
| `results/experiments/MVP_microbatch_{g31,g34}/` | MVP 시뮬레이션 결과 |

## 7. GNN 라운드: Medium 학습 GNN 구축 (G36m / G37m)

- 배경: 사용자 지시 "GNN 기반으로 모델 구축 + TRAIN 데이터셋 MEDIUM으로 교체". 기획서의 GNN 기반 관계형 탐지 검증 목표에 대응
- 공통 설정: `src/gnn/train_gnn_exp.py`, MODEL=pna (PyG PNAConv 2층 메시지패싱), HI-**medium** (train 14.9M / valid 4.55M / test 12.4M 거래), 120에포크, GPU(V100), 16초/에포크
- 피처 차이: G37m = 전체 81피처 / G36m = T3(시간·빈도 10개 + 통화 z 1개) 기반
- 운영 이슈: G36m 1차 실행이 04:16에 그래프 구축 단계에서 cgroup 메모리(27.3GB) OOM으로 조용히 죽고 감시 체인만 좀비로 남았음. 06:47 수동 재시작으로 완료 (총 2,056초)

| 실험 | 피처 | best epoch | test AP | test F1 | test P / R |
|---|---|---|---|---|---|
| G37m (PNA+전체) | 81 | 44 | **0.2905** | **0.3362** | - |
| G36m (PNA+T3) | T3 | 52 | 0.2379 | 0.2883 | 0.280 / 0.297 |
| (참고) G34 HGB | 81 | - | 0.6756 | 0.6328 | - |

- **최적 GNN 선정: G37m (PNA + 전체 피처, medium)** — G36m 대비 AP +0.053 / F1 +0.048 우위. T3 부분집합보다 전체 피처가 medium에서도 유효
- 해석: 두 GNN 모두 같은 medium의 HGB(G34, AP 0.6756/F1 0.6328)에 크게 못 미침 (AP 절반 이하). v1 소규모 시절 GNN 최고치(HI AP 0.326)와 유사한 수준으로, 현재 GNN 구성(PNA 2층)으로는 트리 부스팅 대비 관계형 이득이 확인되지 않음
- 시사점: MVP 탑재 모델은 여전히 G31(HGB, small)이 최선. GNN은 기획서상 관계형 탐지 검증 축으로 개선 실험(레이어 수, 스케줄러, 이웃 샘플링 등)이 필요한 상태
- 산출물: `results/experiments/G36_gnn_pna_t3_med/`, `results/experiments/G37_gnn_pna_full_med/` (각각 gnn_hi_best.pt, metrics_hi.json), 로그 `results/experiments/G36_gnn_pna_t3_med_log.txt`

## 8. G38/G39: HI+LI medium 합성학습 실험 — 결과: 기각 (도메인 간섭)

- 설계·과정: `docs/hili_combine_design.md` 참조 (ID 오프셋 분리, is_li 플래그, split 유지, 캐시 행정렬 concat)
- G38 학습: HI+LI medium 합성(63.1M, 양성 17,534) HGB 3시드 G31 레시피, 6시간 04분. 합성 test AP 0.5040/F1 0.4493
- G39 평가: G38 → HI-small (G35와 동일 프로토콜, is_li=0 주입)

| 모델 | 학습 데이터 | small test AP | small test F1 (small valid 임계값) |
|---|---|---|---|
| G34→G35 | HI-medium 단독 | **0.6261** | **0.6081** (thr 0.672) |
| G38→G39 | HI+LI medium 합성 | 0.6010 | 0.5790 (thr 0.795) |
| (참고) G31 | HI-small 직접 | 0.7570 | 0.7471 |

- **판정: 합성 기각**. 양성 +54%에도 F1 -0.029 / AP -0.025 하락. G33(HI→LI 전이 실패)과 일관 — HI/LI는 결정경계가 다른 별개 도메인이며, is_li 플래그로도 간섭을 상쇄하지 못함
- 부가 관찰: G38은 precision이 매우 높음(G38 임계값에서 0.974, FP 14건) — 보수적 판정 운영점이 필요하면 활용 여지 있으나 recall 0.29로 MVP 부적합
- 운영 이슈 기록: featmat 63M행 단일 프로세스 OOM 2회 → 단계별 프로세스 분리 해결. 학습 1회 OOM → GBT_LOW_MEM 모드(valid 시드별 해제) 추가로 해결
- 산출물: `results/experiments/G38_hili_medium_hgb/`, `results/experiments/G39_g38_on_small/`, `src/gnn/{build_dataset_hili,prep_feat_matrix_hili,eval_g38_on_small}.py`
- 결론: 1단계 최종 모델은 기존 G31(HI-small HGB) 유지. 데이터 확장으로 small 성능을 올리는 경로는 합성·전이 모두 확인된 한계 내에서는 실패

## 9. 허브 계좌 처리안 실험 (설계안 §10 모델팀 위임) — 완료

- H-1 실체 검증(HI-small v2): 허브 15개(노드 515073~515087, 차수 절벽), 거래 8.92%, 세탁 점유 12.23%, 2-hop 비용 98.8% — 설계안 수치와 일치
- H-2 G31 분리 평가: 허브 관여 세탁 129건 전량 누락(AP 0.0017/F1 0) / 비허브 F1 0.7801 — 허브가 실질 탐지 구멍임을 확인
- H-3 상한별 서브그래프 비용(엣지 2만건 샘플): 무상한 p95 461만 → K=64 시 p95 1.9만/p99 3.1만 (98.7% 절감)
- H-4 결정: **C안(허브 플래그 특징 + 팬아웃 상한 K=64) 채택**, 비허브 상한 512 가드. 명세서: `docs/hub_subgraph_spec.md`
- 후속 과제: 허브 피처 보강 재학습(G40 후보) — 허브 관여 AP 회복 실험

## 10. G40: 허브 피처 보강 실험 — 결과: 효과 없음 (원인 진단 포함)

- 설정: G31 프로토콜 + hub_src/hub_dst 플래그 2개 (101차원), HI-small
- 결과: 전체 AP 0.7570/F1 0.7471, 허브 AP 0.0017/F1 0, 비허브 F1 0.7801, 임계값 0.3682 — **G31과 모든 지표가 소수점까지 완전히 동일**. 3개 시드 모두 허브 플래그를 단 한 번도 분기에 사용하지 않음
- 진단: train에 허브 관여 세탁 359건(15.6%)이 있어 학습 기회는 충분했음. 플래그가 무시된 이유는 피처 부재가 아니라 **허브 경유 세탁이 모든 피처에서 허브 정상 거래와 구분되지 않기 때문** — 허브(준중앙은행)의 통상 트래픽 속에서 세탁이 위장되고, 그래프 피처(사이클·자금통과)는 17만 이웃에 희석됨
- 결론: 단순 플래그 추가로는 회복 불가. 진짜 해법은 허브를 투명하게 보는 전용 피처(예: 허브 입출금을 금액·시간으로 짝지은 가상 경유 피처) 또는 허브 접기(허브 상대방 간 가상 엣지) 방향의 피처 공학이 필요 — 별도 과제 규모
- 조치: MVP 범위에서는 허브 관여 세탁 12.2%의 탐지 사각을 **알려진 한계로 명문화** (hub_subgraph_spec.md §5에 이미 기록). 1단계 최종 모델 G31 유지
- 산출물: `results/experiments/G40_hub_feats/`, `src/gnn/g40_hub_feats.py`
