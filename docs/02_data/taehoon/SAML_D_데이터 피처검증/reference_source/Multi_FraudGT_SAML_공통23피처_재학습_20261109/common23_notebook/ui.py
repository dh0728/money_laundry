"""One persistent display, refreshed by the existing notebook event loop."""
import asyncio
from datetime import datetime,timezone
from html import escape
from . import control
_ACTIVE=globals().get('_ACTIVE')

def bar(label,done,total,note='',color='#2563eb'):
    done=max(0,min(float(done),float(total)));pct=100*done/total if total else 0.
    number=f'{done:,.0f} / {total:,.0f}'
    return f'''<div style="margin:16px 0"><div style="display:flex;justify-content:space-between;gap:12px"><b>{escape(label)}</b><span>{number} · <b>{pct:.2f}%</b></span></div><progress max="{total}" value="{done}" style="width:100%;height:22px;accent-color:{color}"></progress><small style="color:#526078">{escape(note)}</small></div>'''

def render(value):
    names={'running':'실행 중','stopping':'체크포인트 저장 후 중단 중','paused':'일시중단','failed':'오류로 중단','complete':'전체 완료'}
    stages={'preflight':'입력·계산 검증','train':'HI-Large 재학습','hi_test':'HI 전체 Test','saml':'SAML-D 전체 Test','report':'결과 정리'}
    state=names[value['state']];live=value['live'];epoch=live.get('epoch',1);train=live.get('train',{});val=live.get('validation',{})
    times=[v.get('utc') for v in (live,value['status']) if v.get('utc')]
    age=max(0,(datetime.now(timezone.utc)-datetime.fromisoformat(max(times))).total_seconds()) if times else 0
    gpu=value['gpu'];gpu_text=(f"GPU {gpu['usage']}% · {gpu['used_mib']/1024:.1f} / {gpu['total_mib']/1024:.0f} GiB" if gpu else 'GPU 정보 확인 중')
    pids=', '.join(str(w['pid']) for w in value['workers']) or '없음'
    html=f'''<div style="max-width:1050px;font-family:system-ui,sans-serif;line-height:1.55;color:#172238;padding:20px;border:1px solid #cbd5e1;border-radius:12px;background:#fff"><h2 style="margin:0 0 8px">Multi-FraudGT · 공통 23종 피처</h2><p style="margin:4px 0"><b>{state}</b> · {escape(stages.get(value['stage'],'준비'))} · {gpu_text}</p><small>화면 갱신 {escape(value['now_utc'])} · 마지막 기록 {age:.1f}초 전 · PID {pids}</small>'''
    html+=bar('완료한 학습 에폭',value['completed_epochs'],value['epochs'],'에폭마다 학습과 예정된 검증을 끝내면 올라갑니다. 시간 비율이 아닙니다.')
    html+=bar(f'현재 {epoch}에폭 · 학습 요청 거래',train.get('completed',0),train.get('total',524288),
        f"로더 배치 2,048 · 8배치 누적 · 실제 채점 {train.get('scored',0):,}건 (기존 official readout)")
    scheduled=val.get('scheduled',False)
    html+=bar(f'현재 {epoch}에폭 · HI 검증',val.get('completed',0),val.get('total',524288),
        '검증 예정: 1, 4, 8, …, 284에폭' if scheduled else '이 에폭은 검증 없이 다음 학습 에폭으로 넘어갑니다.',color='#7c3aed')
    for scope,label in [('hi_test','최종 HI 전체 Test'),('saml','최종 SAML-D 전체 Test')]:
        v=value['evaluations'][scope]
        html+=bar(label,v['done'],v['total'],'284에폭 학습 완료 및 HI 검증 모델 선택 후 자동 실행',color='#059669')
    speed=value['progress'].get('targets_per_second');loss=train.get('loss')
    if speed:html+=f'<p>현재 에폭 평균 요청 처리 속도 <b>{speed:,.0f}건/초</b>'+(f' · 학습 손실 {loss:.5f}' if loss is not None else '')+'</p>'
    eta=value['eta']
    if eta.get('remaining_hours') is not None:
        html+=f"<p>학습·중간 검증 남은 시간 추정 <b>{eta['remaining_hours']:.1f}시간</b> · 예상 종료 {escape(eta['estimated_training_finish_utc'])}<br><small>완료 에폭의 실측 기준이며 전체 HI·SAML Test 시간은 추가됩니다.</small></p>"
    else:html+='<p>완료 예상 시간: 첫 에폭과 검증이 끝나면 실측으로 계산합니다.</p>'
    if value['history']:
        rows=[h for h in value['history'] if h.get('validation_performed')][-5:]
        html+='<table style="width:100%;text-align:right;border-collapse:collapse"><tr><th>에폭</th><th>HI 검증 AP</th><th>Precision</th><th>Recall</th><th>F1</th></tr>'
        for r in rows:
            html+='<tr><td>'+str(r['epoch'])+'</td>'+''.join(f'<td>{100*r[k]:.2f}%</td>' for k in ('val_AP','val_precision_at_05','val_recall_at_05','val_F1'))+'</tr>'
        html+='</table><small>위 표는 중간 HI 검증 표본의 채점 대상 지표입니다. SAML Test 점수가 아닙니다.</small>'
    if value['state']=='failed':html+='<p style="color:#b42318">'+escape(value['status'].get('detail','run.log를 확인하세요.'))+'</p>'
    health=value.get('health',{});monitor=value.get('health_monitor',{})
    if health:
        review=health['assessment'];checkpoint=health['checkpoint']
        labels={'ok':'이상 징후 없음','baseline':'초기 기준 수집 중','warning':'확인 필요','critical':'이상 감지'}
        color='#b42318' if review['state'] in ('warning','critical') else '#176b45'
        html+=f'<hr><h3 style="margin-bottom:5px">1시간 간격 상태 점검 · <span style="color:{color}">{labels[review["state"]]}</span></h3>'
        html+=f'<small>최근 점검 {escape(health["utc"])} · 다음 점검 {escape(monitor.get("next_review_utc","—"))} · 점검기 {escape(monitor.get("status","—"))}</small>'
        if checkpoint.get('status')=='checked':
            lr=', '.join(f'{v:.8g}' for v in checkpoint['learning_rates'])
            html+=f'<p>저장된 학습률 <b>{lr}</b> · 스케줄 {"일치" if checkpoint["schedule_matches"] else "불일치"}</p>'
        for issue in review['issues']:html+='<p style="color:#b42318">'+escape(issue['message'])+'</p>'
        cpu=review['cpu_anonymous_growth'];gpu_trend=review['gpu_committed_allocation_growth']
        html+='<p>CPU 익명 메모리: '+('추세 수집 중' if cpu['status']=='collecting' else '증가 의심' if cpu['suspected'] else '증가 이상 미감지')
        html+=' · GPU 저장 시점 할당: '+('추세 수집 중' if gpu_trend['status']=='collecting' else '증가 의심' if gpu_trend['suspected'] else '증가 이상 미감지')+'</p>'
        html+='<small>파일 캐시와 CUDA 예약 메모리만으로 누수를 판정하지 않습니다. 상세 결과: hourly_health/latest.html</small>'
    html+='<p style="margin-bottom:0;color:#526078">SALT는 중단 유지 · 결제방식 8차원 원핫 유지 · SAML로 학습하거나 임계값을 고르지 않습니다.</p></div>'
    return html

def protocol_html():
    p=control.read(control.ROOT/'plan.json');f=p['features']
    pairs=[('피처',f"{f['original_types']}종 → {f['retained_types']}종; 계좌 유형·소유관계·국가 11종 제거"),
        ('학습','HI-Large 2022-08-01~09-25 · 새로 초기화 · seed42'),
        ('학습량','284에폭 · 기존 500에폭 학습률 곡선의 앞 284에폭'),
        ('배치','공유 그래프 2,048 거래 · 8배치 누적 업데이트'),
        ('검증·선택','HI 2022-09-26~10-13 · 기존 검증 F1 기준'),
        ('최종 평가','HI 33,429,507건 + SAML-D 9,504,852건 · 임계값 0.5 초과'),
        ('결제방식','기존 7범주 + Unknown의 원핫; Debit card·Cross-border는 Unknown')]
    return '<table>'+''.join('<tr><th style="text-align:left;padding:6px">'+escape(a)+'</th><td>'+escape(b)+'</td></tr>' for a,b in pairs)+'</table>'

class Dashboard:
    def __init__(self,refresh_seconds=1):
        import ipywidgets as widgets
        from IPython.display import HTML,display
        self.HTML=HTML;self.refresh_seconds=max(.5,float(refresh_seconds));self.value=None;self.error=None
        self.message=widgets.HTML('')
        start=widgets.Button(description='시작·재개 / 연결',button_style='success',icon='play')
        pause=widgets.Button(description='학습 일시중단',button_style='warning',icon='pause')
        refresh=widgets.Button(description='지금 새로고침',icon='refresh')
        start.on_click(lambda _:self.action(control.start_or_attach))
        pause.on_click(lambda _:self.action(control.request_stop))
        refresh.on_click(lambda _:self.refresh())
        self.buttons=widgets.HBox([start,pause,refresh]);display(self.buttons,self.message)
        self.handle=display(HTML('실행 중인 실험에 연결하는 중입니다.'),display_id=True)
        self.refresh();self.task=asyncio.get_running_loop().create_task(self.poll())
    def action(self,fn):
        try:
            result=fn();text=result.get('message',str(result)) if isinstance(result,dict) else str(result)
            self.message.value='<p>'+escape(text)+'</p>';self.refresh()
        except Exception as error:self.message.value='<p style="color:#b42318">'+escape(str(error))+'</p>'
    def refresh(self):
        try:
            self.value=control.snapshot();self.handle.update(self.HTML(render(self.value)));self.error=None
        except (OSError,ValueError,KeyError) as error:
            self.error=str(error);self.message.value='<p style="color:#b42318">진행률을 다시 읽는 중: '+escape(self.error)+'</p>'
    async def poll(self):
        try:
            while True:
                await asyncio.sleep(self.refresh_seconds);self.refresh()
        except asyncio.CancelledError:return
    def close(self):
        self.task.cancel();self.buttons.close();self.message.close()

def watch(refresh_seconds=1):
    global _ACTIVE
    asyncio.get_running_loop()
    if _ACTIVE is not None:_ACTIVE.close()
    _ACTIVE=Dashboard(refresh_seconds);return _ACTIVE
