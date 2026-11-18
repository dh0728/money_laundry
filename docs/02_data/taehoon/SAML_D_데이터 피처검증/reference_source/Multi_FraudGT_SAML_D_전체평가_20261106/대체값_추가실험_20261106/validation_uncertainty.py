"""Post-selection uncertainty; never changes candidate or threshold choice."""
from experiment import *
from sklearn.metrics import average_precision_score
assert (ROOT/'selection.json').exists()
ys=[];scores=[];groups=[]
for i,path in enumerate(sorted((ROOT/'validation_chunks').glob('*.npz'))):
    with np.load(path) as a:
        ys.append(a['y']>0);scores.append(a['logits']);groups.append(np.full(len(a['y']),i,np.int32));cases=list(a['cases'])
assert len(ys)==128 and cases==CASES
y=np.concatenate(ys);z=np.concatenate(scores,axis=1);group=np.concatenate(groups)
w=np.random.default_rng(20261110).multinomial(128,np.full(128,1/128),size=500)
boot={};points={}
for case,values in zip(cases,z):
    order=np.argsort(values,kind='mergesort')[::-1]
    ends=np.r_[np.flatnonzero(np.diff(values[order])),len(y)-1]
    sg=group[order];truth=y[order];ap=[]
    for weights in w:
        rw=weights[sg];tp=np.cumsum(rw*truth)[ends];den=np.cumsum(rw)[ends]
        p=np.divide(tp,den,out=np.zeros_like(tp,dtype=float),where=den>0)
        ap.append(float(np.sum(np.diff(np.r_[0,tp])/tp[-1]*p)))
    assert abs(ap[0]-average_precision_score(y,values,sample_weight=w[0][group]))<1e-12
    boot[str(case)]=np.asarray(ap);points[str(case)]=float(average_precision_score(y,values))
comparisons={}
for a,b in [('degree_median','zero'),('behavior_donor','zero'),('behavior_donor','degree_median'),('behavior_donor','train_median'),('behavior_donor','original')]:
    low,high=np.quantile(boot[a]-boot[b],[.025,.975])
    comparisons[a+' minus '+b]=dict(AP_delta=points[a]-points[b],CI95_low=float(low),CI95_high=float(high))
write('validation_uncertainty.json',dict(method='Paired128-batch cluster bootstrap500',seed=20261110,
    sklearn_weighted_AP_crosscheck=True,selection_already_frozen=True,comparisons=comparisons))
print(json.dumps(comparisons,ensure_ascii=False),flush=True)
