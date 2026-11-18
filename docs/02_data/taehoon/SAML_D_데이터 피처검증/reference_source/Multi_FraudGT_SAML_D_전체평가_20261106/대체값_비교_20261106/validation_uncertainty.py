"""Paired batch-bootstrap uncertainty, after frozen source-only selection."""
from imputation import *
from sklearn.metrics import average_precision_score

ys=[];scores=[];groups=[]
for i,path in enumerate(sorted((ROOT/'validation_chunks').glob('*.npz'))):
    with np.load(path) as p:
        ys.append(p['y']>0);scores.append(p['logits']);groups.append(np.full(len(p['y']),i,dtype='int32'));cases=p['cases']
y=np.concatenate(ys);z=np.concatenate(scores,axis=1);group=np.concatenate(groups)
assert len(ys)==128 and len(y)==262144
w=np.random.default_rng(20261108).multinomial(128,np.full(128,1/128),size=500)
boot={};points={}
for case,values in zip(cases,z):
    order=np.argsort(values,kind='mergesort')[::-1];ends=np.r_[np.flatnonzero(np.diff(values[order])),len(y)-1]
    sgroup=group[order];truth=y[order];ap=[]
    for weights in w:
        rw=weights[sgroup];tp=np.cumsum(rw*truth)[ends];den=np.cumsum(rw)[ends]
        precision=np.divide(tp,den,out=np.zeros_like(tp,dtype=float),where=den>0)
        ap.append(float(np.sum(np.diff(np.r_[0,tp])/tp[-1]*precision)))
    assert abs(ap[0]-average_precision_score(y,values,sample_weight=w[0][group]))<1e-12
    boot[str(case)]=np.asarray(ap);points[str(case)]=float(average_precision_score(y,values))
comparisons={}
for a,b in [('train_median','zero'),('degree_median','zero'),('train_median','degree_median'),('train_median','original')]:
    lo,hi=np.quantile(boot[a]-boot[b],[.025,.975]);comparisons[a+' minus '+b]=dict(AP_delta=points[a]-points[b],CI95_low=float(lo),CI95_high=float(hi))
write('validation_uncertainty.json',dict(method='Paired128-batch cluster bootstrap500 resamples',seed=20261108,
    sklearn_weighted_AP_crosscheck=True,selection_already_frozen=True,comparisons=comparisons))
print(json.dumps(comparisons,ensure_ascii=False),flush=True)
