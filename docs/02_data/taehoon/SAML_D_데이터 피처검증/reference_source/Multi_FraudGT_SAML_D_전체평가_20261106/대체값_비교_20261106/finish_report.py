"""Independent final checks, uncertainty note and exportable result figure."""
from imputation import *
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

plan=check_frozen();result=json.loads((ROOT/'result.json').read_text());selection=json.loads((ROOT/'selection.json').read_text())
assert result['method']==selection['selected_method'] and selection['saml_labels_used'] is False
assert result['protocol_sha256']==sha(ROOT/'target_protocol.json')
assert result['logits_sha256']==sha(ROOT/'saml_logits.npy')
for name in ['baseline','imputed']:
    row=result[name]
    assert row['rows']==N and row['coverage']==1 and row['TP']+row['FN']==9873 and row['FP']+row['TN']==9494979
assert result['imputed']['FP']==result['baseline']['FP']-result['paired']['normal_rescued']+result['paired']['new_false_positives']
assert result['imputed']['TP']==result['baseline']['TP']-result['paired']['positive_lost']+result['paired']['positive_gained']
assert json.loads((ROOT/'target_preflight.json').read_text())['passed']
assert json.loads((ROOT/'validation_parity.json').read_text())['passed']
salt=Path('/workspace/handoff/SALT_GNN_직접공유샘플링_20261104');sys.path.insert(0,str(salt));import notebook_control as control
assert control.worker() is None
paused=json.loads((DIAG/'salt_paused.json').read_text())
for name,h in paused['preserved'].items():assert sha(name)==h
assert sha(salt/'runs/daily_close_001/models/A3/last.pt')==paused['last_checkpoint_sha256']

plt.rcParams.update({'font.size':11,'axes.spines.top':False,'axes.spines.right':False})
fig,axes=plt.subplots(2,2,figsize=(10,7))
for ax,key,title in zip(axes.flat,['precision','recall','F1','AP'],['Precision','Recall','F1','Average precision']):
    values=np.array([result['baseline'][key],result['imputed'][key]])*100
    ax.bar(['Zero fill','HI Train median'],values,color=['#b55738','#267b9c'],width=.55)
    ax.set_title(title,loc='left',fontweight='bold');ax.set_ylabel('%');ax.grid(axis='y',alpha=.18);ax.set_axisbelow(True)
    ax.set_ylim(0,max(float(values.max())*1.25,1))
    for i,v in enumerate(values):ax.text(i,v+ax.get_ylim()[1]*.025,f'{v:.2f}%',ha='center')
fig.suptitle('Frozen Multi-FraudGT on all 9,504,852 SAML-D transactions',fontweight='bold')
fig.text(.5,.01,'Owner features only. Imputer selected using HI Validation AP; weights, graph and threshold 0.5 fixed.',ha='center',fontsize=9)
fig.tight_layout(rect=(0,.04,1,.95));fig.savefig(ROOT/'comparison.png',dpi=180);fig.savefig(ROOT/'comparison.svg');plt.close(fig)

unc=json.loads((ROOT/'validation_uncertainty.json').read_text());gain=unc['comparisons']['train_median minus zero'];tie=unc['comparisons']['train_median minus degree_median']
p=ROOT/'결과.md';text=p.read_text().replace('original은 참고용 원본 상한 비교다.','original은 원래 피처가 있는 참고 조건이다.')
if '**판단: 이 중앙값 대체 방식은' not in text and all(result['imputed'][k]<result['baseline'][k] for k in ['precision','recall','F1','AP']):
    text=text.replace('## SAML-D 전체 결과','**판단: 이 중앙값 대체 방식은 SAML 개선안으로 채택하지 않는다.** 오탐은 줄었지만 Precision·Recall·F1·AP가 모두 악화했다. HI에서 유효했던 대체 통계가 SAML에도 유효하다고 볼 수 없다. 패턴별 변화는 `pattern_comparison.csv`를 함께 확인한다.\n\n## SAML-D 전체 결과',1)
note=f'''\n## 추가 검산 및 해석

![SAML 전체 비교](comparison.png)

HI Validation에서 전체 중앙값의 zero 대비 AP 변화는 **{gain['AP_delta']*100:+.2f} pp**, paired 배치 bootstrap 500회의 95% 구간은 **[{gain['CI95_low']*100:+.2f}, {gain['CI95_high']*100:+.2f}] pp**다. 두 중앙값 방식 간 AP 차이는 **{tie['AP_delta']*100:+.2f} pp**, 구간은 **[{tie['CI95_low']*100:+.2f}, {tie['CI95_high']*100:+.2f}] pp**로 0을 포함한다. 따라서 선택 규칙에 따라 전체 중앙값을 택했지만, 그것이 보편적으로 더 낫거나 SAML에서 최적이라는 주장을 하지 않는다. 구간별 방식의 SAML 전체 평가는 이번 실험 범위에 포함하지 않았다.

`final_verification.json`에 전체 지표·쌍별 판정 변화의 건수 일치, 해시, 사전 검사 통과, SALT 중단 상태·체크포인트 보존 확인을 기록했다. `validation_uncertainty.json`은 선택 완료 후 산출한 불확실성 분석이며 선택 방법을 변경하지 않았다.
'''
if '## 추가 검산 및 해석' not in text:text+=note
p.write_text(text)
write('final_verification.json',dict(utc=datetime.now(timezone.utc).isoformat(),all_passed=True,all_rows=N,
    class_counts_verified=True,paired_counts_verified=True,full_logit_hash_verified=True,source_only_selection_verified=True,
    original_checkpoint_and_input_code_unchanged=True,source_validation_and_target_preflight_passed=True,
    salt_still_paused=True,salt_checkpoint_unchanged=True))
print(json.dumps(dict(all_passed=True,method=result['method'],baseline=result['baseline'],imputed=result['imputed']),ensure_ascii=False))
