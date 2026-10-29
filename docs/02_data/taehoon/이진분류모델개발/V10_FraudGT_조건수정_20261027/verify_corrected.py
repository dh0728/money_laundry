"""Ordered checks against upstream behavior and real V10 inputs."""
from configure import configure
ROOT,_=configure('verification')
from dataclasses import replace
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from datetime import datetime,timezone
from unittest.mock import patch
from typing import Optional,Callable,List
import ast,json,time,traceback,math
import numpy as np
import torch,yaml
from torch_geometric.data import HeteroData
from torch_geometric.loader import LinkNeighborLoader
from torch_geometric.sampler import NeighborSampler
from fraudgt_lab.config import TrainConfig,VARIANTS
from fraudgt_lab.population import PopulationStream,Labels,prepare_population,temporal_boundaries
from fraudgt_lab.official_loader import PeriodGraph,FORWARD,REVERSE,relations_for,MappedFeatureStore,MappedGraphStore
from fraudgt_lab.data import FeatureAdapter,GraphBatch
from fraudgt_lab.models import make_model
from fraudgt_lab.training import sample_next,combine_batch_gradients,graph_chunks
from fraudgt_lab.metrics import EpochMetrics
from fraudgt_lab.storage import write_json
RESULTS=[]

def check(name,fn):
    start=time.monotonic();value=fn() or {}
    row={'order':len(RESULTS)+1,'utc':datetime.now(timezone.utc).isoformat(),'test':name,'status':'pass','seconds':time.monotonic()-start,**value}
    RESULTS.append(row)
    with (ROOT/'verification_journal.jsonl').open('a') as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
    write_json(ROOT/'verification_progress.json',RESULTS);print(json.dumps(row,ensure_ascii=False),flush=True)


def populations():
    split=prepare_population();labels=Labels();counts={}
    from common import G
    minute=np.load(G/'minute.npy',mmap_mode='r');present=np.load(G/'present.npy',mmap_mode='r')
    for scope in ['train','val','test']:
        stream=PopulationStream(TrainConfig(),scope);w=split['windows'][scope]
        assert len(stream.ids)==w['rows']
        for first in range(0,len(stream.ids),1000000):
            ids=stream.ids[first:first+1000000];times=minute[ids]
            assert (present[ids]!=0).all() and (times>=w['first_day']*1440).all() and (times<(w['last_day']+1)*1440).all()
            assert np.all(ids[1:]>ids[:-1])
        positive=(minute[labels.ids]>=w['first_day']*1440)&(minute[labels.ids]<(w['last_day']+1)*1440)
        counts[scope]={'rows':len(stream.ids),'positive':int(positive.sum())}
    assert [counts[s]['positive'] for s in ['train','val','test']]==[101515,43057,44103]
    # Existing complete-positive cohorts independently confirm binary/unmatched mapping.
    from fraudgt_lab import LEGACY_ROOT
    for scope in ['train_gnn','monitor','fusion_fit','validation','historical_test']:
        with np.load(LEGACY_ROOT/'cache'/f'{scope}.npz') as old:
            new=labels(old['ids']);assert np.array_equal(new>0,old['y']>0);assert np.array_equal(new==9,old['y']==9)
    stream=PopulationStream(TrainConfig(),'val');ids=stream.evaluation_ids(1)
    assert len(ids)==524288 and len(np.unique(ids))==len(ids)
    assert not np.array_equal(ids,stream.evaluation_ids(4))
    assert np.array_equal(ids,PopulationStream(replace(TrainConfig(),graph_mode='disjoint'),'val').evaluation_ids(1))
    return {'splits':counts,'boundaries':split['boundaries'],'validation_requested':len(ids),'label_mapping_matches_old_censuses':True,'comparison_modes_same_targets':True}


def upstream_relations_and_loader():
    # Execute the actual upstream constructor against an in-memory dataset.
    module=ast.parse((ROOT/'official_source/fraudGT/datasets/aml_dataset.py').read_text())
    cls=next(node for node in module.body if isinstance(node,ast.ClassDef) and node.name=='AMLDataset')
    class Parent:
        def __init__(self,root,*args):self.root=root
        @property
        def processed_paths(self):return ['graphs','ports']
    node_count=80;rng=np.random.default_rng(42)
    source=rng.integers(node_count,size=5000);dest=rng.integers(node_count,size=5000)
    source[:80]=0;dest[:80]=1
    data=HeteroData();data['node'].x=torch.ones(node_count,19)
    arrays={}
    for kind,s,d in [(FORWARD,source,dest),(REVERSE,dest,source)]:
        order=np.argsort(d,kind='stable');row=torch.tensor(s[order]);col=torch.tensor(d[order])
        arrays[kind]=(row,torch.tensor(np.r_[0,np.cumsum(np.bincount(d,minlength=node_count))]))
        data[kind].edge_index=torch.stack([row,col]);data[kind].edge_attr=torch.zeros(len(row),22)
    namespace={'TemporalDataset':Parent,'Optional':Optional,'Callable':Callable,'List':List,'torch':torch,'os':__import__('os')}
    exec(compile(ast.Module(body=[cls],type_ignores=[]),'<official_AMLDataset>','exec'),namespace)
    fixture={scope:deepcopy(data) for scope in ['train','val','test']}
    port_fixture={scope:(torch.zeros(5000,1),torch.zeros(5000,1)) for scope in fixture}
    records=[]
    for variant in VARIANTS:
        reverse=variant=='multi_fraudgt_format';ports=variant!='fraudgt_format'
        with patch.object(torch,'load',side_effect=lambda path:deepcopy(fixture if path=='graphs' else port_fixture)):
            upstream=namespace['AMLDataset']('unused','Large-HI',reverse_mp=reverse,add_ports=ports).data_dict['train']
        assert upstream.edge_types==relations_for(variant)
        active={kind:arrays[kind] for kind in relations_for(variant)}
        for disjoint in [False,True]:
            features=MappedFeatureStore(np.ones((node_count,19),np.float32));store=MappedGraphStore(active,node_count)
            sampler=NeighborSampler((features,store),[50,50],replace=False,subgraph_type='directional',disjoint=disjoint)
            sampler.edge_types=relations_for(variant)
            seeds=torch.tensor(np.stack([source[:2048],dest[:2048]]))
            args=dict(num_neighbors=[50,50],edge_label_index=(FORWARD,seeds),batch_size=2048,shuffle=False,replace=False,disjoint=disjoint,num_workers=0)
            remote=LinkNeighborLoader((features,store),neighbor_sampler=sampler,**args)
            reference=LinkNeighborLoader(upstream,is_sorted=True,**args)
            config=TrainConfig();left=sample_next(iter(remote),config,'parity',0,0);right=sample_next(iter(reference),config,'parity',0,0)
            assert torch.equal(left['node'].n_id,right['node'].n_id)
            for kind in relations_for(variant):
                assert torch.equal(left[kind].e_id,right[kind].e_id)
                assert torch.equal(left[kind].edge_index,right[kind].edge_index)
            if disjoint:
                for kind in relations_for(variant):
                    a,b=left[kind].edge_index;assert torch.equal(left['node'].batch[a],left['node'].batch[b])
            else:assert len(torch.unique(left['node'].n_id))==len(left['node'].n_id)
            records.append({'variant':variant,'disjoint':disjoint,'relations':len(active),'exact_loader_parity':True})
    return {'cases':records,'actual_upstream_constructor_executed':True}


def readout_and_gradient():
    torch.manual_seed(42)
    model=make_model('fraudgt_format').eval()
    nodes=torch.randn(7,20);edges=torch.tensor([[0,1,2,3],[1,2,3,4]])
    attributes=torch.randn(4,22)
    targets=torch.tensor([[2,0,5],[3,1,6]]) # includes a target absent from context
    target_features=torch.stack([attributes[2],attributes[0],torch.randn(22)])
    batch=GraphBatch(nodes,edges,attributes,targets,target_features,torch.ones(4,dtype=torch.bool),torch.zeros(4,dtype=torch.bool),
                     torch.tensor([2,0,-1]),torch.zeros(4,2),torch.zeros(3,2))
    logits,selection=model(batch);assert selection.tolist()==[1,0] and len(logits)==2
    # Invoke upstream head indexing, including its original context order.
    encoded=model.node_encoder(nodes[:,:19]);encoded_edges=[model.edge_encoder[0](attributes)]
    for block in model.layers:encoded,encoded_edges=block(encoded,[edges],encoded_edges)
    reference=HeteroData();reference['node'].x=encoded;reference[FORWARD].edge_index=edges;reference[FORWARD].edge_attr=encoded_edges[0]
    reference[FORWARD].e_id=torch.tensor([10,11,12,13]);reference[FORWARD].input_id=torch.arange(3);reference[FORWARD].y=torch.tensor([0,0,1,0]);reference.split='train'
    cls=next(n for n in ast.parse((ROOT/'official_source/fraudGT/head/hetero_edge.py').read_text()).body if isinstance(n,ast.ClassDef))
    fn=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='_apply_index')
    space={'torch':torch,'cfg':SimpleNamespace(dataset=SimpleNamespace(task_entity=FORWARD))}
    exec(compile(ast.Module(body=[fn],type_ignores=[]),'<official_head>','exec'),space)
    rep,truth=space['_apply_index'](SimpleNamespace(train_inds=torch.tensor([12,10,99])),reference)
    torch.testing.assert_close(logits,model.head(rep).squeeze(-1),rtol=0,atol=0)
    assert truth.tolist()==[0,1]
    # Micrographs sum to one original loader-batch mean, including unequal scored sizes.
    linear=torch.nn.Linear(3,1);expected=deepcopy(linear)
    x=torch.randn(9,3);y=torch.randn(9,1)
    for a,b in [(0,5),(5,9)]:
        old=[p.grad for p in linear.parameters()];linear.zero_grad(set_to_none=True)
        for first in range(a,b,3):(linear(x[first:min(first+3,b)])-y[first:min(first+3,b)]).square().sum().backward()
        combine_batch_gradients(linear,old,b-a)
        (expected(x[a:b])-y[a:b]).square().mean().backward()
    for a,b in zip(linear.parameters(),expected.parameters()):torch.testing.assert_close(a.grad,b.grad,rtol=1e-5,atol=1e-6)
    metrics=EpochMetrics();metrics.add_requested(np.array([9,1,0,0]));metrics.add_scored(np.array([1,0]),np.array([1.,-1.]),1.)
    result=metrics.compute();assert result['recall_at_05']==1. and result['requested_recall_lower_bound']==.5 and result['coverage']==.5
    return {'official_head_exact_parity':True,'missing_target_reported':True,'microbatch_gradient_means_equal':True,'coverage_not_misreported_as_full_recall':True}


def real_graphs():
    config=TrainConfig();labels=Labels();train=PopulationStream(config,'train')
    ids=np.asarray(train.ids[np.random.default_rng(42).choice(len(train.ids),2048,replace=False)],np.int64)
    records=[];torch.cuda.set_per_process_memory_fraction(.30);torch.set_num_threads(2)
    for mode in ['shared','disjoint']:
        cfg=replace(config,graph_mode=mode)
        for variant in VARIANTS:
            graph=PeriodGraph('train',variant,cfg);adapter=FeatureAdapter(variant!='fraudgt_format')
            take=ids if mode=='shared' else ids[:64]
            sampled=sample_next(iter(graph.loader(take,batch_size=len(take))),cfg,'real',0,0)
            rows,batch,stats=adapter.materialize(graph,sampled,take)
            assert stats['relations']==(2 if variant=='multi_fraudgt_format' else 1)
            torch.cuda.reset_peak_memory_stats();model=make_model(variant,cfg).cuda().train()
            prediction,selection=model(batch.to('cuda'));assert len(prediction)>0 and torch.isfinite(prediction).all()
            prediction.square().mean().backward();assert all(p.grad is None or torch.isfinite(p.grad).all() for p in model.parameters())
            records.append({'mode':mode,'variant':variant,'scored':len(prediction),'peak_cuda_mib':torch.cuda.max_memory_allocated()/2**20,**stats})
            print(json.dumps(records[-1]),flush=True)
            del graph,adapter,batch,sampled,model,prediction,selection;torch.cuda.empty_cache()
    # Real cumulative validation graph, never reusing the train-only prefix.
    graph=PeriodGraph('val','fraudgt_format',config);take=PopulationStream(config,'val').evaluation_ids(1)[:2048]
    sampled=sample_next(iter(graph.loader(take)),config,'val',1,0)
    rows,batch,stats=FeatureAdapter().materialize(graph,sampled,take)
    assert graph.metadata['end_day']==73 and len(rows)==2048 and stats['reverse_edges']==0
    return {'train_batches':records,'validation_graph':stats,'validation_prefix_day':73}

if __name__=='__main__':
    for name,fn in [('01_population_split_and_supervision',populations),('02_variant_relations_and_official_loader',upstream_relations_and_loader),
                    ('03_upstream_head_gradient_and_coverage',readout_and_gradient),('04_real_gpu_batches_both_modes',real_graphs)]:
        try:check(name,fn)
        except BaseException:
            write_json(ROOT/'verification_failure.json',{'test':name,'traceback':traceback.format_exc()});raise
    write_json(ROOT/'functional_verification.json',{'status':'pass','tests':RESULTS})
