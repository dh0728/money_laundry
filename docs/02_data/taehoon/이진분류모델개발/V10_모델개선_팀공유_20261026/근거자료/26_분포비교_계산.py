"""Descriptive normal/unmatched separation on validation, never input labels."""
from lab import *
import csv
from sklearn.metrics import roc_auc_score

def quantiles(x,w):
    order=np.argsort(x,kind='stable');xx=x[order];ww=w[order];c=np.cumsum(ww)
    return np.interp([.25,.5,.75],c/c[-1],xx).tolist()

def main():
    con=json.loads((P/'06_daily_scalar_contract.json').read_text());flow=json.loads((P/'08_dayflow_contract.json').read_text())
    names=con['names']+flow['names'];base=np.load(CACHE/'daily60_X.npy',mmap_mode='r');extra=np.load(CACHE/'dayflow18_X.npy',mmap_mode='r')
    ids=np.load(CACHE/'control_ids.npy');days=np.load(CACHE/'control_day.npy');val=np.load(CACHE/'cohorts/val_screen.npz');v=np.searchsorted(ids,val['ids'])
    eligible=(val['y']==0)|(val['y']==9);v=v[eligible];y=val['y'][eligible]==9;w=val['w'][eligible];d=days[v]
    early=d<65;late=d>=69;rows=[];categories=[];log('10a_separation_start',scope='Normal vs unmatched validation sample only')
    for j,name in enumerate(names):
        x=np.asarray(base[v,j] if j<60 else extra[v,j-60])
        if name=='payment_format':
            labels=json.loads((FIX/'categories.json').read_text())['payment_format']
            for value in np.unique(x):
                categories.append(dict(code=int(value),name=labels[int(value)],
                    normal_fraction=float(w[early&~y&(x==value)].sum()/w[early&~y].sum()),
                    unmatched_fraction=float(w[early&y&(x==value)].sum()/w[early&y].sum())))
            continue
        auc=float(roc_auc_score(y[early],x[early],sample_weight=w[early]))
        direction=1 if auc>=.5 else -1;late_auc=float(roc_auc_score(y[late],direction*x[late],sample_weight=w[late]))
        n=early&~y;u=early&y;nq=quantiles(x[n],w[n]);uq=quantiles(x[u],w[u])
        rows.append(dict(feature=name,new_dayflow=j>=60,early_direction='higher' if direction>0 else 'lower',early_auc=max(auc,1-auc),
            late_auc_same_direction=late_auc,normal_q25=nq[0],normal_median=nq[1],normal_q75=nq[2],unmatched_q25=uq[0],unmatched_median=uq[1],unmatched_q75=uq[2],
            normal_zero_fraction=float(np.average(x[n]==0,weights=w[n])),unmatched_zero_fraction=float(np.average(x[u]==0,weights=w[u]))))
    rows.sort(key=lambda r:r['early_auc'],reverse=True)
    with (P/'10a_정상_무패턴_피처차이.csv').open('w',newline='',encoding='utf-8-sig') as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    write('10a_feature_separation.json',dict(rows=rows,payment_format_categories=categories,categorical_codes_not_ordinal=True,selection_window='Sep26..Oct4',confirmation_window='Oct9..13',
        warning='Univariate descriptive AUC; not final operating precision/recall, no causal interpretation, no test data.',
        labels_used_only_to_compare_groups=True))
    log('10a_separation_complete',top_existing=[r for r in rows if not r['new_dayflow']][:5],top_new=[r for r in rows if r['new_dayflow']][:5])

if __name__=='__main__':
    try:main()
    except Exception as exc:log('execution_failed',script=Path(__file__).name,error=type(exc).__name__,detail=str(exc));raise
