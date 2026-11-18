from experiment import *
import csv,re
import pandas as pd
import pyarrow.parquet as pq
from sklearn.metrics import average_precision_score,roc_auc_score
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

def metrics(y,z):
    p=z>0;tp=int((y&p).sum());fp=int((~y&p).sum());fn=int((y&~p).sum());tn=int((~y&~p).sum())
    ratio=lambda a,b:a/b if b else 0.
    sys.path.insert(0,str(HI));import fraudgt_lab
    from fraudgt_lab.metrics import binary_average_precision
    ap=binary_average_precision(y,z);assert abs(ap-average_precision_score(y,z))<1e-12
    return dict(rows=len(y),positive=int(y.sum()),TP=tp,FP=fp,FN=fn,TN=tn,
        precision=ratio(tp,tp+fp),recall=ratio(tp,tp+fn),F1=ratio(2*tp,2*tp+fp+fn),AP=ap,FPR=ratio(fp,fp+tn),
        ROC_AUC=float(roc_auc_score(y,z)),coverage=1.)

def table(headers,rows):
    return '\n'.join(['| '+' | '.join(headers)+' |','| '+' | '.join(['---']*len(headers))+' |']+
        ['| '+' | '.join(map(str,row))+' |' for row in rows])

def main():
    plan=check_frozen();protocol=json.loads((ROOT/'target_protocol.json').read_text());protocol_sha=sha(ROOT/'target_protocol.json')
    saved={name:np.lib.format.open_memmap(ROOT/f'saml_{name}_logits.npy','w+',dtype='float32',shape=(N,)) for name in METHODS}
    seen=np.zeros(N,bool)
    for path in sorted((ROOT/'target_chunks').glob('*.json')):
        info=json.loads(path.read_text());assert info['protocol_sha256']==protocol_sha and sha(path.with_suffix('.npz'))==info['sha256']
        with np.load(path.with_suffix('.npz')) as a:
            ids=a['ids'];assert len(ids)==info['rows']==len(np.unique(ids)) and (ids<N).all() and not seen[ids].any()
            assert list(a['methods'])==METHODS and np.isfinite(a['logits']).all()
            for j,name in enumerate(METHODS):saved[name][ids]=a['logits'][j]
            seen[ids]=True
    assert seen.all()
    for a in saved.values():a.flush()
    y=np.load(BASE/'cache/labels.npy',mmap_mode='r').astype(bool)
    scores={'zero':np.load(BASE/'cache/logits.npy',mmap_mode='r'),
            'train_median':np.load(PRIOR/'saml_logits.npy',mmap_mode='r'),**saved}
    refs={'zero':json.loads((BASE/'result.json').read_text()),'train_median':json.loads((PRIOR/'result.json').read_text())['imputed']}
    results=[];paired={}
    for name,z in scores.items():
        met=metrics(y,z)
        if name in refs:
            for key in ('TP','FP','FN','TN','precision','recall','F1','AP','FPR','ROC_AUC'):assert abs(met[key]-refs[name][key])<1e-12
        results.append(dict(method=name,**met));event('metric_complete',method=name,metrics=met)
        if name in METHODS:
            old=scores['zero'];p=z>0;po=old>0
            paired[name]=dict(normal_rescued=int((~y&po&~p).sum()),new_false_positives=int((~y&~po&p).sum()),
                positive_gained=int((y&~po&p).sum()),positive_lost=int((y&po&~p).sum()))
    pd.DataFrame(results).to_csv(ROOT/'saml_metrics.csv',index=False)
    truth_path=Path('/workspace/kimi/Claude_GNN/final_model/experiments/v10_saml_generalization_20261025/cache/truth.parquet')
    truth=pq.read_table(truth_path,columns=['eid','y','pattern']).to_pandas()
    np.testing.assert_array_equal(truth.eid,np.arange(N));np.testing.assert_array_equal(truth.y.astype(bool),y)
    pattern_rows=[]
    for pattern,ix in truth.groupby('pattern',sort=True).groups.items():
        ix=np.asarray(ix);labels=y[ix];pos=int(labels.sum());assert pos in (0,len(ix))
        r=dict(pattern=pattern,rows=len(ix),positive=pos,kind='fraud' if pos else 'normal')
        for name,z in scores.items():
            pred=z[ix]>0;r[name+'_predicted_positive']=int(pred.sum());r[name+'_rate']=float(pred.mean())
        pattern_rows.append(r)
    pd.DataFrame(pattern_rows).to_csv(ROOT/'pattern_comparison.csv',index=False)
    for result in results:
        name=result['method']
        assert sum(p[name+'_predicted_positive'] for p in pattern_rows if p['positive'])==result['TP']
        assert sum(p[name+'_predicted_positive'] for p in pattern_rows if not p['positive'])==result['FP']
    selection=json.loads((ROOT/'selection.json').read_text());fit=json.loads((ROOT/'fit.json').read_text())
    result=dict(completed_utc=datetime.now(timezone.utc).isoformat(),protocol_sha256=protocol_sha,
        source_selected_method=selection['selected_method'],target_methods=METHODS,results=results,paired=paired,
        target_logits_sha256={name:sha(ROOT/f'saml_{name}_logits.npy') for name in METHODS},
        main_model_retrained=False,threshold=.5,all_rows_verified=True,AP_sklearn_crosscheck=True)
    write('result.json',result)
    rows=[[TITLES[r['method']],f"{r['precision']:.2%}",f"{r['recall']:.2%}",f"{r['F1']:.2%}",f"{r['AP']:.2%}",f"{r['FPR']:.4%}",f"{r['TP']:,}",f"{r['FP']:,}"] for r in results]
    target_table=table(['입력 처리','Precision','Recall','F1','AP','FPR','사기 탐지','정상 오탐'],rows)
    valrows=[[TITLES[r['method']],f"{r['precision']:.2%}",f"{r['recall']:.2%}",f"{r['F1']:.2%}",f"{r['AP']:.2%}",f"{r['FP']:,}"] for r in selection['results']]
    validation_table=table(['HI Validation 조건','Precision','Recall','F1','AP','오탐'],valrows)
    baseline=results[0];judgments=[]
    for r in results[2:]:
        changes=', '.join(f"{label} {(r[key]-baseline[key])*100:+.2f} pp" for key,label in [('AP','AP'),('F1','F1'),('recall','Recall')])
        verdict='AP와 F1이 모두 기존 0 대체보다 높았다' if r['AP']>baseline['AP'] and r['F1']>baseline['F1'] else '기존 0 대체 대비 AP·F1의 일관된 개선을 확인하지 못했다'
        judgments.append(f"- **{TITLES[r['method']]}:** {verdict}. {changes}. 이는 이미 확인한 SAML 전체에 대한 탐색 결과다.")
    body=f'''# 추가 결측 대체 실험: 차수 구간 중앙값과 유사 계좌 대체

완료: {result['completed_utc']}

## SAML-D 전체 결과

두 방법 모두 사전에 정해 **전체 {N:,}건**을 평가했다. HI Validation에서 먼저 고른 후보는 **{TITLES[selection['selected_method']]}**다. 아래 SAML 성능으로 후보나 임계값을 재선택하지 않았다.

{target_table}

{chr(10).join(judgments)}

## 바꾼 값과 고정한 조건

소유관계 노드 피처 `log_entity_observed_accounts`, `log_entity_out_diversity`, `log_entity_in_diversity` 3종만 변경했다. 계좌 유형6종·국가2종은 계속0이며, 결제방식 Unknown 대응·다른 관측 피처·Port·Ego는 유지했다. 가중치 epoch280, 임계값0.5, all_targets, 공유배치2048, fanout[50,50], 거래 순서와 sampler RNG도 동일하다. 두 방법이 배치마다 **같은 샘플링 그래프**를 공유했다.

| 방법 | 계산 기준 | 한계 |
|---|---|---|
| 차수 구간별 중앙값 | HI Train의 송신·수신 상대계좌 수 구간별 소유관계 중앙값. 128계좌 미만인 구간은 Train 전체 중앙값. 앞선 실험과 같은 적합 결과 사용 | 같은 구간 안에서도 실제 소유관계는 다를 수 있음 |
| 행동 유사 계좌 대체 | HI Train 활동 계좌 중 seed20261109로 65,536개를 균등 추출. 관측 행동10종을 Train p01/p99로 제한하고 중앙값/IQR로 스케일링. 근접 계좌1개의 실제 소유관계3종을 함께 복사 | 근접 계좌의 소유관계가 SAML의 참값이라는 뜻은 아님. p01/p99 제한으로 관측 범위 밖의 차이가 소실될 수 있음 |

유사 계좌 검색은 Euclidean cKDTree k=1, eps0.1로, 반환 거리는 정확한 최단거리의1.1배 이내인 근사 최근접 검색이다. 스케일은 max(IQR,0.1)이며 설정·계좌 표본은 모델 평가 전에 고정했다. 분류 정답은 대체값 적합에 쓰지 않았다. SAML 입력은 적합된 규칙으로 변환하고 검색할 때만 사용했다. 모든 대체값은 추정값이며 누락된 실제 소유관계의 복원이 아니다.

## HI Validation에서의 비교

앞선 실험과 같은262,144건(128배치), 사기340건을 사용했다. 기존 네 조건의 점수를 모두 재현했고 새 유사 계좌 조건을 추가했다. 두 신규 전체평가 후보의 AP로 우선 후보를 선택하고, AP 동률1e-12 이내에서는 F1을 사용하도록 사전에 정했다. 두 후보는 선택 결과와 무관하게 모두 SAML 전체 평가하도록 고정했다.

{validation_table}

## 패턴별 변화

사기 패턴은 Recall, 정상 패턴은 FPR다. 전체 패턴별 건수는 `pattern_comparison.csv`에 있다.

'''
    prows=[]
    for p in pattern_rows:
        prows.append([p['pattern'],'사기' if p['positive'] else '정상',f"{p['rows']:,}",*[f"{p[name+'_rate']:.4%}" for name in scores]])
    body+=table(['패턴','구분','건수',*[TITLES[name] for name in scores]],prows)
    body+='''

## 해석·검증·산출물

이번 결과는 이미 여러 번 분석한 SAML Test에 대한 후속 진단이다. HI Validation에서 좋은 방식이 SAML에도 유효하다는 보장은 없다. 3종의 대체 방식 비교이지, 11종 전체 결측이나 도메인 차이를 제거한 실험은 아니다. 모든 방법이 실패하더라도 결측이 원인이 아니라는 결론을 낼 수 없으며, 새 방법이 개선돼도 별도 미사용 평가에서 재확인이 필요하다.

대체값 적합은 HI Train만 사용했다. 대표노드64개에서 유사 계좌 거리의 근사 허용범위와 실제 donor3종의 일치를 독립 전수 거리 계산으로 검사했다. HI Validation 원본 및 이전3조건은128배치 모두 기존 점수를 재현했다. SAML 대표4배치에서는 두 방법 각각의 CPU/GPU 입력·점수 일치와 기존 0 대체 재현을 검사했다. 전체950만여 거래에 대해 누락·중복 없이 점수를 만들었고 AP는 별도 구현과 scikit-learn으로 검산했다. SALT-GNN의 중단 상태와 체크포인트 보존도 확인했다.

`plan.json`, `fit.json`, `fit_checks.json`, `selection.json`, `target_protocol.json`, `target_preflight.json`, `final_verification.json`에 조건과 검증을 기록했다. `validation_metrics.csv`, `saml_metrics.csv`, `pattern_comparison.csv`, `result.json`은 결과이며, `saml_degree_median_logits.npy`, `saml_behavior_donor_logits.npy`는 원래 거래 ID 순서의 전체 점수다.

![전체 결과 비교](comparison.png)
'''
    (ROOT/'결과.md').write_text(body)
    # A compact standalone chart, percentages on separate axes.
    fig,axes=plt.subplots(1,3,figsize=(13,4.5),layout='constrained')
    names=['Zero','Global median','Degree median','Behavior donor']
    for ax,key,title in zip(axes,['AP','F1','recall'],['Average Precision (%)','F1 (%)','Recall (%)']):
        values=[r[key]*100 for r in results];bars=ax.bar(names,values,color=['#5c6c7a','#b8c1ca','#376ea4','#e38732'])
        ax.bar_label(bars,fmt='%.2f',padding=3);ax.set_ylim(0,max(values)*1.3 if max(values) else 1)
        ax.set_title(title);ax.tick_params(axis='x',rotation=28);ax.spines[['top','right']].set_visible(False)
    fig.savefig(ROOT/'comparison.png',dpi=160);fig.savefig(ROOT/'comparison.svg');plt.close(fig)
    check_frozen()
    write('final_verification.json',dict(all_passed=True,completed_utc=datetime.now(timezone.utc).isoformat(),
        rows=N,methods=METHODS,full_id_coverage=True,AP_sklearn_crosscheck=True,baseline_and_prior_median_reproduced=True,
        pattern_totals_match_global_metrics=True,source_selection_precedes_target=True,
        input_preflight_passed=json.loads((ROOT/'target_preflight.json').read_text())['passed'],
        salt_still_paused=True,original_checkpoint_unchanged=True))
    cause=BASE/'성능하락_원인보고서_20261106.md';marker='## 12. 추가 결측 대체 실험 결과'
    snippet=f'''{marker}

전체 결과 비교를 추가했다. 두 후보는 사전에 정했고 HI Validation으로 먼저 선정한 후보는 **{TITLES[selection['selected_method']]}**다. 두 후보 모두 같은 전체 SAML 거래와 샘플링 그래프에서 평가했다.

{target_table}

{chr(10).join(judgments)}

세부 조건·Validation·28개 패턴별 결과·그래프·검증은 [추가 결측 실험 보고서](대체값_추가실험_20261106/결과.md)에 있다. 가중치·임계값은 고정했고, 소유관계3종 외의 결측과 도메인 차이는 남아 있다. 이미 분석한 Test의 후속 진단이며 완전히 새로운 일반화 검증으로 해석하지 않는다.
'''
    text=cause.read_text();text=text.split('\n'+marker)[0].rstrip()+'\n\n'+snippet;cause.write_text(text)
    event('complete',source_selected_method=selection['selected_method'],results=results)

if __name__=='__main__':main()
