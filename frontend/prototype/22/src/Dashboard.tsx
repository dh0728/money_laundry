import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { Bar, BarChart, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { DateRangeButton, PageHeading, UnderTabs, SectionTitle, RiskBadge, PatternBadge } from './shared'
import { patternOptions, TODAY, type RecordItem } from './domain'
import { SectionCards, type SectionCardItem } from './blocks/section-cards'
import { ChartAreaInteractive, dashboardChartTones, type DailyFlow } from './blocks/chart-area-interactive'

const fmt = (n: number) => n.toLocaleString('ko-KR')
function WorkCard({ record, onOpen, meta }: { record: RecordItem; onOpen: (record: RecordItem) => void; meta?: string }) {
  return (
    <button type="button" onClick={() => onOpen(record)} className="work-card w-full text-left grid grid-cols-[1fr_auto] items-center gap-4 rounded-lg border bg-card px-5 py-4 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring outline-none">
      <span className="min-w-0">
        <span className="block text-xs font-mono text-muted-foreground">{record.id}</span>
        <span className="block text-sm mt-1.5 truncate">{record.title}</span>
        <span className="flex gap-2 mt-2 items-center"><PatternBadge pattern={record.pattern} probability={record.probability} /><span className="text-[11px] text-muted-foreground">{meta ?? `${record.owner} · ${record.age === 0 ? '오늘 탐지' : `${record.age}일 경과`}`}</span></span>
      </span>
      <RiskBadge risk={record.risk} score={record.score} />
    </button>
  )
}

function Personal({ records, user, onOpen }: { records: RecordItem[]; user: string; onOpen: (r: RecordItem) => void }) {
  const mine = records.filter(r => r.owner === user && r.status !== '종결')
  const queue = mine.slice().sort((a, b) => b.score - a.score).slice(0, 5)
  const stats = [
    { label: '내 담당 미처리', value: mine.length, sub: '검토·조사가 필요한 업무' },
    { label: '3일 이상 경과', value: mine.filter(r => r.age >= 3).length, sub: '우선 처리가 필요한 업무' },
    { label: '내 종결', value: records.filter(r => r.owner === user && r.status === '종결').length, sub: '현재 조회 범위 기준' },
  ]
  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        {stats.map(s => (
          <Card key={s.label} className="shadow-none"><CardContent>
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="type-display font-semibold tracking-tight mt-4 tabular-nums">{s.value}<span className="text-sm font-normal ml-1.5 text-muted-foreground">건</span></p>
            <p className="text-[11px] text-muted-foreground mt-2">{s.sub}</p>
          </CardContent></Card>
        ))}
      </div>
      <section aria-labelledby="queue-title">
        <div className="mb-3">
          <h2 id="queue-title" className="text-base font-semibold tracking-tight">먼저 확인할 업무</h2>
          <p className="text-xs text-muted-foreground mt-1.5">위험 점수 높은 순 · 종결 건 제외</p>
        </div>
        {/* 수정안: 바깥 카드 없이 업무마다 독립된 카드를 간격을 두고 나열 */}
        <div className="space-y-2.5" data-testid="work-queue">
          {queue.map(r => (
            <WorkCard key={r.id} record={r} onOpen={onOpen} />
          ))}
        </div>
      </section>
      <section aria-labelledby="activity-title">
        <div className="mb-3">
          <h2 id="activity-title" className="text-base font-semibold tracking-tight">최근 내 활동</h2>
          <p className="text-xs text-muted-foreground mt-1.5">현재 조회 범위에서 최근 처리한 업무</p>
        </div>
        <div className="space-y-2.5">
          {records.filter(r => r.owner === user).slice(0, 3).map((r, i) => (
            <WorkCard key={r.id} record={r} onOpen={onOpen} meta={`${14 - i}:24 · ${r.status === '종결' ? '검토 종결' : '검토 시작'}`} />
          ))}
        </div>
      </section>
    </>
  )
}

// 9/18 회의: 기관 전체는 EDA 전시장이 아니라 업무 요약만. 모델 팀 지표 확정 전이라 추이는 결정적 예시값이다.
export const dailyFlow: DailyFlow[] = Array.from({ length: 91 }, (_, i) => {
  const d = new Date(TODAY); d.setDate(d.getDate() - (90 - i))
  const inflow = 38 + Math.round(14 * Math.sin(i / 5) + 9 * Math.sin(i / 1.7) + i / 6)
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { date, inflow, closed: Math.max(0, inflow - 6 + Math.round(7 * Math.cos(i / 3))) }
})
const analyticalPatterns = patternOptions.filter(pattern => pattern !== 'NORMAL')

// 기관 대시보드는 목록에 적재된 최신 업무만이 아니라 같은 91일 범위의 일별 집계 스냅샷을 사용한다.
// 현재 레코드의 패턴/거래량 비율을 기준으로 결정적으로 생성해 기간 변경 시 세 그래프가 같은 범위로 움직인다.
function dailyPatternAnalytics(records: RecordItem[]) {
  const alerts = records.filter(record => record.kind === 'Alert')
  const weights = analyticalPatterns.map(pattern => Math.max(1, alerts.filter(record => record.pattern === pattern).length))
  const averageTransactions = analyticalPatterns.map(pattern => {
    const matching = alerts.filter(record => record.pattern === pattern)
    return matching.length ? Math.max(1, Math.round(matching.reduce((total, record) => total + record.count, 0) / matching.length)) : 1
  })

  return dailyFlow.map((flow, dayIndex) => {
    const scores = weights.map((weight, patternIndex) => weight * (0.78 + ((dayIndex * (patternIndex + 3) + patternIndex * 5) % 11) / 20))
    const scoreTotal = scores.reduce((total, score) => total + score, 0)
    const counts = scores.map(score => Math.floor(flow.inflow * score / scoreTotal))
    let remainder = flow.inflow - counts.reduce((total, count) => total + count, 0)
    for (let offset = 0; remainder > 0; offset += 1, remainder -= 1) counts[(dayIndex + offset) % counts.length] += 1

    const byPattern = Object.fromEntries(analyticalPatterns.map((pattern, index) => [pattern, counts[index]])) as Record<(typeof analyticalPatterns)[number], number>
    const nonPatternIndex = analyticalPatterns.indexOf('NON_PATTERN')
    const nonPatternTransactions = counts[nonPatternIndex] * averageTransactions[nonPatternIndex]
    const multiShare = 0.72 + (dayIndex % 3) * 0.07
    const nonPatternMulti = Math.round(nonPatternTransactions * multiShare)
    const patterned = analyticalPatterns.reduce((total, pattern, index) => pattern === 'NON_PATTERN' ? total : total + counts[index] * averageTransactions[index], 0)
    return { date: flow.date, byPattern, patterned, nonPatternMulti, nonPatternSingle: nonPatternTransactions - nonPatternMulti }
  })
}
const sum = (rows: DailyFlow[], k: 'inflow' | 'closed') => rows.reduce((a, r) => a + r[k], 0)
const pct = (now: number, before: number) => Math.round((now - before) / before * 1000) / 10

const defaultRange = (() => { const from = new Date(TODAY); from.setDate(from.getDate() - 29); return { from, to: TODAY } })()
const inRange = (date: string, range?: DateRange) => {
  if (!range) return true
  const value = new Date(`${date}T12:00:00`)
  const from = range.from ? new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate()) : undefined
  const to = range.to ? new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1) : undefined
  return (!from || value >= from) && (!to || value < to)
}

export function buildInstitutionChartData(records: RecordItem[], range?: DateRange) {
  const flow = dailyFlow.filter(item => inRange(item.date, range))
  const analytics = dailyPatternAnalytics(records).filter(item => inRange(item.date, range))
  const composition = [
    { name: '패턴 소속', value: analytics.reduce((total, item) => total + item.patterned, 0), fill: dashboardChartTones.primary },
    { name: '패턴 외 · 다건 묶음', value: analytics.reduce((total, item) => total + item.nonPatternMulti, 0), fill: 'color-mix(in oklch, var(--foreground) 58%, var(--muted))' },
    { name: '패턴 외 · 단일 거래', value: analytics.reduce((total, item) => total + item.nonPatternSingle, 0), fill: 'var(--muted-foreground)' },
  ]
  const distribution = analyticalPatterns.map(pattern => ({ pattern, alerts: analytics.reduce((total, item) => total + item.byPattern[pattern], 0) })).filter(item => item.alerts > 0).sort((a, b) => b.alerts - a.alerts)
  return { flow, composition, distribution }
}

export const institutionRangeAfterChange = (next: DateRange | undefined) => next

export function Institution({ records, onOpen }: { records: RecordItem[]; onOpen: (r: RecordItem) => void }) {
  const [range, setRange] = useState<DateRange | undefined>(defaultRange)
  const charts = buildInstitutionChartData(records, range)
  const today = dailyFlow[dailyFlow.length - 1], yesterday = dailyFlow[dailyFlow.length - 2]
  const last30 = dailyFlow.slice(-30), prev30 = dailyFlow.slice(-60, -30)
  const rate = (rows: DailyFlow[]) => Math.round(sum(rows, 'closed') / sum(rows, 'inflow') * 1000) / 10
  const open = records.filter(r => r.kind === 'Alert' && r.status !== '종결')
  const stale = open.filter(r => r.age >= 3)
  const cards: SectionCardItem[] = [
    { label: '오늘 유입 Alert', value: fmt(today.inflow), delta: pct(today.inflow, yesterday.inflow), trend: '전일 대비', note: '모델이 의심으로 판별한 신규 건' },
    { label: '30일 처리율', value: `${rate(last30)}%`, delta: Math.round((rate(last30) - rate(prev30)) * 10) / 10, unit: '%p', trend: '직전 30일 대비', note: '처리 완료 ÷ 유입' },
    { label: '미처리 Alert', value: fmt(open.length), trend: '현재 조회 범위', note: '종결되지 않은 Alert' },
    { label: '3일 이상 경과', value: fmt(stale.length), trend: '우선 처리 대상', note: '미처리 중 3일 이상 경과' },
  ]
  const recent = open.slice().sort((a, b) => b.date.localeCompare(a.date) || b.score - a.score).slice(0, 5)
  const compositionTotal = charts.composition.reduce((total, item) => total + item.value, 0)
  return (
    <>
      <SectionCards items={cards} />
      <section data-testid="institution-chart-group" aria-labelledby="institution-chart-title" className="min-w-0 max-w-full space-y-4 rounded-xl border bg-card/35 p-3 @3xl:p-4">
        <div className="flex flex-wrap items-center justify-between gap-4 px-1">
          <div><h2 id="institution-chart-title" className="text-base font-semibold tracking-tight">기관 탐지 현황</h2><p className="mt-1 text-xs text-muted-foreground">한 기간 선택이 아래 세 그래프에 함께 적용됩니다.</p></div>
          <DateRangeButton value={range} onChange={next => setRange(institutionRangeAfterChange(next))} />
        </div>
        <ChartAreaInteractive data={charts.flow} />
        <div data-testid="institution-lower-charts" className="grid min-w-0 max-w-full gap-4 @5xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
        <Card className="min-w-0 max-w-full shadow-none" data-testid="laundering-composition-chart"><CardContent className="min-w-0">
          <SectionTitle title="세탁 거래 구성" description={`선택 기간 의심 거래 ${fmt(compositionTotal)}건`} />
          <div className="grid min-w-0 items-center gap-5 @3xl:grid-cols-[180px_minmax(0,1fr)]">
            <ChartContainer config={{ value: { label: '거래' } }} className="mx-auto h-[180px] w-[180px]">
              <PieChart accessibilityLayer><ChartTooltip content={<ChartTooltipContent hideLabel nameKey="name" />} /><Pie data={charts.composition} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} strokeWidth={2} activeShape={{ fill: dashboardChartTones.active }}>{charts.composition.map(item => <Cell key={item.name} fill={item.fill} />)}</Pie></PieChart>
            </ChartContainer>
            <div className="min-w-0 flex flex-col gap-3 text-xs">{charts.composition.map(item => <p key={item.name} className="grid min-w-0 grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2"><i className="size-2.5 rounded-sm border" style={{ background: item.fill }} aria-hidden />{item.name}<span className="tabular-nums">{fmt(item.value)}</span></p>)}</div>
          </div>
        </CardContent></Card>
        <Card className="min-w-0 max-w-full shadow-none" data-testid="pattern-distribution-chart"><CardContent className="min-w-0">
          <SectionTitle title="패턴별 Alert 분포" description="선택 기간 · 탐지 유형별 Alert 건수" />
          <ChartContainer config={{ alerts: { label: 'Alert', color: dashboardChartTones.primary } }} className="h-[260px] min-w-0 max-w-full w-full">
            <BarChart accessibilityLayer data={charts.distribution} layout="vertical" margin={{ left: 18, right: 28 }}>
              <XAxis type="number" allowDecimals={false} hide /><YAxis type="category" dataKey="pattern" width={116} tickLine={false} axisLine={false} fontSize={11} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="alerts" name="의심 Alert" fill="var(--color-alerts)" activeBar={{ fill: dashboardChartTones.active }} radius={3} label={{ position: 'right', fontSize: 11, fill: 'var(--muted-foreground)' }} />
            </BarChart>
          </ChartContainer>
        </CardContent></Card>
        </div>
      </section>
      <section aria-labelledby="recent-title">
        <div className="mb-3">
          <h2 id="recent-title" className="text-base font-semibold tracking-tight">최근 유입 Alert</h2>
          <p className="text-xs text-muted-foreground mt-1.5">미처리 · 최신순</p>
        </div>
        <div className="space-y-2.5">
          {recent.map(r => (
            <WorkCard key={r.id} record={r} onOpen={onOpen} />
          ))}
        </div>
      </section>
    </>
  )
}

export default function Dashboard({ records, user, onOpen }: { records: RecordItem[]; user: string; onOpen: (r: RecordItem) => void }) {
  const [scope, setScope] = useState('personal')
  return (
    <div className="space-y-6">
      <PageHeading title="대시보드" description="담당 업무와 기관 탐지 현황을 확인합니다." />
      <UnderTabs value={scope} onChange={setScope} items={[{ value: 'personal', label: '내 담당' }, { value: 'institution', label: '기관 전체' }]} />
      {scope === 'personal' ? <Personal records={records} user={user} onOpen={onOpen} /> : <Institution records={records} onOpen={onOpen} />}
    </div>
  )
}
