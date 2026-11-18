from experiment import *
import csv,html
from sklearn.metrics import average_precision_score,roc_auc_score
from threadpoolctl import threadpool_limits

FUSIONS={'Multi_FraudGT_HGB':(MOUT,'Multi_FraudGT'),'A3_HGB':(AOUT,'A3')}
DISPLAY={'Multi_FraudGT':'Multi-FraudGT','HGB':'HGB','A3':'SALT-GNN A3','Multi_FraudGT_HGB':'Multi-FraudGT + HGB','A3_HGB':'SALT-GNN A3 + HGB'}

def count(y,z,threshold=0.):
    pred=z>=threshold;truth=y>0
    tp=int(np.count_nonzero(pred&truth));fp=int(np.count_nonzero(pred&~truth));fn=int(truth.sum())-tp;tn=len(y)-tp-fp-fn
    return dict(TP=tp,FP=fp,FN=fn,TN=tn,precision=tp/(tp+fp) if tp+fp else 0.,recall=tp/(tp+fn),
        F1=2*tp/(2*tp+fp+fn),FPR=fp/(fp+tn),predicted_positive=tp+fp,alert_rate=(tp+fp)/len(y),threshold_logit=float(threshold),
        threshold_probability=float(1/(1+np.exp(-threshold))))

def fusion(name):
    root,gnn=FUSIONS[name];bundle=joblib.load(root/'fusion.joblib');frozen=read_json(root/'frozen_validation.json')
    assert sha(root/'fusion.joblib')==frozen['fusion_sha256'] and bundle['plan_sha256']==frozen['plan_sha256']
    folder=OUT/'scores'/name;folder.mkdir(parents=True,exist_ok=True)
    if (folder/'complete.json').exists():return scores(name)
    h=scores('HGB');g=scores(gnn);z=np.lib.format.open_memmap(folder/'scores.npy','w+',dtype='float64',shape=(N,));maximum=0.
    w=bundle['model'].coef_[0]/bundle['scaler'].scale_
    intercept=bundle['model'].intercept_[0]-np.sum(w*bundle['scaler'].mean_)
    for start in range(0,N,250000):
        x=np.column_stack([h[start:start+250000],g[start:start+250000]])
        result=bundle['model'].decision_function(bundle['scaler'].transform(x));manual=x@w+intercept
        maximum=max(maximum,float(np.max(np.abs(result-manual))))
        assert np.isfinite(result).all();z[start:start+len(x)]=result
    assert maximum<1e-10;z.flush();score_complete(name,dict(source_fusion_sha256=sha(root/'fusion.joblib'),
        all_scores_independently_verified=True,manual_formula_max_abs_error=maximum))
    return z

def exact_ap(y,z):
    order=np.argsort(-z,kind='stable');s=np.asarray(z)[order]
    ends=np.r_[np.flatnonzero(s[:-1]!=s[1:]),len(s)-1]
    cumulative=np.cumsum(np.asarray(y)[order]>0,dtype=np.int64)[ends]
    ap=float(np.sum(np.diff(np.r_[0,cumulative])/int(np.count_nonzero(y))*cumulative/(ends+1)))
    top=[]
    for fraction in (.001,.005,.01):
        k=int(np.ceil(len(y)*fraction));tp=int(np.count_nonzero(np.asarray(y)[order[:k]]))
        top.append(dict(fraction=fraction,alerts=k,TP=tp,FP=k-tp,precision=tp/k,recall=tp/int(np.count_nonzero(y))))
    return ap,top

def csvout(name,rows):
    keys=list(dict.fromkeys(k for row in rows for k in row))
    with (OUT/name).open('w',newline='',encoding='utf-8-sig') as f:
        writer=csv.DictWriter(f,fieldnames=keys);writer.writeheader();writer.writerows(rows)

def threshold_sweep(results):
    y=labels();points=sorted(set([i/100 for i in range(101)]+[.0001,.001,.005]+[r['hi_validation_threshold']['threshold_probability'] for k,r in results.items() if k in FUSIONS]))
    chosen={r['hi_validation_threshold']['threshold_probability']:r['hi_validation_threshold']['threshold_logit'] for k,r in results.items() if k in FUSIONS}
    cuts=np.array([-np.inf if p==0 else np.inf if p==1 else chosen[p] if p in chosen else np.log(p)-np.log1p(-p) for p in points]);rows=[]
    for name in FUSIONS:
        z=scores(name);bins=len(cuts)+1;hist=np.zeros((2,bins),np.int64)
        for start in range(0,N,1000000):
            index=np.searchsorted(cuts,z[start:start+1000000],side='right');group=(y[start:start+1000000]>0).astype('int64')
            hist+=np.bincount(group*bins+index,minlength=2*bins).reshape(2,bins)
        pred=hist[:,::-1].cumsum(axis=1)[:,::-1][:,1:]
        assert np.all(np.diff(pred,axis=1)<=0) and pred[:,0].tolist()==[N-POS,POS] and not pred[:,-1].any()
        for i,p in enumerate(points):
            fp,tp=map(int,pred[:,i]);fn=POS-tp;tn=N-POS-fp
            r=dict(model=name,threshold_probability=p,precision=tp/(tp+fp) if tp+fp else 0.,recall=tp/POS,
                F1=2*tp/(2*tp+fp+fn),AP=results[name]['AP'],TP=tp,FP=fp,FN=fn,TN=tn,predicted_positive=tp+fp)
            if p in [0.,.1,.2,.5,.9,1.,*chosen]:
                direct=count(y,z,float(cuts[i]))
                for key in ('TP','FP','FN','TN'):assert r[key]==direct[key]
            rows.append(r)
    csvout('임계값별_비교.csv',rows);write(OUT/'thresholds.json',dict(new_threshold_selection=False,points=points,rows=rows));return rows

def patterns(results):
    import pyarrow.parquet as pq
    import pandas as pd
    raw=pq.read_table(S/'cache/truth.parquet',columns=['pattern']).to_pandas()['pattern'];cat=pd.Categorical(raw)
    codes=cat.codes;names=list(cat.categories);y=np.asarray(labels())>0
    rows=[]
    totals=np.bincount(codes,minlength=len(names));positive=np.bincount(codes[y],minlength=len(names))
    for model in FUSIONS:
        z=scores(model)
        for point in ('primary','hi_validation_threshold'):
            threshold=results[model][point]['threshold_logit'];pred=z>=threshold
            tp=np.bincount(codes[pred&y],minlength=len(names));fp=np.bincount(codes[pred&~y],minlength=len(names))
            for i,name in enumerate(names):
                rows.append(dict(model=model,operating_point=point,threshold_probability=results[model][point]['threshold_probability'],
                    pattern=str(name),rows=int(totals[i]),positive=int(positive[i]),TP=int(tp[i]),FP=int(fp[i]),FN=int(positive[i]-tp[i]),
                    recall=float(tp[i]/positive[i]) if positive[i] else None))
    csvout('SAML_패턴별_탐지.csv',rows);write(OUT/'patterns.json',dict(hi_unmatched_mapping=False,rows=rows));return rows

def report(results,thresholds,pattern_rows):
    def percent(x):return f'{100*x:.2f}%'
    def table(headers,rows):
        return '<div class="scroll"><table><thead><tr>'+''.join('<th>'+html.escape(x)+'</th>' for x in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+html.escape(str(x))+'</td>' for x in row)+'</tr>' for row in rows)+'</tbody></table></div>'
    main=[];hi=[];selected=[]
    for name,r in results.items():
        m=r['primary'];main.append([DISPLAY[name],*[percent(m[k]) for k in ('precision','recall','F1')],percent(r['AP']),f"{m['TP']:,}",f"{m['FP']:,}",f"{m['FN']:,}"])
        if name in FUSIONS:
            old=read_json(FUSIONS[name][0]/'test.json')['results'][name];o=old['primary']
            hi.append([DISPLAY[name],percent(o['F1']),percent(m['F1']),percent(old['AP']),percent(r['AP'])])
            q=r['hi_validation_threshold'];selected.append([DISPLAY[name],f"{q['threshold_probability']:.6f}",*[percent(q[k]) for k in ('precision','recall','F1')],f"{q['FP']:,}"])
    positive_patterns=[]
    for a in pattern_rows:
        if a['model']=='Multi_FraudGT_HGB' and a['operating_point']=='primary' and a['positive']:
            b=next(x for x in pattern_rows if x['model']=='A3_HGB' and x['operating_point']=='primary' and x['pattern']==a['pattern'])
            positive_patterns.append([a['pattern'],f"{a['positive']:,}",f"{a['TP']:,}",percent(a['recall']),f"{b['TP']:,}",percent(b['recall'])])
    sweep=[]
    for a in thresholds:
        if a['model']=='Multi_FraudGT_HGB':
            b=next(x for x in thresholds if x['model']=='A3_HGB' and x['threshold_probability']==a['threshold_probability'])
            sweep.append([f"{a['threshold_probability']:.6f}",*[percent(a[k]) for k in ('precision','recall','F1')],f"{a['FP']:,}",*[percent(b[k]) for k in ('precision','recall','F1')],f"{b['FP']:,}"])
    page='''<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>두 HGB 결합 모델의 SAML-D 일반화 평가</title><style>body{font:15px system-ui,sans-serif;background:#f2f5f9;color:#193047;margin:0}main{max-width:1250px;margin:auto;padding:28px 20px 60px}h1{font-size:28px}h2{font-size:20px}p,li{line-height:1.75}.panel{background:white;border:1px solid #dbe4ed;border-radius:12px;padding:22px;margin-top:18px}.scroll{overflow:auto;max-height:480px}table{border-collapse:collapse;white-space:nowrap;width:100%;font-variant-numeric:tabular-nums}td,th{padding:10px;text-align:right;border-bottom:1px solid #dfe7ee}td:first-child,th:first-child{text-align:left}th{background:#eaf1f8;position:sticky;top:0}a{color:#1a63a0}.note{border-left:4px solid #a26a26;padding:12px 18px;background:#fff7e9}code{overflow-wrap:anywhere}</style></head><body><main><h1>두 HGB 결합 모델의 SAML-D 일반화 성능</h1>'''
    page+=f'<p>평가 완료: {html.escape(utc())}<br>SAML-D 전체 <b>{N:,}건</b> · 정상 {N-POS:,}건 · 사기 <b>{POS:,}건</b> ({100*POS/N:.4f}%) · 2022-10-07~2023-08-23. 모든 거래에 점수를 생성했다.</p>'
    page+='<p>HI-Large에서 학습한 GNN·HGB·로지스틱 회귀와 정규화 값을 고정했다. SAML-D로 재학습하거나 임계값을 재선택하지 않았다. SALT 학습은 기존 중단 상태를 유지했다.</p>'
    page+='<section class="panel"><h2>전체 SAML-D, 공통 임계값 0.5</h2>'+table(['모델','Precision','Recall','F1','AP','TP','FP','FN'],main)+'</section>'
    page+='<section class="panel"><h2>HI-Large Test → SAML-D, 임계값 0.5</h2>'+table(['모델','HI F1','SAML F1','HI AP','SAML AP'],hi)+'</section>'
    page+='<section class="panel"><h2>각 모델의 HI Validation 선택 임계값을 그대로 적용</h2>'+table(['모델','고정 임계값','Precision','Recall','F1','FP'],selected)+'</section>'
    page+='<section class="panel"><h2>SAML 자체 패턴별 탐지율, 임계값 0.5</h2>'+table(['SAML 패턴','실제 사기','Multi 탐지','Multi Recall','SALT 탐지','SALT Recall'],positive_patterns)+'<p>HI의 무패턴/알려진 패턴 분류를 SAML에 임의로 적용하지 않았다. CSV에는 각자 HI Validation 선택값의 패턴별 결과도 포함한다.</p></section>'
    page+='<section class="panel"><h2>공통 임계값별 비교</h2>'+table(['임계값','Multi P','Multi R','Multi F1','Multi FP','SALT P','SALT R','SALT F1','SALT FP'],sweep)+'<p>이 표는 사후 민감도 분석이다. SAML에서 가장 좋아 보이는 임계값을 새 운영값으로 선택하지 않았다. AP는 임계값과 관계없이 일정하다.</p></section>'
    page+='<section class="panel"><h2>적용 조건과 해석</h2><ul><li>Multi-FraudGT는 epoch 280의 기존 SAML 전체 예측을 해시·거래 ID·정답으로 검증해 재사용했다. 원본의 전체 기간 말 누적 그래프를 유지한다.</li><li>SALT-GNN A3는 epoch 6, 원래 날짜별 공유 그래프와 CUDA 샘플러(cap 100), microbatch 4,096, score block 8,192를 사용했다. 노드 상태·원본 차수는 해당 날짜 말까지만 집계하고, 차수 정규화 상수는 HI 학습값으로 고정했다.</li><li>HGB는 기존 36개 입력 열을 이름으로 연결했다. 기존 SAML 전처리의 HI 통계·결측 0·미지원 결제수단 Unknown 매핑을 유지했다. GNN의 계좌 유형/소유 관계 9개 열과 국가 2개 열, HGB의 수취금액/소유관계 관련 열 등은 관측되지 않아 0 대치된 값이다. 실제 0과 결측을 구분하는 새 플래그를 추가하지 않았다.</li><li>두 GNN은 그래프 문맥 방식이 다르므로 모델 구조 하나만 바꾼 통제 실험이나 거래 시점의 인과적 탐지 성능으로 해석할 수 없다. SALT도 일 마감 시점의 정보를 사용한다.</li><li>SAML은 과거에도 평가한 데이터다. Multi의 원래 HI 에폭 선택 구간과 이후 결합 학습·비교 Validation 구간이 겹친다는 기존 제한도 유지된다.</li><li>성능 하락의 원인을 이 평가만으로 결측치 하나에 귀속할 수 없다. 입력 가용성, 거래 분포, 패턴, 그래프 문맥 차이를 함께 고려해야 한다.</li></ul></section>'
    page+='<section class="panel"><h2>검증과 파일</h2><p>전체 거래 ID·정답 정렬, CPU/GPU 샘플 그래프·입력 일치, 모든 노드 차수의 독립 재계산, 결합식 독립 재계산, AP의 별도 구현과 sklearn 일치, 기존 Multi 지표 재현, 원본 모델 보존을 확인했다.</p><p><a href="전체성능.csv">전체 성능 CSV</a> · <a href="임계값별_비교.csv">임계값별 CSV</a> · <a href="SAML_패턴별_탐지.csv">패턴별 CSV</a> · <a href="plan.json">평가 조건</a> · <a href="verification.json">검증 결과</a></p></section></main></body></html>'
    (OUT/'SAML_D_두결합모델_일반화_결과.html').write_text(page)

def run():
    check_frozen();y=labels();results={};flat=[]
    for name in FUSIONS:fusion(name)
    for name in ('Multi_FraudGT','HGB','A3','Multi_FraudGT_HGB','A3_HGB'):
        z=scores(name);ap,top=exact_ap(y,z);independent=float(average_precision_score(y,z));assert abs(ap-independent)<1e-10
        r=dict(model=name,rows=N,positive=POS,coverage=1.,AP=ap,AP_sklearn=independent,AP_crosscheck=True,
            ROC_AUC=float(roc_auc_score(y,z)),primary=count(y,z),top_k=top)
        if name=='Multi_FraudGT':
            assert not np.any(z==0);old=read_json(OLD/'result.json')
            for k in ('TP','FP','FN','TN'):assert r['primary'][k]==old[k]
            assert abs(ap-old['AP'])<1e-10;r['original_saml_baseline_reproduced']=True
        if name in FUSIONS:
            threshold=read_json(OUT/'plan.json')['secondary_frozen_hi_validation_logits'][name]
            r['hi_validation_threshold']=count(y,z,threshold)
        results[name]=r
        for point in ('primary','hi_validation_threshold'):
            if point in r:flat.append(dict(model=DISPLAY[name],operating_point=point,AP=ap,ROC_AUC=r['ROC_AUC'],**r[point]))
        log('saml_metrics_complete',model=name,AP=ap,**r['primary'])
    write(OUT/'results.json',dict(utc=utc(),population='complete SAML-D',results=results,plan_sha256=sha(OUT/'plan.json')))
    csvout('전체성능.csv',flat);thresholds=threshold_sweep(results);pattern_rows=patterns(results)
    check_frozen()
    write(OUT/'verification.json',dict(passed=True,utc=utc(),all_rows_scored=True,labels_ids_aligned=True,AP_independently_verified=True,
        original_multi_saml_result_reproduced=True,all_fusion_scores_independently_recomputed=True,threshold_scans_crosschecked=True,
        original_models_and_thresholds_preserved=True,salt_training_still_paused=True,plan_sha256=sha(OUT/'plan.json'),
        code_manifest_sha256=sha(OUT/'code_manifest.json'),salt_preflight_sha256=sha(OUT/'salt_preflight.json')))
    report(results,thresholds,pattern_rows)
    write(OUT/'complete.json',dict(status='complete',utc=utc(),rows=N,positive=POS,coverage=1.,plan_sha256=sha(OUT/'plan.json'),
        results_sha256=sha(OUT/'results.json'),report_sha256=sha(OUT/'SAML_D_두결합모델_일반화_결과.html'),salt_training_still_paused=True))
    log('experiment_complete',results={k:dict(AP=r['AP'],F1=r['primary']['F1'],precision=r['primary']['precision'],recall=r['primary']['recall']) for k,r in results.items()})

if __name__=='__main__':
    with threadpool_limits(limits=2):run()
