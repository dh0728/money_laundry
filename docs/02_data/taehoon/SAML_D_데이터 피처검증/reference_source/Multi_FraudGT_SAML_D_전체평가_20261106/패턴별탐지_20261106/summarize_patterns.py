"""Summarize every saved SAML score by ground-truth pattern; no inference."""
from pathlib import Path
import os
for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):
    os.environ[key]='1'
import json, csv, hashlib, re
from datetime import datetime, timezone
import numpy as np
import pyarrow.parquet as pq
import pyarrow.compute as pc
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parent
BASE=ROOT.parent
TRUTH=Path('/workspace/kimi/Claude_GNN/final_model/experiments/v10_saml_generalization_20261025/cache/truth.parquet')
REPORT=BASE/'성능하락_원인보고서_20261106.md'
MARKER='## 11. SAML-D 전체 패턴별 탐지 결과'

def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
    return h.hexdigest()

def write(name,obj):
    (ROOT/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')

def csvwrite(name,rows):
    with (ROOT/name).open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)

def table(headers,rows):
    return '\n'.join(['| '+' | '.join(headers)+' |','| '+' | '.join(['---']*len(headers))+' |']+
                     ['| '+' | '.join(map(str,r))+' |' for r in rows])

def pct(n):return f'{n:.2%}'

def chart(rows,kind,file):
    rows=sorted(rows,key=lambda r:r['old_rate'])
    y=np.arange(len(rows));h=max(5, len(rows)*.44+1.9)
    fig,ax=plt.subplots(figsize=(11,h),layout='constrained')
    ax.barh(y+.18,[r['old_rate']*100 for r in rows],height=.34,color='#285d9c',label='Original zero fill')
    ax.barh(y-.18,[r['new_rate']*100 for r in rows],height=.34,color='#e27e31',label='HI Train median fill')
    for j,r in enumerate(rows):
        for offset,key,color in [(.18,'old_rate','#234e81'),(-.18,'new_rate','#9b4f15')]:
            label=f'{r[key]:.2%}' if kind=='fraud' else f'{r[key]:.4%}'
            ax.text(r[key]*100+.7,j+offset,label,va='center',fontsize=8,color=color)
    ax.set_yticks(y,[f"{r['pattern']}  (n={r['rows']:,})" for r in rows],fontsize=9)
    ax.set_xlim(0,112);ax.set_xticks(np.arange(0,101,20));ax.grid(axis='x',alpha=.18);ax.set_axisbelow(True)
    ax.spines[['top','right']].set_visible(False)
    ax.set_xlabel('Recall (%)' if kind=='fraud' else 'False positive rate (%)')
    ax.set_title('SAML-D fraud patterns: detection recall' if kind=='fraud' else 'SAML-D normal patterns: false alerts',loc='left',fontweight='bold')
    ax.legend(loc='lower right',fontsize=9)
    fig.savefig(ROOT/(file+'.png'),dpi=160)
    fig.savefig(ROOT/(file+'.svg'))
    plt.close(fig)

def main():
    old_result=json.loads((BASE/'result.json').read_text())
    comparison=json.loads((BASE/'대체값_비교_20261106/result.json').read_text())
    paths={'old':BASE/'cache/logits.npy','new':BASE/'대체값_비교_20261106/saml_logits.npy'}
    logits={k:np.load(p,mmap_mode='r') for k,p in paths.items()}
    assert sha(paths['old'])==old_result['logits_sha256']
    assert sha(paths['new'])==comparison['logits_sha256']
    truth=pq.read_table(TRUTH,columns=['eid','y','pattern'])
    assert all(truth[c].null_count==0 for c in truth.column_names)
    ids=truth['eid'].to_numpy();y=truth['y'].to_numpy()
    assert len(y)==9504852 and np.array_equal(ids,np.arange(len(y)))
    np.testing.assert_array_equal(y,np.load(BASE/'cache/labels.npy',mmap_mode='r'))
    dictionary=pc.dictionary_encode(truth['pattern'].combine_chunks())
    names=dictionary.dictionary.to_pylist();codes=dictionary.indices.to_numpy()
    rows=[];scores=[]
    for i,name in enumerate(names):
        mask=codes==i;labels=y[mask].astype(bool);count=len(labels);pos=int(labels.sum())
        assert pos in (0,count),f'Mixed-label pattern requires explicit metrics: {name}'
        kind='fraud' if pos else 'normal'
        r=dict(pattern=name,kind=kind,rows=count,positive=pos,normal=count-pos)
        predictions={}
        for method in ('old','new'):
            z=np.asarray(logits[method][mask],np.float64)
            assert np.isfinite(z).all()
            pred=z>0;predictions[method]=pred
            tp=int((labels&pred).sum());fp=int((~labels&pred).sum())
            fn=pos-tp;tn=count-pos-fp
            r.update({method+'_TP':tp,method+'_FP':fp,method+'_FN':fn,method+'_TN':tn,
                      method+'_rate':(tp/pos if pos else fp/count)})
            prob=1/(1+np.exp(-z));q=np.quantile(prob,[.05,.5,.95])
            scores.append(dict(pattern=name,kind=kind,method=method,rows=count,
                mean_score=float(prob.mean()),p05_score=float(q[0]),median_score=float(q[1]),
                p95_score=float(q[2]),min_score=float(prob.min()),max_score=float(prob.max())))
        r['rate_delta_pp']=100*(r['new_rate']-r['old_rate'])
        r['negative_to_positive']=int((~predictions['old']&predictions['new']).sum())
        r['positive_to_negative']=int((predictions['old']&~predictions['new']).sum())
        rows.append(r)
    rows=sorted(rows,key=lambda r:(r['kind'],r['pattern']))
    assert sum(r['rows'] for r in rows)==9504852
    for method,ref in [('old',old_result),('new',comparison['imputed'])]:
        for k in ('TP','FP','FN','TN'):
            assert sum(r[method+'_'+k] for r in rows)==ref[k]
    with (BASE/'대체값_비교_20261106/pattern_comparison.csv').open() as f:
        archived={r['pattern']:r for r in csv.DictReader(f)}
    for r in rows:
        prev=archived[r['pattern']]
        assert r['rows']==int(prev['rows']) and r['positive']==int(prev['positive'])
        for method,key in [('old','old_predicted_positive'),('new','new_predicted_positive')]:
            assert r[method+'_TP']+r[method+'_FP']==int(prev[key])
    fraud=sorted([r for r in rows if r['kind']=='fraud'],key=lambda r:(-r['old_rate'],r['pattern']))
    normal=sorted([r for r in rows if r['kind']=='normal'],key=lambda r:(-r['old_rate'],r['pattern']))
    assert len(fraud)==17 and len(normal)==11
    csvwrite('pattern_detection.csv',rows);csvwrite('pattern_scores.csv',scores)
    chart(fraud,'fraud','fraud_recall');chart(normal,'normal','normal_false_positive_rate')
    score={(r['pattern'],r['method']):r for r in scores}
    body=['''**SAML-D 전체 9,504,852건은 사기 패턴 17종(9,873건), 정상 패턴 11종(9,494,979건)으로 구분된다.** Multi-FraudGT epoch 280의 저장된 전체 예측값을 재집계했다. 재학습·재추론 없이 기존 0 대체와 HI Train 중앙값 대체 결과를 비교하며, 판정 기준은 두 경우 모두 `sigmoid(logit) > 0.5`다.

모델은 정상/사기 이진 분류기다. 아래 패턴은 사후 오류 분석에 사용한 정답 메타데이터이며, 모델이 패턴 이름을 맞혔다는 의미가 아니다. 사기 패턴별 지표는 **탐지율(Recall = TP / 실제 사기 수)**, 정상 패턴별 지표는 **오탐률(FPR = FP / 실제 정상 수)**이다. 각 패턴 내부는 정답이 한 종류이므로 단독 Precision·AP를 성능 비교 지표로 표시하지 않았다. 원본 패턴명과 철자를 유지했다.''',
    '### 사기 패턴 17종: 탐지·미탐과 탐지율',
    '기존 0 대체 탐지율이 높은 순서다. 중앙값 대체는 전체 성능이 악화해 채택하지 않은 실험 조건이다.']
    frows=[]
    for r in fraud:
        frows.append([r['pattern'],f"{r['rows']:,}",f"{r['old_TP']:,}",f"{r['old_FN']:,}",pct(r['old_rate']),
                      f"{r['new_TP']:,}",f"{r['new_FN']:,}",pct(r['new_rate']),f"{r['rate_delta_pp']:+.2f}"])
    frows.append(['전체 사기','9,873','4,511','5,362','45.69%','2,209','7,664','22.37%','-23.32'])
    body.append(table(['패턴','사기 건수','기존 탐지','기존 미탐','기존 탐지율','중앙값 탐지','중앙값 미탐','중앙값 탐지율','변화(pp)'],frows))
    body += ['''`Cash_Withdrawal` 1,334건과 `Smurfing` 932건은 두 조건 모두 탐지하지 못했다. 이 두 패턴의 2,266건은 기존 전체 미탐 5,362건의 **42.26%**다. 중앙값 대체에서 탐지율이 오른 사기 패턴은 `Behavioural_Change_1`과 `Behavioural_Change_2` 두 종류이며, 나머지 15종은 하락하거나 0%에 머물렀다. 이는 패턴명 기준 결과로, 결제방식 기준 현금 입출금 집계와 동일한 구분은 아니다.''',
             '![사기 패턴별 탐지율](패턴별탐지_20261106/fraud_recall.png)',
             '### 정상 패턴 11종: 오탐 건수와 오탐률',
             '정상 패턴에서는 높은 사기 예측 비율이 오탐을 의미하므로 낮을수록 좋다. 기존 오탐률이 높은 순서다.']
    nrows=[]
    for r in normal:
        nrows.append([r['pattern'],f"{r['rows']:,}",f"{r['old_FP']:,}",f"{r['old_rate']:.4%}",f"{r['new_FP']:,}",f"{r['new_rate']:.4%}",f"{r['rate_delta_pp']:+.2f}"])
    nrows.append(['전체 정상','9,494,979','1,018,255','10.7241%','712,843','7.5076%','-3.22'])
    body.append(table(['패턴','정상 건수','기존 오탐','기존 오탐률','중앙값 오탐','중앙값 오탐률','변화(pp)'],nrows))
    body += ['''`Normal_Group`은 기존에도 76.44%가 오탐이었고 중앙값 대체 후 99.9975%로 악화했다. 반대로 `Normal_Fan_In`과 `Normal_Small_Fan_Out`의 오탐은 크게 줄었다. 따라서 전체 오탐 감소가 모든 정상 패턴의 개선을 뜻하지 않는다. 표의 소수점 반올림 때문에 작은 비율은 0.00% 또는 100.00%로 보일 수 있으므로 정확한 건수와 CSV를 함께 확인한다.''',
             '![정상 패턴별 오탐률](패턴별탐지_20261106/normal_false_positive_rate.png)',
             '### 패턴별 모델 점수: 평균·중앙값',
             '점수는 `sigmoid(logit)`의 0~1 값이다. 0.5를 초과하면 사기로 판정한다. 이는 모델 출력이며 해당 수치가 실제 사기 발생 확률과 일치하도록 보정됐다는 의미는 아니다. 평균만으로 탐지율을 판단하지 않도록 위 탐지 건수와 함께 표시했다.']
    srows=[]
    for r in fraud+normal:
        a,b=score[r['pattern'],'old'],score[r['pattern'],'new']
        srows.append(['사기' if r['kind']=='fraud' else '정상',r['pattern'],f"{a['mean_score']:.4f}",f"{a['median_score']:.4f}",f"{b['mean_score']:.4f}",f"{b['median_score']:.4f}"])
    body.append(table(['구분','패턴','기존 평균 점수','기존 중앙값','대체 후 평균 점수','대체 후 중앙값'],srows))
    body += ['### 근거 및 검증',
             '''[패턴별 탐지·미탐·오탐 CSV](패턴별탐지_20261106/pattern_detection.csv), [점수 분포 CSV](패턴별탐지_20261106/pattern_scores.csv), [집계 코드](패턴별탐지_20261106/summarize_patterns.py), [검산 기록](패턴별탐지_20261106/verification.json).

점수 CSV에는 평균·중앙값 외에 5/95백분위와 최솟값·최댓값도 있다. 두 점수 파일의 SHA-256을 기존 전체 평가 결과와 대조하고, 정답 거래 ID·레이블 정렬, 패턴별 집계의 전체 혼동행렬 합계, 기존 패턴별 결과와의 일치를 검증했다. 패턴별로 임계값을 바꾸거나 모델을 다시 선택하지 않았으며 SALT-GNN 학습도 재개하지 않았다.''']
    content='\n\n'.join(body)+'\n'
    # Standalone report uses links relative to its own directory.
    standalone='# SAML-D 전체 패턴별 탐지 결과\n\n'+content.replace('패턴별탐지_20261106/','')
    (ROOT/'패턴별탐지결과.md').write_text(standalone)
    current=REPORT.read_text()
    if '\n'+MARKER in current:
        before,after=current.split('\n'+MARKER,1)
        later=re.search(r'\n## \d+\.',after)
        tail=after[later.start():] if later else ''
    else:before,tail=current.rstrip(),''
    REPORT.write_text(before.rstrip()+'\n\n'+MARKER+'\n\n'+content+tail)
    verification=dict(completed_utc=datetime.now(timezone.utc).isoformat(),all_passed=True,
        rows=len(y),fraud_patterns=len(fraud),normal_patterns=len(normal),positives=int(y.sum()),
        threshold='logit > 0; sigmoid(logit) > 0.5',score_sha256_matches=True,
        labels_and_eid_order_verified=True,all_patterns_single_class=True,
        pattern_totals_match_global_confusion=True,archived_pattern_counts_match=True,
        source_truth_sha256=sha(TRUTH),no_training_or_inference=True)
    write('verification.json',verification)
    print(json.dumps(verification,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
