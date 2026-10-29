"""Run the pinned upstream GTLayer with matching active parameters."""
from configure import configure
ROOT,_=configure('model_math_verification')
import ast,math,json
from types import SimpleNamespace
import torch
from torch import nn
from torch.nn import Parameter
from torch.nn import functional as F
from torch_geometric.nn import Linear
from torch_geometric.nn.inits import zeros
from torch_geometric.data import HeteroData
from fraudgt_lab.models import FraudGTBlock
from fraudgt_lab.official_loader import FORWARD,REVERSE
from fraudgt_lab.storage import write_json

torch.set_num_threads(2)
def scatter_max(source,index,dim,dim_size):
    shape=list(source.shape);shape[dim]=dim_size
    values=source.new_full(shape,-torch.inf)
    values.scatter_reduce_(dim,index,source,reduce='amax',include_self=True)
    return values,None
cfg=SimpleNamespace(gt=SimpleNamespace(act='gelu',hops=2,edge_weight=True,dropout=0.,attn_dropout=.2,
    ffn='Type',residual='Fixed',attn_mask='Edge'),gnn=SimpleNamespace(dropout=0.))
namespace=dict(torch=torch,nn=nn,Parameter=Parameter,Linear=Linear,zeros=zeros,HeteroData=HeteroData,
    F=F,math=math,cfg=cfg,register=SimpleNamespace(act_dict={'gelu':nn.GELU()}),scatter_max=scatter_max,
    runtime_stats_cuda=SimpleNamespace(start_region=lambda *a:None,end_region=lambda *a:None))
cls=next(n for n in ast.parse((ROOT/'upstream_gt_layer.py').read_text()).body if isinstance(n,ast.ClassDef))
exec(compile(ast.Module(body=[cls],type_ignores=[]),'<pinned_GTLayer>','exec'),namespace)
records=[]
for kinds in [[FORWARD],[FORWARD,REVERSE]]:
    torch.manual_seed(17)
    ours=FraudGTBlock(len(kinds)).eval()
    original=namespace['GTLayer'](64,64,64,(['node'],kinds),'None','SparseNodeTransformer',0,
                                 num_heads=8,layer_norm=True,batch_norm=False).eval()
    for local,remote in [(ours.query,original.q_lin['node']),(ours.key,original.k_lin['node']),
        (ours.value,original.v_lin['node']),(ours.node_output,original.o_lin['node']),
        (ours.node_norm,original.norm1_global['node']),(ours.node_ffn_norm,original.norm2_ffn['node']),
        (ours.node_ffn[0],original.ff_linear1_type['node']),(ours.node_ffn[2],original.ff_linear2_type['node'])]:
        remote.load_state_dict(local.state_dict())
    original.edge_weights.data.copy_(ours.relation_keys.data)
    for r,kind in enumerate(kinds):
        key='__'.join(kind)
        for local,remote in [(ours.edge_norm[r],original.norm1_edge_global[key]),
            (ours.edge_bias[r],original.e_lin[key]),(ours.edge_gate[r],original.g_lin[key]),
            (ours.edge_output[r],original.oe_lin[key]),(ours.edge_ffn[r][0],original.ff_linear1_edge_type[key]),
            (ours.edge_ffn[r][2],original.ff_linear2_edge_type[key])]:remote.load_state_dict(local.state_dict())
    x=torch.randn(9,64,requires_grad=True)
    indices=[torch.randint(0,9,(2,25)) for _ in kinds]
    edges=[torch.randn(25,64,requires_grad=True) for _ in kinds]
    source=HeteroData();source['node'].x=x.clone()
    for kind,index,edge in zip(kinds,indices,edges):source[kind].edge_index=index;source[kind].edge_attr=edge.clone()
    y,updated=ours(x,indices,edges);result=original(source)
    torch.testing.assert_close(y,result['node'].x,rtol=2e-5,atol=2e-6)
    maximum=float((y-result['node'].x).abs().max().detach())
    for kind,edge in zip(kinds,updated):
        torch.testing.assert_close(edge,result[kind].edge_attr,rtol=2e-5,atol=2e-6)
        maximum=max(maximum,float((edge-result[kind].edge_attr).abs().max().detach()))
    left=torch.autograd.grad(y.square().sum()+sum(e.square().sum() for e in updated),[x,*edges],retain_graph=True)
    right=torch.autograd.grad(result['node'].x.square().sum()+sum(result[k].edge_attr.square().sum() for k in kinds),[x,*edges])
    for a,b in zip(left,right):torch.testing.assert_close(a,b,rtol=2e-4,atol=3e-5)
    records.append({'relations':len(kinds),'max_forward_absolute_error':maximum,'input_gradient_parity':True})
write_json(ROOT/'model_math_verification.json',{'status':'pass','cases':records,
    'method':'Pinned upstream class executed with identical active parameters; unavailable torch_scatter.scatter_max replaced by native scatter_reduce amax; eval mode avoids differing dropout RNG layouts.'})
print(json.dumps(records))
