"""Validate actual HI/SAML inputs, fresh model, gradients and saved-score parity."""
from experiment import *
import gc, time
from dataclasses import replace
from common_model import compact_model, project, ReducedGPU
from fraudgt_lab.models import make_model
from fraudgt_lab.data import FeatureAdapter, GraphBatch
from fraudgt_lab.official_loader import PeriodGraph
from fraudgt_lab.population import PopulationStream
from fraudgt_lab.training import sample_next
from fraudgt_lab.optimization import make_optimizer, class_weighted_loss

def same_input(a,b):
    for name,tensor in vars(a).items():
        torch.testing.assert_close(tensor.cpu(),getattr(b,name).cpu(),rtol=0,atol=0,msg=name)

def masked(batch):
    node=batch.node_features.clone();edge=batch.edge_features.clone();target=batch.target_features.clone()
    node[:,10:19]=0;edge[:,10:12]=0;target[:,10:12]=0
    return replace(batch,node_features=node,edge_features=edge,target_features=target)

def check_model_and_gradient():
    c=config();torch.manual_seed(c.seed);full=make_model(VARIANT,c).cuda()
    cpu_state=torch.get_rng_state().clone()
    torch.manual_seed(c.seed);small=compact_model(c).cuda()
    assert torch.equal(cpu_state,torch.get_rng_state()), 'Projection must preserve initialization RNG'
    assert small.node_encoder.in_features==11 and all(x.in_features==21 for x in small.edge_encoder)
    # Deterministic, nontrivial graph includes all seeds in the official readout.
    n,m,t=12,24,8
    indices=torch.stack((torch.arange(m)%n,(torch.arange(m)+1)%n)).cuda()
    batch=GraphBatch(torch.randn(n,20,device='cuda'),indices,torch.randn(m,22,device='cuda'),
        indices[:,:t],torch.randn(t,22,device='cuda'),torch.arange(m,device='cuda')<12,
        torch.arange(m,device='cuda')>=12,torch.arange(t,device='cuda'),
        torch.rand(m,2,device='cuda'),torch.rand(t,2,device='cuda'))
    batch.target_features=batch.edge_features[:t].clone();batch.target_ports=batch.ports[:t].clone()
    changed=replace(batch,node_features=batch.node_features.clone(),edge_features=batch.edge_features.clone(),target_features=batch.target_features.clone())
    changed.node_features[:,10:19]=12345.;changed.edge_features[:,10:12]=-999.;changed.target_features[:,10:12]=777.
    same_input(project(batch),project(changed))
    full.eval();small.eval()
    with torch.no_grad():
        a,sa=full(masked(batch));b,sb=small(project(batch))
        torch.testing.assert_close(a,b,rtol=2e-5,atol=2e-5);assert torch.equal(sa,sb)
    full.train();small.train();of=make_optimizer(full,c);os=make_optimizer(small,c)
    rng=torch.cuda.get_rng_state_all()
    a,sa=full(masked(batch));target=(torch.arange(len(a),device='cuda')%3==0).float()
    class_weighted_loss(a,target,c).mean().backward()
    torch.cuda.set_rng_state_all(rng)
    b,sb=small(project(batch));class_weighted_loss(b,target,c).mean().backward()
    torch.testing.assert_close(a,b,rtol=2e-5,atol=2e-5)
    max_error=0.;unused=[]
    for name,p in small.named_parameters():
        original=dict(full.named_parameters())[name];expected=original.grad
        if expected is None:
            assert p.grad is None, name
            unused.append(name)
            continue
        if name=='node_encoder.weight':expected=expected[:,list(NODE_KEEP)]
        elif name.startswith('edge_encoder.') and name.endswith('.weight'):expected=expected[:,list(EDGE_KEEP+(22,))]
        assert p.grad is not None and torch.isfinite(p.grad).all()
        max_error=max(max_error,float((p.grad-expected).abs().max()))
        torch.testing.assert_close(p.grad,expected,rtol=3e-4,atol=2e-5)
    of.step();os.step()
    for name,p in small.named_parameters():
        expected=dict(full.named_parameters())[name]
        if name=='node_encoder.weight':expected=expected[:,list(NODE_KEEP)]
        elif name.startswith('edge_encoder.') and name.endswith('.weight'):expected=expected[:,list(EDGE_KEEP+(22,))]
        torch.testing.assert_close(p,expected,rtol=3e-4,atol=2e-5)
    result=dict(removed_columns_cannot_affect_inputs=True,initialization_rng_preserved=True,
        physically_reduced_dimensions=[11,21,21],fresh_full_masked_vs_compact_grad_max_abs_error=max_error,
        common_initial_weights_and_optimizer_step_match=True,identically_unused_parameters=unused,
        parameters=sum(p.numel() for p in small.parameters()))
    del full,small,of,os,batch;gc.collect();torch.cuda.empty_cache()
    return result

def run():
    verify_contract();torch.set_num_threads(2);torch.cuda.set_per_process_memory_fraction(.90)
    math=check_model_and_gradient();event('preflight_model_pass',**math)
    c=config();torch.manual_seed(c.seed);small=compact_model(c).cuda().eval()
    original=make_model(VARIANT,replace(c,readout='all_targets')).cuda().eval()
    original.load_state_dict(torch.load(BASELINE,map_location='cpu',weights_only=False)['state_dict'])
    cpu=FeatureAdapter(True);event('preflight_hi_cache_loading');gpu=ReducedGPU(cpu)
    checks=[]
    with torch.inference_mode():
        for scope in ('train','val','test'):
            graph=PeriodGraph(scope,VARIANT,c);gpu.set_graph(graph)
            if scope=='train':ids=PopulationStream(c,'train').training_batches(1)[0];epoch=1
            elif scope=='val':ids=PopulationStream(c,'val').evaluation_ids(1)[:2048];epoch=1
            else:
                with np.load(HI_TEST/'chunks/0000.npz') as part:
                    ids=part['transaction_id'][:2048].copy();saved=part['logit'][:2048].copy()
                epoch=0
            t=time.monotonic();sampled=sample_next(iter(graph.loader(ids,batch_size=2048)),c,scope,epoch,0)
            rows,reference,stats=cpu.materialize(graph,sampled,ids)
            gpu_rows,batch,_=gpu.materialize(graph,sampled,ids)
            assert np.array_equal(rows,gpu_rows);same_input(project(reference),batch)
            a,sa=small(batch);b,sb=small(project(reference).to('cuda'))
            assert torch.equal(sa,sb);torch.testing.assert_close(a,b,rtol=1e-5,atol=1e-5)
            item=dict(scope=scope,rows=len(rows),input_bitwise_equal=True,**stats)
            item['compact_cpu_gpu_logit_max_abs_error']=float((a-b).abs().max()) if len(a) else 0.
            if scope=='test':
                from gpu_adapter import GpuAdapter
                _,full_batch=GpuAdapter.materialize(gpu,graph,sampled,ids)
                z,selection=original(full_batch)
                np.testing.assert_allclose(z.cpu().numpy(),saved[rows],rtol=1e-5,atol=1e-5)
                item['baseline_test_reproduced_max_abs_error']=float(np.max(abs(z.cpu().numpy()-saved[rows])))
                del full_batch,z,selection
            item['seconds']=time.monotonic()-t;checks.append(item);event('preflight_hi_pass',**item)
            del graph,sampled,reference,batch,a,b;gc.collect()
    del cpu,gpu;gc.collect();torch.cuda.empty_cache()
    from saml_runtime import SamlGraph,SamlAdapter,ReducedSamlGPU
    graph=SamlGraph(c);cpu=SamlAdapter();gpu=ReducedSamlGPU(graph)
    order=np.load(SAML/'cache/order.npy',mmap_mode='r');baseline=np.load(SAML/'cache/logits.npy',mmap_mode='r')
    with torch.inference_mode():
        for index in (0,len(order)//2048):
            ids=order[index*2048:(index+1)*2048];sampled=sample_next(iter(graph.loader(ids,batch_size=2048)),c,'test',0,index)
            rows,reference,stats=cpu.materialize(graph,sampled,ids);rr,batch,_=gpu.materialize(graph,sampled,ids)
            assert np.array_equal(rows,rr);same_input(project(reference),batch)
            assert not reference.node_features[:,10:19].any() and not reference.edge_features[:,10:12].any()
            small.readout='all_targets';a,sa=small(batch);b,sb=small(project(reference).to('cuda'))
            torch.testing.assert_close(a,b,rtol=1e-5,atol=1e-5)
            original_z,_=original(reference.to('cuda'))
            np.testing.assert_allclose(original_z.cpu().numpy(),baseline[ids[rows]],rtol=1e-5,atol=1e-5)
            item=dict(scope='saml',batch=index,rows=len(rows),input_bitwise_equal=True,
                baseline_logits_reproduced_max_abs_error=float(np.max(abs(original_z.cpu().numpy()-baseline[ids[rows]]))))
            checks.append(item);event('preflight_saml_pass',**item)
    result=dict(passed=True,utc=utc(),code_manifest_sha256=digest(OUT/'code_manifest.json'),
        plan_sha256=digest(OUT/'plan.json'),model_checks=math,input_checks=checks)
    write(OUT/'preflight.json',result);verify_contract();event('preflight_complete')

if __name__=='__main__':
    with run_lock():run()
