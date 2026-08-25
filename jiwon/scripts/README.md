# 스크립트

워크스페이스 루트는 인자로 넘기거나, 생략하면 `__file__`에서 유도한다.
컨테이너 한도가 CPU 4코어이므로 무거운 작업은 하나씩 실행한다.

## 파이프라인 (순서대로)

| 스크립트 | 역할 | 산출물 |
|---|---|---|
| `build_labels.py` | Patterns.txt ↔ Trans.csv 매칭 → 10클래스 라벨 | `data_work/HI-Small_labels_10class.csv` |
| `build_features.py` | 그래프 피처 52개 (인과적, 시간순 단일 패스) | `data_work/HI-Small_features_v1.parquet` |
| `verify_features.py` | 표본 브루트포스 대조 검증 | 표준출력 PASS/FAIL |
| `run_ladder.py` | 학습·평가·기록 (VARIANTS에 실험 정의) | `data_work/runs/run_*.json` + 모델 |

라벨·피처는 이미 생성되어 있으므로, 새 실험은 `run_ladder.py`만 쓰면 된다.

## 분석용 (일회성)

| 스크립트 | 역할 |
|---|---|
| `eda.py` | 기간·클래스·자기거래 분포, 분할 후보 비교 |
| `feature_review.py` | 단건 피처 후보별 세탁 비율·리프트 측정 |
| `train_baseline.py` | run_001을 생성한 학습 스크립트 (이후 `run_ladder.py`로 대체) |

## 새 실험 추가 방법

`run_ladder.py`의 `VARIANTS`에 한 줄 추가 — `(run_id, 변인 설명, 파라미터 override, 가중치 여부, 커스텀 조기종료 여부)`.
`BASE`(기준선 파라미터)는 건드리지 않는다. 실행: `python3 run_ladder.py <WS> run_007`

## 인과성 검증

`build_features.py`에 컷 날짜를 넘겨 앞부분만 재계산한 뒤, 전체 실행 결과와 해당 행들을 비교한다.
값이 다르면 미래 정보 누수. (v1은 228만 행 × 52피처 전부 일치 확인)
