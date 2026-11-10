"""Exact source format frequencies and archived Test errors; no model fitting."""
from analyze_existing import *
from fraudgt_lab.population import Labels

fmt=load(G/'fmt.npy');truth=Labels();rows=[]
names=['ACH','Bitcoin','Cash','Cheque','Credit Card','Reinvestment','Wire','Unknown']
def codes(ids):
    c=np.asarray(fmt[ids],dtype='int64');return np.where((c>=0)&(c<7),c,7)
for scope in ['train','test']:
    population=load(HI/f'assets/{scope}_ids.npy');counts=np.zeros(8,dtype='int64')
    for start in range(0,len(population),2000000):
        counts+=np.bincount(codes(population[start:start+2000000]),minlength=8)
    pos=np.searchsorted(population,truth.ids);inside=pos<len(population)
    ix=np.flatnonzero(inside);ix=ix[population[pos[ix]]==truth.ids[ix]]
    positives=np.bincount(codes(truth.ids[ix]),minlength=8)
    known=np.bincount(codes(truth.ids[ix][truth.classes[ix]!=9]),minlength=8)
    for i,name in enumerate(names):
        rows.append(dict(domain='HI_'+scope,format=name,rows=int(counts[i]),positive=int(positives[i]),
                         known_pattern_positive=int(known[i]),positive_rate=float(positives[i]/counts[i]) if counts[i] else None))
    log('source_format_population',scope=scope,rows=int(counts.sum()),positive=int(positives.sum()))
pd.DataFrame(rows).to_csv(R/'HI_payment_population.csv',index=False)
archive=HI/'runs/shared_corrected_001/evaluations/multi_alltargets_fulltest_20261103/chunks'
count=np.zeros((8,4),dtype='int64')
for file in sorted(archive.glob('*.npz')):
    with np.load(file) as part:
        c=codes(part['transaction_id']);y=part['actual_class']>0;pred=part['logit']>0
        assert part['scored'].all()
        for j,mask in enumerate([y&pred,~y&pred,y&~pred,~y&~pred]):count[:,j]+=np.bincount(c[mask],minlength=8)
assert count.sum()==33429507 and count[:,1].sum()==3078
out=[]
for name,(tp,fp,fn,tn) in zip(names,count):
    ratio=lambda a,b:float(a/b) if b else None
    out.append(dict(format=name,TP=int(tp),FP=int(fp),FN=int(fn),TN=int(tn),precision=ratio(tp,tp+fp),recall=ratio(tp,tp+fn),FPR=ratio(fp,fp+tn)))
pd.DataFrame(out).to_csv(R/'HI_full_test_payment_metrics.csv',index=False)
log('source_format_complete')
