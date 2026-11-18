"""Finite resumable sequence: checks -> training -> HI test -> SAML test -> report."""
from experiment import *
import experiment as e
import subprocess,time,traceback

def main():
    verify_contract()
    with (OUT/'pipeline.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        child=None
        def stop(*unused):
            request_stop()
            if child is not None and child.poll() is None:child.send_signal(signal.SIGTERM)
        signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
        stages=[('preflight',['preflight.py'],OUT/'preflight.json'),
            ('train',['train.py'],RUN/'models'/VARIANT/'complete.json'),
            ('hi_test',['evaluate.py','hi_test'],OUT/'evaluation/hi_test/complete.json'),
            ('saml',['evaluate.py','saml'],OUT/'evaluation/saml/complete.json'),
            ('report',['report.py'],OUT/'complete.json')]
        for name,args,marker in stages:
            if e.STOP:break
            verify_contract()
            if marker.exists():continue
            event('pipeline_stage',stage=name)
            child=subprocess.Popen([sys.executable,'-u',*args],cwd=OUT)
            write(OUT/'worker.json',dict(pipeline_pid=os.getpid(),child_pid=child.pid,stage=name,utc=utc()))
            rc=child.wait()
            if e.STOP:break
            if rc!=0 or not marker.exists():raise RuntimeError(f'{name} did not complete (exit={rc}); inspect run.log')
        if e.STOP:event('pipeline_paused')
        else:event('pipeline_complete')

if __name__=='__main__':
    try:main()
    except Exception as error:
        event('pipeline_failed',error_type=type(error).__name__,detail=str(error))
        traceback.print_exc();raise
