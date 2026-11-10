"""Read-only threshold comparison of two frozen fusion models on identical rows."""
from pathlib import Path
import sys,json,csv
DEST=Path(__file__).resolve().parent
MULTI=DEST.parent/'Multi_FraudGT_HGB_결합실험_20261108'
SALT=DEST.parent/'SALT_GNN_A3_HGB_결합실험_20261107'
sys.path.insert(0,str(MULTI))
from experiment import population,sha,read_json,utc,write,check_frozen
from salt_daily.metrics import confusion
import numpy as np

CONFIG=[('multi',MULTI,'Multi_FraudGT_HGB','Multi-FraudGT + HGB','#bd5222'),
        ('salt',SALT,'A3_HGB','SALT-GNN A3 + HGB','#2468b4')]
METRICS=['precision','recall','F1','AP','FP','FN','TP','TN','predicted_positive','alert_rate',
         'FPR','known_pattern_recall','unmatched_recall','known_pattern_TP','unmatched_TP']

def write_csv(path,rows):
    with path.open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)

def main():
    check_frozen();models={};retained={};scopes={};checks=[];long=[];wide=[];operating=[]
    for key,root,source_name,name,color in CONFIG:
        freeze=read_json(root/'frozen_validation.json');z=freeze['thresholds'][source_name]
        assert sha(root/'fusion.joblib')==freeze['fusion_sha256']
        assert sha(root/'validation.json')==freeze['validation_sha256']
        assert sha(root/'test.json')==read_json(root/'complete.json')['test_sha256']
        models[key]=dict(name=name,color=color,selected_logit=z,selected_probability=float(1/(1+np.exp(-z))))
        for name in ['plan.json','fusion.joblib','frozen_validation.json','validation.json','test.json','결과.md']:
            retained[str(root/name)]=sha(root/name)
    points=sorted(set([i/100 for i in range(101)]+[.0001,.001,.005]+[m['selected_probability'] for m in models.values()]))
    chosen={m['selected_probability']:m['selected_logit'] for m in models.values()}
    thresholds=np.array([-np.inf if p==0 else np.inf if p==1 else chosen[p] if p in chosen else np.log(p)-np.log1p(-p) for p in points])
    assert np.all(np.diff(thresholds)>0)
    for scope in ('test','validation'):
        data=population(scope);source=data.meta['files']
        # Both experiments used the same canonical ID and label arrays.
        assert read_json(MULTI/'gnn_scores'/scope/'complete.json')['population']==source if scope=='validation' else read_json(MULTI/'gnn_scores'/scope/'complete.json')['all_labels_equal']
        assert read_json(SALT.parent/'SALT_GNN_직접공유샘플링_20261104/runs/daily_close_001/models/A3'/f'{scope}_epoch6/request.json')['population']==source
        for name,digest in source.items():
            path=SALT.parent/'SALT_GNN_직접공유샘플링_20261104/cache/population'/name
            assert sha(path)==digest;retained[str(path)]=digest
        scopes[scope]=dict(rows=len(data),positive=data.meta['positive'],normal=len(data)-data.meta['positive'],models={})
        for key,root,source_name,name,color in CONFIG:
            path=root/'fusion_scores'/f'{scope}.npy';digest=sha(path);retained[str(path)]=digest
            if key=='multi':
                expected=next(r['fusion_scores_sha256'] for r in read_json(root/'independent_verification.json')['checks'] if r['scope']==scope)
            else:expected=read_json(root/'threshold_sweep_20261108/thresholds.json')['source_sha256'][str(path)]
            assert digest==expected
            scores=np.load(path,mmap_mode='r');assert scores.shape==(len(data),)
            nbins=len(thresholds)+1;hist=np.zeros((3,nbins),np.int64)
            for start in range(0,len(data),1000000):
                values=scores[start:start+1000000];labels=data.y[start:start+1000000]
                assert np.isfinite(values).all() and np.all((labels>=0)&(labels<=9))
                group=np.where(labels==0,0,np.where(labels==9,2,1))
                index=np.searchsorted(thresholds,values,side='right')
                hist+=np.bincount(group*nbins+index,minlength=3*nbins).reshape(3,nbins)
            normal,known,unmatched=map(int,hist.sum(axis=1));positive=known+unmatched
            assert normal+positive==len(data) and positive==data.meta['positive']
            predictions=hist[:,::-1].cumsum(axis=1)[:,::-1][:,1:]
            assert np.all(np.diff(predictions,axis=1)<=0)
            assert predictions[:,0].tolist()==[normal,known,unmatched] and np.all(predictions[:,-1]==0)
            original=read_json(root/f'{scope}.json')['results'][source_name]
            rows=[]
            for i,p in enumerate(points):
                fp,k,u=map(int,predictions[:,i]);tp=k+u;fn=positive-tp;tn=normal-fp
                row=dict(threshold_probability=p,threshold_logit='-inf' if p==0 else 'inf' if p==1 else float(thresholds[i]),
                    precision=tp/(tp+fp) if tp+fp else 0.,recall=tp/positive,F1=2*tp/(2*tp+fp+fn),AP=original['AP'],
                    FP=fp,FN=fn,TP=tp,TN=tn,predicted_positive=tp+fp,alert_rate=(tp+fp)/len(data),FPR=fp/normal,
                    known_pattern_recall=k/known,unmatched_recall=u/unmatched,known_pattern_TP=k,unmatched_TP=u)
                rows.append(row);long.append(dict(scope=scope,model=name,**row))
            selected=models[key]['selected_probability']
            scan_points=[0.,.05,.1,.2,.3,.5,.9,1.]+list(chosen)
            for p in scan_points:
                i=points.index(p);independent=confusion(data.y,scores,float(thresholds[i]))
                for field in ('TP','FP','FN','TN','known_pattern_TP','unmatched_TP'):
                    assert rows[i][field]==independent[field],(key,scope,p,field)
            for p,field in [(.5,'primary'),(selected,'validation_threshold')]:
                row=rows[points.index(p)]
                for metric in ('TP','FP','FN','TN','precision','recall','F1','known_pattern_recall','unmatched_recall'):
                    assert row[metric]==original[field][metric],(key,scope,p,metric)
                operating.append(dict(scope=scope,model=name,operating_point=field,**row))
            scopes[scope]['models'][key]=dict(AP=original['AP'],known=known,unmatched=unmatched,thresholds=rows)
            checks.append(dict(scope=scope,model=key,rows=len(data),thresholds=len(points),independent_scans=scan_points,
                original_default_and_val_threshold_reproduced=True,counts_monotonic=True,full_coverage=True))
            print(json.dumps(checks[-1]),flush=True)
        for i,p in enumerate(points):
            m=scopes[scope]['models']['multi']['thresholds'][i];s=scopes[scope]['models']['salt']['thresholds'][i]
            reference='default' if p==.5 else 'multi_validation_selected' if p==models['multi']['selected_probability'] else 'salt_validation_selected' if p==models['salt']['selected_probability'] else 'grid'
            wide.append(dict(scope=scope,threshold_probability=p,reference=reference,
                **{'multi_'+k:m[k] for k in METRICS},**{'salt_'+k:s[k] for k in METRICS},
                delta_F1_percentage_points=100*(m['F1']-s['F1']),delta_recall_percentage_points=100*(m['recall']-s['recall']),delta_FP=m['FP']-s['FP']))
    result=dict(created_utc=utc(),models=models,points=points,scopes=scopes,inclusive_threshold=True,
        purpose='Saved-score threshold sensitivity on identical canonical populations; no new fitting/inference or threshold selection',
        units='Rates are fractions; CSV delta_F1/delta_recall are percentage points; FP counts are integer transactions',
        test_not_used_to_select_new_threshold=True,original_selected_thresholds_unchanged=True,
        limitations=['Multi original epoch-selection Validation overlaps the later fusion-fit and comparison Validation periods.',
            'Existing systems have different graph/training/selection protocols. This is exploratory historical comparison, not a controlled architecture experiment.',
            'Equal numerical probability thresholds do not imply equal calibration or alert budgets. Each model own Validation threshold is also shown.'],
        source_sha256=retained)
    write(DEST/'comparison.json',result)
    write_csv(DEST/'임계값별_나란히비교.csv',wide);write_csv(DEST/'임계값별_전체지표.csv',long);write_csv(DEST/'기본값_검증선택값_비교.csv',operating)
    template=(DEST/'viewer_template.html').read_text()
    (DEST/'두모델_임계값비교.html').write_text(template.replace('__DATA_JSON__',json.dumps(result,ensure_ascii=False,allow_nan=False)))
    plot(result)
    check_frozen();assert all(sha(Path(p))==digest for p,digest in retained.items())
    write(DEST/'verification.json',dict(all_passed=True,utc=utc(),checks=checks,identical_population_ids_and_labels=True,
        original_files_unchanged=True,salt_still_paused=True,models_not_refit=True,thresholds_not_reselected=True,
        code_sha256={p.name:sha(p) for p in [Path(__file__),DEST/'viewer_template.html']},
        outputs={p.name:sha(p) for p in DEST.iterdir() if p.suffix in ('.csv','.html','.png','.svg') and p.name!='viewer_template.html'}))
    for row in wide:
        if row['scope']=='test' and row['threshold_probability'] in [.1,.15,.2,.25,.3,.4,.5,.6,.7,.8,.9,*chosen]:
            print(json.dumps(row,ensure_ascii=False),flush=True)

def plot(data):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig,axes=plt.subplots(2,3,figsize=(15,8),layout='constrained')
    metrics=[('precision','Precision (%)'),('recall','Recall (%)'),('F1','F1 (%)'),
             ('FP','False positives (log scale)'),('unmatched_recall','Unmatched fraud recall (%)'),('delta','F1 difference: Multi - SALT (pp)')]
    for ax,(metric,title) in zip(axes.flat,metrics):
        for key,meta in data['models'].items():
            rows=data['scopes']['test']['models'][key]['thresholds'];keep=[r for r in rows if .05<=r['threshold_probability']<=.95]
            if metric=='delta':
                if key=='salt':continue
                sr=data['scopes']['test']['models']['salt']['thresholds']
                values=[100*(r['F1']-sr[data['points'].index(r['threshold_probability'])]['F1']) for r in keep]
                ax.axhline(0,color='#697380',lw=.8)
            else:values=[r[metric]*(1 if metric=='FP' else 100) for r in keep]
            ax.plot([r['threshold_probability'] for r in keep],values,color=meta['color'],label=meta['name'],lw=2)
        if metric=='FP':ax.set_yscale('log')
        for meta in data['models'].values():ax.axvline(meta['selected_probability'],color=meta['color'],alpha=.5,ls=':',lw=1)
        ax.set(title=title,xlabel='Probability threshold',xlim=(.05,.95));ax.grid(alpha=.2)
    axes[0,0].legend(fontsize=9)
    fig.suptitle('HI-Large full Test: Multi-FraudGT + HGB vs SALT-GNN A3 + HGB\n33,429,507 transactions | Dotted lines: each model frozen Validation threshold',fontsize=14)
    fig.savefig(DEST/'Test_임계값비교.png',dpi=170);fig.savefig(DEST/'Test_임계값비교.svg');plt.close(fig)

if __name__=='__main__':main()
