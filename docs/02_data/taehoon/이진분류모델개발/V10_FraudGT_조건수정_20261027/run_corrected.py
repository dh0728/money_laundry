"""Explicit CLI launch; editing notebooks never restarts existing experiments."""
import argparse,traceback

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--mode',choices=['shared','disjoint'],default='shared')
    parser.add_argument('--run-name')
    parser.add_argument('--prepare-only',action='store_true')
    args=parser.parse_args()
    from configure import configure
    configure(args.run_name or f'{args.mode}_corrected_001')
    from fraudgt_lab.config import TrainConfig,VARIANTS
    from fraudgt_lab.training import run_variant,finish_evaluation
    from fraudgt_lab.storage import log
    from corrected_runtime import prepare,run_lock,require_verification
    config=TrainConfig(graph_mode=args.mode)
    with run_lock():
        require_verification();prepare(config)
        if args.prepare_only:return
        try:
            for variant in VARIANTS:run_variant(config,variant)
            finish_evaluation(config)
        except BaseException:
            log('corrected_execution_interrupted',traceback=traceback.format_exc(),checkpoint='last completed optimizer update')
            raise

if __name__=='__main__':main()
