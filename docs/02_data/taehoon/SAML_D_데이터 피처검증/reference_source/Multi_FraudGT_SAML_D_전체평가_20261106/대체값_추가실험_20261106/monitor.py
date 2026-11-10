"""Low-overhead resource snapshots while the already-running experiment lives."""
from pathlib import Path
from datetime import datetime,timezone
import json,time,subprocess,psutil
ROOT=Path(__file__).resolve().parent
matches=[]
for p in psutil.process_iter(['pid','cmdline']):
    try:
        if any(str(a).endswith('/대체값_추가실험_20261106/run.sh') for a in (p.info['cmdline'] or [])):
            matches.append(p)
    except psutil.Error:pass
assert len(matches)==1,[(p.pid,p.name()) for p in matches]
root=matches[0];identity=root.create_time()
with (ROOT/'health.jsonl').open('a',buffering=1) as f:
    while root.is_running() and root.create_time()==identity:
        try:
            processes=[root]+root.children(recursive=True)
            rss=sum(p.memory_info().rss for p in processes if p.is_running())
            gpu=subprocess.check_output(['nvidia-smi','--query-gpu=utilization.gpu,memory.used','--format=csv,noheader,nounits'],text=True).strip()
            util,mem=[int(x.strip()) for x in gpu.split(',')]
            status=json.loads((ROOT/'status.json').read_text())
            f.write(json.dumps(dict(utc=datetime.now(timezone.utc).isoformat(),stage=status['stage'],
                completed=status.get('completed'),gpu_utilization=util,gpu_MiB=mem,rss_GiB=rss/1024**3))+'\n')
        except (psutil.Error,FileNotFoundError,ValueError):pass
        time.sleep(15)
