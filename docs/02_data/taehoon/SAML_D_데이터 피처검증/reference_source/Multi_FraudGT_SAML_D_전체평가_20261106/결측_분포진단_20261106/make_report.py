"""Render completed diagnostic artifacts; no model execution or selection."""
from pathlib import Path
import json
import numpy as np,pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
R=Path(__file__).resolve().parent
metrics=pd.read_csv(R/'control_metrics.csv').set_index('condition')
result=json.loads((R/'control_result.json').read_text())
groups=pd.read_csv(R/'saml_group_metrics.csv')
dist=pd.read_csv(R/'feature_distribution_normal_sample.csv')
source=pd.read_csv(R/'HI_payment_population.csv')
source_perf=pd.read_csv(R/'HI_full_test_payment_metrics.csv')
full=json.loads((R.parent/'result.json').read_text())
labels={'baseline':'원본','node_type_zero':'계좌 유형 6종 → 0','node_owner_zero':'소유관계 3종 → 0',
        'country_zero':'국가 2종 → 0','missing11':'결측 11종 모두 → 0','unknown31':'결제방식 약31% → Unknown',
        'missing11_unknown31':'결측 11종 + Unknown 약31%'}
english=['Original','Type = 0','Owner = 0','Country = 0','All missing','31% Unknown','Missing + Unknown']
colors=['#344054','#98a2b3','#e66a3b','#98a2b3','#b42318','#98a2b3','#7a271a']
plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False,'figure.facecolor':'white'})
fig,axes=plt.subplots(1,2,figsize=(14,5.1))
for ax,key,title in zip(axes,['FPR','AP'],['False positive rate (%)','Average precision (%)']):
    value=metrics[key].to_numpy()*100;lo=metrics[key+'_CI_low'].to_numpy()*100;hi=metrics[key+'_CI_high'].to_numpy()*100
    ax.bar(np.arange(7),value,color=colors,yerr=np.stack([value-lo,hi-value]),capsize=3,width=.72)
    ax.set_xticks(np.arange(7),english,rotation=28,ha='right');ax.set_title(title,loc='left',fontweight='bold')
    ax.grid(axis='y',alpha=.18);ax.set_axisbelow(True)
    for i,v in enumerate(value):ax.annotate(f'{v:.3f}' if key=='FPR' else f'{v:.2f}',(i,hi[i]),xytext=(0,5),textcoords='offset points',ha='center',fontsize=9)
    ax.set_ylim(0,max(hi)*1.18)
fig.suptitle('Frozen Multi-FraudGT: paired input interventions on 262,144 HI Test transactions',fontweight='bold',y=.99)
fig.text(.5,.015,'Same checkpoint, graph batches and threshold 0.5. Error bars: 95% paired cluster-bootstrap CI (500 resamples).',ha='center',fontsize=9)
fig.tight_layout(rect=(0,.07,1,.94));fig.savefig(R/'paired_missing_controls.png',dpi=180);fig.savefig(R/'paired_missing_controls.svg');plt.close(fig)

pay=groups[groups.grouping=='payment_type'].sort_values('FPR')
fp=pd.read_csv(R/'normal_pattern_fp_contribution.csv').head(6).sort_values('predicted_positive')
fig,axes=plt.subplots(1,2,figsize=(13,5.3))
axes[0].barh(pay['group'],pay.FPR*100,color='#267b9c');axes[0].set_xlabel('False positive rate (%)');axes[0].set_title('SAML-D: errors also occur in known formats',loc='left',fontweight='bold')
for i,v in enumerate(pay.FPR*100):axes[0].text(v+.35,i,f'{v:.2f}%',va='center',fontsize=9)
axes[0].set_xlim(0,36)
axes[1].barh(fp.pattern,fp.predicted_positive/1000,color='#b55738');axes[1].set_xlabel('False positives (thousands)');axes[1].set_title('SAML-D: major normal-pattern false positives',loc='left',fontweight='bold')
for i,v in enumerate(fp.predicted_positive/1000):axes[1].text(v+4,i,f'{v:,.1f}k',va='center',fontsize=9)
axes[1].set_xlim(0,480)
for ax in axes:ax.grid(axis='x',alpha=.18);ax.set_axisbelow(True)
fig.tight_layout();fig.savefig(R/'saml_error_groups.png',dpi=180);fig.savefig(R/'saml_error_groups.svg');plt.close(fig)

control_rows=[];ci_rows=[]
for name,row in metrics.iterrows():
    control_rows.append(f"| {labels[name]} | {row.precision:.2%} | {row.recall:.2%} | {row.F1:.2%} | {row.AP:.2%} | {row.FPR:.4%} | {int(row.FP):,} |")
    if name!='baseline':
        delta=(row.AP-metrics.loc['baseline','AP'])*100
        ci_rows.append(f"| {labels[name]} | {delta:+.2f} pp | [{row.AP_delta_CI_low*100:+.2f}, {row.AP_delta_CI_high*100:+.2f}] pp |")
group_rows=[]
for _,v in groups[groups.grouping.isin(['payment_known','currency_supported'])].iterrows():
    group_rows.append(f"| {v['group']} | {int(v.rows):,} | {int(v.FP):,} | {v.FPR:.2%} | {v.recall:.2%} | {v.AP:.2%} |")
pay_rows=[]
for _,v in groups[groups.grouping=='payment_type'].iterrows():
    name={'Credit card':'Credit Card','Cash Deposit':'Cash','Cash Withdrawal':'Cash'}.get(v['group'],v['group'])
    hi=source_perf[source_perf['format']==name]
    source_fpr=f"{hi.iloc[0].FPR:.4%}" if len(hi) and pd.notna(hi.iloc[0].FPR) else '대응 없음'
    pay_rows.append(f"| {v['group']} | {source_fpr} | {v.FPR:.4%} | {int(v.FP):,} | {v.recall:.2%} |")
feature_rows=[]
chosen=['src_log_entity_observed_accounts','src_log_entity_out_diversity','src_log_entity_in_diversity',
        'src_log_self_count','dst_log_self_count','pair_prior_count','src_log_active_days','dst_log_active_days','paid_currency_z','in_port','out_port']
for name in chosen:
    d=dist[dist.feature==name].set_index('domain')
    feature_rows.append(f"| `{name}` | {d.loc['HI_train','median']:.3f} | {d.loc['HI_test','median']:.3f} | {d.loc['SAML','median']:.3f} | {d.loc['SAML','KS_vs_HI_train']:.3f} |")
baseline=metrics.loc['baseline'];owner=metrics.loc['node_owner_zero'];missing=metrics.loc['missing11'];combo=metrics.loc['missing11_unknown31']
md=f'''# Multi-FraudGT SAML-D 결측·분포 진단

분석 완료: {result['completed_utc']}

## 판단

**현재 모델은 소유관계 피처의 0 대체에 크게 취약하다. 다만 SAML-D의 전체 성능 저하를 결측 하나로 설명할 수는 없다.**

- HI의 같은 거래·같은 그래프·같은 가중치에서 소유관계 3종만 0으로 바꾸자 오탐이 **{int(baseline.FP):,} → {int(owner.FP):,}건**, F1이 **{baseline.F1:.2%} → {owner.F1:.2%}**로 악화했다. 원래 정상으로 판단한 거래 {int(owner.normal_negative_to_positive):,}건이 새 오탐으로 바뀌었다.
- SAML과 동일하게 결측 11종을 모두 0으로 처리하면 F1 **{missing.F1:.2%}**, AP **{missing.AP:.2%}**다. 여기에 약31% Unknown까지 넣어도 AP **{combo.AP:.2%}**다. **SAML 전체 AP {full['AP']:.2%} 수준의 순위 성능 붕괴는 이 HI 대조 실험에서 재현되지 않았다.**
- 국가 피처만 0으로 처리한 영향은 작았다. 따라서 “같은 국가 여부를 0으로 채운 것”이 핵심이라는 가설은 이번 대조 결과가 지지하지 않는다.
- Unknown 결제방식은 단독으로 약간의 AP 저하가 있었고 다른 결측과 함께 적용하면 추가 악화가 있었다. 그러나 단독 조건의 오탐 폭증은 나타나지 않았다. SAML에서도 Known 거래의 오탐률이 Unknown보다 높았다.
- 원본 HI 학습 데이터의 알려진 사기 패턴은 **99.987%가 ACH**였다. SAML에서는 사기·정상 패턴과 결제방식의 관계, 반복 거래·활동일·자기거래·Port 분포가 모두 다르다. 이런 차이가 별도의 설명 후보다.

이는 **HI에서 입력을 인위적으로 바꾼 모델 민감도 실험**이다. 실제 SAML의 누락된 소유관계 참값을 확보한 전후 비교가 아니므로, 결측을 복구하면 SAML에서 몇 % 회복되는지나 원인별 기여율을 확정하지 않는다.

## 1. 사전에 고정한 가설·실험 조건

가설: (H1) 미제공 계좌·국가 피처의 0 대체가 성능 저하를 유발한다. (H2) HI에서 없었던 Unknown 결제방식이 주된 원인이다. (H3) 관측 가능한 피처와 거래 패턴의 분포 차이도 크다.

| 항목 | 조건 |
|---|---|
| 대상 | 기존 HI 전체 Test 중 원래 공유 배치 128개를 무작위 선택: **{result['rows']:,}건**, 양성 **{result['positive']:,}건** |
| 표본 선택 | seed 20261106, 정답·점수와 독립적으로 원래 2,048건 배치 단위 선택 |
| 모델 | HI Multi-FraudGT epoch280 고정, 재학습 없음 |
| 판정 | 원래 임계값 sigmoid(logit)>0.5 고정, 새 임계값 선택 없음 |
| 그래프 | 원래 HI Test 누적 그래프, 같은 배치 구성과 sampler RNG·fanout[50,50] 유지 |
| 변경 범위 | 지정한 피처만 변경. context 엣지와 query 엣지에 같은 처리 적용. Ego·Port·그래프·거래 ID는 유지 |
| Unknown 대조 | 전체 거래 ID에 고정한 독립 Bernoulli mask, 확률 {2946034/9504852:.4%}; 실제 query 비율 {result['unknown_query_fraction']:.4%} |
| 불확실성 | 같은 배치를 함께 재표집하는 paired cluster bootstrap 500회, 95% 구간 |
| 검증 | 128개 원본 배치 모두 기존 전체 Test 저장 점수를 허용 오차 이내 재현 |

Unknown 대조는 HI에 임의의 결측을 넣은 민감도 시험이다. SAML의 Debit card/Cross-border가 Unknown이 되는 실제 의미·패턴 구성을 그대로 재현하지 않는다. 결과는 **표본 진단 지표**이며, 기존 HI 전체 Test 성능을 대체하지 않는다. SAML 전체 결과를 본 후 수행한 사후 분석으로, 새 미사용 Test 검증이 아니다.

## 2. 같은 HI 표본에서의 대조 결과

| 조건 | Precision | Recall | F1 | AP | FPR | 오탐 수 |
|---|---:|---:|---:|---:|---:|---:|
{chr(10).join(control_rows)}

![HI 입력 대조 결과](paired_missing_controls.png)

| 조건 | 원본 대비 AP 변화 | paired 95% 신뢰구간 |
|---|---:|---:|
{chr(10).join(ci_rows)}

소유관계 0 처리 시 정상 거래의 평균 logit이 **{owner.normal_mean_logit_change:+.3f}** 상승했다. F1과 오탐은 크게 악화했지만 AP 하락은 상대적으로 작았다. 따라서 **고정 임계값에서 정상 점수가 올라가 경보가 늘어나는 문제와 순위 성능 저하를 구분**해야 한다. 이 결과만 보고 SAML Test 정답으로 임계값을 다시 맞추지는 않았다.

## 3. 무엇이 실제로 결측인가

전처리 캐시의 NaN/Inf는 **0개**다. 문제는 NaN 계산 오류가 아니라 **없는 정보를 숫자 0으로 표현한 체계적인 입력 차이**다.

- 노드 계좌 유형 6종: Corporation, Partnership, Sole Proprietorship, Individual, Country, Direct.
- 노드 소유관계 3종: `log_entity_observed_accounts`, `log_entity_out_diversity`, `log_entity_in_diversity`.
- 엣지 국가 2종: `same_known_country`, `both_countries_known`.
- 위 11종은 SAML 전체에서 0이다. 따라서 SAML 안에는 해당 정보의 “관측된 대조군”이 없다.
- 소유 엔터티 관측 계좌 수·송신 다양성 등은 HI 정상 표본에서 거의 항상 양수였다. SAML의 0은 학습 때 드물거나 없던 입력이다. 특히 로그 계좌 수의 0은 숫자로는 관측 계좌 0개를 뜻해, 실제 계좌가 존재하는 상황에서 ‘정보 없음’과 의미가 어긋난다.
- `both_countries_known=0`은 기존의 정보 가용성 단서를 제공한다. 따라서 모든 결측에 표시가 전혀 없다고 일반화하면 안 된다. 다만 소유관계 등의 0을 구분하는 공통 신규 mask는 없다.

## 4. 기존 SAML 전체 점수에서의 오탐 위치

| 구분 | 거래 수 | 오탐 수 | FPR | Recall | AP |
|---|---:|---:|---:|---:|---:|
{chr(10).join(group_rows)}

Known 결제방식 거래만 남겨도 오탐률은 **11.40%**다. 지원하지 않는 통화의 오탐은 4,572건으로 전체 1,018,255건의 일부이며, 지원 통화에서도 오탐이 크다. 이 그룹 비교는 패턴 구성이 달라질 수 있어 단독 인과 효과로 해석하지 않는다.

사기 비율도 HI Test **0.1319%**, SAML **0.1039%**로 다르지만 이것만으로 낮은 Precision을 설명할 수는 없다. 정상 거래를 분모로 하는 FPR 자체가 HI **0.00922%**에서 SAML **10.7241%**로 약 **1,163배** 늘었다. 참고로 HI의 TPR/FPR이 그대로라고 가정하고 양성 비율만 SAML 비율로 바꾸는 산술 계산의 Precision은 약 **86.70%**다. 이는 실제 SAML 예측 성능이 아니라 단순 양성 비율 차이의 영향 크기를 살펴보는 계산이다.

| 결제방식 | HI 전체 Test FPR | SAML 전체 FPR | SAML 오탐 수 | SAML Recall |
|---|---:|---:|---:|---:|
{chr(10).join(pay_rows)}

SAML 사기의 **27.74%**가 현금 입출금인데 해당 탐지율은 **1.53%**였다. 이 구간의 미탐 2,697건은 전체 미탐의 **50.30%**다. HI 학습에서 현금 사기가 전혀 없었던 것은 아니다: **2,136건**이 있었지만 모두 기존의 ‘무패턴’ 양성이었고 알려진 패턴 양성은 0건이었다. HI 전체 Test에서도 현금 사기 643건을 전부 놓쳤다. 기존 HI의 높은 알려진 패턴 성능이 SAML의 다른 사기 유형에 그대로 이전되지 않는다는 근거다.

정상 `Normal_Group` 528,351건 중 **403,879건(76.44%)**이 오탐이며, 전체 오탐의 **39.66%**를 차지한다. 정상 행위 패턴 자체도 별도 분석 대상이다.

![SAML 결제방식 및 정상 패턴 오탐](saml_error_groups.png)

## 5. 관측 가능한 피처도 분포가 다르다

각 도메인에서 정답과 독립적으로 거래 100,000건을 추출하고, 그중 정상 거래를 비교했다. 노드값은 실제 모델에 사용한 기간 말 스냅샷이다. 표의 값은 변환된 입력의 **중앙값**이며 원래 거래 수가 아니다. KS는 분포 차이 크기(0~1)이며 인과 중요도가 아니다.

| 피처 | HI Train | HI Test | SAML | SAML vs HI Train KS |
|---|---:|---:|---:|---:|
{chr(10).join(feature_rows)}

SAML의 자기거래·자기거래 수는 실제로 0이며 이 부분은 결측 대체가 아니다. 계좌 활동일 수는 HI 학습 그래프 56일, HI Test 누적 92일, SAML 누적 321일이라는 관측 기간 차이도 받는다. SAML 정상 송신 계좌 활동일 입력의 **68.24%**가 HI 학습 정상 표본의 99백분위를 넘었다. Port와 반복 거래 수의 차이는 단순히 결측 열을 제거해도 남는다.

## 6. 다음 실험의 우선순위 — 이번에는 실행하지 않음

1. **공통으로 관측 가능한 피처만 쓰는 재학습 대조**: 34종에서 미제공 11종을 제외한 23종 기준. 기존 모델의 추론 입력을 0으로 만드는 것과, 처음부터 해당 정보 없이 학습하는 것은 다른 실험이다.
2. **학습 시 결측 처리에 적응시키는 대조**: 명시적 결측 표시, 소유관계 피처 masking, Unknown 결제방식 노출 등을 학습 데이터에 적용하고 원래 HI 성능과 결측 상황 성능을 함께 검증한다.
3. **결제방식 의존과 관측 기간 차이 분리**: 결제방식 제외 모델, 같은 길이의 관측 이력/기간 기준 피처를 비교한다. 설정 선택은 별도 검증 데이터에서 하고, 이미 진단에 사용한 SAML 전체를 새로운 미사용 Test라고 부르지 않는다.

SAML의 실제 KYC/소유관계를 추측해 넣거나, 이번 Test 점수를 보고 임계값·피처값을 바꾸어 최종 개선이라고 보고하지 않았다.

## 산출물·검증·작업 상태

- `analysis_plan.json`, `control_plan.json`: 분석 범위·가설·표본·입력 개입 조건. `control_plan.json`은 추론 전에 고정했다.
- `control_metrics.csv`, `control_result.json`: 대조 지표·신뢰구간. `control_chunks/`: 동일 표본의 조건별 점수.
- `control_input_parity.json`: 3개 실제 배치에서 GPU 입력과 원본 CPU 입력의 비트 단위 일치 확인.
- `intervention_unit_checks.json`: 지정 열만 변경하고 원본 배치·그래프·Port·Ego를 보존하는지 확인.
- `saml_group_metrics.csv`, `saml_pattern_by_payment_known.csv`, `normal_pattern_fp_contribution.csv`: SAML 전체 그룹 진단.
- `HI_payment_population.csv`, `HI_full_test_payment_metrics.csv`: HI 전체 Train/Test 결제방식 분포 및 저장 점수의 조건별 오류.
- `feature_distribution_normal_sample.csv`, `distribution_sampling.json`: 표본 분포와 표본 방식. `missingness_inventory.json`: 결측·NaN 검사.
- **SALT-GNN은 2026-11-06 05:16:11 UTC에 체크포인트를 저장하고 중단했으며, 자동 재개하지 않았다.** `salt_paused.json`, `salt_last_at_pause.pt`에 재개 가능한 상태를 보존했다.
'''
(R/'분석결과.md').write_text(md)
print('Wrote analysis report and two figures.')
