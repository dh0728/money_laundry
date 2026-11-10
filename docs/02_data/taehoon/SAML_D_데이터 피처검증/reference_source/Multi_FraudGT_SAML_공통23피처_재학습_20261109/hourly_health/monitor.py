"""Read-only local monitoring: minute samples, hourly health reviews."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
HERE=Path(__file__).resolve().parent
import argparse,fcntl,hashlib,json,math,os,signal,statistics,subprocess,sys,time
from datetime import datetime,timezone
from html import escape
sys.path.insert(0,str(ROOT))
from common23_notebook import control
MODEL=control.MODEL
GIB=1024**3
STOP=False

def utc(epoch=None):return datetime.fromtimestamp(time.time() if epoch is None else epoch,timezone.utc).isoformat()
def read(path,default=None):
    try:return json.loads(Path(path).read_text())
    except (OSError,ValueError):return default
def write(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+f'.{os.getpid()}.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n');tmp.replace(path)
def append(path,value):
    with Path(path).open('a') as f:f.write(json.dumps(value,ensure_ascii=False,allow_nan=False)+'\n')
def tail(path,limit=8_000_000):
    path=Path(path)
    if not path.exists():return []
    with path.open('rb') as f:
        size=f.seek(0,2);f.seek(max(0,size-limit))
        if size>limit:f.readline()
        lines=f.read().decode(errors='replace').splitlines()
    result=[]
    for line in lines:
        try:result.append(json.loads(line))
        except ValueError:pass
    return result
def timestamp(value):
    try:return datetime.fromisoformat(value).timestamp()
    except (TypeError,ValueError):return None

def process_memory(worker):
    try:
        if control.identity(worker['pid'])!=worker:return None
        values=dict(line.split(':',1) for line in (Path('/proc')/str(worker['pid'])/'status').read_text().splitlines() if ':' in line)
        result=dict(worker,state=values['State'].strip())
        for name in ('VmRSS','RssAnon','RssFile','VmSwap'):
            if name in values:result[name+'_bytes']=int(values[name].split()[0])*1024
        return result
    except (OSError,ValueError,KeyError):return None

def cgroup():
    base=Path('/sys/fs/cgroup');result={}
    for name in ('memory.current','memory.max'):
        try:
            value=(base/name).read_text().strip();result[name]=int(value) if value.isdigit() else None
        except OSError:pass
    for name in ('memory.events','memory.stat'):
        try:result[name]={k:int(v) for k,v in (line.split() for line in (base/name).read_text().splitlines())}
        except (OSError,ValueError):pass
    return result

def sample():
    now=time.time();status=read(ROOT/'status.json',{});live=read(MODEL/'live_progress.json',{})
    progress=read(MODEL/'progress.json',{});active=control.workers();worker=read(ROOT/'worker.json',{})
    stage=worker.get('stage');phase=live.get('phase') if stage=='train' else stage
    memory=[item for item in (process_memory(w) for w in active) if item]
    training=next((w for w in memory if w['command']=='train.py'),None)
    times=[timestamp(status.get('utc'))]
    if stage=='train':times.append(timestamp(live.get('utc')))
    times=[t for t in times if t is not None]
    done=(ROOT/'complete.json').exists()
    pause=read(ROOT/'pause_request.json',{});launch=read(ROOT/'launch.json',{})
    requested_pause=status.get('event') in ('pipeline_paused','paused') or (
        (timestamp(pause.get('utc')) or 0)>=(timestamp(launch.get('started_utc')) or float('inf')))
    state='complete' if done else 'running' if active else 'paused' if requested_pause else 'failed'
    boundary_gpu=None
    if phase=='train' and progress.get('epoch')==live.get('epoch'):
        boundary_gpu={k:progress.get(k) for k in ('gpu_allocated_bytes','gpu_reserved_bytes')}
    return dict(utc=utc(now),time=now,state=state,stage=stage,phase=phase,status_event=status.get('event'),
        epoch=live.get('epoch'),phase_completed=live.get(phase,{}).get('completed') if stage=='train' else status.get('completed'),
        progress_age_seconds=max(0,now-max(times)) if times else None,workers=memory,training_process=training,
        boundary_gpu=boundary_gpu,gpu=control.gpu(),cgroup=cgroup(),
        train_loss=progress.get('train_loss') if math.isfinite(progress.get('train_loss',0)) else None,
        nonfinite_loss=not math.isfinite(progress.get('train_loss',0)),
        targets_per_second=progress.get('targets_per_second'),
        checkpoint_mtime=(MODEL/'last.pt').stat().st_mtime if (MODEL/'last.pt').exists() else None)

def expected_lr(training,epoch):
    step=epoch-1;warm=training['warmup_epochs'];horizon=training['epochs']
    factor=max(1e-6,step/warm) if step<warm else max(0.,.5*(1+math.cos(math.pi*(step-warm)/(horizon-warm))))
    return training['base_lr']*factor

def check_checkpoint():
    path=MODEL/'last.pt'
    if not path.exists():return dict(status='not_available')
    # Loading in a short-lived CPU subprocess avoids retaining Torch in the daemon.
    script='''import io,json,sys,torch
from pathlib import Path
raw=Path(sys.argv[1]).read_bytes()
s=torch.load(io.BytesIO(raw),map_location='cpu',weights_only=False)
finite=all(bool(torch.isfinite(v).all()) for v in s['model'].values())
for state in s['optimizer']['state'].values():
 for value in state.values():
  if torch.is_tensor(value):finite=finite and bool(torch.isfinite(value).all())
print(json.dumps(dict(epoch=s['epoch'],loader_cursor=s['loader_cursor'],
 learning_rates=[g['lr'] for g in s['optimizer']['param_groups']],
 tensors_finite=finite,plan_sha256=s['plan_sha256'],code_manifest_sha256=s['code_manifest_sha256'])))
'''
    try:
        proc=subprocess.run([sys.executable,'-c',script,str(path)],capture_output=True,text=True,timeout=45,
            env={**os.environ,'OMP_NUM_THREADS':'1','MKL_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1'})
        if proc.returncode!=0:return dict(status='read_error',detail=proc.stderr[-1200:])
        result=json.loads(proc.stdout);training=read(ROOT/'plan.json')['training']
        # A cursor=0 checkpoint after an epoch still holds that completed epoch's LR.
        lr_epoch=result['epoch'] if result['loader_cursor'] else max(1,result['epoch']-1)
        expected=expected_lr(training,lr_epoch)
        result.update(status='checked',learning_rate_epoch=lr_epoch,expected_learning_rate=expected,
            schedule_matches=all(math.isclose(v,expected,rel_tol=1e-10,abs_tol=1e-14) for v in result['learning_rates']),
            plan_matches=result['plan_sha256']==hashlib.sha256((ROOT/'plan.json').read_bytes()).hexdigest(),
            manifest_matches=result['code_manifest_sha256']==hashlib.sha256((ROOT/'code_manifest.json').read_bytes()).hexdigest())
        return result
    except (OSError,ValueError,subprocess.TimeoutExpired) as error:return dict(status='read_error',detail=str(error))

def timing(history,field,width=10):
    values=[r[field] for r in history if r.get(field,0)>0 and not r.get('resumed_partial_epoch')]
    recent=values[-width:];previous=values[-2*width:-width]
    a=statistics.median(recent) if recent else None;b=statistics.median(previous) if previous else None
    return dict(recent_samples=len(recent),previous_samples=len(previous),recent_median_seconds=a,
        previous_median_seconds=b,slowdown_ratio=a/b if a and b else None,
        slowdown_suspected=len(recent)>=5 and len(previous)>=5 and a>b*1.30)

def growth(points,absolute_floor,relative_floor):
    points=sorted(points);n=len(points)
    if n<8 or points[-1][0]-points[0][0]<1200:return dict(status='collecting',samples=n,suspected=False)
    width=n//3;parts=[points[:width],points[width:2*width],points[2*width:]]
    medians=[statistics.median(v for _,v in part) for part in parts]
    delta=medians[-1]-medians[0];ratio=delta/max(1,medians[0])
    rising=medians[0]<medians[1]<medians[2]
    return dict(status='checked',samples=n,window_seconds=points[-1][0]-points[0][0],
        first_median_bytes=medians[0],middle_median_bytes=medians[1],last_median_bytes=medians[2],
        delta_bytes=delta,relative_increase=ratio,suspected=rising and delta>=absolute_floor and ratio>=relative_floor)

def assess(current,samples,history,checkpoint,events,previous,policy):
    issues=[];now=current['time']
    def issue(level,code,message):issues.append(dict(level=level,code=code,message=message))
    if checkpoint.get('status')=='checked':
        if not checkpoint['schedule_matches']:issue('critical','learning_rate_mismatch','저장된 optimizer 학습률이 고정 스케줄과 다릅니다.')
        if not checkpoint['tensors_finite']:issue('critical','nonfinite_checkpoint','체크포인트 가중치 또는 optimizer 상태에 NaN/Inf가 있습니다.')
        if not checkpoint['plan_matches'] or not checkpoint['manifest_matches']:issue('critical','checkpoint_contract_mismatch','체크포인트의 실험 조건 식별자가 다릅니다.')
    elif current['stage']=='train':issue('warning','checkpoint_unavailable','학습률을 체크포인트에서 확인하지 못했습니다.')
    if current['nonfinite_loss']:issue('critical','nonfinite_loss','저장된 학습 손실에 NaN/Inf가 있습니다.')
    old_cgroup=previous.get('sample',{}).get('cgroup',{}).get('memory.events',{})
    new_cgroup=current['cgroup'].get('memory.events',{})
    oom_delta={key:max(0,new_cgroup[key]-old_cgroup[key]) if key in old_cgroup and key in new_cgroup else None for key in ('oom','oom_kill')}
    if any(v is not None and v>0 for v in oom_delta.values()):issue('critical','new_oom','이전 점검 이후 cgroup OOM 또는 OOM kill이 발생했습니다.')
    if current['state']=='failed':issue('critical','pipeline_failed','학습·평가 파이프라인이 오류로 중단됐습니다.')
    age=current['progress_age_seconds']
    if current['state']=='running' and age is not None and age>policy['stale_progress_seconds']:
        issue('warning','stale_progress',f'최근 진행 기록이 {age/60:.1f}분 동안 갱신되지 않았습니다.')
    speed={phase:timing(history,phase+'_seconds') for phase in ('train','validation')}
    for phase,value in speed.items():
        if value['slowdown_suspected']:issue('warning','slow_'+phase,f'{phase} 최근 에폭 처리 시간이 이전 구간보다 30% 이상 증가했습니다.')
    worker=current.get('training_process');cpu=[]
    if worker:
        for s in samples:
            p=s.get('training_process')
            if p and (p['pid'],p['start_ticks'],s.get('phase'))==(worker['pid'],worker['start_ticks'],'train') and now-s['time']<=3600:
                cpu.append((s['time'],p['RssAnon_bytes']))
    cpu_growth=growth(cpu,policy['cpu_growth_bytes'],policy['cpu_growth_fraction'])
    # Check same process, same training stage, post-update allocation from logs;
    # reserved CUDA pool size and memory-mapped files alone do not imply a leak.
    gpu_points=[]
    if worker:
        for item in events:
            t=timestamp(item.get('utc'));v=item.get('gpu_allocated_bytes')
            if t and now-t<=3600 and item.get('event')=='training_progress' and item.get('pid')==worker['pid'] and v is not None:
                gpu_points.append((t,v))
    gpu_growth=growth(gpu_points,policy['gpu_growth_bytes'],policy['gpu_growth_fraction'])
    if cpu_growth['suspected']:issue('warning','cpu_memory_growth','동일 프로세스·학습 단계의 CPU 익명 메모리가 지속 증가합니다. 누수 의심 추세이며 원인 확인이 필요합니다.')
    if gpu_growth['suspected']:issue('warning','gpu_memory_growth','학습 업데이트 후 GPU 할당 메모리가 지속 증가합니다. 누수 의심 추세이며 원인 확인이 필요합니다.')
    if any(i['level']=='critical' for i in issues):state='critical'
    elif issues:state='warning'
    elif cpu_growth['status']=='collecting' and current['state']=='running':state='baseline'
    else:state='ok'
    return dict(state=state,issues=issues,speed=speed,cpu_anonymous_growth=cpu_growth,
        gpu_committed_allocation_growth=gpu_growth,oom_since_previous_check=oom_delta,
        interpretation='파일 캐시·CUDA 예약 메모리·순간 GPU 사용률만으로 누수나 속도 이상을 판정하지 않습니다. 증가 추세는 누수 확정이 아닙니다.')

def render_report(report):
    a=report['assessment'];s=report['sample'];cp=report['checkpoint'];names={'ok':'이상 징후 없음','baseline':'초기 기준 수집 중','warning':'확인 필요','critical':'이상 감지'}
    rows=[]
    def row(k,v):rows.append(f'<tr><th>{escape(k)}</th><td>{escape(str(v))}</td></tr>')
    row('점검 시각',report['utc']);row('판정',names[a['state']]);row('다음 정기 점검',report.get('next_review_utc') or '최종 점검')
    row('현재 단계',f"{s['stage']} / {s['phase']} / epoch {s['epoch']}")
    row('실제 학습률',cp.get('learning_rates',cp.get('status')));row('계획 학습률',cp.get('expected_learning_rate'))
    row('스케줄 일치',cp.get('schedule_matches'));row('GPU',s['gpu'])
    p=s.get('training_process')
    if p:row('학습 프로세스 CPU 메모리',f"익명 {p.get('RssAnon_bytes',0)/GIB:.2f} GiB · 파일 매핑 {p.get('RssFile_bytes',0)/GIB:.2f} GiB")
    for phase,v in a['speed'].items():
        row(phase+' 최근 중앙값(초)',v['recent_median_seconds']);row(phase+' 이전 대비 시간 비율',v['slowdown_ratio'])
    row('CPU 익명 메모리 추세',a['cpu_anonymous_growth']);row('GPU 업데이트 후 할당 추세',a['gpu_committed_allocation_growth'])
    row('새 OOM 기록',a['oom_since_previous_check'])
    issues=''.join('<li>'+escape(i['message'])+'</li>' for i in a['issues']) or '<li>현재 감지된 이상 징후가 없습니다. 추세 수집 중인 항목은 다음 점검에서 다시 판단합니다.</li>'
    return '<!doctype html><html lang="ko"><meta charset="utf-8"><title>시간별 학습 상태 점검</title><style>body{font-family:sans-serif;max-width:1100px;margin:35px auto;line-height:1.7}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:9px;text-align:left;overflow-wrap:anywhere}th{width:230px}</style><h1>Multi-FraudGT 공통 23종 · 시간별 점검</h1><ul>'+issues+'</ul><table>'+''.join(rows)+'</table><p>'+escape(a['interpretation'])+'</p><p>1분마다 상태를 수집하고, 1시간마다 optimizer 학습률·메모리 추세·속도를 점검합니다. 이 프로세스는 학습 설정·가중치·실행 상태를 변경하지 않습니다.</p></html>'

def review(current,next_review=None,label='hourly'):
    policy=read(HERE/'config.json');history=read(MODEL/'history.json',[])
    previous=read(HERE/'latest.json',{});checkpoint=check_checkpoint()
    result=dict(utc=utc(),label=label,sample=current,checkpoint=checkpoint,next_review_utc=utc(next_review) if next_review else None)
    result['assessment']=assess(current,tail(HERE/'samples.jsonl'),history,checkpoint,tail(ROOT/'events.jsonl'),previous,policy)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    write(HERE/'reports'/f'{stamp}.json',result);write(HERE/'latest.json',result);append(HERE/'reviews.jsonl',result)
    text=render_report(result);tmp=HERE/'latest.tmp.html';tmp.write_text(text);tmp.replace(HERE/'latest.html')
    print(json.dumps(dict(utc=result['utc'],state=result['assessment']['state'],label=label,
        issues=result['assessment']['issues'],epoch=current['epoch']),ensure_ascii=False),flush=True)
    return result

def daemon():
    global STOP
    def stop(*unused):
        global STOP
        STOP=True
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    with (HERE/'daemon.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        config=read(HERE/'config.json');interval=config['review_interval_seconds'];sample_interval=config['sample_interval_seconds']
        now=time.time();next_sample=now;next_review=config.get('next_review_epoch',now)
        absent_since=None;last_sample=None;reason='stopped'
        while not STOP:
            config=read(HERE/'config.json',{})
            if not config.get('enabled',False):reason='disabled';break
            now=time.time()
            if now>=next_sample:
                try:
                    last_sample=sample();append(HERE/'samples.jsonl',last_sample);write(HERE/'latest_sample.json',last_sample)
                    if last_sample['state']=='complete':
                        review(last_sample,label='complete');reason='experiment_complete';break
                    if not last_sample['workers']:
                        absent_since=absent_since or now
                        if now-absent_since>=config['stop_after_no_workers_seconds']:
                            review(last_sample,label='worker_stopped');reason='worker_stopped';break
                    else:absent_since=None
                except Exception as error:
                    append(HERE/'errors.jsonl',dict(utc=utc(),error_type=type(error).__name__,detail=str(error)))
                next_sample=now+sample_interval
            if now>=next_review and last_sample:
                try:
                    due=next_review
                    while next_review<=now:next_review+=interval
                    review(last_sample,next_review,label='initial' if not (HERE/'latest.json').exists() else 'hourly')
                    config['next_review_epoch']=next_review;write(HERE/'config.json',config)
                except Exception as error:
                    append(HERE/'errors.jsonl',dict(utc=utc(),error_type=type(error).__name__,detail=str(error)))
                    next_review=time.time()+60
            write(HERE/'daemon_status.json',dict(pid=os.getpid(),status='running',heartbeat_utc=utc(),
                next_review_utc=utc(next_review),sample_interval_seconds=sample_interval,review_interval_seconds=interval,
                last_sample_utc=last_sample['utc'] if last_sample else None))
            time.sleep(min(5,max(.1,min(next_sample,next_review)-time.time())))
        write(HERE/'daemon_status.json',dict(pid=os.getpid(),status='stopped',reason=reason,heartbeat_utc=utc()))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['daemon','once']);args=parser.parse_args()
    if args.command=='daemon':daemon()
    else:
        s=sample();append(HERE/'samples.jsonl',s);review(s,label='manual')
