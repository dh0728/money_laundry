import { LiveWorkQueue } from '@/features/dashboard/LiveWorkQueue'
import { InstitutionLayout } from '@/features/dashboard/DashboardPresentation'
import { AlertDailyFlowChart } from '@/features/dashboard/AlertFlowChart'
import { TransactionPatternHierarchy } from '@/features/dashboard/PatternRelation'
import { UnderTabs } from '@/components/UnderTabs'
import { isoDate } from '@/lib/format'
import { RefreshCountdown } from '@/components/RefreshCountdown'
import { useSharedPeriod, useViewState } from '@/lib/workspaceState'
import { RefreshStatus } from '@/components/RefreshStatus'
import { typeDisplay, type TypeCode } from '@/api/codes'
import { fetchDemoClock, fetchLiveDashboard, daysBefore, kstDate, type LiveDashboard } from '@/api/liveDashboard'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { SectionCards } from '@/components/SectionCards'
import { RadarSweep } from '@/features/agent/RadarSweep'
import { rdrSummaryBackground } from '@/features/agent/rdrSummaryStyle'
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
  const first = data.priority[0]
  return <section data-testid="ai-daily-report" aria-label="RDR 9000 Daily Report" className="rounded-xl border bg-card p-5" style={rdrSummaryBackground}>
    <div className="flex flex-wrap items-center gap-2"><RadarSweep className="size-5 shrink-0" /><h2 className="font-semibold">RDR 9000 Daily Report</h2><Badge variant="outline" className="provenance-badge font-normal" data-provenance="mock">mock · LLM 미연동</Badge></div>
    <p className="mt-1 text-xs text-muted-foreground">수치는 서버 집계, 문장은 규칙 기반 시연. AI 분석 결과나 자금세탁 확정 판정 아님.</p>
    <div className="mt-4 grid gap-4 text-sm">
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
    {scope === 'institution' ? <InstitutionLayout cards={<SectionCards items={kpis} />} today={new Date(`${businessDate}T00:00:00`)} range={{ from: new Date(`${from}T00:00:00`), to: new Date(`${to}T00:00:00`) }} onRange={range => setPeriod({ from: range?.from ? isoDate(range.from) : daysBefore(businessDate,29), to: range?.to ? isoDate(range.to) : businessDate })}
      charts={<><AlertDailyFlowChart data={data.daily} /><section className="min-h-80 rounded-xl border bg-card p-4"><h3 className="font-semibold">모델 판정 조합과 탐지 유형</h3><p className="mb-3 text-xs text-muted-foreground">왼쪽: 전체 분석 거래 {count(agreementTotal)}건 · 오른쪽: 모델 의심 거래의 유형별 건수</p>{agreementTotal ? <TransactionPatternHierarchy linked={false} unit="거래" composition={data.agreements.map((row,i) => ({ name: agreementLabels[row.agreement] ?? row.agreement, value: row.count, fill: ['var(--foreground)','var(--muted-foreground)','var(--chart-3)','var(--chart-4)'][i%4] }))} distribution={data.types.map(row => ({ pattern: typeDisplay(row.type as TypeCode)?.key ?? String(row.type), alerts: row.count, fill: 'var(--foreground)' }))} /> : <EmptyBlock>모델 조합 데이터가 없습니다.</EmptyBlock>}</section></>} report={<LiveAiDailyReport data={data} />} /> : <SectionCards items={kpis} />}
    {scope === 'personal' && <LiveWorkQueue />}
    <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">내 우선 검토 사건</h2><p className="mb-3 text-xs text-muted-foreground">위험도와 경과를 확인할 사건</p>{data.priority.length ? <div className="space-y-2">{data.priority.slice(0, 5).map(row => <button key={row.case_id} type="button" className="flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm hover:bg-accent" onClick={() => onOpen(row.kind, row.case_id)}><span className="font-mono">{row.kind === 'ALERT' ? `A-${row.alert_id ?? row.case_id}` : `E-${row.case_id}`}</span><span>위험 {row.risk.toFixed(2)}</span></button>)}</div> : <EmptyBlock>우선 검토 사건이 없습니다.</EmptyBlock>}</section><section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">내 최근 활동</h2><p className="mb-3 text-xs text-muted-foreground">선택 기간의 서버 업무 이력</p>{data.activities.length ? <div className="max-h-64 overflow-auto text-sm">{data.activities.slice(0, 8).map(row => <div key={row.event_id} className="border-b py-2"><p className="font-medium">{row.action} · 조사 사건 {row.case_id}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(row.business_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>{row.comment && <p className="mt-1 text-sm">{row.comment}</p>}</div>)}</div> : <EmptyBlock>선택 기간의 활동이 없습니다.</EmptyBlock>}</section></div>
  </div>
}
