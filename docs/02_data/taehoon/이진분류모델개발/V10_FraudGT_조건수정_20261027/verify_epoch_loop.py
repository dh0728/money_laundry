"""Small synthetic lifecycle checks; not a model performance experiment."""
from configure import configure
ROOT,_=configure('lifecycle_verification')
from dataclasses import replace
from pathlib import Path
import json
import numpy as np
import torch
from fraudgt_lab.config import TrainConfig
from fraudgt_lab.data import GraphBatch
from fraudgt_lab.storage import write_json
import fraudgt_lab.training as training
import fraudgt_lab.storage as storage

class FixtureStream:
    def __init__(self,config,scope='train'):
        self.config=config;self.scope=scope;self.ids=np.arange(16)
    def training_batches(self,epoch):
        return [self.ids[:8],self.ids[8:]]
    def evaluation_ids(self,epoch=0):return self.ids

class FixtureGraph:
    def __init__(self,scope,*args):self.scope=scope
    def loader(self,ids,labels=None,batch_size=8,shuffle=False,batch_sizes=None,seed=42):
        sizes=batch_sizes or [min(batch_size,len(ids)-i) for i in range(0,len(ids),batch_size)]
        bounds=np.r_[0,np.cumsum(sizes)]
        return [np.arange(a,b) for a,b in zip(bounds[:-1],bounds[1:])]

class FixtureLabels:
    def __call__(self,ids):
        return np.where(ids%3==0,np.where(ids%2==0,9,1),0).astype(np.int8)

class FixtureAdapter:
    def __init__(self,*args):pass
    def materialize(self,graph,rows,ids):
        seed=ids[rows];count=len(seed)
        index=torch.tensor(np.stack([np.arange(count),np.arange(count)+count]))
        nodes=torch.arange(count*2*20,dtype=torch.float32).reshape(count*2,20)/160
        edge=torch.arange(count*22,dtype=torch.float32).reshape(count,22)/100
        yes=torch.ones(count,dtype=torch.bool);ports=torch.zeros(count,2)
        positions=torch.arange(count);positions[torch.from_numpy(seed%7==0)]=-1
        batch=GraphBatch(nodes,index,edge,index,edge,yes,~yes,positions,ports,ports)
        return rows,batch,{'target_edges_not_sampled':int((positions<0).sum())}

training.PopulationStream=FixtureStream;training.PeriodGraph=FixtureGraph
training.FeatureAdapter=FixtureAdapter;training.Labels=FixtureLabels
records=[]
for mode in ['shared','disjoint']:
    config=replace(TrainConfig(),graph_mode=mode,epochs=6,seed_batch=8,iterations_per_epoch=2,
                   validation_batches=2,batch_accumulation=1,reference_microbatch=3)
    variants=[]
    for scenario in ['continuous','resumed']:
        folder=ROOT/'runs/lifecycle_verification'/mode/scenario
        if folder.exists():raise RuntimeError('Use a fresh synthetic test folder')
        folder.mkdir(parents=True);training.RUN_ROOT=folder;storage.RUN_ROOT=folder
        write_json(folder/'protocol.json',{'purpose':'synthetic_lifecycle_only','mode':mode})
        phases=[]
        def on_progress(value):
            phases.append((value['epoch'],value['phase'],value[value['phase']]['completed']))
        save=training.save_checkpoint
        def stop_after_save(path,state):
            save(path,state)
            if path.name=='last.pt' and state['epoch']==1 and state['loader_cursor']==1:
                raise InterruptedError('Expected mid-epoch checkpoint interruption')
        if scenario=='resumed':
            training.save_checkpoint=stop_after_save
            try:training.run_variant(config,'fraudgt_format',on_progress=on_progress)
            except InterruptedError:pass
            finally:training.save_checkpoint=save
            state=torch.load(folder/'models/fraudgt_format/last.pt',weights_only=False,map_location='cpu')
            assert state['epoch']==1 and state['loader_cursor']==1
        result=training.run_variant(config,'fraudgt_format',on_progress=on_progress)
        model_folder=folder/'models/fraudgt_format'
        history=json.loads((model_folder/'history.json').read_text())
        assert [row['epoch'] for row in history]==list(range(1,7))
        assert [row['epoch'] for row in history if row['validation_performed']]==[1,4,6]
        assert all(row['training_rows']==16 and row['train_coverage']==13/16 for row in history)
        assert all(row['val_loss'] is None and row['validation_rows']==0 for row in history if not row['validation_performed'])
        assert all((epoch,'train',16) in phases for epoch in range(1,7))
        assert all((epoch,'validation',16) in phases for epoch in [1,4,6])
        assert training.run_variant(config,'fraudgt_format')==result
        variants.append(torch.load(model_folder/'last.pt',weights_only=False,map_location='cpu'))
    for name,expected in variants[0]['model'].items():
        torch.testing.assert_close(expected,variants[1]['model'][name],rtol=1e-6,atol=1e-7)
    assert variants[0]['best']==variants[1]['best']
    for left,right in zip(variants[0]['history'],variants[1]['history']):
        for key in ['train_loss','val_loss','train_recall_at_05','train_coverage']:
            assert left[key]==right[key],(mode,key,left[key],right[key])
    records.append({'mode':mode,'epochs':6,'validation_epochs':[1,4,6],
                    'mid_epoch_resume_matches_continuous':True,'gauges_complete':True,'blank_skipped_validation':True})
write_json(ROOT/'epoch_loop_verification.json',{'status':'pass','synthetic_fixture_not_performance':True,'cases':records})
print(json.dumps(records))
