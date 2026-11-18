"""Render completed experiment artifacts without launching inference or fitting."""
from experiment import *
import csv

def table(results,mode):
    lines=['| 모델 | Precision | Recall | F1 | AP | 알려진 패턴 Recall | 무패턴 Recall | FP |',
           '|---|---:|---:|---:|---:|---:|---:|---:|']
    for name in ['A3','HGB','A3_HGB']:
        r=results[name];m=r[mode]
        values=[m['precision'],m['recall'],m['F1'],r['AP'],m['known_pattern_recall'],m['unmatched_recall']]
        lines.append('| '+name+' | '+' | '.join(f'{100*v:.2f}%' for v in values)+f" | {m['FP']:,} |")
    return '\n'.join(lines)

def main():
    done=read_json(OUT/'complete.json');assert done['status']=='complete'
    assert read_json(OUT/'independent_verification.json')['all_passed']
    check_frozen()
    val=read_json(OUT/'validation.json')['results'];test=read_json(OUT/'test.json')['results']
    fit=read_json(OUT/'fit.json');frozen=read_json(OUT/'frozen_validation.json')
    baseline=test['A3'];combined=test['A3_HGB'];tree=test['HGB']
    delta={name:dict(AP_pp=100*(combined['AP']-r['AP']),
        F1_pp=100*(combined['primary']['F1']-r['primary']['F1']),
        precision_pp=100*(combined['primary']['precision']-r['primary']['precision']),
        recall_pp=100*(combined['primary']['recall']-r['primary']['recall']),
        unmatched_recall_pp=100*(combined['primary']['unmatched_recall']-r['primary']['unmatched_recall']))
        for name,r in [('A3',baseline),('HGB',tree)]}
    thresholds='\n'.join(f'| {name} | {frozen["thresholds"][name]:.9f} | {1/(1+np.exp(-frozen["thresholds"][name])):.6f} |' for name in ['A3','HGB','A3_HGB'])
    text=f'''# SALT-GNN A3 + HGB 결합 실험 결과

시작일: 2026-11-07 UTC. 완료: {done['utc']}. A3·HGB 가중치를 고정하고 새 로지스틱 회귀만 학습했다.

## 1. 결과

전체 Test 33,429,507건에서 결합 모델의 고정 임계값 0.5 결과는 **Precision {100*combined['primary']['precision']:.2f}%, Recall {100*combined['primary']['recall']:.2f}%, F1 {100*combined['primary']['F1']:.2f}%, AP {100*combined['AP']:.2f}%**다.

A3 단독 대비 F1 **{delta['A3']['F1_pp']:+.2f} pp**, AP **{delta['A3']['AP_pp']:+.2f} pp**다. HGB 단독 대비 F1 **{delta['HGB']['F1_pp']:+.2f} pp**, AP **{delta['HGB']['AP_pp']:+.2f} pp**다. pp는 퍼센트포인트다. 이 비교는 한 쌍의 고정 모델과 한 가지 결합 설정의 결과이며 모든 결합 방식에 대한 결론은 아니다.

기본 임계값에서 A3 대비 정상 오탐은 **{baseline['primary']['FP']:,}건 → {combined['primary']['FP']:,}건**으로 줄었고, 전체 탐지율은 **{100*baseline['primary']['recall']:.2f}% → {100*combined['primary']['recall']:.2f}%**로 낮아졌다. 정밀도·F1·AP 개선과 탐지율 감소가 함께 관측됐다. 결합 모델의 무패턴 탐지율은 **{100*combined['primary']['unmatched_recall']:.2f}%**로 여전히 낮다.

Val에서 정한 결합 임계값을 사용한 Test 결과는 **Precision {100*combined['validation_threshold']['precision']:.2f}%, Recall {100*combined['validation_threshold']['recall']:.2f}%, F1 {100*combined['validation_threshold']['F1']:.2f}%**, 무패턴 Recall **{100*combined['validation_threshold']['unmatched_recall']:.2f}%**다. 이 경우에도 무패턴 탐지는 제한적이다. 기존 모델의 채택 상태를 바꾸지 않았으며, 실제 경보량과 누락 비용에 맞춘 운영점 검토가 후속 과제다.

## 2. 데이터와 학습 조건

| 구간 | 날짜 | 거래 수 | 사용 목적 |
|---|---|---:|---|
| fusion_fit | 2022-10-05~10-08 | 7,315,599 | scaler·결합기 학습, 사기 9,637건 |
| Validation | 2022-10-09~10-13 | 8,551,015 | 성능 비교·보조 임계값 선택 |
| Test | 2022-10-14~10-31 | 33,429,507 | 설정 고정 후 전체 평가 |

- A3: Monitor에서 선택한 6에폭 체크포인트. 거래 ID순·일별 배치, microbatch 4,096, 저장 구간 8,192, 최대 간선 6,000,000의 기존 평가 규칙을 유지했다.
- HGB: 이전 41피처 실험에서 채택한 HGB(22종/36열). 3클래스 확률을 `[1,100,100]`으로 나눈 뒤 재정규화해 두 사기 클래스의 확률 합을 logit으로 변환했다.
- 결합 입력: `[HGB 보정 logit, A3 원래 logit 차이]` 두 열이다. 이전 GNN용 logit 보정이나 이전 결합기의 계수를 재사용하지 않았다.
- 새 결합기: 전체 모집단에 `StandardScaler + LogisticRegression(C=0.1, solver=lbfgs, max_iter=1000, tol=1e-7)`를 적합했다. 다운샘플링·IPW·양성 가중치·추가 점수 보정은 없다.
- 로지스틱 회귀 적합: {fit['seconds']:.2f}초, {fit['iterations'][0]}회 반복. 모델 수렴과 저장·재로딩 후 점수 일치를 확인했다.

## 3. 주 비교: 확률 0.5 고정

### Validation 전체

{table(val,'primary')}

### Test 전체

{table(test,'primary')}

AP는 모든 점수의 순위를 사용한 Average Precision이다. Precision/Recall/F1은 표의 임계값에서 계산한 실제 전량 정오분류 건수 기준이다. 정상·알려진 패턴·무패턴을 모두 포함했고 각 모델의 평가 거래는 같다.

## 4. 보조 비교: Validation에서 선택한 F1 최대 임계값

각 모델에 대해 전체 Validation F1이 가장 높은 임계값을 선택하고 Test 점수 생성 전에 고정했다. 동률이면 더 높은 임계값을 사용했다. 아래 임계값은 확률이 아닌 logit 점수다.

| 모델 | 고정한 logit 임계값 | 해당 확률 임계값 |
|---|---:|---:|
{thresholds}

### Validation 전체

{table(val,'validation_threshold')}

### Test 전체: 같은 임계값 적용

{table(test,'validation_threshold')}

Test에서 임계값을 다시 고르지 않았다. 주 비교와 보조 비교를 모두 보존하며 Test에서 더 좋은 행만 골라 새로운 최적 설정으로 주장하지 않는다.

## 5. 결합 계수

표준화 전 입력 logit에 대한 동등한 식은 다음과 같다.

`결합 logit = ({fit['unscaled_coefficients'][0]:.9f}) × HGB logit + ({fit['unscaled_coefficients'][1]:.9f}) × A3 logit + ({fit['unscaled_intercept']:.9f})`

두 모델의 점수는 상관될 수 있다. 이 계수를 원인별 기여율이나 피처 중요도로 해석하지 않는다. 실제 추론은 저장된 scaler와 모델을 함께 사용한다.

## 6. 검증과 한계

- fusion_fit의 기존 저장 표본 115,830건에서 새 HGB 입력과 점수를 재현했다. 전체 Val/Test 거래 ID와 일별 입력 순서도 일치했다.
- A3는 생산용 배치 8,192건으로 재추론해 기존 Validation 점수와 허용 오차 내 일치를 확인했다. 새 fusion_fit에도 같은 배치·그래프 문맥 규칙을 적용했다.
- 세 모델 모두 전량 채점했고 AP를 독립 계산과 scikit-learn으로 교차 검산했다. A3의 기존 최종 Val/Test 지표도 재현했다.
- 저장된 결합 점수를 원래 입력 logit에 대한 직접 계산식으로 재현하고, 각 평가 구간에서 모델·임계값 6조건의 정오분류 집계를 별도로 검산했다. Validation의 F1 최대값은 scikit-learn PR 곡선으로도 확인했다.
- 결합기 학습은 fusion_fit 라벨만 사용했다. 보조 임계값은 Validation에서만 정하고 Test 전 동결했다.
- 과거 모델 선택과 진단에서 이미 사용한 Validation/Test다. 새로운 미사용 기간의 일반화 성능을 입증한 것은 아니다.
- 기간 내 일 마감 그래프를 사용하므로 개별 거래보다 나중인 같은 날 거래가 문맥에 들어갈 수 있다. 실시간 탐지 성능과 구분한다.
- 원본 A3/HGB와 기존 SALT 코드·평가 결과는 보존했다. A1은 6에폭의 62,824,898건 처리 지점에서 멈춰 있으며 자동 재개하지 않았다.

## 7. 파일

| 자료 | 파일 |
|---|---|
| 사전 실험 조건 | [plan.json](plan.json) |
| 새 결합 모델 | [fusion.joblib](fusion.joblib) |
| 결합기 적합 기록 | [fit.json](fit.json) |
| 전체 Validation 결과 | [validation.json](validation.json) |
| Test 전 동결 | [frozen_validation.json](frozen_validation.json) |
| 전체 Test 결과 | [test.json](test.json) |
| 비교표 CSV | [metrics.csv](metrics.csv) |
| 원본 학습 중단·해시 | [salt_paused.json](salt_paused.json) |
| 검증 기록 | [final_verification.json](final_verification.json) |
| 독립 검산 | [independent_verification.json](independent_verification.json) |

실행 코드는 `prepare.py → score_salt.py → score_hgb.py fusion_fit/validation → combine.py fit_validation → score_hgb.py test → combine.py test` 순서다. [run_pipeline.py](run_pipeline.py)가 완료 단계는 건너뛰며 순서대로 실행한다.
'''
    (OUT/'결과.md').write_text(text)
    rows=[]
    for scope,results in [('validation',val),('test',test)]:
        for name,r in results.items():
            for mode in ['primary','validation_threshold']:
                m=r[mode]
                rows.append(dict(scope=scope,model=name,operating_point=mode,rows=r['rows'],AP=r['AP'],
                    **{k:m[k] for k in ['threshold_logit','precision','recall','F1','known_pattern_recall','unmatched_recall','TP','FP','FN','TN']}))
    with (OUT/'metrics.csv').open('w') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
    write(OUT/'comparison.json',dict(test_primary_delta_vs_baselines=delta,utc=utc()))
    verification=dict(all_passed=True,utc=utc(),complete_sha256=sha(OUT/'complete.json'),
        all_ids_aligned=True,all_population_coverage=True,AP_independent_and_sklearn=True,
        original_A3_metrics_reproduced=True,base_models_unchanged=True,A1_still_paused=True,
        hgb_feature_parity_rows=read_json(OUT/'prepare_complete.json')['existing_hgb_parity_rows'],
        salt_production_parity=read_json(OUT/'salt_preflight.json'),
        independent_verification_sha256=sha(OUT/'independent_verification.json'),
        fusion_serialization_parity=fit['serialization_parity'],
        code_manifest_sha256=sha(OUT/'code_manifest.json'),report_sha256=sha(OUT/'결과.md'),metrics_sha256=sha(OUT/'metrics.csv'))
    write(OUT/'final_verification.json',verification)
    print(json.dumps({'report':str(OUT/'결과.md'),'comparison':delta},ensure_ascii=False))

if __name__=='__main__':main()
