import { LiveWorkQueue } from '@/features/dashboard/LiveWorkQueue'
import { InstitutionView } from '@/features/dashboard/InstitutionView'
import { PersonalView, PersonalSummaryView } from '@/features/dashboard/PersonalView'
import { DailyReportView } from '@/features/dashboard/AiDailyReport'
import { QueueItems } from '@/features/dashboard/LiveWorkQueue'
import { fetchReviewCases } from '@/api/liveReview'
import { useCurrentUser } from '@/app/session'
import { Card, CardContent } from '@/components/ui/card'
import { SectionTitle } from '@/components/page'
import { AlertStatusChart } from '@/features/dashboard/AlertFlowChart'
import { TransactionPatternHierarchy } from '@/features/dashboard/PatternRelation'
import { UnderTabs } from '@/components/UnderTabs'
import { isoDate } from '@/lib/format'
import { RefreshCountdown } from '@/components/RefreshCountdown'
import { useSharedPeriod, useViewState } from '@/lib/workspaceState'
import { RefreshStatus } from '@/components/RefreshStatus'
import { typeDisplay, type TypeCode } from '@/api/codes'
import { fetchDemoClock, fetchLiveDashboard, daysBefore, kstDate, type LiveDashboard } from '@/api/liveDashboard'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import { SectionCards } from '@/components/SectionCards'
import { useAsync } from '@/lib/useAsync'

const count = (n: number | undefined) => (n ?? 0).toLocaleString('ko-KR')
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
  return <DailyReportView generatedAt={data.businessAt} changeSummary={`신규 Alert ${count(today)}건 · 전일 ${count(yesterday)}건${change}`}
    operation={`3일 이상 미처리 Alert ${count(data.openAlertsAgedOver3Days)}건. ${data.pendingReports ? `미완료 보고 ${count(data.pendingReports)}건으로 탐지 집계 확인 필요.` : `오늘 수신 거래 ${count(data.detection.received)}건.`}`}
    focus={<p className="mt-2 text-sm leading-6 text-muted-foreground">선택 기간의 유형별 건수는 왼쪽 분포에서 확인하세요. 서로 다른 사건이 같은 시나리오라는 판정은 아닙니다.</p>}
    priority={<QueueItems kind="ALERT" status="OPEN" personal={false} />} />

}

export default function LiveDashboardPage(_props: { onOpen: (kind: 'ALERT' | 'EPISODE', id: number) => void }) {
  void _props
  const user = useCurrentUser()
  const highRisk = useAsync(() => fetchReviewCases({ kind: 'ALERT', statuses: ['OPEN'], assigneeId: user.userId, risk: 'high', size: 1 }), [user.userId], { key: 'dashboard/high-risk' })
  const [scope, setScope] = useViewState<'personal' | 'institution'>('dashboard/scope', 'institution')
  const clock = useAsync(fetchDemoClock, [], { key: 'clock' })
  const businessDate = clock.state.status === 'success' ? kstDate(clock.state.data.businessAt) : ''
  const { from, to, setPeriod } = useSharedPeriod({ from: businessDate ? daysBefore(businessDate, 29) : '', to: businessDate })
  const dashboard = useAsync(() => from && to ? fetchLiveDashboard(from, to) : Promise.reject(new Error('업무 시각을 확인하지 못했습니다.')), [from, to], { key: 'dashboard', enabled: Boolean(from && to) })

  if (clock.state.status === 'loading') return <LoadingBlock label="업무 시각" />
  if (clock.state.status === 'error') return <ErrorBlock message={clock.state.message} onRetry={clock.retry} />
  if (dashboard.state.status === 'loading') return <LoadingBlock label="대시보드" />
  if (dashboard.state.status === 'error') return <ErrorBlock message={dashboard.state.message} onRetry={dashboard.retry} />
  const data = dashboard.state.data
  const agreementTotal = data.agreements.reduce((sum, row) => sum + row.count, 0)
  const detectionRate = data.detection.received > 0 && data.pendingReports === 0 ? `${((data.detection.suspicious / data.detection.received) * 100).toFixed(1)}%` : '—'
  const yesterday = data.institution.yesterday
  const alertChange = yesterday > 0 ? `${data.institution.today >= yesterday ? '+' : ''}${(((data.institution.today - yesterday) / yesterday) * 100).toFixed(1)}%` : '—'
  const kpis = scope === 'institution'
    ? [
        { label: '오늘 탐지 의심 거래', value: count(data.detection.suspicious), trend: `전체 수신 거래 대비 ${detectionRate}`, note: `대상 거래일 ${data.deliveryDate || '미제공'}` },
        { label: '오늘 유입 Alert', value: count(data.institution.today), delta: yesterday > 0 ? Number(alertChange.slice(0, -1)) : undefined, favorableDirection: 'down' as const, trend: '전일 대비', note: '모델이 의심으로 판별한 신규 Alert' },

        { label: '처리 전 Alert', value: count(data.institution.alerts), trend: `3일 이상 경과 ${count(data.openAlertsAgedOver3Days)}건`, note: '아직 판정하지 않은 Alert' },
        { label: '조사 중 Episode', value: count(data.institution.episodes), trend: `검토 전 ${count(data.episodeWork.current.unreviewed)}건`, note: '진행 중인 Episode' },
      ]
    : [
        { label: '내 미처리', value: count(data.personal.pending), trend: '본인 담당', note: '진행 중인 사건' },
        { label: '72시간 이상 경과', value: count(data.personal.aged), trend: '본인 담당', note: '우선 확인 필요' },
        { label: '선택 기간 내 종결', value: count(data.personal.closed), trend: '본인 담당', note: '최종 판정 완료' },
      ]

  return <div className="space-y-6">
    <RefreshStatus queries={[dashboard]} />
    <div className="flex flex-wrap items-center justify-between gap-3"><UnderTabs value={scope} onChange={setScope} items={[{ value: 'institution', label: '기관 전체' }, { value: 'personal', label: '내 담당' }]} /><span className="text-xs text-muted-foreground">업무 기준 {kstDate(data.businessAt)} · <RefreshCountdown nextRefreshAt={dashboard.nextRefreshAt} refreshing={dashboard.refreshing} /></span></div>
    {scope === 'institution' ? <InstitutionView today={new Date(`${businessDate}T00:00:00`)} remote={{
      cards: <SectionCards items={kpis} />,
      range: { from: new Date(`${from}T00:00:00`), to: new Date(`${to}T00:00:00`) },
      onRange: range => setPeriod({ from: range?.from ? isoDate(range.from) : daysBefore(businessDate,29), to: range?.to ? isoDate(range.to) : businessDate }),
      charts: <><div className="shrink-0"><AlertStatusChart data={data.dailyAlertStatus ?? []} unavailable={data.dailyAlertStatus == null} /></div><Card className="min-w-0 max-w-full shrink-0 gap-4 py-4 shadow-none" data-testid="transaction-pattern-hierarchy"><CardContent className="flex min-h-0 flex-1 flex-col px-4"><SectionTitle title="의심 거래 구성과 패턴 분포" description={`전체 분석 거래 ${count(agreementTotal)}건의 모델 조합 · 의심 거래 유형별 건수`} />{agreementTotal ? <div className="min-h-0 flex-1"><TransactionPatternHierarchy linked={false} unit="거래" composition={data.agreements.map((row,i) => ({ name: agreementLabels[row.agreement] ?? row.agreement, value: row.count, fill: ['var(--foreground)','var(--muted-foreground)','var(--chart-3)','var(--chart-4)'][i%4] }))} distribution={data.types.map(row => ({ pattern: typeDisplay(row.type as TypeCode)?.key ?? String(row.type), alerts: row.count, fill: 'var(--foreground)' }))} /></div> : <EmptyBlock>모델 조합 데이터가 없습니다.</EmptyBlock>}</CardContent></Card></>,
      report: <LiveAiDailyReport data={data} />,
      alerts: <QueueItems kind="ALERT" status="OPEN" personal={false} />,
      episodes: <QueueItems kind="EPISODE" status="OPEN" personal={false} />,
    }} /> : <PersonalView remote={{
      cards: [
        { label: '위험 점수 0.80 이상', value: highRisk.state.status === 'success' ? count(highRisk.state.data.totalElements) : '—', trend: '처리 전 Alert', note: '본인 담당 고위험 건' },
        { label: '3일 이상 경과', value: count(data.personal.aged), trend: 'Alert · Episode', note: '본인 담당 배정 후 72시간 이상' },
      ],
      summary: <PersonalSummaryView><p className="mt-2 text-sm leading-6 text-muted-foreground">담당 사건의 유형과 반복 계좌를 아래 업무 현황에서 확인하세요. LLM 요약은 아직 연결되지 않았습니다.</p></PersonalSummaryView>,
      queue: <LiveWorkQueue />,
    }} />}
    {scope === 'personal' && highRisk.state.status === 'error' && <ErrorBlock message={highRisk.state.message} onRetry={highRisk.retry} />}
  </div>
}
