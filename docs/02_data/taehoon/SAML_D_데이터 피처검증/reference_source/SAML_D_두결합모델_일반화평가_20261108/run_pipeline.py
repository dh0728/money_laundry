from pathlib import Path
import sys,subprocess,os,fcntl
ROOT=Path(__file__).resolve().parent

def main():
    with (ROOT/'run.lock').open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);(ROOT/'pipeline.pid').write_text(str(os.getpid())+'\n')
        if not (ROOT/'plan.json').exists():subprocess.run([sys.executable,'-u','experiment.py'],cwd=ROOT,check=True)
        children=[]
        for script,name in [('score_hgb.py','HGB'),('score_salt.py','A3')]:
            if not (ROOT/'scores'/name/'complete.json').exists():
                log=(ROOT/(name+'_run.log')).open('a')
                child=subprocess.Popen([sys.executable,'-u',script],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
                children.append((child,log,script))
        errors=[]
        for child,log,script in children:
            code=child.wait();log.close()
            if code:errors.append((script,code))
        if errors:raise RuntimeError(f'Inference failed; preserve completed scores and inspect logs: {errors}')
        if not (ROOT/'complete.json').exists():subprocess.run([sys.executable,'-u','evaluate.py'],cwd=ROOT,check=True)

if __name__=='__main__':main()
