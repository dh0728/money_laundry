"""Notebook display helpers; no model training or file writes."""
import json,time,fcntl
import weakref
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
import numpy as np
import pandas as pd
from matplotlib.figure import Figure
from matplotlib.backends.backend_agg import FigureCanvasAgg
from IPython import get_ipython
from IPython.display import display,HTML,Image

METRIC_COLUMNS=['epoch','train_loss','train_accuracy_at_05','train_precision_at_05',
                'train_recall_at_05','train_F1','train_unmatched_recall_at_05','train_AP',
                'val_loss','val_accuracy_at_05',
                'val_precision_at_05','val_recall_at_05','val_F1','val_unmatched_recall_at_05','val_AP',
                'train_coverage','val_coverage','val_missing_positive',
                'val_requested_recall_lower_bound','validation_performed','learning_rate']

def read_result_json(path,default=None):
    try:return json.loads(Path(path).read_text())
    except (FileNotFoundError,json.JSONDecodeError):return default


def training_is_active(run_dir):
    path=Path(run_dir)/'run.lock'
    if not path.exists():return False
    with path.open('rb') as handle:
        try:fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return True
        fcntl.flock(handle,fcntl.LOCK_UN);return False


def progress_bar_html(live,config,variant,active):
    from html import escape
    epoch=live.get('epoch',1);phase=live.get('phase','대기')
    text='실행 중' if active else '저장된 기록 · 현재 실행 중 아님'
    out=f'<div style="padding:18px;border:1px solid #ddd;border-radius:10px;font-family:system-ui"><b>{escape(variant)} · Epoch {epoch}/{config.epochs}</b><p>{text}</p>'
    for key,label,color in [('train','Train','#3478f6'),('validation','Validation','#ef922d')]:
        value=live.get(key,{})
        out+='<div style="min-height:85px">'
        if key=='validation' and not value.get('scheduled',config.validation_epoch(epoch)):
            out+='<p><b>Validation: 이번 epoch는 공식 검증 주기가 아닙니다.</b></p></div>';continue
        done=int(value.get('completed',0));total=int(value.get('total',config.seed_batch*(config.iterations_per_epoch if key=='train' else config.validation_batches)))
        total=max(1,total);percent=100*done/total
        scored=value.get('scored');scored_text=f' · 실제 판정 {scored:,}건' if scored is not None else ''
        loss=value.get('loss');loss_text=f' · loss {loss:.5f}' if loss is not None else ''
        out+=f'<p><b>{label}</b> {done:,}/{total:,}건 · {percent:.2f}%{scored_text}{loss_text}</p><progress value="{done}" max="{total}" style="width:100%;height:22px;accent-color:{color}"></progress></div>'
    return out+'</div>'


def learning_figure(history,variant,live=None):
    # A pyplot figure is retained by Jupyter's inline display queue until the
    # training cell ends, even after plt.close(). Render without that manager.
    fig=Figure(figsize=(14,8));FigureCanvasAgg(fig)
    axes=fig.subplots(2,2);frame=pd.DataFrame(history)
    fig.suptitle(variant+' | official scored-target metrics')
    if len(frame):
        axes[0,0].plot(frame.epoch,frame.train_loss,label='Train loss')
        valid=frame[frame.validation_performed]
        if len(valid):
            axes[0,0].plot(valid.epoch,valid.val_loss,'o-',label='Validation loss')
            for col,label in [('val_precision_at_05','Precision'),('val_recall_at_05','Recall'),('val_F1','F1')]:
                axes[0,1].plot(valid.epoch,valid[col],'o-',label=label)
            axes[1,0].plot(valid.epoch,valid.val_unmatched_recall_at_05,'o-',label='Unmatched recall')
            axes[1,0].plot(valid.epoch,valid.val_recall_at_05,'o-',label='All positive recall')
            axes[1,1].plot(valid.epoch,valid.val_AP,'o-',label='AP')
            axes[1,1].plot(valid.epoch,valid.val_coverage,'o--',label='Scored / requested targets')
    if live and live.get('train',{}).get('loss') is not None:
        t=live['train'];x=live['epoch']-1+t['completed']/max(t['total'],1)
        axes[0,0].plot([x],[t['loss']],'x',label='Current training mean')
    for axis,title in zip(axes.flat,['Loss','Validation P / R / F1','Positive-group recall','AP and coverage']):
        axis.set_title(title);axis.set_xlabel('Epoch');axis.grid(alpha=.25)
        if axis.get_legend_handles_labels()[0]:axis.legend(fontsize=9)
    for axis in [axes[0,1],axes[1,0],axes[1,1]]:axis.set_ylim(0,1.03)
    fig.tight_layout();return fig


class PersistentOutputs:
    """Update individual output slots; recreate them after a clear or cell rerun."""

    def __init__(self):
        self.handles = {}
        self.signatures = {}
        self.execution_id = None
        self.shell = get_ipython()
        publisher = getattr(self.shell, 'display_pub', None)
        if hasattr(publisher, 'register_hook'):
            reference = weakref.ref(self)

            def observe_clear(message):
                state = reference()
                if (state is not None
                        and message.get('header', {}).get('msg_type') == 'clear_output'
                        and message.get('parent_header', {}).get('msg_id') == state.execution_id):
                    state.reset()
                return message

            publisher.register_hook(observe_clear)
            weakref.finalize(self, publisher.unregister_hook, observe_clear)

    def reset(self):
        self.handles.clear()
        self.signatures.clear()

    def update(self, name, value, signature):
        parent = self.shell.get_parent() if hasattr(self.shell, 'get_parent') else {}
        execution_id = parent.get('header', parent).get('msg_id')
        if execution_id != self.execution_id:
            self.reset()
            self.execution_id = execution_id
        if name in self.signatures and signature == self.signatures[name]:
            return
        handle = self.handles.get(name)
        if handle is None:
            self.handles[name] = display(value, display_id=True)
        else:
            handle.update(value)
        self.signatures[name] = signature


class LiveTrainingDisplay:
    def __init__(self,run_dir,config,variants,chart_refresh_seconds=15):
        self.run_dir=Path(run_dir);self.config=config;self.variants=variants
        self.signature=None;self.history_signature=None
        self.figure=None;self.table=None
        self.chart_refresh_seconds=chart_refresh_seconds;self.last_chart_refresh=0.0
        self.outputs=PersistentOutputs()
    def refresh(self):
        active=training_is_active(self.run_dir);status=read_result_json(self.run_dir/'current_status.json',{})
        variant=status.get('variant',self.variants[0]);variant=variant if variant in self.variants else self.variants[0]
        folder=self.run_dir/'models'/variant;history=read_result_json(folder/'history.json',[])
        live=read_result_json(folder/'live_progress.json',{})
        gauge=progress_bar_html(live,self.config,variant,active)
        history_signature=json.dumps([variant,history],sort_keys=True)
        history_changed=history_signature!=self.history_signature
        signature=json.dumps([variant,history,live.get('train'),live.get('epoch')],sort_keys=True)
        now=time.monotonic()
        if (self.figure is None or history_changed or
                (signature!=self.signature and now-self.last_chart_refresh>=self.chart_refresh_seconds)):
            figure=learning_figure(history,variant,live)
            with BytesIO() as buffer:
                figure.savefig(buffer,format='png',dpi=100)
                self.figure=Image(data=buffer.getvalue(),format='png',width=1000)
            self.signature=signature;self.last_chart_refresh=now
        if history_changed:
            frame=pd.DataFrame(history[-10:]).reindex(columns=METRIC_COLUMNS)
            self.table=HTML('<div style="overflow:auto;height:300px">'+frame.to_html(index=False,na_rep='—',float_format=lambda v:f'{v:.5f}')+'</div>')
            self.history_signature=history_signature
        eta=read_result_json(folder/'eta.json',{})
        messages=[]
        if eta.get('remaining_hours') is not None:messages.append(f"현재 모델 남은 시간 약 {eta['remaining_hours']:.1f}시간 · 예상 완료(UTC): {eta['estimated_finish_utc']}")
        if not history and not active:messages.append('수정 조건의 새 실행 기록이 없습니다. 직접 학습하려면 RUN_TRAINING=True로 설정하세요.')
        # Keep the output area in place and send only changed components.
        self.outputs.update('gauge',HTML(gauge),gauge)
        self.outputs.update('figure',self.figure,self.signature)
        self.outputs.update('table',self.table,self.history_signature)
        message_html='<div style="min-height:28px">'+'<br>'.join(messages)+'</div>'
        self.outputs.update('messages',HTML(message_html),message_html)
        return active


def follow_training(run_dir,config,variants,refresh_seconds=2,max_updates=None):
    viewer=LiveTrainingDisplay(run_dir,config,variants);count=0
    try:
        while True:
            active=viewer.refresh();count+=1
            if not active or (max_updates is not None and count>=max_updates):break
            time.sleep(max(1,min(refresh_seconds,60)))
    except KeyboardInterrupt:print('조회 셀을 종료했습니다. 별도 프로세스의 학습 상태는 그대로입니다.')
    return viewer


def show_saved_training(run_dir,follow=False,refresh_seconds=2,max_updates=None):
    """Read progress files without importing Torch, loading models or training."""
    run_dir=Path(run_dir)
    protocol=read_result_json(run_dir/'protocol.json',{})
    settings={'epochs':500,'seed_batch':2048,'iterations_per_epoch':256,
              'validation_batches':256,'eval_period':4,'extra_epoch_validation':False}
    settings.update(protocol.get('training',{}))
    config=SimpleNamespace(**settings)
    config.validation_epoch=lambda epoch:(config.extra_epoch_validation or epoch==1
        or epoch%config.eval_period==0 or epoch==config.epochs)
    variants=protocol.get('variants',['fraudgt_format','pe_fraudgt_format','multi_fraudgt_format'])
    if follow:
        return follow_training(run_dir,config,variants,refresh_seconds,max_updates)
    viewer=LiveTrainingDisplay(run_dir,config,variants)
    viewer.refresh()
    return viewer
