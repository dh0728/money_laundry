from imputation import *
import sys
sys.path.insert(0,str(HI))
import fraudgt_lab
from common import G,NODE_NAMES

def main():
    if (ROOT/'fit.json').exists():check_frozen();return
    assert sha(BASE/'selected_best.pt')==WEIGHT_SHA
    path=G/'nodes/2022-09-25.npy';nodes=np.load(path,mmap_mode='r')
    active=(nodes[:,0]>0)|(nodes[:,1]>0)
    x=np.array(nodes[active],copy=True)
    assert x.shape[1]==19 and np.isfinite(x).all()
    median=np.median(x[:,16:19],axis=0).astype('float32')
    edges=np.log1p(np.array([2**k-.5 for k in range(11)],dtype='float64')).astype('float32')
    bins=len(edges)+1
    out=np.searchsorted(edges,x[:,2],side='right');inc=np.searchsorted(edges,x[:,3],side='right')
    key=out*bins+inc;order=np.argsort(key,kind='stable');bounds=np.searchsorted(key[order],np.arange(bins*bins+1))
    counts=np.diff(bounds).reshape(bins,bins)
    table=np.broadcast_to(median,(bins,bins,3)).copy()
    for index in range(bins*bins):
        ids=order[bounds[index]:bounds[index+1]]
        if len(ids)>=128:table[index//bins,index%bins]=np.median(x[ids,16:19],axis=0)
    np.save(ROOT/'owner_train_median.npy',median);np.save(ROOT/'degree_bin_edges.npy',edges)
    np.save(ROOT/'owner_bin_medians.npy',table);np.save(ROOT/'owner_bin_counts.npy',counts)
    assert np.isfinite(table).all() and (table>=0).all()
    files=['imputation.py','prepare.py','validate.py','full_saml.py']
    plan=dict(version=1,purpose='Change owner missing-value imputation; frozen GNN weights and threshold',
        fields=list(NODE_NAMES[16:19]),unchanged='Node type6,country2 remain zero; payment format mapping,Port,Ego,graph and all observed numeric fields unchanged',
        methods={'train_median':'Coordinate-wise median over active HI Train accounts (not transaction-weighted)',
                 'degree_median':'Same HI Train owner medians in fixed source/destination unique-counterparty count bins; groups<128 use global Train median'},
        fitting='Only HI Train node snapshot 2022-09-25; all active accounts; no fraud labels',
        validation='128 shared2048-target batches (262144 rows), uniform permutation of entire HI Validation, seed20261107; original val graph and sampler scope val/epoch0/index',
        selection='Highest HI masked-validation AP among the two alternative imputers; tie within1e-12 -> higherF1 -> train_median. Zero baseline is reference, not candidate. Selected alternative is evaluated even if worse than zero.',
        validation_conditions=['original','zero','train_median','degree_median'],
        target='Every one of9504852 SAML-D observations, original fixed random order and samplers; selected method only',
        threshold=.5,selected_checkpoint_epoch=280,checkpoint_sha256=WEIGHT_SHA,
        readout='all_targets',batch_size=2048,fanout=[50,50],main_model_retrained=False,
        status='Post-hoc follow-up after SAML full Test was already inspected; not a fresh unseen benchmark',
        imputation_limit='Owner values are source-based numerical guesses, not recovered SAML ground truth; source validation choice may not transfer',
        salt_remains_paused=True,source_sha256={f:sha(ROOT/f) for f in files})
    write('plan.json',plan)
    st=path.stat()
    fitted=dict(active_train_accounts=int(active.sum()),total_accounts=len(nodes),owner_fields=list(NODE_NAMES[16:19]),
        global_median=median.tolist(),degree_bins_log=edges.tolist(),supported_cells=int((counts>=128).sum()),total_cells=bins*bins,
        minimum_cell_count=128,labels_read=False,saml_inputs_used=False,
        inputs={str(path):dict(size=st.st_size,mtime_ns=st.st_mtime_ns,sha256=sha(path))},
        artifacts={f:sha(ROOT/f) for f in ['owner_train_median.npy','degree_bin_edges.npy','owner_bin_medians.npy','owner_bin_counts.npy']})
    write('fit.json',fitted)
    # Verify fallback and bin assignment independently on representative Train rows.
    test=x[np.linspace(0,len(x)-1,128).astype(int)];pred=owners(test,'degree_median')
    for i,node in enumerate(test):
        a=sum(node[2]>=float(e) for e in edges);b=sum(node[3]>=float(e) for e in edges)
        np.testing.assert_array_equal(pred[i],table[a,b])
    np.testing.assert_array_equal(table[counts<128],np.broadcast_to(median,table[counts<128].shape))
    write('fit_checks.json',dict(passed=True,checked_rows=128,all_sparse_cells_use_train_median=True))
    event('fit_complete',active_train_accounts=fitted['active_train_accounts'],global_median=median.tolist(),supported_bins=fitted['supported_cells'])

if __name__=='__main__':main()
