"""[스텝 확장판] 02와 같은 설정에서 스텝만 900→3600(약 3.7에폭)으로 늘린다. 280에폭 가중치에서 새로 시작한다. 출력은 work/long3600.

Multi-FraudGT 280에폭 가중치를 TransXion 1~8월로 미세조정한다.

분할: 학습 1/1~8/31, 검증 9/1~10/31, Test 11/1~12/31 (시간순).
그래프: 각 구간 종료일까지 누적(원본 HI 학습 규약과 동일). 체크포인트는 검증 AP로 고르고 Test는 마지막에 한 번만 채점한다.
"""
import sys, json, math, time, argparse, os
from pathlib import Path
sys.path.insert(0,'/workspace/handoff/TransXion_외부평가_20261112')
import bootstrap
import numpy as np, pandas as pd, torch
from torch_geometric.data import HeteroData
from torch_geometric.loader import LinkNeighborLoader
from sklearn.metrics import average_precision_score, roc_auc_score
from backend_model.inference import Predictor, FORWARD, REVERSE
from backend_model.data import GraphBatch
from backend_model.preprocessing import select_gnn_edges
from backend_model.schema import NODE_FEATURES, NUMERIC_FEATURES, FORMAT_NAMES

SRC=Path('/workspace/handoff/TransXion_외부평가_20261112'); ROOT=Path(__file__).resolve().parents[1]; WORK=ROOT/'work'; OUT=WORK/'long3600'; OUT.mkdir(exist_ok=True)
p=argparse.ArgumentParser(); p.add_argument('--pilot',action='store_true'); a=p.parse_args()
SEED=20261112; BATCH=2048; STEPS=3600; EVAL_EVERY=300; LR=3e-4; WARMUP=20; POS_W=6.; WD=1e-5; CLIP=1.
os.nice(10); torch.cuda.set_per_process_memory_fraction(.6)
pred=Predictor(device='cuda',threads=2); model=pred.gnn
tx=pd.read_parquet(SRC/'run/prepared/tx.parquet',columns=['edge_id','src','dst','ts']).sort_values('edge_id').reset_index(drop=True)
n=len(tx); assert (tx.edge_id.to_numpy()==np.arange(n)).all()
truth=pd.read_parquet(SRC/'normalized/truth.parquet'); y=truth.y.to_numpy(np.float32)
edges=pd.read_parquet(SRC/'run/prepared/edge_features.parquet',columns=['edge_id']+NUMERIC_FEATURES).sort_values('edge_id').reset_index(drop=True)
# 결제방식: Cash→Cash, Card→Credit Card, Transfer→Wire, Mobile→Unknown (네 범주를 구분해 보존)
edges['payment_format']=truth.original_payment_format.replace({'Card':'Credit Card','Transfer':'Wire','Mobile':'Unknown'}).to_numpy()
assert set(edges.payment_format)<=set(FORMAT_NAMES)
ex=select_gnn_edges(edges); del edges
ports=pd.read_parquet(SRC/'run/prepared/ports.parquet').sort_values('edge_id')[['incoming_port','outgoing_port']].to_numpy(np.float32)
src=tx.src.to_numpy(np.int64); dst=tx.dst.to_numpy(np.int64)
day=tx.ts.to_numpy().astype('datetime64[D]'); minute=tx.ts.to_numpy().astype('datetime64[m]').astype(np.int64)
SPLIT={'train':(np.datetime64('2025-01-01'),np.datetime64('2025-08-31')),'val':(np.datetime64('2025-09-01'),np.datetime64('2025-10-31')),
       'test':(np.datetime64('2025-11-01'),np.datetime64('2025-12-31'))}
NODES={'train':WORK/'context_train/prepared/node_features.parquet','val':WORK/'context_val/prepared/node_features.parquet',
       'test':SRC/'run/prepared/node_features.parquet'}

class Graph:
    """구간 종료일까지의 거래만 간선으로 쓰는 누적 그래프."""
    def __init__(self,name):
        self.name=name; end=SPLIT[name][1]
        self.eid=np.flatnonzero(day<=end)                 # 그래프에 들어가는 거래
        nx=pd.read_parquet(NODES[name]).set_index('node_id')
        x=np.zeros((47526,len(NODE_FEATURES)),np.float32); x[nx.index.to_numpy()]=nx[NODE_FEATURES].to_numpy(np.float32)
        g=HeteroData(); g['node'].x=torch.from_numpy(x); self.perm={}
        s,d,m=src[self.eid],dst[self.eid],minute[self.eid]
        for rel,owner,peer in [(FORWARD,d,s),(REVERSE,s,d)]:
            o=np.lexsort((self.eid,m,owner)); self.perm[rel]=self.eid[o]
            g[rel].edge_index=torch.from_numpy(np.stack([peer[o],owner[o]]))
        self.g=g
        self.targets=np.flatnonzero((day>=SPLIT[name][0])&(day<=end))
    def loader(self,ids,seed):
        return iter(LinkNeighborLoader(self.g,num_neighbors=[50,50],edge_label_index=(FORWARD,torch.from_numpy(np.stack([src[ids],dst[ids]]))),
            batch_size=BATCH,shuffle=False,replace=False,subgraph_type='directional',num_workers=0,is_sorted=True,
            generator=torch.Generator().manual_seed(seed)))
    def batch(self,sample,ids):
        t=ids[sample[FORWARD].input_id.numpy()]
        f=self.perm[FORWARD][sample[FORWARD].e_id.numpy()]; r=self.perm[REVERSE][sample[REVERSE].e_id.numpy()]
        sel=np.r_[f,r]
        index=np.concatenate([sample[FORWARD].edge_index.numpy(),sample[REVERSE].edge_index.numpy()[::-1]],axis=1)
        ti=sample[FORWARD].edge_label_index.numpy()
        ego=np.zeros(sample['node'].num_nodes,np.float32); ego[np.unique(ti)]=1
        data=[np.column_stack([sample['node'].x.numpy(),ego]),index,ex[sel],ti,ex[t],np.arange(len(sel))<len(f),np.arange(len(sel))>=len(f),
              np.full(len(t),-1,np.int64),ports[sel],ports[t]]
        return t,GraphBatch(*[torch.from_numpy(np.ascontiguousarray(v)) for v in data]).to('cuda')

def score(graph,tag,limit=None):
    """구간의 모든 대상 거래를 고정 순서로 섞어 채점한다."""
    model.eval(); ids=np.random.default_rng(SEED).permutation(graph.targets)
    if limit: ids=ids[:limit*BATCH]
    out=np.full(n,np.nan,np.float32); it=graph.loader(ids,SEED); t0=time.monotonic()
    with torch.inference_mode():
        for i in range(math.ceil(len(ids)/BATCH)):
            torch.manual_seed(SEED+i); t,b=graph.batch(next(it),ids)
            z,s=model(b); assert len(z)==len(t); out[t]=z.float().cpu().numpy()
    z=out[ids]; assert np.isfinite(z).all()
    r=dict(tag=tag,split=graph.name,rows=len(ids),positive=int(y[ids].sum()),AP=float(average_precision_score(y[ids],z)),
           AUC=float(roc_auc_score(y[ids],z)),seconds=time.monotonic()-t0)
    print(json.dumps(r),flush=True); return out,r

G={k:Graph(k) for k in ['train','val','test']}
print({k:(len(v.eid),len(v.targets),int(y[v.targets].sum())) for k,v in G.items()},flush=True)
named=list(model.named_parameters()); nd=('bias','LayerNorm.bias','LayerNorm.weight')
opt=torch.optim.AdamW([{'params':[q for k,q in named if not any(s in k for s in nd)],'weight_decay':WD},
                       {'params':[q for k,q in named if any(s in k for s in nd)],'weight_decay':0.}],lr=LR)
def lr_at(step): return LR*(step+1)/WARMUP if step<WARMUP else LR*.5*(1+math.cos(math.pi*(step-WARMUP)/(STEPS-WARMUP)))
steps=3 if a.pilot else STEPS
history=[]; ckpt=OUT/'checkpoints'; ckpt.mkdir(exist_ok=True)
_rng=np.random.default_rng(SEED+1); order=np.concatenate([_rng.permutation(G['train'].targets) for _ in range(math.ceil(steps*BATCH/len(G['train'].targets)))])[:steps*BATCH]   # 에폭마다 다시 섞음(첫 에폭 순서는 02와 같음)
it=G['train'].loader(order,SEED+1); torch.manual_seed(SEED); torch.cuda.reset_peak_memory_stats(); t0=time.monotonic(); run=[]
for step in range(steps):
    model.train()
    for gparam in opt.param_groups: gparam['lr']=lr_at(step)
    t,b=G['train'].batch(next(it),order); z,s=model(b); assert len(z)==len(t)
    target=torch.from_numpy(y[t]).to('cuda')
    loss=torch.nn.functional.binary_cross_entropy_with_logits(z.float(),target,weight=torch.where(target>0,POS_W,1.))
    assert torch.isfinite(loss)
    opt.zero_grad(set_to_none=True); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(),CLIP); opt.step()
    run.append(float(loss.detach())); del b,z,loss
    if a.pilot or (step+1)%20==0:
        print(json.dumps(dict(step=step+1,loss=float(np.mean(run[-20:])),lr=lr_at(step),seconds=time.monotonic()-t0,
            peak_GiB=torch.cuda.max_memory_allocated()/2**30)),flush=True)
    if not a.pilot and (step+1)%EVAL_EVERY==0:
        v,r=score(G['val'],f'step{step+1}'); history.append(dict(step=step+1,train_loss=float(np.mean(run[-EVAL_EVERY:])),**r))
        np.save(OUT/f'val_logit_step{step+1}.npy',v); torch.save(model.state_dict(),ckpt/f'step{step+1}.pt')
        (ROOT/'gnn_finetune_long3600_history.json').write_text(json.dumps(history,indent=2))
if a.pilot: sys.exit()
tuned=[h for h in history if h['step']>0]; best=max(tuned,key=lambda h:h['AP'])       # 검증 AP로 선택, Test 미사용
model.load_state_dict(torch.load(ckpt/f"step{best['step']}.pt")); 
test1,r1=score(G['test'],f"step{best['step']}_selected"); np.save(OUT/'test_logit_finetuned.npy',test1)
np.save(OUT/'val_logit_finetuned.npy',np.load(OUT/f"val_logit_step{best['step']}.npy"))
(ROOT/'gnn_finetune_long3600_history.json').write_text(json.dumps(dict(settings=dict(seed=SEED,batch=BATCH,steps=STEPS,lr=LR,warmup=WARMUP,
    positive_weight=POS_W,weight_decay=WD,clip=CLIP,selection='validation AP',payment='Card→Credit Card, Transfer→Wire, Mobile→Unknown'),
    history=history,selected_step=best['step'],test_finetuned=r1),indent=2))
print('DONE',flush=True)
