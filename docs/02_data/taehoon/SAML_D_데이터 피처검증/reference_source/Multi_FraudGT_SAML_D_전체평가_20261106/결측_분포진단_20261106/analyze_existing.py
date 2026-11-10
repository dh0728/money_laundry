"""Descriptive post-test diagnosis; never fits a model or chooses a threshold."""
from pathlib import Path
import os,sys,json,time,gc,hashlib
from datetime import datetime,timezone
R=Path(__file__).resolve().parent
FULL=R.parent
HI=Path('/workspace/handoff/V10_FraudGT_조건수정_20261027')
S=Path('/workspace/kimi/Claude_GNN/final_model/experiments/v10_saml_generalization_20261025')
SG=S.parent/'v10_gnn_verify_20261025/cache/saml'
for key in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS']:os.environ[key]='1'
sys.path.insert(0,str(HI))
import fraudgt_lab
from fraudgt_lab.data import FeatureAdapter
from fraudgt_lab.metrics import binary_average_precision
from fraudgt_lab.population import Labels
from common import G,NODE_NAMES,EDGE_NAMES
import numpy as np,pandas as pd,pyarrow.parquet as pq
from scipy.stats import ks_2samp

def write(name,value):
    (R/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def log(stage,**kw):print(json.dumps(dict(utc=datetime.now(timezone.utc).isoformat(),stage=stage,**kw),ensure_ascii=False),flush=True)
def load(path):return np.load(path,mmap_mode='r')
def metrics(y,z):
    y=np.asarray(y,bool);pred=z>0
    tp=int((y&pred).sum());fp=int((~y&pred).sum());fn=int((y&~pred).sum());tn=int((~y&~pred).sum())
    ratio=lambda a,b:a/b if b else None
    return dict(rows=len(y),positive=int(y.sum()),normal=int((~y).sum()),TP=tp,FP=fp,FN=fn,TN=tn,
        precision=ratio(tp,tp+fp),recall=ratio(tp,tp+fn),FPR=ratio(fp,fp+tn),
        F1=ratio(2*tp,2*tp+fp+fn),AP=binary_average_precision(y,z) if y.any() else None,
        logit_median=float(np.median(z)),logit_p95=float(np.quantile(z,.95)))

def group_metrics():
    y=load(FULL/'cache/labels.npy');z=load(FULL/'cache/logits.npy');x=load(S/'cache/X.npy')
    observation=pq.read_table(S/'cache/observations.parquet',columns=['payment_type','pay_ccy']).to_pandas()
    known=np.asarray(x[:,17]>=0)
    ccy=observation['pay_ccy'];supported=ccy.isin(['Euro','Mexican Peso','Swiss franc','UK pounds','US dollar','Yen','Indian rupee']).to_numpy()
    rows=[]
    for name,values in [('payment_type',observation['payment_type']),('payment_known',np.where(known,'Known','Unknown')),
                        ('currency_supported',np.where(supported,'Supported','Unsupported')),
                        ('payment_currency',ccy),('month',pd.to_datetime(load(S/'cache/day.npy'),unit='D').strftime('%Y-%m'))]:
        cat=pd.Categorical(values)
        for i,label in enumerate(cat.categories):
            mask=cat.codes==i
            rows.append(dict(grouping=name,group=str(label),**metrics(y[mask],z[mask])))
        log('group_finished',group=name)
    frame=pd.DataFrame(rows);frame.to_csv(R/'saml_group_metrics.csv',index=False)
    # Interactions distinguish unknown format from its mixture of typologies.
    pattern=pq.read_table(S/'cache/truth.parquet',columns=['pattern']).to_pandas()['pattern']
    cat=pd.Categorical(pattern);cross=[]
    for i,label in enumerate(cat.categories):
        for is_known in [False,True]:
            mask=(cat.codes==i)&(known==is_known)
            if mask.any():cross.append(dict(pattern=str(label),payment_known=is_known,**metrics(y[mask],z[mask])))
    pd.DataFrame(cross).to_csv(R/'saml_pattern_by_payment_known.csv',index=False)
    pattern_table=pd.read_csv(FULL/'pattern_metrics.csv')
    normal=pattern_table[pattern_table.positive==0].copy()
    normal['share_of_all_fp']=normal.predicted_positive/1018255
    normal.sort_values('predicted_positive',ascending=False).to_csv(R/'normal_pattern_fp_contribution.csv',index=False)
    # Country, KYC and owner inputs are unavailable for ALL SAML examples,
    # hence no within-SAML observed-vs-missing control group exists.
    count=dict(rows=len(y),node_missing_columns=list(NODE_NAMES[10:19]),country_columns=['same_known_country','both_countries_known'],
               unknown_payment_rows=int((~known).sum()),unsupported_currency_rows=int((~supported).sum()),
               all_country_zero=True,all_node_kyc_zero=True,nan_inf_count=0)
    for start in range(0,len(y),250000):
        b=np.asarray(x[start:start+250000]);count['all_country_zero'] &= bool(not b[:,[12,13]].any())
        count['all_node_kyc_zero'] &= bool(not b[:,32:41].any() and not b[:,51:60].any())
        count['nan_inf_count'] += int((~np.isfinite(b)).sum())
    assert count['all_country_zero'] and count['all_node_kyc_zero'] and count['nan_inf_count']==0
    write('missingness_inventory.json',count)
    return frame

def distributions():
    adapter=FeatureAdapter(use_ports=True);labels=Labels();rng=np.random.default_rng(20261106)
    edge_names=[EDGE_NAMES[i] for i in (0,1,2,3,4,5,6,7,9,10,12,13,14,15)]
    features={};samples={};categories=[];N=100000
    for domain in ['HI_train','HI_test','SAML']:
        log('distribution_start',domain=domain)
        if domain.startswith('HI'):
            scope=domain.split('_')[1];population=load(HI/f'assets/{scope}_ids.npy')
            indices=np.sort(rng.choice(len(population),N,replace=False));ids=np.asarray(population[indices],np.int64)
            edges=adapter.edge_features(ids)[:,:14];ports=adapter.ports(ids)
            node=load(G/'nodes'/('2022-09-25.npy' if scope=='train' else '2022-10-31.npy'))
            src=load(G/'src.npy')[ids];dst=load(G/'dst.npy')[ids];ys=labels(ids)>0
            fmt=np.asarray(adapter.formats[ids]);a=np.asarray(node[src]);b=np.asarray(node[dst])
        else:
            ids=np.sort(rng.choice(9504852,N,replace=False));edges=load(FULL/'cache/edge22.npy')[ids,:14]
            ports=np.column_stack([load(FULL/f'cache/{d}_ports.npy')[ids] for d in ('incoming','outgoing')])
            node=load(FULL/'cache/nodes19.npy');src=load(SG/'src.npy')[ids];dst=load(SG/'dst.npy')[ids]
            a=np.asarray(node[src]);b=np.asarray(node[dst]);ys=load(FULL/'cache/labels.npy')[ids]>0
            fmt=load(S/'cache/X.npy')[ids,17]
        values=np.column_stack([edges,a,b,ports]).astype('float32')
        names=edge_names+['src_'+n for n in NODE_NAMES]+['dst_'+n for n in NODE_NAMES]+['in_port','out_port']
        assert values.shape==(N,len(names)) and np.isfinite(values).all()
        features[domain]=values[~ys];samples[domain]=dict(rows=N,normal=int((~ys).sum()),positive=int(ys.sum()),seed=20261106)
        for code,name in enumerate(['ACH','Bitcoin','Cash','Cheque','Credit Card','Reinvestment','Wire','Unknown']):
            mask=(fmt==code) if code<7 else ((fmt<0)|(fmt>=7))
            categories.append(dict(domain=domain,format=name,rows=int(mask.sum()),fraction=float(mask.mean())))
        np.savez(R/f'{domain}_feature_sample.npz',ids=ids,y=ys,values=values,names=np.asarray(names),format=fmt)
        gc.collect()
    rows=[]
    for domain,values in features.items():
        for j,name in enumerate(names):
            v=values[:,j];base=features['HI_train'][:,j];q=np.quantile(v,[.01,.05,.5,.95,.99]);bq=np.quantile(base,[.01,.99])
            rows.append(dict(domain=domain,feature=name,normal_sample_rows=len(v),mean=float(v.mean()),
                zero_fraction=float((v==0).mean()),p01=float(q[0]),p05=float(q[1]),median=float(q[2]),p95=float(q[3]),p99=float(q[4]),
                below_HI_train_p01=float((v<bq[0]).mean()),above_HI_train_p99=float((v>bq[1]).mean()),
                KS_vs_HI_train=float(ks_2samp(base,v,method='asymp').statistic)))
    pd.DataFrame(rows).to_csv(R/'feature_distribution_normal_sample.csv',index=False)
    pd.DataFrame(categories).to_csv(R/'payment_distribution_sample.csv',index=False)
    write('distribution_sampling.json',dict(method='Label-independent uniform100000 transactions per domain; numeric distribution comparison uses normals within sample',domains=samples,node_snapshot='HI train/test split-end; SAML full-period-end, same as model context'))
    log('distributions_complete')

if __name__=='__main__':
    write('analysis_plan.json',dict(created_utc=datetime.now(timezone.utc).isoformat(),scope='Existing frozen predictions, missingness audit, source/target feature distributions',
        threshold=0.5,refit=False,select_threshold=False,causal_claim=False,salt_remains_paused=True,
        note='Missing KYC/country is constant across SAML; group associations cannot identify its causal effect. No new SAML model evaluation or training in this script.'))
    group_metrics();distributions();log('complete')
