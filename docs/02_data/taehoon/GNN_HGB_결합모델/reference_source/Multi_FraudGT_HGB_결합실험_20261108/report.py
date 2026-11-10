from experiment import *
import csv, html
from salt_daily.metrics import confusion

def report():
    check_frozen();plan=read_json(OUT/'plan.json');fit=read_json(OUT/'fit.json')
    rows=[];sweep=[];tables={}
    for scope in ('validation','test'):
        current=read_json(OUT/f'{scope}.json')['results']
        previous=read_json(PREVIOUS/f'{scope}.json')['results']
        results={**current,'A3':previous['A3'],'A3_HGB':previous['A3_HGB']}
        table=['| 모델 | Precision | Recall | F1 | AP | FP | 무패턴 Recall |','|---|---:|---:|---:|---:|---:|---:|']
        for name,r in results.items():
            m=r['primary'];table.append(f"| {name} | {m['precision']:.2%} | {m['recall']:.2%} | {m['F1']:.2%} | {r['AP']:.2%} | {m['FP']:,} | {m['unmatched_recall']:.2%} |")
            for operating_point in ('primary','validation_threshold'):
                row=dict(scope=scope,model=name,operating_point=operating_point,AP=r['AP'],rows=r['rows'],**r[operating_point])
                row.setdefault('threshold_probability',float(1/(1+np.exp(-row['threshold_logit']))));rows.append(row)
        tables[scope]='\n'.join(table)
        scores=np.load(OUT/'fusion_scores'/f'{scope}.npy',mmap_mode='r');data=population(scope)
        frozen=current['Multi_FraudGT_HGB']['validation_threshold']['threshold_logit']
        for probability in sorted(set([.05,.1,.15,.2,.25,.3,.4,.5,.6,.7,.8,.9,.95,float(1/(1+np.exp(-frozen)))])):
            threshold=frozen if probability==float(1/(1+np.exp(-frozen))) else float(np.log(probability)-np.log1p(-probability))
            sweep.append(dict(scope=scope,threshold_probability=probability,threshold_logit=threshold,AP=current['Multi_FraudGT_HGB']['AP'],
                selection='frozen_validation' if threshold==frozen else 'descriptive_fixed_grid',**confusion(data.y,scores,threshold)))
    def csv_write(path,values):
        keys=list(dict.fromkeys(k for row in values for k in row))
        with path.open('w',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=keys);writer.writeheader();writer.writerows(values)
    csv_write(OUT/'metrics.csv',rows);csv_write(OUT/'thresholds.csv',sweep)
    write(OUT/'thresholds.json',dict(test_tuning=False,rows=sweep))
    current=read_json(OUT/'test.json')['results'];fused=current['Multi_FraudGT_HGB'];base=current['Multi_FraudGT']
    secondary=fused['validation_threshold']
    text=f'''# Multi-FraudGT + HGB 결합 실험

완료: {read_json(OUT/'complete.json')['utc']}. HI-Large 전체 Test **33,429,507건**, 사기 **44,103건**. 모든 거래를 누락·중복 없이 평가했다. SAML-D 평가는 아니다.

기존 Multi-FraudGT epoch 280과 HGB는 재학습하지 않았다. 두 모델의 점수만 입력으로 받는 로지스틱 회귀를 새로 학습했다. SALT 학습은 기존 A1 중단 상태를 유지했다.

## 전체 Test, 임계값 0.5

{tables['test']}

Multi-FraudGT 단독 대비 결합 F1 차이 **{100*(fused['primary']['F1']-base['primary']['F1']):+.4f}%p**, AP 차이 **{100*(fused['AP']-base['AP']):+.4f}%p**. AP는 전체 점수 순위 지표이므로 임계값에 따라 변하지 않는다.

## 비교 Validation, 임계값 0.5

{tables['validation']}

## 임계값 비교

각 모델의 비교 Validation 전체 F1이 최대인 임계값을 Test 결합 평가 전에 고정했다. 결합 모델의 고정 확률 임계값은 **{secondary['threshold_probability']:.8f}**이다. 이 값을 적용한 Test Precision **{secondary['precision']:.2%}**, Recall **{secondary['recall']:.2%}**, F1 **{secondary['F1']:.2%}**, FP **{secondary['FP']:,}건**이다.

`metrics.csv`에는 모든 모델의 0.5 기준과 각자 Validation에서 선택한 임계값 기준을 함께 기록했다. `thresholds.csv`에는 결합 모델의 고정 임계값별 민감도 분석이 있다. Test 표에서 가장 좋아 보이는 임계값으로 재선택하지 않았다.

## 실험 조건

| 항목 | 적용 |
|---|---|
| 기반 GNN | Multi-FraudGT epoch 280, 원본 가중치 고정 |
| 기반 HGB | 기존 채택 모델, 22종/36개 입력 열, 원본 가중치 고정 |
| HGB 보정 | 원래 3클래스 확률을 class factor [1,100,100]으로 1회 나누고 재정규화한 사기 확률의 logit |
| 결합 입력 | HGB 보정 logit, Multi-FraudGT 원시 logit 두 개 |
| 결합 학습 | 2022-10-05~10-08 전체 7,315,599건, 사기 9,637건 |
| 비교 Validation | 2022-10-09~10-13 전체 8,551,015건, 사기 12,173건 |
| Test | 2022-10-14~10-31 전체 33,429,507건, 사기 44,103건 |
| 로지스틱 회귀 | StandardScaler, C=0.1, lbfgs, max_iter=1000, tol=1e-7, class/sample 가중치 없음 |
| 결합 학습 시간 | {fit['seconds']:.2f}초, {fit['iterations'][0]}회 반복, 수렴 확인 |
| 그래프/추론 | 원본 PyG, shared batch 2,048, fanout [50,50], 두 방향, all_targets, float32 |
| 실행 최적화 | 피처 GPU 캐시 + CPU 샘플러 1배치 미리 준비. 원본 CPU 입력과 모든 텐서 동일성 확인 |
| Test 재사용 | 기존 전체 예측 256개 조각을 거래 ID로 정렬, 정답 및 해시 검증. 전체 Test 재추론 없음 |
| 기본 판정 | probability >= 0.5. 원래 Multi의 > 0.5와 달라질 수 있는 정확한 0 logit이 0건임을 확인 |

원래 logit 단위의 결합식은 `sigmoid({fit['unscaled_intercept']:.10g} + ({fit['unscaled_coefficients'][0]:.10g}) * HGB_logit + ({fit['unscaled_coefficients'][1]:.10g}) * Multi_logit)`이다. 이 확률의 보정 정확도 자체를 별도로 검증한 것은 아니다.

## 결과 해석의 범위

1. **기존 Multi의 에폭 선택 Validation은 2022-09-26~10-13이었다.** 당시 이 기간의 일부 거래를 반복 검증해 epoch 280을 선택했다. 이번 결합 학습·비교 Validation 기간이 겹치므로 독립된 stacking holdout 결과가 아닌 **기존 모델 재활용 탐색 실험**이다. 엄격한 후속 검증은 기반 모델의 선택 구간, 결합 학습 구간, 임계값 선택 구간을 분리하고 새 Test로 평가해야 한다.
2. 원본 Multi는 구간 마지막 날의 누적 그래프·노드 상태를 사용한다. 결합 학습·Validation은 10월 13일, Test는 10월 31일 그래프다. 각 거래 시점 이후 관측이 문맥에 들어갈 수 있어 실시간 인과적 탐지 결과가 아니다.
3. A3와 Multi는 학습·샘플링·그래프·에폭 선택 조건이 다르다. 표는 현재 보유한 시스템의 성능 비교이며 모델 구조 하나만 바꾼 통제 실험이 아니다. 과거 Test도 이미 여러 번 확인한 데이터다.
4. 무패턴 사기(label 9)는 사기 양성에 포함했다. 정상 거래의 false positive와 무패턴 recall을 함께 확인해야 한다.

## 재현 및 검증

- `python run_pipeline.py`: 저장된 단계를 이어 실행한다. 원본 학습 재개 기능은 없다.
- `plan.json`, `code_manifest.json`: 점수 생성 전에 고정한 조건·원본 해시·실행 코드 해시.
- `preflight.json`: CPU/GPU 입력 동일성, 기존 Test 첫 배치 예측 재현 검사.
- `gnn_scores/`: 모든 대상 점수, 청크별 무결성 해시와 중단·재개 정보. HGB 점수는 이전 A3+HGB 폴더에서 읽기 전용 재사용.
- `fit.json`, `fusion.joblib`: 수렴·직렬화 재현 검사 및 결합 모델.
- `frozen_validation.json`: Test 결합 평가 전에 고정한 모델과 임계값.
- `validation.json`, `test.json`: 정수 혼동행렬, 패턴별 recall, TOP-K, 독립 AP 구현과 sklearn 교차 검증.
- `metrics.csv`, `thresholds.csv`: 공유용 전체 결과표와 임계값별 표.
'''
    (OUT/'결과.md').write_text(text)
    log('report_complete',file=str(OUT/'결과.md'))

if __name__=='__main__':report()
