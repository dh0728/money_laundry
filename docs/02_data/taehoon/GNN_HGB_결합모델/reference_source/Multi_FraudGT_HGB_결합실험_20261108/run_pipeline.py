from pathlib import Path
import subprocess, sys, os, fcntl
ROOT=Path(__file__).resolve().parent

def main():
    with (ROOT/'run.lock').open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        (ROOT/'pipeline.pid').write_text(str(os.getpid())+'\n')
        steps=[]
        if not (ROOT/'plan.json').exists():steps.append(['experiment.py'])
        if not all((ROOT/'gnn_scores'/s/'complete.json').exists() for s in ('fusion_fit','validation')):steps.append(['score_multi.py'])
        if not (ROOT/'frozen_validation.json').exists():steps.append(['combine.py','fit_validation'])
        if not (ROOT/'complete.json').exists():steps.append(['combine.py','test'])
        for step in steps:subprocess.run([sys.executable,'-u',*step],cwd=ROOT,check=True)
        subprocess.run([sys.executable,'-u','report.py'],cwd=ROOT,check=True)

if __name__=='__main__':main()
