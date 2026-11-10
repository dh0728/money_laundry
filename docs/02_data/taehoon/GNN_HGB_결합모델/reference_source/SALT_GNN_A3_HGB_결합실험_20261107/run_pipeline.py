"""Sequential detached runner; never resumes the paused ablation training."""
from experiment import *
import fcntl,subprocess

def main():
    with (OUT/'experiment.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        check_frozen()
        steps=[('prepare_complete.json',['prepare.py']),
               ('salt_complete.json',['score_salt.py']),
               ('hgb_scores/fusion_fit/complete.json',['score_hgb.py','fusion_fit']),
               ('hgb_scores/validation/complete.json',['score_hgb.py','validation']),
               ('frozen_validation.json',['combine.py','fit_validation']),
               ('hgb_scores/test/complete.json',['score_hgb.py','test']),
               ('complete.json',['combine.py','test'])]
        for marker,args in steps:
            if (OUT/marker).exists():continue
            log('pipeline_stage_started',command=args,pid=os.getpid())
            subprocess.run([sys.executable,'-u',*args],cwd=OUT,check=True)
            assert (OUT/marker).exists(),marker
        check_frozen()

if __name__=='__main__':
    try:main()
    except BaseException as exc:
        log('pipeline_stopped',error_type=type(exc).__name__,detail=str(exc));raise
