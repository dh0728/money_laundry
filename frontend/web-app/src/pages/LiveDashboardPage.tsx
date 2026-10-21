import { useEffect } from 'react'
import { agreementComposition } from '@/features/dashboard/metrics'
import { LiveWorkQueue } from '@/features/dashboard/LiveWorkQueue'
import { InstitutionView } from '@/features/dashboard/InstitutionView'
import { PersonalView, PersonalSummaryView } from '@/features/dashboard/PersonalView'
import { DailyReportView } from '@/features/dashboard/AiDailyReport'
import { useCurrentUser } from '@/app/session'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SectionTitle } from '@/components/page'
import { AlertStatusChart } from '@/features/dashboard/AlertFlowChart'
import { TransactionPatternHierarchy } from '@/features/dashboard/PatternRelation'
import { UnderTabs } from '@/components/UnderTabs'
import { isoDate } from '@/lib/format'
import { useSharedPeriod, useViewState } from '@/lib/workspaceState'
import { typeDisplay, type TypeCode } from '@/api/codes'
import { fetchDemoClock, daysBefore, kstDate, type LiveDashboard } from '@/api/liveDashboard'
import { EmptyBlock, ErrorBlock } from '@/components/states'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionCards } from '@/components/SectionCards'
import { useAsync } from '@/lib/useAsync'
import { useDashboardPolling } from '@/lib/useDashboardPolling'

const count = (n: number | null | undefined) => n == null ? '미제공' : n.toLocaleString('ko-KR')
const sourceTime = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) : '미제공'
const duration = (seconds: number | null | undefined, samples: number | undefined) => samples && seconds != null
  ? `${Math.round(seconds / 60).toLocaleString('ko-KR')}분` : '데이터 없음'

function LiveAiDailyReport({ investigation, pipeline, investigationComputedAt }: { investigation: NonNullable<LiveDashboard['investigation']>; pipeline: LiveDashboard['pipeline']; investigationComputedAt: string | null }) {
  const today = investigation.institution.today
  const yesterday = investigation.institution.yesterday
  const change = yesterday > 0 ? today === yesterday ? ' · 전일과 동일' : ` · ${Math.abs((today - yesterday) / yesterday * 100).toFixed(1)}% ${today > yesterday ? '증가' : '감소'}` : ''
  return <DailyReportView generatedAt={investigationComputedAt} changeSummary={`신규 Alert ${count(today)}건 · 전일 ${count(yesterday)}건${change}`}
    operation={`3일 이상 미처리 Alert ${count(investigation.openAlertsAgedOver3Days)}건. ${!pipeline ? '탐지 집계 미제공.' : pipeline.pendingReports ? `미완료 보고 ${count(pipeline.pendingReports)}건으로 탐지 집계 확인 필요.` : `오늘 수신 거래 ${count(pipeline.detection.received)}건.`}`}
    focus={<p className="mt-2 text-sm leading-6 text-muted-foreground">선택 기간의 유형별 건수는 왼쪽 분포에서 확인하세요. 서로 다른 사건이 같은 시나리오라는 판정은 아닙니다.</p>}
    />

}

function DashboardPending({ scope, onScope, label, error, onRetry }: { scope: 'institution' | 'personal'; onScope: (scope: 'institution' | 'personal') => void; label: string; error?: string; onRetry: () => void }) {
  const cards = scope === 'institution' ? ['오늘 신규 Alert', '오늘 의심 거래 탐지율', '열린 Alert', '조사 중 Episode'] : ['내 미처리', '72시간 이상 경과', '선택 기간 내 종결']
  return <div className="space-y-6">
    <UnderTabs value={scope} onChange={onScope} items={[{ value: 'institution', label: '기관 전체' }, { value: 'personal', label: '내 담당' }]} />
    {error ? <ErrorBlock message={error} onRetry={onRetry} /> : <p role="status" className="text-xs text-muted-foreground">{label} 불러오는 중…</p>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(card => <div key={card} className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{card}</p>{!error && <Skeleton className="mt-3 h-8 w-24" />}</div>)}</div>
    <div className="grid gap-4 xl:grid-cols-3"><section className="rounded-xl border bg-card p-4 xl:col-span-2"><h2 className="text-base font-semibold">{scope === 'institution' ? '기관 탐지 현황' : '내 담당 요약'}</h2>{!error && <Skeleton className="mt-4 h-40 w-full" />}</section><section className="rounded-xl border bg-card p-4"><h2 className="text-base font-semibold">{scope === 'institution' ? 'RDR 9000 Daily Report' : 'RDR 9000 · 내 담당 요약'}</h2>{!error && <Skeleton className="mt-4 h-40 w-full" />}</section></div>
    <section className="rounded-xl border bg-card p-4"><h2 className="text-base font-semibold">업무 현황</h2>{!error && <Skeleton className="mt-4 h-32 w-full" />}</section>
  </div>
}

export default function LiveDashboardPage(_props: { onOpen: (kind: 'ALERT' | 'EPISODE', id: number) => void }) {
  void _props
  const user = useCurrentUser()
  const [scope, setScope] = useViewState<'personal' | 'institution'>('dashboard/scope', 'institution')
  useEffect(() => {
    const showWiredScope = (event: Event) => {
      const id = (event as CustomEvent<string>).detail
      if (id?.startsWith('dashboard.institution.')) setScope('institution')
      else if (id?.startsWith('dashboard.personal.')) setScope('personal')
    }
    window.addEventListener('aml-wiring-focus', showWiredScope)
    return () => window.removeEventListener('aml-wiring-focus', showWiredScope)
  }, [setScope])
  const clock = useAsync(fetchDemoClock, [], { key: 'clock' })
  const businessDate = clock.state.status === 'success' ? kstDate(clock.state.data.businessAt) : ''
  const { from, to, setPeriod } = useSharedPeriod({ from: businessDate ? daysBefore(businessDate, 29) : '', to: businessDate })
  const dashboard = useDashboardPolling(user.userId, from, to)

  if (clock.state.status === 'loading') return <DashboardPending scope={scope} onScope={setScope} label="업무 시각" onRetry={clock.retry} />
  if (clock.state.status === 'error') return <DashboardPending scope={scope} onScope={setScope} label="업무 시각" error={clock.state.message} onRetry={clock.retry} />
  if (dashboard.state.status === 'loading') return <DashboardPending scope={scope} onScope={setScope} label="대시보드" onRetry={dashboard.retry} />
  if (dashboard.state.status === 'error') return <DashboardPending scope={scope} onScope={setScope} label="대시보드" error={dashboard.state.message} onRetry={dashboard.retry} />
  const data = dashboard.state.data
  const { pipeline, investigation } = data
  const agreementTotal = pipeline?.agreements.reduce((sum, row) => sum + row.count, 0)
  const detectionRate = !pipeline ? '미제공' : pipeline.pendingReports > 0 ? '분석 진행 중' : pipeline.detection.received > 0 ? `${((pipeline.detection.suspicious / pipeline.detection.received) * 100).toFixed(1)}%` : '산출 불가'
  const yesterday = investigation?.institution.yesterday
  const alertChange = investigation && yesterday && yesterday > 0 ? `${investigation.institution.today >= yesterday ? '+' : ''}${(((investigation.institution.today - yesterday) / yesterday) * 100).toFixed(1)}%` : '—'
  const kpis = scope === 'institution'
    ? [
        { label: '오늘 신규 Alert', value: count(investigation?.institution.today), delta: yesterday && yesterday > 0 ? Number(alertChange.slice(0, -1)) : undefined, favorableDirection: 'down' as const, trend: '전일 대비', note: !investigation ? '조사 집계 미제공' : yesterday && yesterday > 0 ? `전일 ${count(yesterday)}건` : '전일 비교 데이터 없음' },
        { label: '오늘 의심 거래 탐지율', value: detectionRate, trend: '전체 수신 거래 대비', note: !pipeline ? '탐지 집계 미제공' : pipeline.pendingReports > 0 ? `미완료 보고 ${count(pipeline.pendingReports)}건 · 집계 확인 필요 · 대상 거래일 ${pipeline.detection.deliveryDates.join(', ') || '미제공'}` : `의심 ${count(pipeline.detection.suspicious)}건 / 수신 ${count(pipeline.detection.received)}건 · 대상 거래일 ${pipeline.detection.deliveryDates.join(', ') || '미제공'}` },
        { label: '열린 Alert', value: count(investigation?.institution.alerts), trend: `3일 이상 경과 ${count(investigation?.openAlertsAgedOver3Days)}건`, note: investigation ? '아직 종결하지 않은 Alert' : '조사 집계 미제공' },
        { label: '조사 중 Episode', value: count(investigation?.institution.episodes), trend: `검토 전 ${count(investigation?.episodeWork.current.unreviewed)}건`, note: investigation ? '진행 중인 Episode' : '조사 집계 미제공' },
      ]
    : [
        { label: '내 미처리', value: count(investigation?.personal.pending), trend: '본인 담당', note: investigation ? '진행 중인 사건' : '조사 집계 미제공' },
        { label: '72시간 이상 경과', value: count(investigation?.personal.aged), trend: '본인 담당', note: investigation ? '우선 확인 필요' : '조사 집계 미제공' },
        { label: '선택 기간 내 종결', value: count(investigation?.personal.closed), trend: '본인 담당', note: investigation ? '최종 판정 완료' : '조사 집계 미제공' },
      ]

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><UnderTabs value={scope} onChange={setScope} items={[{ value: 'institution', label: '기관 전체' }, { value: 'personal', label: '내 담당' }]} /><div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-wiring-id="dashboard.freshness"><span>업무 기준 {kstDate(data.businessAt)}</span><span>탐지 집계 {sourceTime(data.pipelineComputedAt)}</span><span>조사 집계 {sourceTime(data.investigationComputedAt)}</span><span>{dashboard.refreshError ? `연결 끊김 · 마지막 성공 집계 표시 중${dashboard.nextRefreshInSeconds != null ? ` · ${dashboard.nextRefreshInSeconds}초 뒤 다시 시도` : ''}` : '1초마다 확인'}</span></div></div>
    {dashboard.refreshError && <div role="alert" className="text-xs">최신 조회 실패 · 이전 데이터를 표시합니다. {dashboard.refreshError}</div>}
    {!pipeline && <ErrorBlock message="탐지 집계 미제공 · 다시 시도할 수 있습니다." onRetry={dashboard.retry} />}
    {!investigation && <ErrorBlock message="조사 집계 미제공 · 다시 시도할 수 있습니다." onRetry={dashboard.retry} />}
    {scope === 'institution' ? <InstitutionView today={new Date(`${businessDate}T00:00:00`)} remote={{
      cards: <div data-wiring-id="dashboard.institution.kpis"><SectionCards items={kpis} /></div>,
      range: { from: new Date(`${from}T00:00:00`), to: new Date(`${to}T00:00:00`) },
      onRange: range => setPeriod({ from: range?.from ? isoDate(range.from) : daysBefore(businessDate,29), to: range?.to ? isoDate(range.to) : businessDate }),
      charts: <><div className="shrink-0" data-wiring-id="dashboard.institution.status-chart">{investigation ? <AlertStatusChart data={investigation.dailyAlertStatus} /> : <EmptyBlock>조사 집계 미제공</EmptyBlock>}</div><Card className="min-w-0 max-w-full shrink-0 gap-4 py-4 shadow-none" data-testid="transaction-pattern-hierarchy" data-wiring-id="dashboard.institution.pattern-chart"><CardContent className="flex min-h-0 flex-1 flex-col px-4"><SectionTitle title="의심 거래 구성과 패턴 분포" description={`전체 분석 거래 ${count(agreementTotal)}건의 모델 조합 · 의심 거래 유형별 건수`} />{!pipeline ? <EmptyBlock>탐지 집계 미제공</EmptyBlock> : agreementTotal ? <div className="min-h-0 flex-1"><TransactionPatternHierarchy linked={false} unit="거래" composition={agreementComposition(pipeline.agreements)} distribution={pipeline.types.map(row => ({ pattern: typeDisplay(row.type as TypeCode)?.key ?? String(row.type), alerts: row.count, fill: 'var(--foreground)' }))} /></div> : <EmptyBlock>모델 조합 데이터가 없습니다.</EmptyBlock>}</CardContent></Card></>,
      report: <div className="h-full" data-wiring-id="dashboard.institution.daily-report">{investigation ? <LiveAiDailyReport investigation={investigation} pipeline={pipeline} investigationComputedAt={data.investigationComputedAt} /> : <EmptyBlock>조사 집계 미제공</EmptyBlock>}</div>,
      queue: <div data-wiring-id="dashboard.institution.work"><div className="mb-4 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-5">{[
        ['열린 Episode', investigation?.episodeWork.current.open], ['72시간 이상 경과', investigation?.episodeWork.current.aged], ['검토 전', investigation?.episodeWork.current.unreviewed],
        ['첫 검토 평균', investigation ? duration(investigation.episodeWork.firstReview?.averageSeconds, investigation.episodeWork.firstReview?.samples) : '미제공'],
        ['완료 평균', investigation ? duration(investigation.episodeWork.completion?.averageSeconds, investigation.episodeWork.completion?.samples) : '미제공'],
      ].map(([label, value]) => <div key={label} className="rounded-lg border bg-card p-3"><p className="text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{typeof value === 'number' ? count(value) : value ?? '미제공'}</p></div>)}</div><p className="mb-3 text-xs text-muted-foreground">아래 목록은 위험도순 서버 페이지입니다. 배정 후 오래된 순서는 별도 목록 API 연결 전까지 표시하지 않습니다.</p><LiveWorkQueue personal={false} /></div>,
    }} /> : <PersonalView remote={{
      cards: [
        { label: '내 미처리', value: count(investigation?.personal.pending), trend: '본인 담당', note: investigation ? '열린 Alert · Episode' : '조사 집계 미제공' },
        { label: '72시간 이상 경과', value: count(investigation?.personal.aged), trend: '본인 담당', note: investigation ? '배정 후 72시간 이상 열린 사건' : '조사 집계 미제공' },
      ],
      summary: <PersonalSummaryView><p className="mt-2 text-sm leading-6 text-muted-foreground">담당 사건의 유형과 반복 계좌를 아래 업무 현황에서 확인하세요. LLM 요약은 아직 연결되지 않았습니다.</p><div className="mt-4 flex gap-2"><Input aria-label="RDR 질문" placeholder="질문 기능 미연결" disabled /><Button disabled>질문하기</Button></div></PersonalSummaryView>,
      queue: <div data-wiring-id="dashboard.personal.work"><LiveWorkQueue /></div>,
    }} />}
  </div>
}
