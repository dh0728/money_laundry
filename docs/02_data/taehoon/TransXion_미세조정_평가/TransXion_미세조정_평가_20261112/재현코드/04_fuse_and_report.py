"""결합기를 검증 구간에서 다시 맞추고 Test(11~12월)를 한 번 평가해 결과.md를 쓴다."""
import sys, json, argparse
from pathlib import Path
import numpy as np, pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score, precision_recall_curve
SRC=Path('/workspace/handoff/TransXion_외부평가_20261112'); ROOT=Path(__file__).resolve().parents[1]; WORK=ROOT/'work'
a=argparse.ArgumentParser(); a.add_argument('--dry',action='store_true'); dry=a.parse_args().dry
t=pd.read_parquet(SRC/'normalized/truth.parquet'); y=t.y.to_numpy(np.int8); n=len(y)
tx=pd.read_parquet(SRC/'normalized/transactions.parquet',columns=['src','dst'])
kind=pd.read_parquet(SRC/'normalized/account_mapping.parquet').sort_values('node_id').profile_kind.to_numpy()
pair=(pd.Series(kind[tx.src])+'→'+pd.Series(kind[tx.dst])).str.replace('person','개인').str.replace('merchant','상인').to_numpy()
day=t.original_timestamp.to_numpy().astype('datetime64[D]')
va=(day>=np.datetime64('2025-09-01'))&(day<=np.datetime64('2025-10-31')); te=day>=np.datetime64('2025-11-01')
h0=np.load(SRC/'run/prepared/hgb_logit.npy'); h1=np.load(WORK/'hgb_logit_retrained.npy')
if dry:   # 코드 점검용: 미세조정 점수 대신 기존 저장 점수를 넣는다
    g=np.load(SRC/'inference_batch2048/gnn_logits.npy')[1].astype(np.float64); g0v=g0t=g1v=g1t=g; hist=None
else:
    g0v=np.load(WORK/'val_logit_step0.npy').astype(np.float64); g0t=np.load(WORK/'test_logit_frozen.npy').astype(np.float64)
    g1v=np.load(WORK/'val_logit_finetuned.npy').astype(np.float64); g1t=np.load(WORK/'test_logit_finetuned.npy').astype(np.float64)
    hist=json.loads((ROOT/'gnn_finetune_history.json').read_text())
for _z,_m in [(g0v,va),(g1v,va),(g0t,te),(g1t,te)]:   # 구간 밖은 채점하지 않아 NaN이다. 구간 안이 유한한지 확인한 뒤 0으로 채운다(사용하지 않는 값)
    assert np.isfinite(_z[_m]).all(); _z[~_m]=0.0
HI={'GNN':0.7844613790512085,'HGB':-0.9449479020486691,'결합':-1.4178564536600042}
f0=lambda h,g:-0.4412511869+0.6739111692*h+0.350945333*g            # HI에서 맞춘 결합식
scaler=StandardScaler().fit(np.c_[h1[va],g1v[va]])
lr=LogisticRegression(C=0.1,max_iter=1000,tol=1e-7,random_state=20261108).fit(scaler.transform(np.c_[h1[va],g1v[va]]),y[va])
f1=lambda h,g:lr.decision_function(scaler.transform(np.c_[h,g]))
def best_f1_cut(yv,zv):
    p,r,c=precision_recall_curve(yv,zv); f=2*p[:-1]*r[:-1]/np.maximum(p[:-1]+r[:-1],1e-12); return float(c[np.argmax(f)])
models=[('HI 고정','GNN',g0v,g0t,HI['GNN']),('HI 고정','HGB',h0,h0,HI['HGB']),('HI 고정','결합',f0(h0,g0v),f0(h0,g0t),HI['결합']),
        ('TransXion 학습','GNN',g1v,g1t,None),('TransXion 학습','HGB',h1,h1,None),('TransXion 학습','결합',f1(h1,g1v),f1(h1,g1t),None)]
rows=[];groups=[];yt=y[te];pt=pair[te]
def cm(z,cut,m=None):
    m=np.ones(len(z),bool) if m is None else m; al=(z>=cut)&m; tp=int((al&(yt==1)).sum()); fp=int((al&(yt==0)).sum()); pos=int((yt[m]==1).sum())
    return tp,fp,(tp/(tp+fp) if tp+fp else float('nan')),tp/pos if pos else float('nan')
for kindname,model,zv,zt,cut in models:
    zv=np.asarray(zv)[va]; z=np.asarray(zt)[te]; assert np.isfinite(z).all() and np.isfinite(zv).all()
    cut2=cut if cut is not None else best_f1_cut(y[va],zv)
    r=dict(구분=kindname,모델=model,검증AP=average_precision_score(y[va],zv),AP=average_precision_score(yt,z),AUC=roc_auc_score(yt,z))
    for name,c in [('0.5',0.),('검증임계값',cut2)]:
        tp,fp,p,rc=cm(z,c); r.update({f'TP@{name}':tp,f'FP@{name}':fp,f'P@{name}':p,f'R@{name}':rc})
    r['검증임계값_확률']=1/(1+np.exp(-cut2)); rows.append(r)
    for gname in ['개인→개인','개인→상인','상인→개인','상인→상인']:
        m=pt==gname; tp,fp,p,rc=cm(z,cut2,m)
        groups.append(dict(구분=kindname,모델=model,유형=gname,거래수=int(m.sum()),세탁=int(yt[m].sum()),
            AUC=roc_auc_score(yt[m],z[m]) if 0<yt[m].sum()<m.sum() else float('nan'),AP=average_precision_score(yt[m],z[m]) if yt[m].sum() else float('nan'),
            TP=tp,FP=fp,Recall=rc))
R=pd.DataFrame(rows);Gd=pd.DataFrame(groups)
ms=np.char.startswith(pt.astype(str),'상인'); rule=dict(TP=int((ms&(yt==1)).sum()),FP=int((ms&(yt==0)).sum()))
rule_score=pd.Series(pair[~te&~va]).map(pd.Series(y[~te&~va]).groupby(pair[~te&~va]).mean()); rate=pd.Series(y[~te&~va]).groupby(pair[~te&~va]).mean()
rs=pd.Series(pt).map(rate).to_numpy(); rule.update(AP=average_precision_score(yt,rs),AUC=roc_auc_score(yt,rs))
if dry: print(R.round(4).to_string());print(Gd.round(4).to_string());print(rule);sys.exit()
R.to_csv(ROOT/'Test_전체성능.csv',index=False,encoding='utf-8-sig');Gd.to_csv(ROOT/'Test_유형별.csv',index=False,encoding='utf-8-sig')
pc=lambda v:'–' if v!=v else f'{100*v:.2f}%'
L=['# TransXion 미세조정 후 재평가 (Test 11~12월)','',
 f'Test는 2025-11-01~12-31 거래 {int(te.sum()):,}건(세탁 {int(yt.sum()):,}건, {100*yt.mean():.3f}%)이다. 학습은 1~8월, 검증은 9~10월이며 Test는 마지막에 한 번만 채점했다.','',
 '## 전체 성능','','| 구분 | 모델 | AP | AUC | 0.5 기준 TP / FP | 0.5 기준 P / R | 검증 임계값 TP / FP | 검증 임계값 P / R |','| --- | --- | --- | --- | --- | --- | --- | --- |']
for r in rows:
    L.append(f"| {r['구분']} | {r['모델']} | {pc(r['AP'])} | {r['AUC']:.3f} | {r['TP@0.5']:,} / {r['FP@0.5']:,} | {pc(r['P@0.5'])} / {pc(r['R@0.5'])} | {r['TP@검증임계값']:,} / {r['FP@검증임계값']:,} | {pc(r['P@검증임계값'])} / {pc(r['R@검증임계값'])} |")
L+=['',f"- 참고 규칙 '송신자가 상인이면 경보': TP {rule['TP']:,} / FP {rule['FP']:,}. 송·수신 유형별 학습 구간 세탁 비율을 점수로 쓰면 AP {pc(rule['AP'])}, AUC {rule['AUC']:.3f}.",
 "- 'HI 고정'의 검증 임계값은 HI-Large 검증에서 정한 값이고, 'TransXion 학습'은 9~10월 검증에서 F1이 최대인 값이다.",'',
 '## 송·수신 유형별 (검증 임계값 기준)','','| 구분 | 모델 | 유형 | 거래 수 | 세탁 | AUC | AP | TP / FP | Recall |','| --- | --- | --- | --- | --- | --- | --- | --- | --- |']
for g in groups:
    L.append(f"| {g['구분']} | {g['모델']} | {g['유형']} | {g['거래수']:,} | {g['세탁']:,} | {'–' if g['AUC']!=g['AUC'] else format(g['AUC'],'.3f')} | {pc(g['AP'])} | {g['TP']:,} / {g['FP']:,} | {pc(g['Recall'])} |")
s=hist['settings']
L+=['','## 학습 방법','',
 f"- GNN: Multi-FraudGT 280에폭 가중치에서 시작해 전체 파라미터를 {s['steps']}스텝 미세조정했다(배치 {s['batch']}, AdamW, 학습률 {s['lr']}, 양성 가중치 {s['positive_weight']}). 검증 AP가 가장 높은 {hist['selected_step']}스텝 체크포인트를 골랐다.",
 '- GNN 검증 AP 추이: '+', '.join(f"{h['step']}스텝 {100*h['AP']:.2f}%" for h in hist['history'])+'.',
 '- HGB: 트리 모델은 가중치 미세조정이 안 되므로 같은 36열과 같은 하이퍼파라미터로 1~8월에 다시 학습했다. 이진 라벨만 있어 이진 분류다.',
 '- 결합: HGB·GNN 점수 두 개의 로지스틱 회귀를 9~10월 검증에서 다시 맞췄다.',
 '- 그래프와 계좌 피처는 각 구간 종료일까지만 누적했다(학습 8/31, 검증 10/31, Test 12/31). HGB 피처는 거래일 종료 기준이다.',
 '- 결제방식은 Card→Credit Card, Transfer→Wire, Mobile→Unknown으로 넣어 네 범주를 구분했다. HI 고정 GNN도 같은 입력으로 채점했다.','',
 '## 한계','','- 시드와 설정은 하나씩이며 하이퍼파라미터 탐색은 하지 않았다.','- 거래 발생 시점까지만 쓰는 실시간 평가가 아니라 구간 종료일 그래프를 쓴 사후 평가다.',
 '- 체크포인트 선택과 결합기 학습에 같은 검증 구간을 썼다.','- TransXion 논문의 공식 분할·성능과 맞춘 것이 아니다.','',
 '## 파일','','- `Test_전체성능.csv`, `Test_유형별.csv`, `gnn_finetune_history.json`','- `재현코드/01~04`, 실행 로그는 같은 폴더의 `.log`']
(ROOT/'결과.md').write_text('\n'.join(L)+'\n'); print('REPORT WRITTEN')
