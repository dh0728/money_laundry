import os
os.environ.setdefault('OMP_NUM_THREADS','2');os.environ.setdefault('OPENBLAS_NUM_THREADS','2')
from pathlib import Path
import json,pickle,hashlib,sys
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
from sklearn.decomposition import PCA
from sklearn.neighbors import NearestNeighbors
OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[1];V=OUT/'evidence_visuals';V.mkdir(exist_ok=True)
plt.rcParams.update({'font.family':FontProperties(fname=str(OUT/'report_font.ttf')).get_name(),'axes.unicode_minus':False})
from matplotlib import font_manager
font_manager.fontManager.addfont(str(OUT/'report_font.ttf'))
plt.rcParams['font.family']=FontProperties(fname=str(OUT/'report_font.ttf')).get_name()
C=ROOT/'experiments/cluster_downsample_40_v1';L=ROOT/'experiments/gnn36_latent_oversampling_v1';date='2022-08-08';seed=20260927
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
ref=pickle.loads((C/'cluster_reference.pkl').read_bytes())
t=pd.read_parquet(C/'samples'/date/'selected.parquet');counts=pd.read_csv(C/'samples'/date/'cluster_counts.csv')
x=np.load(Path('/tmp/cluster_downsample_40_v1')/date/'target_x.npy');ids=np.load(Path('/tmp/cluster_downsample_40_v1')/date/'target_ids.npy')
np.testing.assert_array_equal(ids,t.edge_id)
neg=t.y.to_numpy()==0;z=ref['scaler'].transform(x[neg]);pred=ref['kmeans'].predict(z)
np.testing.assert_array_equal(pred,t.loc[neg,'cluster'])
# Recompute integer/capped allocation, IPW and class preservation for all 68 dates.
sys.path.insert(0,str(ROOT/'CODE'));from cluster_sampling_audit import allocate,divergence
checks=[]
for directory in sorted((C/'samples').iterdir()):
 if not (directory/'selected.parquet').exists():continue
 tab=pd.read_parquet(directory/'selected.parquet');ct=pd.read_csv(directory/'cluster_counts.csv');meta=json.loads((directory/'complete.json').read_text())
 np.testing.assert_array_equal(allocate(ct.population.to_numpy()),ct.sampled.to_numpy())
 actual=tab[tab.y==0].groupby('cluster').size().reindex(ct.cluster,fill_value=0).to_numpy()
 np.testing.assert_array_equal(actual,ct.sampled)
 nn=tab.y.to_numpy()==0;w=ct.set_index('cluster').population/ct.set_index('cluster').sampled.replace(0,np.nan)
 np.testing.assert_allclose(tab.loc[nn,'sample_weight'],tab.loc[nn,'cluster'].map(w),rtol=1e-12)
 assert tab.edge_id.is_unique and int(tab.y.sum())==meta['positives'] and np.all(tab.loc[~nn,'sample_weight']==1)
 assert np.isclose(tab.sample_weight.sum(),meta['population'])
 rand=pd.read_parquet(directory/'random_reference.parquet');assert len(rand)==len(tab)
 # All saved positive IDs must also appear in the random sample; class labels derive from shared IDs.
 assert set(tab.loc[~nn,'edge_id'])<=set(rand.edge_id)
 assert meta['graph_tensor_equivalence'] is True
 checks.append({'date':directory.name,'rows':len(tab),'population':meta['population'],'positives':meta['positives'],'allocation_ipw_ids_passed':True})
pd.DataFrame(checks).to_csv(V/'cluster_68day_checks.csv',index=False)
# Use stored fitted clusters, not freshly reclustered 2D points.
pca=PCA(n_components=2,svd_solver='full').fit(z);xy=pca.transform(z)
rng=np.random.default_rng(seed);selected=np.sort(rng.choice(len(z),min(3000,len(z)),replace=False))
sv=t.loc[neg].iloc[selected].copy();sv['PC1']=xy[selected,0];sv['PC2']=xy[selected,1];sv.to_csv(V/'cluster_plot_sample.csv',index=False)
fig,axes=plt.subplots(1,2,figsize=(12,4.6));colors=plt.get_cmap('turbo',32)
a=axes[0];sc=a.scatter(xy[selected,0],xy[selected,1],c=pred[selected],cmap=colors,vmin=-.5,vmax=31.5,s=8,alpha=.6,rasterized=True);fig.colorbar(sc,ax=a,label='저장된 cluster ID',ticks=[0,8,16,24,31]);a.set(title='실제 추출 정상 거래 3,000건',xlabel='PC1',ylabel='PC2')
a=axes[1];j=np.arange(32);a.plot(j,counts.population/counts.population.sum()*100,'o-',label='원본 정상 비중');a.plot(j,counts.sampled/counts.sampled.sum()*100,'s-',label='추출 정상 비중');weighted=counts.population.where(counts.sampled>0,0);a.plot(j,weighted/weighted.sum()*100,'x--',label='IPW 복원 비중');a.set(xlabel='cluster ID',ylabel='비중 (%)',title='32개 군집의 원본·표본·IPW 비중');a.legend(fontsize=8)
fig.suptitle(f'{date} | PCA는 추출 정상 19,272건의 표준화 18피처에 적합 | 설명분산 {pca.explained_variance_ratio_.sum():.1%}',fontsize=11);fig.tight_layout();fig.savefig(V/'cluster_sample.png',dpi=170);plt.close(fig)
fig,axes=plt.subplots(1,2,figsize=(12,4.3));axes[0].bar(j,counts.population,color='#487eb0',label='원본 정상');axes[0].bar(j,counts.sampled,color='#f6b93b',label='추출 정상');axes[0].set_yscale('symlog',linthresh=1);axes[0].set(xlabel='cluster ID',ylabel='거래 수 (symlog)',title='군집별 원본 크기와 실제 추출 수');axes[0].legend()
rate=counts.sampled/counts.population.replace(0,np.nan)*100;axes[1].bar(j,rate,color='#6a89cc');axes[1].axhline(1,ls='--',color='gray');axes[1].set(xlabel='cluster ID',ylabel='추출률 (%)',title='작은 군집은 더 높은 비율로 보존');fig.tight_layout();fig.savefig(V/'cluster_allocation.png',dpi=170);plt.close(fig)
# Verify the saved daily and pooled KL against stored histogram evidence.
h=pickle.loads((C/'samples'/date/'histograms.pkl').read_bytes());audit=pd.read_csv(C/'samples'/date/'kld.csv')
kl_errors=[]
for label in h['original']:
 for method,hists in h['samples'][label].items():
  expected=np.array([divergence(p,q)['kl_original_to_sample'] for p,q in zip(h['original'][label],hists)])
  actual=audit[(audit.label==label)&(audit.method==method)].kl_original_to_sample.to_numpy()
  np.testing.assert_allclose(actual,expected,rtol=1e-7,atol=1e-12);kl_errors.append(float(np.max(abs(actual-expected))))
ov=pd.read_csv(C/'kld_overview.csv');sub=ov[ov.label=='negative'];methods=['cluster_raw','cluster_ipw','random_raw','random_ipw'];fig,ax=plt.subplots(figsize=(10,4.2));pos=np.arange(4)
for off,split,color in [(-.18,'train','#3867d6'),(.18,'val','#fa8231')]:
 vals=sub[sub.split==split].set_index('method').loc[methods,'mean_KLD'];ax.bar(pos+off,vals,width=.35,label=split,color=color)
ax.set_xticks(pos,methods);ax.set_yscale('log');ax.set(ylabel='62项边际直方图的平均 KL' if False else '62개 주변분포 평균 KL (로그 축)',title='정상 거래 분포 감사: IPW 보정 전·후');ax.legend();fig.tight_layout();fig.savefig(V/'cluster_kl.png',dpi=170);plt.close(fig)
# Recover the actual TGNN seed42 positive synthesis bank in saved source order.
r=L/'tgnn_seed42';sources=pd.read_parquet(r/'synthesis_training_sources.parquet');manifest=json.loads((r/'synthesis_manifest.json').read_text());assert sha(r/'synthesis_training_sources.parquet')==manifest['source_sha256']
assert sources.y.eq(1).all() and sources.day.astype(str).between('2022-08-08','2022-09-27').all()
bank=np.empty((len(sources),128),np.float32);mean=np.load(r/'scaler_mean.npy');scale=np.load(r/'scaler_scale.npy')
allpos=[];offset=0;maxerror=0.;embedding_hashes=0
for directory in sorted((r/'embeddings').iterdir()):
 date2=directory.name;marker=json.loads((directory/'complete.json').read_text());assert sha(directory/'x.npy')==marker['x_sha256'];embedding_hashes+=1
 assert sha(C/'samples'/date2/'selected.parquet')==marker['identity']['sample_sha']
 if marker['split']=='val':maxerror=max(maxerror,marker['validation_score_max_error']);continue
 tab=pd.read_parquet(C/'samples'/date2/'selected.parquet');raw=np.load(directory/'x.npy',mmap_mode='r');assert len(raw)==len(tab)
 mask=sources.day.astype(str).eq(date2);idx=tab.set_index('edge_id').index.get_indexer(sources.loc[mask,'edge_id']);assert np.all(idx>=0)
 # Match StandardScaler.transform(float32)'s in-place arithmetic exactly.
 vals=np.array(raw[idx],copy=True);vals-=mean.astype(vals.dtype);vals/=scale.astype(vals.dtype);bank[mask]=vals
 allpos.extend((offset+np.flatnonzero(tab.y.to_numpy()==1)).tolist());offset+=len(tab)
np.save(V/'real_positive_bank.npy',bank)
pools={'repeat':np.load(r/'repeat.npy'),'smote':np.load(r/'smote.npy'),'wgan_gp':np.load(r/'gan/synthetic.npy')}
for key,file in [('repeat','repeat.npy'),('smote','smote.npy'),('gan','gan/synthetic.npy')]:assert sha(r/file)==manifest[key+'_sha256']
# Recreate exact repeat and SMOTE pools from their stored bank and published seed.
sys.path.insert(0,str(L));import components
rr=np.random.default_rng(42+5000);rr.choice(np.array(allpos),10000,replace=False);rep=bank[rr.integers(len(bank),size=10000)]
np.testing.assert_allclose(rep,pools['repeat'],rtol=0,atol=1e-6)
near=components.make_neighbors(bank,5);sm=components.smote(bank,near,10000,np.random.default_rng(42+6000));np.testing.assert_allclose(sm,pools['smote'],rtol=0,atol=2e-6)
# All panels use one PCA fitted ONLY to the real positive bank.
pc=PCA(n_components=2,svd_solver='full').fit(bank);realxy=pc.transform(bank);viz=np.sort(np.random.default_rng(seed).choice(10000,2000,replace=False))
coords=[realxy[viz]]+[pc.transform(v[viz]) for v in pools.values()];combined=np.concatenate(coords);lims=[(combined[:,k].min()-1,combined[:,k].max()+1) for k in (0,1)]
fig,axes=plt.subplots(2,2,figsize=(11,8));labels=['실제 양성 참조 (none의 비교 기준)','반복 추출: 같은 점의 재사용','SMOTE: 양성 이웃 사이 보간','WGAN-GP: 생성기 출력']
for i,(ax,label) in enumerate(zip(axes.flat,labels)):
 ax.scatter(realxy[viz,0],realxy[viz,1],s=5,alpha=.25,color='#3867d6',label='실제 참조 2,000')
 if i:ax.scatter(coords[i][:,0],coords[i][:,1],s=5,alpha=.3,color='#eb3b5a',label='저장 증강 2,000')
 ax.set(title=label,xlabel='PC1',ylabel='PC2',xlim=lims[0],ylim=lims[1]);ax.legend(fontsize=8)
fig.suptitle(f'TGNN seed 42 | 실제 양성 10,000건에 적합한 공통 PCA | 설명분산 {pc.explained_variance_ratio_.sum():.1%}',fontsize=12);fig.tight_layout();fig.savefig(V/'augmentation_pca.png',dpi=160);plt.close(fig)
for method,xy2 in [('real',realxy)]+[(k,pc.transform(v)) for k,v in pools.items()]:
 pd.DataFrame({'method':method,'stored_row':viz,'PC1':xy2[viz,0],'PC2':xy2[viz,1]}).to_csv(V/(method+'_plot_sample.csv'),index=False)
nearest=NearestNeighbors(n_neighbors=1,n_jobs=2).fit(bank);diagnostics=[];distances={}
for name,pool in pools.items():
 ix_near=nearest.kneighbors(pool[:2048],return_distance=False)[:,0];ds=np.linalg.norm(pool[:2048].astype(np.float64)-bank[ix_near].astype(np.float64),axis=1);distances[name]=ds
 active=bank.std(0)>1e-6;ratio=np.median(pool.std(0)[active]/bank.std(0)[active]);diagnostics.append({'method':name,'median_nearest_distance_first2048':float(np.median(ds)),'duplicate_fraction_first2048':float(np.mean(ds<1e-6)),'median_std_ratio':float(ratio)})
pd.DataFrame(diagnostics).to_csv(V/'augmentation_diagnostics.csv',index=False)
fig,axes=plt.subplots(1,2,figsize=(11,4.3));axes[0].boxplot(list(distances.values()),tick_labels=list(distances),showfliers=False);axes[0].set(ylabel='128차원 표준화 공간 거리',title='실제 참조까지 최근접 거리 (앞 2,048개)');axes[1].bar([x['method'] for x in diagnostics],[x['median_std_ratio'] for x in diagnostics],color=['#3867d6','#20bf6b','#eb3b5a']);axes[1].axhline(1,ls='--',color='gray');axes[1].set(ylabel='차원별 표준편차 비율의 중앙값',title='실제 참조 대비 증강 표본의 분산');fig.tight_layout();fig.savefig(V/'augmentation_diagnostics.png',dpi=170);plt.close(fig)
allgan=[]
for p in sorted(L.glob('*_seed*/gan/diagnostics.json')):
 d=json.loads(p.read_text());allgan.append(dict(case=p.parent.parent.name,**d))
pd.DataFrame(allgan).to_csv(V/'gan_18case_diagnostics.csv',index=False)
# Draw actual target repetitions from the unchanged existing sampling code.
sys.path.insert(0,str(ROOT/'experiments/gnn36_target_repeat_v1'));from sampling import epoch_sample
y=np.load('/tmp/gnn36_distribution_v1/original/2022-08-08/labels.npy',mmap_mode='r');order,weight=epoch_sample(y,42+pd.Timestamp('2022-08-08').dayofyear,'repeat');freq=np.bincount(order,minlength=len(y));
summary=[]
for c,label in [(0,'정상'),(1,'양성')]:
 mask=y==c;summary.append({'class':label,'population':int(mask.sum()),'draws':int((y[order]==c).sum()),'unique_seen':int((freq[mask]>0).sum()),'weight':float(weight[mask][0]),'weighted_mass':float(weight[order][y[order]==c].sum())})
pd.DataFrame(summary).to_csv(V/'target_repeat_day_counts.csv',index=False)
fig,axes=plt.subplots(1,2,figsize=(11,4));axes[0].bar(['정상','양성'],[x['population'] for x in summary],label='원본/대조군',alpha=.7);axes[0].bar(['정상','양성'],[x['draws'] for x in summary],label='반복 추출 타깃',alpha=.6);axes[0].set(title='총 노출 수를 유지하며 클래스 비율 변경',ylabel='타깃 노출 수');axes[0].legend();axes[1].hist(freq[y==1],bins=30,color='#fa8231');axes[1].set(title='양성 거래별 한 에폭 재방문 횟수',xlabel='반복 횟수',ylabel='양성 거래 수');fig.tight_layout();fig.savefig(V/'target_repeat_example.png',dpi=170);plt.close(fig)
result=dict(example_date='2022-08-08',plot_seed=seed,cluster_days_checked=len(checks),cluster_feature_dim=18,cluster_training_reference_rows=ref['fit_negative_rows'],cluster_sample_pca_explained=float(pca.explained_variance_ratio_.sum()),cluster_prediction_agreement=1.,daily_kl_max_error=max(kl_errors),embedding_files_hash_verified=embedding_hashes,stored_validation_reproduction_max_error=maxerror,repeat_pool_reproduced=True,smote_pool_reproduced=True,latent_pca_explained=float(pc.explained_variance_ratio_.sum()),gan_cases=len(allgan),gan_collapsed=sum(x['collapsed'] for x in allgan),target_repeat=summary)
(V/'audit.json').write_text(json.dumps(result,indent=2,ensure_ascii=False));print(json.dumps(result,indent=2,ensure_ascii=False))
