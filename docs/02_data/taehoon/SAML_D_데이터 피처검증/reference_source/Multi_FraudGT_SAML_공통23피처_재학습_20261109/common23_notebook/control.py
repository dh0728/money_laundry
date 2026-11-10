"""Read live artifacts and safely attach/start/stop only this experiment."""
from pathlib import Path
from datetime import datetime,timezone
import fcntl,json,os,signal,subprocess,sys,time
ROOT=Path(__file__).resolve().parents[1]
RUN=ROOT/'runs/common23_001'
MODEL=RUN/'models/multi_fraudgt_format'
SALT=ROOT.parent/'SALT_GNN_직접공유샘플링_20261104'
COMMANDS=('run_pipeline.py','preflight.py','train.py','evaluate.py','report.py')
_GPU={'at':0.,'value':{}}

def read(path,default=None):
    try:return json.loads(Path(path).read_text())
    except FileNotFoundError:return default

def identity(pid):
    try:
        p=Path('/proc')/str(int(pid));stat=(p/'stat').read_text().split(') ',1)[1].split()
        if stat[0]=='Z' or (p/'cwd').resolve()!=ROOT:return None
        argv=(p/'cmdline').read_bytes().decode().split('\0')
        for name in COMMANDS:
            if name in argv or str(ROOT/name) in argv:
                return dict(pid=int(pid),start_ticks=int(stat[19]),command=name)
    except (OSError,ValueError,TypeError,UnicodeDecodeError):pass
    return None

def workers():
    result=[]
    for p in Path('/proc').iterdir():
        if p.name.isdigit():
            item=identity(p.name)
            if item:result.append(item)
    return result

def held(path):
    if not Path(path).exists():return False
    with Path(path).open('r') as f:
        try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return True
        fcntl.flock(f,fcntl.LOCK_UN)
    return False

def write(path,value):
    temporary=path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');temporary.replace(path)

def start_or_attach():
    with (ROOT/'launch.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if (ROOT/'complete.json').exists():return dict(mode='complete',message='전체 실험 완료')
        active=workers()
        if active or held(ROOT/'pipeline.lock') or held(ROOT/'run.lock'):
            return dict(mode='attached',workers=active,message='현재 실행에 연결했습니다.')
        if held(SALT/'runs/daily_close_001/run.lock'):
            raise RuntimeError('SALT가 실행 중입니다. 먼저 SALT를 중단해야 합니다.')
        with (ROOT/'run.log').open('ab') as output:
            child=subprocess.Popen([sys.executable,'-u',str(ROOT/'run_pipeline.py')],cwd=ROOT,
                stdin=subprocess.DEVNULL,stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
        for _ in range(30):
            if child.poll() is not None:raise RuntimeError('실행이 종료됐습니다. run.log를 확인하세요.')
            item=identity(child.pid)
            if item:
                write(ROOT/'launch.json',dict(**item,started_utc=datetime.now(timezone.utc).isoformat()))
                return dict(mode='started',worker=item,message='저장 지점부터 실행을 시작했습니다.')
            time.sleep(.1)
        raise RuntimeError('프로세스 확인 중입니다. 중복 시작하지 말고 현재 상태를 확인하세요.')

def request_stop():
    active=workers()
    if not active:return '이미 중단된 상태입니다.'
    parent=next((w for w in active if w['command']=='run_pipeline.py'),None)
    targets=[parent] if parent else active
    for item in targets:
        if identity(item['pid'])==item:os.kill(item['pid'],signal.SIGTERM)
    write(ROOT/'pause_request.json',dict(utc=datetime.now(timezone.utc).isoformat(),workers=active))
    return '중단 요청을 보냈습니다. 학습은 8배치 누적 업데이트·저장 후, 평가는 저장 구간 완료 후 멈춥니다.'

def gpu():
    now=time.monotonic()
    if now-_GPU['at']<5:return _GPU['value']
    try:
        text=subprocess.check_output(['nvidia-smi','--query-gpu=utilization.gpu,memory.used,memory.total',
            '--format=csv,noheader,nounits'],text=True,timeout=2).strip().splitlines()[0]
        usage,used,total=map(int,text.split(','));value=dict(usage=usage,used_mib=used,total_mib=total)
    except (OSError,subprocess.SubprocessError,ValueError,IndexError):value={}
    _GPU.update(at=now,value=value);return value

def recent_evaluations():
    path=ROOT/'events.jsonl';result={}
    if not path.exists():return result
    with path.open('rb') as f:
        size=f.seek(0,2);f.seek(max(0,size-256000))
        if size>256000:f.readline()
        for line in f.read().decode().splitlines():
            try:
                item=json.loads(line)
                if item.get('event')=='evaluation_progress':result[item['scope']]=item
            except json.JSONDecodeError:continue
    return result

def snapshot():
    active=workers();status=read(ROOT/'status.json',{});history=read(MODEL/'history.json',[])
    live=read(MODEL/'live_progress.json',{});progress=read(MODEL/'progress.json',{})
    completed=max((h['epoch'] for h in history),default=0)
    pause=read(ROOT/'pause_request.json',{}).get('workers',[])
    if (ROOT/'complete.json').exists():state='complete'
    elif active:
        state='stopping' if any(w in pause for w in active) else 'running'
    else:state='failed' if status.get('event')=='pipeline_failed' else 'paused'
    evaluations={};recent=recent_evaluations() if active else {}
    for scope,total in [('hi_test',33429507),('saml',9504852)]:
        folder=ROOT/'evaluation'/scope;done=read(folder/'complete.json',{})
        if done:amount=done['scored']
        else:
            chunks=sorted((folder/'chunks').glob('*.json'))
            amount=read(chunks[-1],{}).get('stop',0) if chunks else 0
            amount=max(amount,recent.get(scope,{}).get('completed',0))
        evaluations[scope]=dict(done=min(amount,total),total=total,complete=bool(done))
    value=dict(state=state,workers=active,status=status,stage=read(ROOT/'worker.json',{}).get('stage'),
        completed_epochs=completed,epochs=284,live=live,progress=progress,
        eta=read(MODEL/'eta.json',{}),history=history,evaluations=evaluations,gpu=gpu(),
        now_utc=datetime.now(timezone.utc).isoformat(),
        health=read(ROOT/'hourly_health/latest.json',{}),
        health_monitor=read(ROOT/'hourly_health/daemon_status.json',{}))
    return value
