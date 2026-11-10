"""Same original training steps and 284-epoch budget, common-feature inputs."""
import experiment as e
from experiment import *
import gc, time, statistics
from dataclasses import asdict
from common_model import compact_model, ReducedGPU
from fraudgt_lab.data import FeatureAdapter
from fraudgt_lab.population import PopulationStream, Labels
from fraudgt_lab.official_loader import PeriodGraph
from fraudgt_lab.optimization import make_optimizer
from fraudgt_lab.training import train_one_epoch, evaluate_one_epoch, history_row, EpochProgressReporter, save_checkpoint
from fraudgt_lab.storage import write_csv

FOLDER = RUN/'models'/VARIANT

def eta(history,c):
    completed=len(history)
    train_times=[h['train_seconds'] for h in history if not h['resumed_partial_epoch']][-5:]
    val_times=[h['validation_seconds'] for h in history if h['validation_performed']][-5:]
    if not train_times: return dict(completed_epochs=completed,remaining_hours=None)
    a=statistics.mean(train_times);b=statistics.mean(val_times) if val_times else 0.
    seconds=(MAX_EPOCHS-completed)*a+sum(c.validation_epoch(i) for i in range(completed+1,MAX_EPOCHS+1))*b
    from datetime import timedelta
    return dict(completed_epochs=completed,target_epochs=MAX_EPOCHS,train_mean_seconds=a,validation_mean_seconds=b,
        remaining_hours=seconds/3600,estimated_training_finish_utc=(datetime.now(timezone.utc)+timedelta(seconds=seconds)).isoformat(),
        scope='training and scheduled HI validation only; full HI/SAML test time is additional')

def run():
    verify_contract()
    assert read(OUT/'preflight.json')['passed'] and read(OUT/'preflight.json')['code_manifest_sha256']==digest(OUT/'code_manifest.json')
    FOLDER.mkdir(parents=True,exist_ok=True)
    if (FOLDER/'complete.json').exists(): return
    c=config();torch.set_num_threads(c.torch_threads);torch.cuda.set_per_process_memory_fraction(.90)
    torch.manual_seed(c.seed)
    model=compact_model(c).cuda();optimizer=make_optimizer(model,c)
    state=dict(epoch=1,loader_cursor=0,history=[],best=dict(F1=-1.,epoch=0),metric_state=None)
    if (FOLDER/'last.pt').exists():
        state=torch.load(FOLDER/'last.pt',map_location='cpu',weights_only=False)
        assert state['plan_sha256']==digest(OUT/'plan.json') and state['code_manifest_sha256']==digest(OUT/'code_manifest.json')
        model.load_state_dict(state['model']);optimizer.load_state_dict(state['optimizer'])
        torch.set_rng_state(state['rng_cpu']);torch.cuda.set_rng_state_all(state['rng_cuda'])
    history,best=state['history'],state['best']
    labels=Labels();train_stream=PopulationStream(c,'train');val_stream=PopulationStream(c,'val')
    event('training_cache_loading',start_epoch=state['epoch'],loader_cursor=state['loader_cursor'])
    cpu=FeatureAdapter(True);adapter=ReducedGPU(cpu)
    train_graph=PeriodGraph('train',VARIANT,c);val_graph=PeriodGraph('val',VARIANT,c)
    event('training_cache_ready',cache_seconds=adapter.cache.initialization_seconds)
    (FOLDER/'model_structure.txt').write_text(str(model))
    def checkpoint(epoch,cursor,metric_state):
        save_checkpoint(FOLDER/'last.pt',dict(model=model.state_dict(),optimizer=optimizer.state_dict(),
            epoch=epoch,loader_cursor=cursor,metric_state=metric_state,history=history,best=best,
            plan_sha256=digest(OUT/'plan.json'),code_manifest_sha256=digest(OUT/'code_manifest.json'),
            rng_cpu=torch.get_rng_state(),rng_cuda=torch.cuda.get_rng_state_all()))
    if not (FOLDER/'last.pt').exists(): checkpoint(1,0,None)
    for epoch in range(state['epoch'],MAX_EPOCHS+1):
        stop_check();ensure_salt_paused()
        for group in optimizer.param_groups: group['lr']=c.learning_rate(epoch)
        cursor=state['loader_cursor'] if epoch==state['epoch'] else 0
        metric_state=state['metric_state'] if epoch==state['epoch'] else None
        adapter.set_graph(train_graph)
        total=sum(map(len,train_stream.training_batches(epoch)))
        reporter=EpochProgressReporter(FOLDER,VARIANT,epoch,c,total,c.validation_batches*c.seed_batch)
        reporter.value['epochs']=MAX_EPOCHS
        begin=time.monotonic();base_targets=metric_state['requested'] if metric_state else 0
        def save_progress(next_batch,metrics):
            checkpoint(epoch,next_batch,metrics.state())
            value=dict(epoch=epoch,loader_batches=next_batch,epoch_targets=metrics.requested,
                scored_targets=sum(map(len,metrics.labels)),train_loss=metrics.loss_sum/max(1,sum(map(len,metrics.labels))),
                seconds_this_segment=time.monotonic()-begin,
                targets_per_second=(metrics.requested-base_targets)/max(time.monotonic()-begin,1e-6),
                gpu_allocated_bytes=torch.cuda.memory_allocated(),gpu_reserved_bytes=torch.cuda.memory_reserved())
            write(FOLDER/'progress.json',value);event('training_progress',**value)
            stop_check();ensure_salt_paused()
        event('epoch_started',epoch=epoch,epochs=MAX_EPOCHS,loader_cursor=cursor,learning_rate=c.learning_rate(epoch))
        train=train_one_epoch(model,train_stream,train_graph,adapter,labels,optimizer,'cuda',epoch,c,
            cursor,metric_state,save_progress,reporter).compute()
        train_seconds=time.monotonic()-begin
        val=None;val_seconds=0.
        if c.validation_epoch(epoch):
            stop_check();adapter.set_graph(val_graph);start=time.monotonic()
            event('validation_started',epoch=epoch)
            val=evaluate_one_epoch(model,val_stream.evaluation_ids(epoch),val_graph,adapter,labels,'cuda',c,epoch,reporter)
            val_seconds=time.monotonic()-start
            if val['F1']>best['F1']:
                best=dict(F1=val['F1'],epoch=epoch)
                save_checkpoint(FOLDER/'best.pt',dict(state_dict=model.state_dict(),variant=VARIANT,epoch=epoch,
                    config=asdict(c),plan_sha256=digest(OUT/'plan.json'),code_manifest_sha256=digest(OUT/'code_manifest.json'),
                    feature_schema=read(OUT/'plan.json')['features'],validation=val))
        row=history_row(epoch,train,val,c,train_seconds,val_seconds,bool(cursor));history.append(row)
        write(FOLDER/'history.json',history);write_csv(FOLDER/'epoch_metrics.csv',history)
        checkpoint(epoch+1,0,None)
        if epoch%50==0 or epoch==MAX_EPOCHS:
            save_checkpoint(FOLDER/f'epoch{epoch}.pt',dict(state_dict=model.state_dict(),epoch=epoch,config=asdict(c),
                plan_sha256=digest(OUT/'plan.json'),code_manifest_sha256=digest(OUT/'code_manifest.json')))
        estimate=eta(history,c);write(FOLDER/'eta.json',estimate)
        event('epoch_complete',best_epoch=best['epoch'],eta=estimate,**row)
        gc.collect()
    write(FOLDER/'complete.json',dict(status='complete',epochs=MAX_EPOCHS,best=best,
        checkpoint_sha256=digest(FOLDER/'best.pt'),plan_sha256=digest(OUT/'plan.json')))
    verify_contract();event('training_complete',epochs=MAX_EPOCHS,best=best)

if __name__=='__main__':
    install_signals()
    try:
        with run_lock(): run()
    except StopRequested as error: event('paused',detail=str(error))
