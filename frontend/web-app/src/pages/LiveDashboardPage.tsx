import { RefreshCountdown } from '@/components/RefreshCountdown'
import { useSharedPeriod, useViewState } from '@/lib/workspaceState'
import { RefreshStatus } from '@/components/RefreshStatus'
import { fetchDemoClock, fetchLiveDashboard, daysBefore, kstDate, type LiveDashboard } from '@/api/liveDashboard'
import { EmptyBlock, ErrorBlock } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { SectionCards, sectionCardSurface } from '@/components/SectionCards'
import { RadarSweep } from '@/features/agent/RadarSweep'
import { rdrSummaryBackground } from '@/features/agent/rdrSummaryStyle'
import { useAsync } from '@/lib/useAsync'
import { UnderTabs } from '@/components/UnderTabs'
import LivePersonalView from '@/features/dashboard/LivePersonalView'
import { InstitutionCharts } from '@/features/dashboard/InstitutionView'
import { DateRangeButton } from '@/components/DateRangeButton'
import { fetchReviewCases } from '@/api/liveReview'
import { WorkCard } from '@/features/dashboard/WorkCard'
import { reviewCaseWorkItem } from '@/features/dashboard/workItems'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const count = (n: number | undefined) => (n ?? 0).toLocaleString('ko-KR')
function DashboardSkeleton({ scope, setScope }: { scope: 'institution' | 'personal'; setScope: (scope: 'institution' | 'personal') => void }) {
  const labels = scope === 'institution' ? ['오늘 유입 Alert', '오늘 의심 거래 탐지율', '열린 Alert', '조사 중 Episode'] : ['내 미처리', '72시간 이상 경과', '선택 기간 내 종결']
  return <div role="status" aria-label="대시보드 불러오는 중" className="space-y-6">
    <UnderTabs value={scope} onChange={setScope} items={[{ value: 'institution', label: '기관 전체' }, { value: 'personal', label: '내 담당' }]} />
    <div className={`grid grid-cols-1 gap-4 @xl:grid-cols-2 @5xl:grid-cols-4 ${sectionCardSurface}`} data-testid="section-cards">{labels.map(label => <Card key={label} className="@container/card"><CardHeader><CardDescription>{label}</CardDescription><CardTitle><Skeleton className="h-8 w-24" /></CardTitle></CardHeader><CardFooter className="flex-col items-start gap-2"><Skeleton className="h-4 w-20" />{label === '열린 Alert' ? <p className="text-sm text-muted-foreground">최초 열람 여부는 구분할 수 없음</p> : label === '조사 중 Episode' ? <p className="text-sm text-muted-foreground">진행 중인 Episode</p> : <Skeleton className="h-4 w-3/4" />}</CardFooter></Card>)}</div>
    {scope === 'personal' ? <div className="grid gap-4 @3xl:grid-cols-3">{['처리 전', '처리 중', '처리 완료'].map(label => <section key={label} className="rounded-xl border bg-card p-4"><h2 className="font-semibold">{label}</h2><div className="mt-4 space-y-3">{[0, 1].map(index => <Skeleton key={index} className="h-24 w-full" />)}</div></section>)}</div> : <>
      <div data-testid="institution-dashboard-grid" className="grid min-w-0 max-w-full items-stretch gap-4 @6xl:grid-cols-3">
        <section className="rounded-xl border bg-card/35 p-4 @6xl:col-span-2"><div className="flex items-start justify-between gap-4"><div><h2 className="text-base font-semibold">기관 탐지 현황</h2><p className="mt-1 text-xs text-muted-foreground">한 기간 선택이 아래 두 그래프에 함께 적용됩니다.</p></div><Skeleton className="h-9 w-36" /></div><div className="mt-5 rounded-xl border bg-card p-4"><h3 className="text-sm font-medium">일별 Alert 유입과 처리 상태</h3><p className="mt-1 text-xs text-muted-foreground">그날 들어온 Alert가 지금 어느 단계에 있는지</p><Skeleton className="mt-6 h-56 w-full" /><div className="mt-4 flex justify-around">{[0, 1, 2, 3, 4, 5].map(index => <Skeleton key={index} className="h-3 w-8" />)}</div></div><div className="mt-4 rounded-xl border bg-card p-4"><h3 className="text-sm font-medium">의심 거래 구성과 패턴 분포</h3><Skeleton className="mt-6 h-36 w-full" /></div></section>
        <Card className="h-full shadow-none" style={rdrSummaryBackground}><CardContent><div className="flex items-center gap-2"><RadarSweep className="size-5" /><h2 className="font-semibold">RDR 9000 Daily Report</h2><Badge variant="outline" className="provenance-badge font-normal">mock · LLM 미연동</Badge></div><p className="mt-1 text-[11px] text-muted-foreground">수치는 서버 집계, 문장은 규칙 기반 시연.</p><div className="mt-5 space-y-5">{['오늘의 변화', '운영 해석', '집중 패턴'].map(label => <div key={label}><h3 className="text-xs font-medium">{label}</h3><Skeleton className="mt-3 h-4 w-full" /><Skeleton className="mt-2 h-4 w-3/4" /></div>)}</div></CardContent></Card>
      </div>
      <div className="grid gap-4 @3xl:grid-cols-2">{['열린 Alert', '조사 중 Episode'].map(label => <section key={label}><h2 className="font-semibold">{label}</h2><div className="mt-3 space-y-2">{[0, 1, 2].map(index => <Skeleton key={index} className="h-20 w-full rounded-lg" />)}</div></section>)}</div>
    </>}
  </div>
}
function LiveAiDailyReport({ data, onOpen }: { data: LiveDashboard; onOpen: (kind: 'ALERT' | 'EPISODE', id: number) => void }) {
  const today = data.institution.today
  const yesterday = data.institution.yesterday
  const change = yesterday > 0 ? today === yesterday ? ' · 전일과 동일' : ` · ${Math.abs((today - yesterday) / yesterday * 100).toFixed(1)}% ${today > yesterday ? '증가' : '감소'}` : ''
  return <Card data-testid="ai-daily-report" aria-label="RDR 9000 Daily Report" className="h-full min-w-0 overflow-hidden shadow-none" style={rdrSummaryBackground}>
    <CardContent className="flex h-full min-h-0 flex-col">
      <div><div className="flex items-center gap-2"><RadarSweep className="size-5 shrink-0" /><h2 className="text-base font-semibold tracking-tight">RDR 9000 Daily Report</h2><Badge variant="outline" className="provenance-badge font-normal" data-provenance="mock">mock · LLM 미연동</Badge></div>
        <p className="mt-1 text-[11px] text-muted-foreground">수치는 서버 집계, 문장은 규칙 기반 시연. AI 분석 결과나 자금세탁 확정 판정 아님.</p></div>
      <div className="mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 text-sm">
        <div><h3 className="text-xs font-medium">오늘의 변화</h3><p className="mt-2 leading-6 text-muted-foreground">오늘 신규 Alert {count(today)}건 · 전일 {count(yesterday)}건{change}{yesterday === 0 && ' · 전일 0건으로 증감률 산출 불가'}</p></div>
        <div><h3 className="text-xs font-medium">운영 해석</h3><p className="mt-2 leading-6 text-muted-foreground">{data.pendingReports > 0 ? `미완료 보고 ${count(data.pendingReports)}건 · 오늘 탐지율 확정 전.` : data.detection.received > 0 ? `오늘 대상 원장 ${count(data.detection.received)}건 중 모델 의심 ${count(data.detection.suspicious)}건 확인됨.` : '오늘 대상 원장 거래 없음 · 탐지율 산출 불가.'}</p></div>
        <div><h3 className="text-xs font-medium">집중 패턴</h3><p className="mt-2 leading-6 text-muted-foreground">진행 중인 Alert의 최빈 유형 데이터가 제공되지 않았습니다.</p></div>
        <div><h3 className="text-xs font-medium">담당 조사자 교차 확인 질문</h3><ul className="mt-2 list-disc space-y-2 pl-4 leading-6 text-muted-foreground"><li>동일 소유주·계좌의 다중 패턴 반복 여부</li><li>고액 집중일과 고객 프로필·거래 목적의 일치 여부</li><li>장기 경과 건의 증빙 요청·회신 기록 여부</li></ul></div>
        <section aria-labelledby="live-priority-title" className="rounded-lg border bg-muted/20 p-3 @3xl:p-4"><h3 id="live-priority-title" className="text-sm font-semibold">담당 조사자 우선 검토</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">본인 담당 현재 열린 사건 중 위험 점수가 높은 순으로 표시합니다.</p>{data.priority.length ? <div className="mt-3 space-y-2.5">{data.priority.slice(0, 3).map(row => <button key={row.case_id} type="button" className="flex w-full items-center justify-between rounded-lg border bg-card p-3 text-left text-sm hover:bg-accent" onClick={() => onOpen(row.kind, row.case_id)}><span className="font-mono">{row.kind === 'ALERT' ? `A-${row.alert_id ?? row.case_id}` : `E-${row.case_id}`}</span><span>위험 {row.risk.toFixed(2)}</span></button>)}</div> : <p className="mt-2 text-sm text-muted-foreground">우선 검토 사건 없음.</p>}</section>
      </div>
    </CardContent>
  </Card>
}

function LiveInstitutionRecent() {
  const alerts = useAsync(() => fetchReviewCases({ kind: 'ALERT', status: 'OPEN', page: 0, size: 10 }), [], { key: 'institution/recent-alerts' })
  const episodes = useAsync(() => fetchReviewCases({ kind: 'EPISODE', status: 'OPEN', page: 0, size: 5 }), [], { key: 'institution/recent-episodes' })
  const sections = [
    { title: '열린 Alert', description: '위험 점수 높은 순 · 최초 열람 여부 미확인', result: alerts },
    { title: '조사 중 Episode', description: '위험 점수 높은 순', result: episodes },
  ]
  return <div data-testid="institution-recent" className="grid items-start gap-4 @3xl:grid-cols-2">{sections.map(({ title, description, result }) => {
    const items = result.state.status === 'success' ? result.state.data.content.flatMap(row => reviewCaseWorkItem(row) ?? []).slice(0, 5) : []
    return <section key={title} aria-label={title}><div className="mb-3"><h2 className="text-base font-semibold tracking-tight">{title}</h2><p className="mt-1.5 text-xs text-muted-foreground">{description}</p></div>
      {result.state.status === 'loading' ? <div role="status" aria-label={`${title} 불러오는 중`} className="space-y-2.5">{[0, 1, 2].map(index => <div key={index} className="space-y-3 rounded-lg border bg-card px-5 py-4"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-3/4" /></div>)}</div>
        : result.state.status === 'error' ? <ErrorBlock message={result.state.message} onRetry={result.retry} />
          : items.length ? <div className="space-y-2.5">{items.map(item => <WorkCard key={`${item.kind}-${item.id}`} item={item} />)}</div>
            : <EmptyBlock>해당 업무가 없습니다.</EmptyBlock>}
    </section>
  })}</div>
}

export default function LiveDashboardPage({ onOpen }: { onOpen: (kind: 'ALERT' | 'EPISODE', id: number) => void }) {
  const [scope, setScope] = useViewState<'personal' | 'institution'>('dashboard/scope', 'institution')
  const clock = useAsync(fetchDemoClock, [], { key: 'clock' })
  const businessDate = clock.state.status === 'success' ? kstDate(clock.state.data.businessAt) : ''
  const { from, to, setPeriod } = useSharedPeriod({ from: businessDate ? daysBefore(businessDate, 29) : '', to: businessDate })
  const dashboard = useAsync(() => from && to ? fetchLiveDashboard(from, to) : Promise.reject(new Error('업무 시각을 확인하지 못했습니다.')), [from, to], { key: 'dashboard', enabled: Boolean(from && to) })

  if (clock.state.status === 'loading') return <DashboardSkeleton scope={scope} setScope={setScope} />
  if (clock.state.status === 'error') return <ErrorBlock message={clock.state.message} onRetry={clock.retry} />
  if (dashboard.state.status === 'loading') return <DashboardSkeleton scope={scope} setScope={setScope} />
  if (dashboard.state.status === 'error') return <ErrorBlock message={dashboard.state.message} onRetry={dashboard.retry} />
  const data = dashboard.state.data
  const selectedRange = { from: from ? new Date(`${from}T00:00:00`) : undefined, to: to ? new Date(`${to}T00:00:00`) : undefined }
  const yesterday = data.institution.yesterday
  const alertChange = yesterday > 0 ? `${data.institution.today >= yesterday ? '+' : ''}${(((data.institution.today - yesterday) / yesterday) * 100).toFixed(1)}%` : '—'
  const detectionRate = data.pendingReports > 0 ? '확정 전' : data.detection.received > 0 ? `${(data.detection.suspicious / data.detection.received * 100).toFixed(1)}%` : '—'
  const kpis = scope === 'institution'
    ? [
        { label: '오늘 유입 Alert', value: count(data.institution.today), delta: yesterday > 0 ? Number(alertChange.slice(0, -1)) : undefined, favorableDirection: 'down' as const, trend: '전일 대비', note: '모델이 의심으로 판별한 신규 Alert' },
        { label: '오늘 의심 거래 탐지율', value: detectionRate, trend: '모델 의심 ÷ 대상 원장', note: data.pendingReports > 0 ? `미완료 보고 ${count(data.pendingReports)}건` : `${count(data.detection.suspicious)}건 의심 · ${count(data.detection.received)}건 대상` },
        { label: '열린 Alert', value: count(data.institution.alerts), trend: `72시간 이상 경과 ${count(data.openAlertsAgedOver3Days)}건`, note: '최초 열람 여부는 구분할 수 없음' },
        { label: '조사 중 Episode', value: count(data.institution.episodes), trend: `검토 전 ${count(data.episodeWork.current.unreviewed)}건`, note: '진행 중인 Episode' },
      ]
    : [
        { label: '내 미처리', value: count(data.personal.pending), trend: '본인 담당', note: '진행 중인 사건' },
        { label: '72시간 이상 경과', value: count(data.personal.aged), trend: '본인 담당', note: '우선 확인 필요' },
        { label: '선택 기간 내 종결', value: count(data.personal.closed), trend: '본인 담당', note: '최종 판정 완료' },
      ]

  return <div className="space-y-6">
    <RefreshStatus queries={[dashboard]} />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <UnderTabs value={scope} onChange={setScope} items={[{ value: 'institution', label: '기관 전체' }, { value: 'personal', label: '내 담당' }]} />
      <span className="text-xs text-muted-foreground">업무 기준 {kstDate(data.businessAt)} · <RefreshCountdown nextRefreshAt={dashboard.nextRefreshAt} refreshing={dashboard.refreshing} /></span>
    </div>
    {scope === 'personal' ? <LivePersonalView pending={data.personal.pending} aged={data.personal.aged} /> : <>
    <SectionCards items={kpis} />
    <div data-testid="institution-dashboard-grid" className="grid min-w-0 max-w-full items-stretch gap-4 @6xl:grid-cols-3">
      <section aria-labelledby="institution-chart-title" className="flex h-full min-h-0 min-w-0 max-w-full flex-col gap-4 rounded-xl border bg-card/35 p-3 @3xl:p-4 @6xl:col-span-2">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 px-1">
          <div><h2 id="institution-chart-title" className="text-base font-semibold tracking-tight">기관 탐지 현황</h2><p className="mt-1 text-xs text-muted-foreground">한 기간 선택이 아래 두 그래프에 함께 적용됩니다.</p></div>
          <DateRangeButton value={selectedRange} onChange={range => setPeriod({ from: range?.from?.toLocaleDateString('sv-SE') ?? '', to: range?.to?.toLocaleDateString('sv-SE') ?? '' })} today={new Date(`${businessDate}T00:00:00`)} />
        </div>
        <InstitutionCharts data={{ alertsByType: [] }} />
      </section>
      <section aria-label="RDR 9000 Daily Report" className="h-full min-w-0 @6xl:col-span-1"><LiveAiDailyReport data={data} onOpen={onOpen} /></section>
    </div>
    <LiveInstitutionRecent />
    </>}
  </div>
}
