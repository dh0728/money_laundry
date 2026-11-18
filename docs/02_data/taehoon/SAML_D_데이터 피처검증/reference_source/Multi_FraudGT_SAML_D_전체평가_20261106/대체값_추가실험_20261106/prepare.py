from experiment import *
import time
from scipy.spatial import cKDTree
sys.path.insert(0,str(HI))
import fraudgt_lab
from common import G,NODE_NAMES

def main():
    if (ROOT/'fit.json').exists():check_frozen();return
    salt_check();assert sha(BASE/'selected_best.pt')==WEIGHT_SHA
    files=['experiment.py','prepare.py','validate.py','full_saml.py','report.py']
    plan=dict(version=1,created_utc=datetime.now(timezone.utc).isoformat(),
        purpose='Additional missing owner-field imputations, frozen classifier; all methods evaluated by predeclared protocol',
        methods=METHODS,fields=NODE_NAMES[16:19],unchanged='Node types6,country2 remain zero; observed fields,format mapping,Port,Ego,graph,order,sampler and weights unchanged',
        degree_median='Reuse exact previously fitted HI Train out/in unique-counterparty bin medians, min128 accounts, otherwise global Train median',
        behavior_donor=dict(training='HI Train active nodes at2022-09-25 only, no fraud labels',
            donor_sample=65536,donor_seed=20261109,match_features=NODE_NAMES[:10],
            scaling='Train account-weighted feature quantiles: clip to p01/p99, center median, divide max(IQR,0.1)',
            search='Euclidean cKDTree k=1, eps=0.1, leafsize32, workers2; approximate nearest within factor1.1',
            output='Copy all3 owner fields from ONE actual HI Train donor; retain their joint tuple',
            rationale='Condition on observed behavior instead of a global constant; does not recover true SAML owner identity'),
        validation='Same previous262144 HI Validation IDs,128 shared2048 batches, seed20261107; val sampler epoch0/index',
        validation_conditions=CASES,
        source_selection='Highest masked HI Validation AP among degree_median and behavior_donor; tie1e-12 -> F1 -> degree_median. Record before target inference. Both candidates evaluated on full SAML regardless of this ranking.',
        target='Both predeclared alternatives on ALL9504852 SAML rows. Same sampled graph per batch reused for paired methods; no new method or threshold selected from target outcomes.',
        benchmark='Preserved original zero and prior global median full SAML results',
        threshold=.5,selected_epoch=280,checkpoint_sha256=WEIGHT_SHA,readout='all_targets',
        batch_size=2048,fanout=[50,50],main_model_retrained=False,salt_remains_paused=True,
        interpretation='Exploratory follow-up on already-inspected SAML Test; no fresh holdout claim or causal allocation of entire domain gap',
        source_sha256={f:sha(ROOT/f) for f in files})
    if (ROOT/'plan.json').exists():
        prior=json.loads((ROOT/'plan.json').read_text());plan['created_utc']=prior['created_utc'];assert prior==plan
    else:write('plan.json',plan)
    train_path=G/'nodes/2022-09-25.npy';raw=np.load(train_path,mmap_mode='r')
    active_ids=np.flatnonzero((raw[:,0]>0)|(raw[:,1]>0));x=np.array(raw[active_ids,:10],np.float64)
    q=np.quantile(x,[.01,.25,.5,.75,.99],axis=0)
    low,high=q[0],q[4];center=q[2];scale=np.maximum(q[3]-q[1],.1)
    donor_ids=np.sort(np.random.default_rng(20261109).choice(active_ids,65536,replace=False))
    donor_raw=np.asarray(raw[donor_ids,:10],np.float64)
    donor_x=(np.clip(donor_raw,low,high)-center)/scale
    donor_y=np.asarray(raw[donor_ids,16:19],np.float32)
    np.save(ROOT/'donor_ids.npy',donor_ids);np.save(ROOT/'donor_x.npy',donor_x);np.save(ROOT/'donor_y.npy',donor_y)
    np.savez(ROOT/'scaler.npz',low=low,high=high,center=center,scale=scale)
    tree=cKDTree(donor_x,leafsize=32);del x;trim()
    edges=np.load(PRIOR/'degree_bin_edges.npy');table=np.load(PRIOR/'owner_bin_medians.npy')
    prior_fit=json.loads((PRIOR/'fit.json').read_text())
    for f in ['degree_bin_edges.npy','owner_bin_medians.npy','owner_bin_counts.npy','owner_train_median.npy']:
        assert sha(PRIOR/f)==prior_fit['artifacts'][f]
    inputs={};audit={};checks=[]
    for scope,path in [('val',G/'nodes/2022-10-13.npy'),('saml',BASE/'cache/nodes19.npy')]:
        nodes=np.load(path,mmap_mode='r');nearest=np.empty(len(nodes),np.int32);distances=np.empty(len(nodes),np.float64)
        clip_count=np.zeros(10,np.int64);started=time.monotonic()
        for start in range(0,len(nodes),100000):
            stop=min(start+100000,len(nodes));b=np.asarray(nodes[start:stop,:10],np.float64)
            clip_count+=((b<low)|(b>high)).sum(axis=0)
            transformed=(np.clip(b,low,high)-center)/scale
            d,idx=tree.query(transformed,k=1,eps=.1,workers=2)
            nearest[start:stop]=idx;distances[start:stop]=d
            event('donor_mapping',scope=scope,completed=stop,total=len(nodes),elapsed_seconds=time.monotonic()-started)
        prediction=donor_y[nearest]
        np.save(ROOT/f'{scope}_behavior_donor_owners.npy',prediction)
        np.save(ROOT/f'{scope}_donor_indices.npy',nearest);np.save(ROOT/f'{scope}_donor_distances.npy',distances)
        out=np.searchsorted(edges,nodes[:,2],side='right');inc=np.searchsorted(edges,nodes[:,3],side='right')
        degree=table[out,inc].copy();np.save(ROOT/f'{scope}_degree_median_owners.npy',degree)
        assert np.isfinite(prediction).all() and (prediction>=0).all() and np.isfinite(degree).all()
        # Brute-force distances for fixed label-independent audit rows.
        for idx in np.linspace(0,len(nodes)-1,32,dtype=int):
            v=(np.clip(np.asarray(nodes[idx,:10],np.float64),low,high)-center)/scale
            actual=np.linalg.norm(donor_x[nearest[idx]]-v)
            best=np.sqrt(((donor_x-v)**2).sum(axis=1)).min()
            assert abs(actual-distances[idx])<1e-8 and actual<=1.1*best+1e-8
            np.testing.assert_array_equal(prediction[idx],raw[donor_ids[nearest[idx]],16:19])
        stats=dict(nodes=len(nodes),donors_used=len(np.unique(nearest)),distance_quantiles=np.quantile(distances,[0,.5,.9,.99,1]).tolist(),
                   clip_fraction_by_feature={name:float(clip_count[i]/len(nodes)) for i,name in enumerate(NODE_NAMES[:10])},
                   owner_mean=prediction.mean(axis=0,dtype=np.float64).tolist(),owner_min=prediction.min(axis=0).tolist(),owner_max=prediction.max(axis=0).tolist())
        if scope=='val':stats['owner_MAE_against_actual_val']=np.abs(prediction-nodes[:,16:19]).mean(axis=0,dtype=np.float64).tolist()
        audit[scope]=stats;checks.append(dict(scope=scope,brute_force_rows=32,approximation_bound_checked=True,joint_donor_tuple_exact=True))
        del nodes,prediction,degree,nearest,distances;trim()
    for path in [train_path,G/'nodes/2022-10-13.npy',BASE/'cache/nodes19.npy',PRIOR/'validation_ids.npy',
                 PRIOR/'degree_bin_edges.npy',PRIOR/'owner_bin_medians.npy',PRIOR/'owner_bin_counts.npy',PRIOR/'owner_train_median.npy']:
        st=path.stat();inputs[str(path)]=dict(size=st.st_size,mtime_ns=st.st_mtime_ns,sha256=sha(path))
    artifacts={p.name:sha(p) for p in sorted(ROOT.glob('*.np*'))}
    write('fit.json',dict(train_active_accounts=len(active_ids),donors=65536,labels_used=False,
        train_only_fit=True,saml_inputs_used_for_fit=False,saml_inputs_used_only_for_transform_and_query=True,
        scaler=dict(low=low.tolist(),high=high.tolist(),center=center.tolist(),scale=scale.tolist()),
        diagnostics=audit,inputs=inputs,artifacts=artifacts))
    write('fit_checks.json',dict(passed=True,checks=checks));event('fit_complete',diagnostics=audit)

if __name__=='__main__':main()
