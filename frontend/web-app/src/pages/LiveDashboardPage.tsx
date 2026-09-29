import { useSharedPeriod, useViewState } from '@/lib/workspaceState'
import { RefreshStatus } from '@/components/RefreshStatus'
import { typeDisplay, type TypeCode } from '@/api/codes'
import { fetchDemoClock, fetchLiveDashboard, daysBefore, kstDate, type LiveDashboard } from '@/api/liveDashboard'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import { PageHeading } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RadarSweep } from '@/features/agent/RadarSweep'
import { rdrSummaryBackground } from '@/features/agent/rdrSummaryStyle'
import { useAsync } from '@/lib/useAsync'

const count = (n: number) => n.toLocaleString('ko-KR')
const agreementLabels: Record<string, string> = {
  STRONG: '모델 의심 · 패턴 있음',
  ATYPICAL: '모델 의심 · 패턴 없음',
  PATTERN_ONLY: '모델 정상 · 패턴 있음',
  WEAK: '모델 정상 · 패턴 없음',
}

function LiveAiDailyReport({ data }: { data: LiveDashboard }) {
  const today = data.institution.today
  const yesterday = data.institution.yesterday
  const change = yesterday > 0 ? today === yesterday ? ' · 전일과 동일' : ` · ${Math.abs((today - yesterday) / yesterday * 100).toFixed(1)}% ${today > yesterday ? '증가' : '감소'}` : ''
  const first = data.priority[0]
  return <section data-testid="ai-daily-report" aria-label="RDR 9000 Daily Report" className="rounded-xl border bg-card p-5" style={rdrSummaryBackground}>
    <div className="flex flex-wrap items-center gap-2"><RadarSweep className="size-5 shrink-0" /><h2 className="font-semibold">RDR 9000 Daily Report</h2><Badge variant="outline" className="provenance-badge font-normal" data-provenance="mock">mock · LLM 미연동</Badge></div>
    <p className="mt-1 text-xs text-muted-foreground">수치는 서버 집계, 문장은 규칙 기반 시연. AI 분석 결과나 자금세탁 확정 판정 아님.</p>
    <div className="mt-4 grid gap-4 text-sm md:grid-cols-3">
      <div><h3 className="text-xs font-medium">오늘의 변화</h3><p className="mt-2 text-muted-foreground">오늘 신규 Alert {count(today)}건 · 전일 {count(yesterday)}건{change}{yesterday === 0 && ' · 전일 0건으로 증감률 산출 불가'}</p></div>
      <div><h3 className="text-xs font-medium">탐지 상태</h3><p className="mt-2 text-muted-foreground">{data.pendingReports > 0 ? `미완료 보고 ${count(data.pendingReports)}건 · 오늘 탐지율 확정 전.` : data.detection.received > 0 ? `오늘 대상 원장 ${count(data.detection.received)}건 중 모델 의심 ${count(data.detection.suspicious)}건 확인됨.` : '오늘 대상 원장 거래 없음 · 탐지율 산출 불가.'}</p></div>
      <div><h3 className="text-xs font-medium">내 우선 검토</h3><p className="mt-2 text-muted-foreground">{first ? `${first.kind === 'ALERT' ? `Alert A-${first.alert_id ?? first.case_id}` : `Episode E-${first.case_id}`} · 위험 점수 ${first.risk.toFixed(2)}` : '우선 검토 사건 없음.'}</p></div>
    </div>
  </section>
}

export default function LiveDashboardPage({ onOpen }: { onOpen: (kind: 'ALERT' | 'EPISODE', id: number) => void }) {
  const [scope, setScope] = useViewState<'personal' | 'institution'>('dashboard/scope', 'institution')
  const clock = useAsync(fetchDemoClock, [], { key: 'clock' })
  const businessDate = clock.state.status === 'success' ? kstDate(clock.state.data.businessAt) : ''
  const { from, to, setFrom, setTo } = useSharedPeriod({ from: businessDate ? daysBefore(businessDate, 29) : '', to: businessDate })
  const dashboard = useAsync(() => from && to ? fetchLiveDashboard(from, to) : Promise.reject(new Error('업무 시각을 확인하지 못했습니다.')), [from, to], { key: 'dashboard', enabled: Boolean(from && to) })

  if (clock.state.status === 'loading') return <LoadingBlock label="업무 시각" />
  if (clock.state.status === 'error') return <ErrorBlock message={clock.state.message} onRetry={clock.retry} />
  if (dashboard.state.status === 'loading') return <LoadingBlock label="대시보드" />
  if (dashboard.state.status === 'error') return <ErrorBlock message={dashboard.state.message} onRetry={dashboard.retry} />
  const data = dashboard.state.data
  const cards = scope === 'personal'
    ? [['내 미처리', data.personal.pending], ['72시간 이상 경과', data.personal.aged], ['선택 기간 내 종결', data.personal.closed]] as const
    : [['열린 Alert', data.institution.alerts], ['열린 Episode', data.institution.episodes], ['72시간 이상 경과', data.institution.aged]] as const
  const agreementTotal = data.agreements.reduce((sum, row) => sum + row.count, 0)
  const detectionRate = data.detection.received > 0 && data.pendingReports === 0 ? `${((data.detection.suspicious / data.detection.received) * 100).toFixed(1)}%` : '—'
  const yesterday = data.institution.yesterday
  const alertChange = yesterday > 0 ? `${data.institution.today >= yesterday ? '+' : ''}${(((data.institution.today - yesterday) / yesterday) * 100).toFixed(1)}%` : '—'
  const maxTypeCount = Math.max(1, ...data.types.map(row => row.count))

  return <div className="space-y-6">
    <RefreshStatus queries={[dashboard]} />
    <PageHeading title="대시보드" description={`업무 기준 ${kstDate(data.businessAt)} · 서버 집계`} />
    <div className="flex flex-wrap items-center gap-2">
      <Button variant={scope === 'institution' ? 'default' : 'outline'} size="sm" onClick={() => setScope('institution')}>기관 전체</Button>
      <Button variant={scope === 'personal' ? 'default' : 'outline'} size="sm" onClick={() => setScope('personal')}>내 담당</Button>
      <label className="ml-auto flex items-center gap-2 text-xs">기간
        <input aria-label="시작일" type="date" className="rounded-md border bg-background px-2 py-1" value={from} max={to} onChange={event => setFrom(event.target.value)} />
        <span>~</span>
        <input aria-label="종료일" type="date" className="rounded-md border bg-background px-2 py-1" value={to} min={from} onChange={event => setTo(event.target.value)} />
      </label>
    </div>
    {scope === 'institution' && <section className="grid gap-3 md:grid-cols-2" aria-label="기관 탐지 현황">
      <div className="rounded-xl border bg-card p-5"><p className="text-xs text-muted-foreground">오늘 탐지율</p><p className="mt-3 text-3xl font-semibold">{detectionRate}</p><p className="mt-2 text-xs text-muted-foreground">수신 {count(data.detection.received)} · 분석 {count(data.detection.analyzed)} · 의심 {count(data.detection.suspicious)}{data.pendingReports > 0 && ` · 미완료 보고 ${count(data.pendingReports)}`}</p><p className="mt-1 text-xs text-muted-foreground">대상 거래일 {data.deliveryDate || '미제공'}</p></div>
      <div className="rounded-xl border bg-card p-5"><p className="text-xs text-muted-foreground">오늘 생성된 Alert</p><p className="mt-3 text-3xl font-semibold">{count(data.institution.today)}</p><p className="mt-2 text-xs text-muted-foreground">전일 대비 {alertChange}</p></div>
    </section>}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={`${scope === 'personal' ? '내 담당' : '기관 전체'} 현황`}>
      {cards.map(([label, value]) => <div key={label} className="rounded-xl border bg-card p-5"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-3 text-3xl font-semibold">{count(value)}</p></div>)}
    </section>
    {scope === 'institution' && <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Episode 업무">
      <div className="rounded-xl border bg-card p-5"><p className="text-xs text-muted-foreground">열린 Episode 중 검토 전</p><p className="mt-3 text-2xl font-semibold">{count(data.episodeWork.current.unreviewed)}</p></div>
      <div className="rounded-xl border bg-card p-5"><p className="text-xs text-muted-foreground">Episode 첫 검토 평균</p><p className="mt-3 text-2xl font-semibold">{data.episodeWork.firstReview.average_seconds == null ? '—' : `${Math.round(data.episodeWork.firstReview.average_seconds / 3600)}시간`}</p></div>
      <div className="rounded-xl border bg-card p-5"><p className="text-xs text-muted-foreground">Episode 종결 평균</p><p className="mt-3 text-2xl font-semibold">{data.episodeWork.completion.average_seconds == null ? '—' : `${Math.round(data.episodeWork.completion.average_seconds / 3600)}시간`}</p></div>
    </section>}
    {scope === 'institution' && <LiveAiDailyReport data={data} />}
    <section className="grid gap-4 xl:grid-cols-3">
      <div className="rounded-xl border bg-card p-5"><h2 className="font-semibold">일별 Alert 유입·종결</h2><p className="mb-3 text-xs text-muted-foreground">선택 기간의 생성일·종결일 기준</p>{data.daily.length ? <div className="max-h-64 overflow-auto text-sm">{data.daily.map(row => <div key={row.day} className="grid grid-cols-3 gap-2 border-b py-2"><span>{row.day}</span><span>유입 {count(row.incoming)}</span><span>종결 {count(row.completed)}</span></div>)}</div> : <EmptyBlock>해당 기간 데이터가 없습니다.</EmptyBlock>}</div>
      <div className="rounded-xl border bg-card p-5"><h2 className="font-semibold">모델 판정 조합</h2><p className="mb-3 text-xs text-muted-foreground">전체 분석 거래 {count(agreementTotal)}건 기준</p>{agreementTotal > 0 ? <div className="space-y-3">{data.agreements.map(row => <div key={row.agreement} className="text-xs"><div className="flex justify-between gap-2"><span>{agreementLabels[row.agreement] ?? row.agreement}</span><strong>{count(row.count)}건 · {(row.count / agreementTotal * 100).toFixed(1)}%</strong></div><div className="mt-1 h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${row.count / agreementTotal * 100}%` }} /></div></div>)}</div> : <EmptyBlock>모델 조합 데이터가 없습니다.</EmptyBlock>}</div>
      <div className="rounded-xl border bg-card p-5"><h2 className="font-semibold">탐지 유형</h2><p className="mb-3 text-xs text-muted-foreground">모델 의심 거래의 유형별 건수</p>{data.types.length ? data.types.map(row => <div key={row.type} className="mb-3 text-xs"><div className="flex justify-between gap-2"><span>{row.type === 0 ? '패턴 없음' : typeDisplay(row.type as TypeCode)?.label ?? `미확인 유형 ${row.type}`}</span><strong>{count(row.count)}건</strong></div><div className="mt-1 h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${row.count / maxTypeCount * 100}%` }} /></div></div>) : <EmptyBlock>유형별 거래가 없습니다.</EmptyBlock>}</div>
    </section>
    {scope === 'personal' && <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">내 최근 활동</h2><p className="mb-3 text-xs text-muted-foreground">선택 기간의 서버 업무 이력</p>{data.activities.length ? <div className="max-h-64 overflow-auto text-sm">{data.activities.map(row => <div key={row.event_id} className="border-b py-2"><p className="font-medium">{row.action} · 조사 사건 {row.case_id}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(row.business_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>{row.comment && <p className="mt-1">{row.comment}</p>}</div>)}</div> : <EmptyBlock>선택 기간의 활동이 없습니다.</EmptyBlock>}</section>}
    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">내 우선 검토 사건</h2><p className="mb-3 text-xs text-muted-foreground">담당 조사자가 위험도와 경과를 확인할 사건</p>{data.priority.length ? <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{data.priority.map(row => <button key={row.case_id} type="button" className="rounded-lg border p-3 text-left hover:bg-accent" onClick={() => onOpen(row.kind, row.case_id)}><span className="text-sm font-semibold">{row.kind === 'ALERT' ? `A-${row.alert_id ?? row.case_id}` : `E-${row.case_id}`}</span><span className="ml-2 text-xs text-muted-foreground">위험 {row.risk.toFixed(2)}</span><p className="mt-1 text-xs text-muted-foreground">조사 사건 {row.case_id}</p></button>)}</div> : <EmptyBlock>우선 검토 사건이 없습니다.</EmptyBlock>}</section>
  </div>
}
