# GNN + HGB 결합모델 · Git 공유

SALT-GNN A3+HGB와 Multi-FraudGT+HGB의 실제 결합 학습 코드, 노트북, 전체 Val/Test 결과와 임계값 비교를 담았다.

## 시작하기

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
```

Jupyter에서 [01 실험 조건](notebooks/01_실험조건_입력점수.ipynb) → [02 SALT A3+HGB](notebooks/02_SALT_A3_HGB_결합학습.ipynb) → [03 Multi-FraudGT+HGB](notebooks/03_Multi_FraudGT_HGB_결합학습.ipynb) → [04 임계값 비교](notebooks/04_임계값별_결과비교.ipynb) 순서로 연다. 기본 실행은 저장 결과를 표시하며 학습 프로세스를 시작하거나 기존 결과를 변경하지 않는다.

## HI-Large 전체 Test 결과

33,429,507건 · 실제 사기 44,103건 · 주 임계값 0.5. AP는 Average Precision이다.

| model | AP | precision | recall | F1 | FP |
| --- | --- | --- | --- | --- | --- |
| A3 | 65.61% | 79.56% | 58.45% | 67.39% | 6621 |
| HGB | 66.78% | 85.32% | 57.17% | 68.46% | 4338 |
| A3_HGB | 68.91% | 92.81% | 56.76% | 70.44% | 1939 |
| Multi_FraudGT | 66.88% | 89.22% | 57.78% | 70.14% | 3078 |
| Multi_FraudGT_HGB | 69.75% | 94.57% | 56.68% | 70.88% | 1435 |

[전체 비교 CSV](results/model_comparison.csv) · [임계값별 비교 HTML](results/threshold_comparison/두모델_임계값비교.html) · [임계값 전체 CSV](results/threshold_comparison/임계값별_전체지표.csv)

## 포함 내용

- `notebooks/`: 점수 입력, 결합기 학습·검증 선택·Test, 임계값 결과 비교
- `src/fusion_workflow.py`: ID 정렬 검증, HGB 확률 보정, StandardScaler+로지스틱 회귀, 지표 계산
- `results/`: 실제 완료 결과, 결합기 계수 JSON, 고정 임계값, 검증 기록
- `reference_source/`: 기존 GNN 추론·결합기 실행 코드와 기반 모델 구현 보존본
- `tools/export_original_scores.py`: 기존 워크스페이스에서 정렬된 점수를 외부 입력 폴더로 내보내는 도구

전체 재실행 범위와 입력은 [실험 방법](docs/실험방법_결합기.md), [외부 입력 준비](docs/외부입력_재실행.md), [출처와 재현 범위](docs/출처_및_재현범위.md)를 확인한다.

**비교 한계:** Multi-FraudGT의 기반 모델 선택 구간이 결합기 fit/비교 Validation과 겹친다. 기존 모델 재사용을 보는 탐색 실험이며 독립적인 stacking holdout 성능으로 해석하지 않는다. Test도 과거에 이미 사용한 평가 구간이다. SAML-D 일반화 실험과 23종 재학습은 별도 `saml_d_experiments` ZIP에 있다.
