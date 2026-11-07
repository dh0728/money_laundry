"""Actual PyG sampling -> three FraudGT variants -> resume -> full Val/Test."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def make_fixture(root):
    import numpy as np
    rng=np.random.default_rng(123);nodes=12;per_day=6;days=92;n=days*per_day
    g=root/'data/features';h=root/'data/hi';s=root/'data/structural';p=root/'data/ports';assets=root/'assets'
    for path in (g/'nodes',h,s,p,assets):path.mkdir(parents=True,exist_ok=True)
    src=rng.integers(nodes,size=n,dtype=np.int32);dst=rng.integers(nodes,size=n,dtype=np.int32)
    minute=(np.repeat(np.arange(days),per_day)*1440+np.tile(np.arange(per_day),days)).astype(np.int32)
    for name,a in {'src':src,'dst':dst,'minute':minute,'present':np.ones(n,np.uint8),
                   'z':rng.normal(size=n).astype(np.float32),'fmt':rng.integers(7,size=n,dtype=np.uint8)}.items():np.save(g/f'{name}.npy',a)
    for day in range(days):np.save(g/'nodes'/f"{np.datetime64('2022-08-01')+np.timedelta64(day,'D')}.npy",rng.normal(size=(nodes,19)).astype(np.float32))
    np.save(s/'x.npy',rng.normal(size=(n,17)).astype(np.float32));np.save(s/'present.npy',np.ones(n,np.uint8))
    np.save(h/'paid_z.npy',rng.normal(size=n).astype(np.float32))
    for role,endpoint in (('incoming',dst),('outgoing',src)):
        ids=np.argsort(endpoint,kind='stable').astype(np.uint32)
        offsets=np.r_[0,np.cumsum(np.bincount(endpoint,minlength=nodes))].astype(np.int64)
        np.save(h/f'{role}_time_ids.npy',ids);np.save(h/f'{role}_time_offsets.npy',offsets)
        np.save(p/f'{role}_ports.npy',rng.integers(5,size=n,dtype=np.int32))
    (h/'complete.json').write_text(json.dumps({'nodes':nodes,'width':n,'rows':n,'complete':True}))
    positive=np.arange(0,n,7,dtype=np.uint32);classes=np.where(np.arange(len(positive))%3==0,9,1).astype(np.int8)
    np.save(assets/'positive_ids.npy',positive);np.save(assets/'positive_classes.npy',classes)


def check_readout():
    import numpy as np
    import torch
    from fraudgt_lab.config import TrainConfig,VARIANTS
    from fraudgt_lab.data import GraphBatch
    from fraudgt_lab.models import make_model
    torch.manual_seed(4);config=TrainConfig();checked=[]
    for variant in VARIANTS:
        # One requested edge is absent from message passing; two have known positions.
        nf=torch.randn(4,20,dtype=torch.float64);ef=torch.randn(6,22,dtype=torch.float64)
        edge_index=torch.tensor([[0,1,2,0,1,2],[1,2,3,1,2,3]])
        target_index=torch.tensor([[0,3,2],[1,0,3]])
        tf=torch.stack([ef[0],torch.randn(22,dtype=torch.float64),ef[2]])
        ports=torch.randn(6,2,dtype=torch.float64);tp=torch.stack([ports[0],torch.zeros(2,dtype=torch.float64),ports[2]])
        batch=GraphBatch(nf,edge_index,ef,target_index,tf,torch.tensor([1,1,1,0,0,0],dtype=torch.bool),
                         torch.tensor([0,0,0,1,1,1],dtype=torch.bool),torch.tensor([0,-1,2]),ports,tp)
        model=make_model(variant,config).double().eval()
        with torch.no_grad():
            old,selection=model(batch);model.readout='all_targets';full,all_selection=model(batch)
        np.testing.assert_array_equal(selection.numpy(),[0,2]);np.testing.assert_array_equal(all_selection.numpy(),[0,1,2])
        torch.testing.assert_close(old,full[selection],rtol=1e-12,atol=1e-12)
        assert torch.isfinite(full).all();checked.append(variant)
    return checked


def worker():
    import numpy as np
    import torch
    from fraudgt_lab import EXPERIMENT_ROOT,PACKAGE_ROOT,RUN_ROOT
    from fraudgt_lab.config import TrainConfig,VARIANTS
    from fraudgt_lab.environment import check_backend
    from fraudgt_lab.runtime import prepare
    from fraudgt_lab.training import run_variant,combine_batch_gradients
    from fraudgt_lab.evaluation import full_evaluate
    from fraudgt_lab.metrics import binary_average_precision
    backend=check_backend();make_fixture(EXPERIMENT_ROOT);torch.set_num_threads(1)
    config=TrainConfig(**json.loads((PACKAGE_ROOT/'configs/smoke.json').read_text()))
    prepare(config,True)
    parity=check_readout()
    assert abs(binary_average_precision([1,0,1,0],[.8,.8,.2,.1])-7/12)<1e-12
    layer=torch.nn.Linear(1,1,bias=False);layer.weight.grad=torch.tensor([[6.]])
    combine_batch_gradients(layer,[torch.tensor([[2.]])],3)
    assert layer.weight.grad.item()==4. # sum of batch means, not a mean of the sum
    results=[]
    for variant in VARIANTS:
        first=run_variant(config,variant,device_name='cpu',stop_after=1)
        assert first['status']=='stopped_at_epoch' and first['epochs']==1
        assert run_variant(config,variant,device_name='cpu',stop_after=1)==first
        final=run_variant(config,variant,device_name='cpu')
        assert final['status']=='complete' and final['epochs']==2
        val=full_evaluate(variant,scope='val',device_name='cpu')
        test=full_evaluate(variant,scope='test',device_name='cpu')
        assert val['coverage']==test['coverage']==1. and test['scored']==108
        assert full_evaluate(variant,scope='test',device_name='cpu')==test
        # Delete only the generated summary to exercise committed-shard replay.
        summary=RUN_ROOT/'evaluations'/f'{variant}_test_all_targets/result.json'
        summary.unlink();replayed=full_evaluate(variant,scope='test',device_name='cpu')
        assert replayed==test
        results.append({'variant':variant,'epochs':2,'resume':'pass','val_rows':val['scored'],'test_rows':test['scored'],'replay':'pass'})
    result={'status':'pass','backend':backend,'readout_parity':parity,'AP_tie_check':'pass','accumulation_mean_check':'pass','variants':results}
    (EXPERIMENT_ROOT/'smoke_result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))


def run_smoke():
    root=Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='fraudgt_smoke_') as tmp:
        env=dict(os.environ,FRAUDGT_WORK_DIR=tmp,FRAUDGT_RUN_NAME='smoke',OMP_NUM_THREADS='1',OPENBLAS_NUM_THREADS='1')
        subprocess.run([sys.executable,'-m','tests.smoke','--worker'],cwd=root,env=env,check=True)
        return json.loads((Path(tmp)/'smoke_result.json').read_text())


if __name__=='__main__':
    if '--worker' in sys.argv:worker()
    else:run_smoke()
