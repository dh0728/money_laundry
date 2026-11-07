"""CLI entry point; imports happen after work directory/run name are selected."""
import argparse
import json
import os
from pathlib import Path


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--work-dir',default='work')
    p.add_argument('--run-name',default='shared_seed42')
    sub=p.add_subparsers(dest='command',required=True)
    sub.add_parser('environment')
    c=sub.add_parser('connect');c.add_argument('--project',required=True);c.add_argument('--labels-root',required=True)
    c=sub.add_parser('prepare');c.add_argument('--config',default='configs/shared_500.json');c.add_argument('--build-graphs',action='store_true')
    c=sub.add_parser('train');c.add_argument('--config',default='configs/shared_500.json');c.add_argument('--variant',required=True)
    c.add_argument('--device',default='cuda',choices=['cuda','cpu']);c.add_argument('--memory-fraction',default=.35,type=float);c.add_argument('--stop-after',type=int)
    c=sub.add_parser('evaluate');c.add_argument('--variant',required=True);c.add_argument('--checkpoint');c.add_argument('--scope',default='test',choices=['val','test'])
    c.add_argument('--device',default='cuda',choices=['cuda','cpu']);c.add_argument('--memory-fraction',default=.35,type=float)
    sub.add_parser('smoke')
    a=p.parse_args();os.environ['FRAUDGT_WORK_DIR']=str(Path(a.work_dir).expanduser().resolve());os.environ['FRAUDGT_RUN_NAME']=a.run_name
    if a.command=='environment':
        from fraudgt_lab.environment import check_backend
        result=check_backend()
    elif a.command=='connect':
        from fraudgt_lab.setup_data import connect_existing
        result=connect_existing(a.project,a.labels_root)
    elif a.command=='smoke':
        from tests.smoke import run_smoke
        result=run_smoke()
    elif a.command=='evaluate':
        from fraudgt_lab.config import VARIANTS
        if a.variant not in VARIANTS:p.error('Unknown variant')
        from fraudgt_lab.evaluation import full_evaluate
        result=full_evaluate(a.variant,a.checkpoint,a.scope,a.device,a.memory_fraction)
    else:
        from fraudgt_lab.config import TrainConfig,VARIANTS
        from fraudgt_lab.runtime import prepare,lock,Progress
        from fraudgt_lab import RUN_ROOT
        config=TrainConfig(**json.loads(Path(a.config).read_text()))
        if a.command=='prepare':
            with lock(RUN_ROOT/'contract.lock'):result=prepare(config,a.build_graphs)
        else:
            if a.variant not in VARIANTS:p.error('Unknown variant')
            if a.stop_after is not None and not 1<=a.stop_after<=config.epochs:p.error('stop-after must be within the schedule')
            from fraudgt_lab.environment import check_backend
            from fraudgt_lab.training import run_variant
            check_backend()
            with lock(RUN_ROOT/'run.lock'):
                with lock(RUN_ROOT/'contract.lock'):prepare(config)
                progress=Progress()
                try:result=run_variant(config,a.variant,on_progress=progress,device_name=a.device,memory_fraction=a.memory_fraction,stop_after=a.stop_after)
                finally:progress.close()
    print(json.dumps(result,ensure_ascii=False,indent=2,default=str),flush=True)


if __name__=='__main__':main()
