"""Same objective and target budget for disjoint and shared graph comparisons."""
from dataclasses import asdict
from datetime import datetime,timedelta,timezone
import hashlib,json,time
import numpy as np
import torch
from . import RUN_ROOT
from .config import digest,VARIANTS
from .data import FeatureAdapter
from .official_loader import PeriodGraph
from .population import PopulationStream,Labels
from .models import make_model
from .optimization import class_weighted_loss,make_optimizer
from .metrics import EpochMetrics
from .storage import write_json,write_csv,log


def save_checkpoint(path,state):
    temp=path.with_suffix('.tmp');torch.save(state,temp);temp.replace(path)


class EpochProgressReporter:
    def __init__(self,folder,variant,epoch,config,train_total,val_total,callback=None):
        self.path=folder/'live_progress.json';self.callback=callback;self.last=0.;self.started={}
        self.value={'variant':variant,'epoch':epoch,'epochs':config.epochs,'phase':'train',
                    'train':{'completed':0,'total':train_total,'percent':0.,'loss':None},
                    'validation':{'completed':0,'total':val_total,'percent':0.,'scheduled':config.validation_epoch(epoch)}}
    def __call__(self,phase,completed,total,loss=None,scored=None,force=False):
        now=time.monotonic();self.started.setdefault(phase,now)
        self.value['phase']=phase
        self.value[phase].update(completed=int(completed),total=int(total),percent=100*completed/total if total else 0.,
                                 elapsed_seconds=now-self.started[phase])
        if loss is not None:self.value[phase]['loss']=float(loss)
        if scored is not None:self.value[phase]['scored']=int(scored)
        if force or now-self.last>=1:
            self.value['utc']=datetime.now(timezone.utc).isoformat();write_json(self.path,self.value);self.last=now
            if self.callback:self.callback(self.value)


def sample_next(iterator,config,scope,epoch,index):
    key=f'{config.seed}|{scope}|{epoch}|{index}'.encode()
    seed=int.from_bytes(hashlib.blake2b(key,digest_size=8).digest(),'little')%(2**63-1)
    with torch.random.fork_rng(devices=[]):
        torch.random.default_generator.manual_seed(seed)
        return next(iterator)


def graph_chunks(logical_sizes,config):
    """Reference keeps each target disjoint; shared mode keeps the whole seed batch."""
    groups=[];sizes=[]
    for size in logical_sizes:
        parts=[min(config.graph_batch_size,size-first) for first in range(0,size,config.graph_batch_size)]
        groups.append(len(parts));sizes.extend(parts)
    return groups,sizes


def combine_batch_gradients(model,previous,scored):
    """Add one complete loader-batch MEAN to accumulated previous batch means."""
    for parameter,old in zip(model.parameters(),previous):
        current=parameter.grad
        if current is not None:
            if scored<=0:raise RuntimeError('Gradient without any scored target')
            current.div_(scored)
        if old is not None:
            if current is None:parameter.grad=old
            else:current.add_(old)


def train_one_epoch(model,stream,graph,adapter,labels,optimizer,device,epoch,config,
                    start_batch=0,metric_state=None,save_progress=None,reporter=None):
    model.train();batches=stream.training_batches(epoch);total=sum(map(len,batches))
    metrics=EpochMetrics.restore(metric_state)
    if reporter:reporter('train',metrics.requested,total,scored=sum(map(len,metrics.labels)),force=True)
    if start_batch==len(batches):return metrics
    ids=np.concatenate(batches[start_batch:]);y=labels(ids)
    groups,sizes=graph_chunks([len(b) for b in batches[start_batch:]],config)
    loader=graph.loader(ids,(y>0).astype(np.float32),config.graph_batch_size,batch_sizes=sizes,seed=config.seed+epoch)
    iterator=iter(loader);optimizer.zero_grad(set_to_none=True)
    graph_index=sum(graph_chunks([len(b) for b in batches[:start_batch]],config)[0])
    for logical in range(start_batch,config.iterations_per_epoch):
        previous=[parameter.grad for parameter in model.parameters()]
        optimizer.zero_grad(set_to_none=True);batch_scored=0
        for _ in range(groups[logical-start_batch]):
            sampled=sample_next(iterator,config,'train',epoch,graph_index);graph_index+=1
            rows,batch,_=adapter.materialize(graph,sampled,ids)
            prediction,selection=model(batch.to(device));selected=selection.detach().cpu().numpy()
            metrics.add_requested(y[rows]);truth=y[rows[selected]]
            if len(prediction):
                target=torch.as_tensor(truth>0,dtype=torch.float32,device=device)
                losses=class_weighted_loss(prediction,target,config)
                if not torch.isfinite(losses).all():raise FloatingPointError('Nonfinite training loss')
                losses.sum().backward()
                metrics.add_scored(truth,prediction.detach().cpu().numpy(),float(losses.detach().sum()))
                batch_scored+=len(prediction)
            if reporter:
                scored=sum(map(len,metrics.labels))
                reporter('train',metrics.requested,total,metrics.loss_sum/scored if scored else None,scored)
            del batch,sampled,prediction,selection
        combine_batch_gradients(model,previous,batch_scored)
        cursor=logical+1
        if cursor%config.batch_accumulation==0 or cursor==config.iterations_per_epoch:
            norm=torch.nn.utils.clip_grad_norm_(model.parameters(),config.gradient_clip)
            if not torch.isfinite(norm):raise FloatingPointError('Nonfinite gradient')
            optimizer.step();optimizer.zero_grad(set_to_none=True)
            if save_progress:save_progress(cursor,metrics)
    assert metrics.requested==total
    if reporter:
        result=metrics.compute();reporter('train',total,total,result['loss'],result['scored'],True)
    return metrics


def evaluate_one_epoch(model,ids,graph,adapter,labels,device,config,epoch=0,reporter=None):
    model.eval();y=labels(ids);metrics=EpochMetrics();visited=np.zeros(len(ids),bool)
    loader=graph.loader(ids,(y>0).astype(np.float32),batch_size=config.graph_batch_size,shuffle=False)
    iterator=iter(loader)
    if reporter:reporter('validation',0,len(ids),scored=0,force=True)
    with torch.inference_mode():
        for index in range(len(loader)):
            sampled=sample_next(iterator,config,graph.scope,epoch,index)
            rows,batch,_=adapter.materialize(graph,sampled,ids)
            assert not visited[rows].any();visited[rows]=True
            logits,selection=model(batch.to(device));selected=selection.cpu().numpy()
            metrics.add_requested(y[rows]);truth=y[rows[selected]]
            if len(logits):
                if not torch.isfinite(logits).all():raise FloatingPointError('Nonfinite validation score')
                target=torch.as_tensor(truth>0,dtype=torch.float32,device=device)
                losses=class_weighted_loss(logits,target,config)
                metrics.add_scored(truth,logits.cpu().numpy(),float(losses.sum()))
            if reporter:reporter('validation',metrics.requested,len(ids),scored=sum(map(len,metrics.labels)),force=metrics.requested==len(ids))
            del batch,sampled,logits,selection
    assert visited.all() and metrics.requested==len(ids)
    return metrics.compute()


def history_row(epoch,train,val,config,train_seconds,val_seconds,partial):
    row={'epoch':epoch,'learning_rate':config.learning_rate(epoch),'selection_eligible':config.selection_epoch(epoch),
         'validation_performed':val is not None,'train_seconds':train_seconds,'validation_seconds':val_seconds,
         'seconds_this_process_segment':train_seconds+val_seconds,'resumed_partial_epoch':partial,
         'train_loss':train['loss'],'training_rows':train['requested'],'training_scored':train['scored'],
         'validation_rows':val['requested'] if val else 0,'validation_scored':val['scored'] if val else 0,
         'optimizer_updates':(config.iterations_per_epoch+config.batch_accumulation-1)//config.batch_accumulation}
    for prefix,values in [('train',train),('val',val)]:
        for key in ['loss','accuracy_at_05','precision_at_05','recall_at_05','F1','AP','unmatched_recall_at_05',
                    'known_recall_at_05','coverage','requested_recall_lower_bound','missing_positive','missing_targets']:
            row[prefix+'_'+key]=values[key] if values else None
    return row


def estimate_eta(history,config):
    completed=max((row['epoch'] for row in history),default=0)
    train_times=[row['train_seconds'] for row in history if not row['resumed_partial_epoch']][-5:]
    val_times=[row['validation_seconds'] for row in history if row['validation_performed']][-5:]
    if not train_times:return {'mean_epoch_seconds':None,'remaining_hours':None,'estimated_finish_utc':None}
    train_mean=float(np.mean(train_times));val_mean=float(np.mean(val_times)) if val_times else 0.
    remaining_epochs=config.epochs-completed
    remaining_evaluations=sum(config.validation_epoch(e) for e in range(completed+1,config.epochs+1))
    seconds=train_mean*remaining_epochs+val_mean*remaining_evaluations
    return {'mean_epoch_seconds':train_mean+val_mean/config.eval_period,'train_mean_seconds':train_mean,
            'validation_mean_seconds':val_mean,'remaining_validation_epochs':remaining_evaluations,
            'remaining_hours':seconds/3600,'estimated_finish_utc':(datetime.now(timezone.utc)+timedelta(seconds=seconds)).isoformat(),
            'scope':'current variant only; accounts for scheduled validation'}


def run_variant(config,variant,on_epoch=None,on_progress=None):
    folder=RUN_ROOT/'models'/variant;folder.mkdir(parents=True,exist_ok=True)
    if (folder/'complete.json').exists():return json.loads((folder/'complete.json').read_text())
    torch.set_num_threads(config.torch_threads);torch.cuda.set_per_process_memory_fraction(.35);torch.manual_seed(config.seed)
    device=torch.device('cuda');model=make_model(variant,config).to(device);optimizer=make_optimizer(model,config)
    protocol_hash=digest(RUN_ROOT/'protocol.json')
    state={'epoch':1,'loader_cursor':0,'history':[],'best':{'F1':-1.,'epoch':0},'metric_state':None}
    if (folder/'last.pt').exists():
        state=torch.load(folder/'last.pt',map_location='cpu',weights_only=False)
        assert state['protocol_sha256']==protocol_hash,'Changed protocol cannot resume old checkpoints'
        model.load_state_dict(state['model']);optimizer.load_state_dict(state['optimizer'])
        torch.set_rng_state(state['rng_cpu']);torch.cuda.set_rng_state_all(state['rng_cuda'])
    history,best=state['history'],state['best'];labels=Labels()
    train_stream,val_stream=PopulationStream(config,'train'),PopulationStream(config,'val')
    train_graph,val_graph=PeriodGraph('train',variant,config),PeriodGraph('val',variant,config)
    adapter=FeatureAdapter(variant!='fraudgt_format');(folder/'model_structure.txt').write_text(str(model))
    def checkpoint(epoch,cursor,metric_state):
        save_checkpoint(folder/'last.pt',{'model':model.state_dict(),'optimizer':optimizer.state_dict(),
            'epoch':epoch,'loader_cursor':cursor,'metric_state':metric_state,'history':history,'best':best,
            'protocol_sha256':protocol_hash,'rng_cpu':torch.get_rng_state(),'rng_cuda':torch.cuda.get_rng_state_all()})
    log('corrected_training_started',variant=variant,graph_mode=config.graph_mode,start_epoch=state['epoch'])
    try:
        for epoch in range(state['epoch'],config.epochs+1):
            for group in optimizer.param_groups:group['lr']=config.learning_rate(epoch)
            cursor=state['loader_cursor'] if epoch==state['epoch'] else 0
            metric_state=state['metric_state'] if epoch==state['epoch'] else None
            total=sum(map(len,train_stream.training_batches(epoch)))
            val_total=min(len(val_stream.ids),config.validation_batches*config.seed_batch)
            reporter=EpochProgressReporter(folder,variant,epoch,config,total,val_total,on_progress)
            started=time.monotonic()
            def save_progress(next_batch,metrics):
                checkpoint(epoch,next_batch,metrics.state())
                result=metrics.compute();value={'epoch':epoch,'loader_batches':next_batch,'epoch_targets':metrics.requested,
                       'train_loss':result['loss'],'scored_targets':result['scored'],'coverage':result['coverage']}
                write_json(folder/'progress.json',value);log('corrected_training_progress',variant=variant,**value)
            train=train_one_epoch(model,train_stream,train_graph,adapter,labels,optimizer,device,epoch,config,
                                  cursor,metric_state,save_progress,reporter).compute()
            train_seconds=time.monotonic()-started;val=None;val_seconds=0.
            if config.validation_epoch(epoch):
                log('corrected_validation_started',variant=variant,epoch=epoch)
                val_start=time.monotonic();ids=val_stream.evaluation_ids(epoch)
                val=evaluate_one_epoch(model,ids,val_graph,adapter,labels,device,config,epoch,reporter)
                val_seconds=time.monotonic()-val_start
                if config.selection_epoch(epoch) and val['F1']>best['F1']:
                    best={'F1':val['F1'],'epoch':epoch}
                    save_checkpoint(folder/'best.pt',{'state_dict':model.state_dict(),'variant':variant,'epoch':epoch,
                                    'config':asdict(config),'protocol_sha256':protocol_hash,'validation':val})
            row=history_row(epoch,train,val,config,train_seconds,val_seconds,bool(cursor));history.append(row)
            write_json(folder/'history.json',history);write_csv(folder/'epoch_metrics.csv',history)
            checkpoint(epoch+1,0,None)
            if epoch%config.checkpoint_every(variant)==0 or epoch==config.epochs:
                save_checkpoint(folder/f'epoch{epoch}.pt',{'state_dict':model.state_dict(),'config':asdict(config),
                                'epoch':epoch,'protocol_sha256':protocol_hash})
            eta=estimate_eta(history,config);write_json(folder/'eta.json',eta)
            log('corrected_epoch_complete',variant=variant,best_epoch=best['epoch'],**row)
            if on_epoch:on_epoch(history,variant,best['epoch'],eta)
        result={'status':'complete','variant':variant,'epochs':len(history),'best':best}
        write_json(folder/'complete.json',result);return result
    finally:
        del model,optimizer,train_graph,val_graph,adapter;torch.cuda.empty_cache()


def finish_evaluation(config,model_factory=None):
    """Freeze every variant before looking at test predictions; no test tuning."""
    pending=[v for v in VARIANTS if not (RUN_ROOT/'models'/v/'complete.json').exists()]
    if pending:return {'status':'training_pending','variants':pending}
    freeze={v:{'checkpoint_sha256':digest(RUN_ROOT/'models'/v/'best.pt')} for v in VARIANTS}
    frozen=RUN_ROOT/'frozen_selection.json'
    if frozen.exists():assert json.loads(frozen.read_text())==freeze
    else:write_json(frozen,freeze)
    labels=Labels();ids=PopulationStream(config,'test').evaluation_ids(0)
    results={}
    for variant in VARIANTS:
        saved=torch.load(RUN_ROOT/'models'/variant/'best.pt',map_location='cpu',weights_only=False)
        model=(model_factory or make_model)(variant,config).cuda().eval();model.load_state_dict(saved['state_dict'])
        graph=PeriodGraph('test',variant,config);adapter=FeatureAdapter(variant!='fraudgt_format')
        try:results[variant]=evaluate_one_epoch(model,ids,graph,adapter,labels,torch.device('cuda'),config)
        finally:del model,graph,adapter;torch.cuda.empty_cache()
    result={'status':'complete','test_results':results,'goal_population_certified':False,
            'interpretation':'Official sampled/scored-subset test metrics; P70/R65 over all transactions is not certified.'}
    write_json(RUN_ROOT/'complete.json',result);return result
