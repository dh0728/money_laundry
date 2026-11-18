# SAML-D 일반화 실험 · 방법, 가설 검증, 결과 분석

2026-11-06 최초 전체 평가부터 결측 대체, GNN+HGB, 2026-11-09 완료된 공통 23종 재학습까지 정리했다. **결측 피처에 대한 민감도는 확인됐지만, 대체하거나 제외하는 것만으로 SAML-D 일반화 성능이 회복되지는 않았다.**

## 먼저 볼 자료

1. [실험 방법과 입력 비교](docs/01_실험방법_입력비교.md)
2. [가설별 검증 흐름](docs/02_가설검증.md)
3. [최신 결과 분석과 후속 계획](docs/03_결과분석_후속계획.md)
4. [코드 구성과 재현 범위](docs/04_코드_재실행.md)

## SAML-D 전체 평가 결과

9,504,852건 · 사기 9,873건 · 정상 9,494,979건 · 주 임계값 0.5. AP는 Average Precision이며 임계값과 독립적인 순위 지표다. Multi 단독은 `logit > 0`, 결합 파이프라인은 `logit >= 0`을 사용했다. 원래 Multi 점수의 정확한 0은 없음을 검증했다.

| model | AP | precision | recall | F1 | FP |
| --- | --- | --- | --- | --- | --- |
| Multi-FraudGT zero | 2.04% | 0.44% | 45.69% | 0.87% | 1018255 |
| Multi-FraudGT train_median | 0.16% | 0.31% | 22.37% | 0.61% | 712843 |
| Multi-FraudGT degree_median | 0.17% | 0.32% | 21.95% | 0.63% | 676670 |
| Multi-FraudGT behavior_donor | 0.23% | 0.36% | 24.68% | 0.72% | 668211 |
| HGB | 2.28% | 0.80% | 50.83% | 1.57% | 623998 |
| SALT-GNN A3 | 0.33% | 0.59% | 43.93% | 1.17% | 725325 |
| Multi-FraudGT + HGB | 2.24% | 0.78% | 47.23% | 1.54% | 591077 |
| SALT-GNN A3 + HGB | 1.04% | 0.77% | 46.28% | 1.52% | 588165 |
| Multi-FraudGT common23 | 1.21% | 0.53% | 31.62% | 1.05% | 580586 |

[전체 비교 CSV](results/saml_experiment_comparison.csv) · [공통 23종 결과 HTML](results/common23/결과.html) · [두 결합모델 결과 HTML](results/fusion_generalization/SAML_D_두결합모델_일반화_결과.html)

`zero`는 기존 34종 모델의 SAML-D 기본 입력이다. 다른 세 대체 방법도 동일한 학습 가중치를 사용했다. `common23`만 SAML-D에서 관측할 수 있는 피처로 HI-Large에서 새로 학습했다. HGB는 이 표에서 AP와 F1이 가장 높았지만 절대 성능은 여전히 낮다.

## 노트북

- [01 입력 비교와 실험 조건](notebooks/01_입력비교_실험조건.ipynb)
- [02 결측 가설 검증](notebooks/02_결측처리_가설검증.ipynb)
- [03 공통 23종 학습 코드와 결과](notebooks/03_공통23종_재학습.ipynb)
- [04 모델·패턴별 결과 및 외부 점수 재평가](notebooks/04_일반화_패턴별_결과분석.ipynb)

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
```

노트북 기본 실행은 패키지에 저장된 전체 결과를 표시한다. 데이터·가중치 없이도 검토할 수 있다. 실제 재학습·추론에는 별도 외부 입력이 필요하다. `reference_source/`에 당시 실행 코드를 보존했고, `reference_reports/20261106/`은 **11월 6일 시점의 과거 보고서**다. 당시의 “공통 피처 재학습 예정”은 현재 완료됐으며 이 README와 최신 문서가 우선한다.

원본 데이터·대용량 캐시·모델 가중치·거래별 점수 배열은 ZIP에 없다. [출처와 재현 범위](docs/출처_및_재현범위.md), `SOURCE_PROVENANCE.json`, `MANIFEST.json`에서 출처 및 파일 무결성을 확인할 수 있다.
