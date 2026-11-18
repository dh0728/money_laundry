# FraudGT 구현·실험 결과·논문 비교

작성: 2026-11-05. 기존 `V10_FraudGT_조건수정_20261027/runs/shared_corrected_001`에서 완료된 실험을 정리했다. 이 공유본을 만드는 과정에서 실제 데이터 모델을 재학습하지 않았다. 아래 수치는 합성 데이터 스모크 테스트 결과가 아니다.

## 1. 전체 Test 결과

**전체 Test 33,429,507건을 모두 채점한 `all_targets` 결과**다. 양성은 44,103건(기존 패턴 25,896건 + 무패턴 클래스 9의 18,207건), 정상은 33,385,404건이다. 모든 비율은 %, 임계값은 `sigmoid(logit) > 0.5`다. AP는 Average Precision이며 사다리꼴 적분 PR-AUC와 구분한다.

| 모델 | 완료/선택 epoch | Precision | Recall | F1 | AP | 무패턴 Recall |
|---|---:|---:|---:|---:|---:|---:|
| Basic FraudGT | 500/280 | 89.52 | 52.63 | 66.29 | 63.05 | 0.21 |
| PE FraudGT (ports-only) | 500/496 | 89.88 | 56.99 | 69.75 | 66.36 | 0.20 |
| Multi FraudGT | 284/280 | 89.22 | 57.78 | 70.14 | 66.88 | 0.26 |

Multi는 사용자가 요청한 284에폭에서 종료했다. 최고 Val 체크포인트는 280에폭이고 **학습률 스케줄은 500에폭 기준**이었다. 재실행 시 `epochs=284`로 바꾸면 당시 스케줄이 달라진다. `--stop-after 284`를 사용한다.

양성 클래스 전체를 기준으로 보면 세 모델 모두 무패턴 Recall이 낮다. 알려진 패턴 Recall은 Basic 89.48%, PE 96.92%, Multi 98.22%다. 전체 F1과 알려진 패턴 성능만으로 무패턴 탐지 성능을 설명하면 안 된다.

원본 결과 JSON의 혼동행렬로 Precision/Recall/F1을 재계산하고, 요청 수=채점 수=전체 Test 수인지 확인했다. AP는 완료된 전체 평가의 저장값을 가져왔다. 원본 파일명·SHA256·선택 체크포인트 SHA256은 [provenance](docs/provenance.json)와 [집계 JSON](results/full_test_summary.json)에 남겼다. 이번 공유 작업에서 3,342만 건 추론을 다시 실행한 것은 아니다.

## 2. Val 선택과 Test 채점의 차이

| 모델 | 선택 epoch | Val 요청/채점 | Coverage | 조건부 F1 | 조건부 AP |
|---|---:|---:|---:|---:|---:|
| Basic FraudGT | 280 | 524,288/176,419 | 33.65 | 74.03 | 70.84 |
| PE FraudGT (ports-only) | 496 | 524,288/175,996 | 33.57 | 73.97 | 72.46 |
| Multi FraudGT | 280 | 524,288/176,419 | 33.65 | 75.56 | 72.28 |

학습 및 체크포인트 선택은 `official` readout이었다. 요청한 타깃 중 **샘플링된 순방향 문맥 엣지에 포함된 거래만** 손실/지표에 들어간다. 위 Val은 매 평가마다 전체 Val에서 섞어 뽑은 최대 524,288건 중 채점된 부분집합의 조건부 점수이며, 전체 Val 점수가 아니다. 1, 4, 8, …, 500에폭의 조건부 Val F1로 선택했다. 평가 타깃 추출은 라벨을 보지 않으며 평가 epoch마다 표본이 달라진다.

최종 Test는 선택된 가중치를 고정하고 `all_targets`로 바꾸어 전체 거래를 채점했다. 이 확장은 누락된 타깃의 엣지 임베딩에도 같은 업데이트 수식을 적용한다. 추가 메시지 엣지나 이웃, 파라미터를 넣지 않는다. 기존에 채점되던 타깃의 점수가 일치하는지는 별도 검증했다. **추론 방식 확장이며 `all_targets`로 재학습한 결과가 아니다.** 예전 official Test의 채점 비율 약 29.65%와 현재의 100% 결과를 섞어 비교하지 않는다.

공유 평가기는 모델별로 `--scope val` / `--scope test`를 독립 실행할 수 있다. 새로 계산한 전체 Val은 위의 역사적 조건부 Val 결과와 별도 지표다. Test 결과로 체크포인트나 운영 임계값을 다시 선택하지 않는다.

## 3. 실제 데이터 구간

| 구분 | 날짜, 양 끝 포함 | 거래 수 | 샘플링 문맥 종료일 |
|---|---|---:|---|
| Train | 2022-08-01 ~ 2022-09-25 | 102,505,233 | 2022-09-25 |
| Val | 2022-09-26 ~ 2022-10-13 | 34,491,749 | 2022-10-13 |
| Test | 2022-10-14 ~ 2022-10-31 | 33,429,507 | 2022-10-31 |
| 전체 | 2022-08-01 ~ 2022-10-31 | 170,426,489 | 계정 2,116,168개 |

일별 거래 수를 사용해 60/20/20 비율의 최대 상대 오차가 작은 경계를 선택했다. 라벨은 경계 계산에 사용하지 않았다. 원본 V10의 관측값 중복 제거·복구된 양성·스케일링·KYC 처리 결과를 입력으로 사용한다.

각 split 종료일까지의 **누적 그래프와 종료일 계정 피처**를 사용한다. 개별 타깃 시점보다 뒤에 발생한 같은 split의 거래가 문맥에 포함될 수 있다. SALT의 일별 마감/타깃별 시간 제한과 동일한 실험이 아니며, 온라인 인과 예측 성능으로 해석하지 않는다. 이 데이터는 앞선 실험에도 사용됐으므로 완전히 새로운 홀드아웃이라는 주장도 하지 않는다.

## 4. 논문과 공개 구현, 현재 코드 비교

기준 논문은 Lin et al., *FraudGT: A Simple, Effective, and Efficient Graph Transformer for Financial Fraud Detection*, ICAIF 2024다. 논문은 최고 Val 성능의 가중치로 Test F1을 보고하고 5개 시드의 평균·표준편차를 제시한다. [논문 §4.1.3 및 Table 2](https://jshun.csail.mit.edu/FraudGT.pdf)

공개 코드 기준 commit은 `f88db9dc003a6f521a90631c4741541686043119`다. 아래 수치는 [Large-HI 기본 설정](https://github.com/junhongmit/FraudGT/blob/f88db9dc003a6f521a90631c4741541686043119/configs/AML-Large-HI/AML-Large-HI-SparseNodeGT.yaml), [ports 설정](https://github.com/junhongmit/FraudGT/blob/f88db9dc003a6f521a90631c4741541686043119/configs/AML-Large-HI/AML-Large-HI-SparseNodeGT%2Bports.yaml), [Multi 설정](https://github.com/junhongmit/FraudGT/blob/f88db9dc003a6f521a90631c4741541686043119/configs/AML-Large-HI/AML-Large-HI-Multi-SparseNodeGT.yaml)을 확인했다.

| 항목 | 논문 / 공개 구현 | 현재 구현·실험 |
|---|---|---|
| 데이터/피처 | 공개 AML 거래 데이터 | V10 가공 데이터, 계정 19 + 거래 수치 14 + 결제형식 1(8개 one-hot) |
| 모델 중심 수식 | 엣지 기반 attention bias와 메시지 gate | 유지. 엣지 임베딩 업데이트, relation별 key 변환, destination softmax |
| 모델 크기 | Large-HI YAML: hidden 64, head 8, layer 2 | 동일, head는 192→192→1 |
| dropout | global 0, attention 0.2 | 동일. SALT 논문의 별도 비교 설정과 혼동하지 않음 |
| 샘플러 | link neighbor, 2 hop, fanout [50,50] | 실제 PyG LinkNeighborLoader, 균등 비복원, directional, shared graph |
| seed batch | 2,048 | 동일. 문맥 노드/엣지 수는 고정되지 않음 |
| 학습량 | epoch당 256 batch | 동일. 최대 524,288 요청, Train 전체 1회전이 아님 |
| gradient accumulation | 8, weighted CE [1,6] | 8개 loader batch 평균 gradient의 합, positive weight 6 BCE |
| optimizer | AdamW, lr .001, wd 1e-5 | 동일, gradient norm clip 1, warmup 5 후 cosine |
| 학습 종료 | 500 epoch 설정 | Basic/PE 500, Multi 284에서 중지; 스케줄 500 유지 |
| 모델 선택 | 최고 Val, YAML eval period 4 | 1 및 4의 배수/최종 epoch, sigmoid > .5 F1 |
| CPU 자원 | worker 18, thread 24 | worker 0, thread 2; 메모리 사용을 줄이기 위한 변경 |
| graph 저장 | 공개 구현 데이터 로딩 | mmap CSC, 기간별 인덱스 캐시. C 코드는 CSC 변환만 수행 |
| 연산 메모리 | 공개 모델 수식 | 노드별 relation key 변환 재사용, activation checkpointing |
| 재현 시드 | 논문 5 seed 통계 | seed 42 단일 실행, phase/epoch/batch별 sampler RNG |
| 배치 누적 경계 | 공개 학습 loop | 8개 완전 배치 평균을 누적하고 마지막 잔여분도 업데이트하도록 경계 수정 |
| 최종 readout | 현재 official 경로는 샘플 문맥의 타깃만 출력 | 학습 official, 최종 Test는 all_targets 확장 |

### PE 이름과 실제 구현의 차이

**기존 `pe_fraudgt_format`은 ports-only다.** 논문에서 PE-FraudGT는 Ports+Ego ID인데, 저장된 실험 코드는 Basic/PE에 ego ID를 넣지 않고 Multi에만 넣는다. 공개 ports YAML에는 `train.add_ego_id`가 없고 [공개 기본값](https://github.com/junhongmit/FraudGT/blob/f88db9dc003a6f521a90631c4741541686043119/fraudGT/config/defaults_config.py)은 False다. 공유본은 기존 체크포인트와 일치하도록 이 동작을 유지했다. 논문 PE 구성을 새로 실험하려면 입력 계층과 체크포인트가 달라지므로 별도 모델명·재학습이 필요하다.

| 모델 | 현재 node 입력 | 현재 edge 입력 | 역방향 관계 | ego ID |
|---|---:|---:|---|---|
| Basic | 19 | 22 | 없음 | 없음 |
| PE 실험명, ports-only | 19 | 24 | 없음 | 없음 |
| Multi | 20 | 관계별 23 | 있음 | 있음 |

[피처 이름·컬럼 순서](docs/feature_manifest.json). PE에는 in/out port 2개, Multi에는 순방향 in-port와 역방향 out-port를 각각 하나씩 넣는다. HGB의 41개 피처 입력 모델과 동일한 입력이 아니다.

### 논문 수치와 나란히 보기

| 명칭 | 논문 AML Large-HI Test F1, 5회 평균 ± 표준편차 | 현재 V10 전체 Test F1, seed 42 |
|---|---:|---:|
| Basic FraudGT | 54.35 ± 1.65 | 66.29 |
| PE-FraudGT | 68.64 ± 2.31 | 69.75 (현재는 ports-only) |
| Multi-FraudGT | 73.34 ± 1.64 | 70.14 |

논문 열은 [Table 2](https://jshun.csail.mit.edu/FraudGT.pdf)의 수치다. 데이터 가공·피처·PE 구조·채점 범위·반복 시드 수가 달라 이 표의 차이를 논문 대비 향상/하락 효과나 재현 성공으로 판정하지 않는다.

## 5. 수신 in-degree별 전체 Test AP

| 수신 in-degree | Test 거래 수 | 양성 수 | Basic AP | PE AP | Multi AP |
|---|---:|---:|---:|---:|---:|
| 1–4 | 235,741 | 613 | 89.38 | 89.55 | 89.74 |
| 5–9 | 365,088 | 3,279 | 86.12 | 87.08 | 86.99 |
| 10–19 | 677,851 | 6,257 | 64.72 | 66.85 | 66.67 |
| 20–49 | 1,435,975 | 9,211 | 54.70 | 57.19 | 56.98 |
| 50–99 | 1,081,480 | 3,206 | 55.18 | 57.32 | 57.62 |
| 100 이상 | 29,633,372 | 21,537 | 62.39 | 66.69 | 67.74 |
| 전체 | 33,429,507 | 44,103 | 63.05 | 66.36 | 66.88 |

in-degree는 Test 종료일까지 누적 원본 순방향 거래에서 수신 계정으로 들어오는 거래 수다. 반복 거래는 각각 센다. 합성 역방향 엣지, 샘플링 후 degree, 고유 상대방 수와 다르다. 위 표는 현재 프로젝트 Test 결과이며 원 논문에 실린 수치가 아니다. F1·TP/FP/FN 등은 [degree CSV](results/degree_all_targets.csv)에 포함했다.

## 6. 코드 구성과 실행 범위

- `data.py`, `inputs.py`: V10 캐시 → numeric14 + format one-hot8, 포트, ego ID, transaction ID 정렬.
- `official_loader.py`, `csc_index.c`: split별 CSC 준비와 실제 PyG 샘플링.
- `models.py`: Basic/ports-only/Multi 및 official/all_targets readout. 기존 파일과 SHA256 일치.
- `training.py`, `optimization.py`: batch 평균 누적, warmup/cosine, Val 선택, optimizer 경계 체크포인트 및 재개.
- `evaluation.py`: 선택 체크포인트 고정, split 전체 순열, 64 seed batch 단위 결과 저장, 해시 확인 후 재개, 100% coverage 검사.
- `runtime.py`: 데이터/설정/소스 고정, 진행률 표시, 주기적 CPU 메모리 반환.

서버 고정 경로 제거와 실행·저장 계층은 새로 정리했다. 기존 `models.py`, `optimization.py`, `metrics.py`, `csc_index.c`는 그대로 유지했다. 새 평가기는 기존 all_targets 모델 함수를 호출하지만 원본 평가 스크립트 자체와 동일한 파일은 아니다. 다른 환경에서 저장된 숫자가 비트 단위로 재현된다고 보증하지 않는다.

준비된 V10 캐시를 별도로 연결해야 실데이터 학습을 실행할 수 있다. 이 패키지는 원본 CSV→V10 전체 전처리 생성기를 포함하지 않는다. [입력 계약](docs/입력캐시_계약.md)에 필요한 파일과 연결 방법을 명시했다. 임의의 SALT 캐시를 연결해 같은 결과라고 간주하지 않는다.

## 7. 공유본 검증과 후속 확인

검증 기록은 [validation.json](docs/validation.json)을 참조한다. 합성 데이터는 거래 552건·계정 12개·92일이며 실제 PyG native sampler를 사용한다. 세 모델 각각 1epoch 중지→2epoch 재개, 전체 Val/Test 108건씩 채점, 저장된 평가 shard 재사용, official/all_targets 공통 타깃 점수 일치, AP 동점 처리, gradient 누적 의미를 확인한다. 원본 실험의 학습 가중치는 Git/ZIP에 넣지 않는다.

후속 실험에서는 논문형 PE(Ports+Ego)를 별도 학습하고, 전체 Val에서 임계값을 선택한 뒤 Test를 고정 평가할 수 있다. SALT/HGB와 비교할 때는 동일 거래 ID·라벨·기간·정보 접근 시점으로 정렬해야 한다. HGB 점수 결합은 별도 검증 구간에서 학습한 로지스틱 회귀 등으로 설계할 수 있으나, 이 문서의 수치는 결합 전 FraudGT 단독 결과다.
