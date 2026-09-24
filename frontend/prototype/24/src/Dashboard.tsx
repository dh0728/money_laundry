import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { Cell, Pie, PieChart } from 'recharts'
import type { PieLabelRenderProps } from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

export function PatternAxisTick({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value?: string } }) {
  return <text x={x} y={y} dy=".35em" textAnchor="end" style={{ fill: 'var(--foreground)' }} fontSize={11} fontWeight={600}>{payload?.value}</text>
}

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
    { name: '패턴 소속', value: analytics.reduce((total, item) => total + item.patterned, 0), fill: 'var(--foreground)' },
    { name: '패턴 외 · 다건 묶음', value: analytics.reduce((total, item) => total + item.nonPatternMulti, 0), fill: 'var(--foreground)' },
    { name: '패턴 외 · 단일 거래', value: analytics.reduce((total, item) => total + item.nonPatternSingle, 0), fill: 'var(--foreground)' },
  ]
  const distribution = analyticalPatterns.filter(pattern => pattern !== 'NON_PATTERN').map(pattern => ({ pattern, alerts: analytics.reduce((total, item) => total + item.byPattern[pattern], 0), fill: 'var(--foreground)' })).sort((a, b) => b.alerts - a.alerts)
  return { flow, composition, distribution }
}

export const institutionRangeAfterChange = (next: DateRange | undefined) => next

function AiDailyReport({ records, onOpen }: { records: RecordItem[]; onOpen: (record: RecordItem) => void }) {
  const today = dailyFlow.at(-1)!, yesterday = dailyFlow.at(-2)!
  const priority = records.filter(record => record.kind === 'Alert' && record.status !== '종결').slice().sort((a, b) => b.age - a.age || b.score - a.score).slice(0, 3)
  const patternCounts = records.filter(record => record.kind === 'Alert' && record.status !== '종결' && record.pattern !== 'NORMAL').reduce<Record<string, number>>((counts, record) => ({ ...counts, [record.pattern]: (counts[record.pattern] ?? 0) + 1 }), {})
  const focus = Object.entries(patternCounts).sort(([, left], [, right]) => right - left)[0]
  const change = today.inflow - yesterday.inflow
  const changeSummary = change === 0 ? '전일과 같은 수준입니다.' : `전일보다 ${Math.abs(change)}건 ${change > 0 ? '늘었습니다' : '줄었습니다'}.`
  const stale = records.filter(record => record.kind === 'Alert' && record.status !== '종결' && record.age >= 3)
  const unassigned = records.filter(record => record.kind === 'Alert' && record.status !== '종결' && !record.owner)
  const highRisk = records.filter(record => record.kind === 'Alert' && record.status !== '종결' && record.score >= 80)
  return (
    <Card data-testid="ai-daily-report" className="h-full min-w-0 overflow-hidden shadow-none"><CardContent className="flex h-full min-h-0 flex-col">
      <div><h3 className="text-base font-semibold tracking-tight">AI Daily Report</h3><p className="mt-1 text-[11px] text-muted-foreground">생성 시각 <time dateTime="2026-09-16T15:00:00+09:00">2026-09-16 15:00</time></p></div>
      <div className="mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        <div><p className="text-xs font-medium">오늘의 변화</p><p className="mt-2 text-sm leading-6 text-muted-foreground">신규 탐지 흐름이 {changeSummary} 단순 건수보다 장기 경과와 위험 점수가 함께 높은 기록을 먼저 확인해야 합니다.</p></div>
        <div><p className="text-xs font-medium">운영 해석</p><p className="mt-2 text-sm leading-6 text-muted-foreground">3일 이상 미처리 {stale.length}건, 고위험 점수 80 이상 {highRisk.length}건입니다. 미배정 기록은 {unassigned.length}건으로 담당 공백 여부를 함께 점검할 수 있습니다.</p></div>
        <div><p className="text-xs font-medium">집중 패턴</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{focus ? `${focus[0]} 의심이 진행 중인 탐지 ${focus[1]}건으로 가장 많이 관찰됩니다. 동일 소유주·계좌의 반복 여부를 서로 다른 Alert 사이에서도 대조하세요.` : '현재 진행 중인 탐지에서 집중 패턴을 찾지 못했습니다.'}</p></div>
        <div><p className="text-xs font-medium">교차 확인 질문</p><ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-6 text-muted-foreground"><li>같은 소유주나 계좌가 서로 다른 패턴에 반복 등장합니까?</li><li>고액 집중일이 고객 프로필과 거래 목적에 부합합니까?</li><li>장기 경과 건의 증빙 요청과 회신 상태가 기록돼 있습니까?</li></ul></div>
        <div><p className="text-xs font-medium">권고 조치</p><p className="mt-2 text-sm leading-6 text-muted-foreground">아래 장기 경과·고위험 기록부터 근거를 확인하고, 같은 패턴의 연결 거래를 이어서 검토하세요.</p></div>
        <div><p className="text-xs font-medium">우선 검토</p><ul className="mt-2 space-y-3">{priority.map(record => <li key={record.id} data-testid="ai-priority-item" className="rounded-md border px-3 py-2.5"><p className="truncate text-sm">{record.title}</p><p className="mt-1 text-[11px] text-muted-foreground">근거 · {record.pattern} 의심 {record.probability}% · 위험 점수 {record.score} · {record.age === 0 ? '오늘 탐지' : `${record.age}일 경과`}</p><Button variant="link" size="sm" className="mt-1 h-auto p-0 text-xs" onClick={() => onOpen(record)}>근거 보기</Button></li>)}</ul></div>
        <div><p className="text-xs font-medium">다음 점검</p><p className="mt-2 text-sm leading-6 text-muted-foreground">다음 보고 시점에는 우선 검토 3건의 담당 상태, 증빙 확보 여부, 연결 Episode 편입 여부를 비교합니다.</p></div>
      </div>
    </CardContent></Card>
  )
}

type CompositionItem = { name: string; value: number; fill: string }
type PatternDistributionItem = { pattern: string; alerts: number; fill: string }

// The outer ring occupies only the angular range of its patterned parent.
export const dashboardDonutRadii = {
  parentInner: 42,
  parentOuter: 64,
  childInner: 64,
  childOuter: 96,
} as const

// Reverse arcs below the horizontal axis so labels never read upside down.
export function patternArcLabelPath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const bottom = (startAngle + endAngle) / 2 < 0 && (startAngle + endAngle) / 2 > -180
  const point = (angle: number) => {
    const radians = -angle * Math.PI / 180
    return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)].map(value => Math.round(value * 100) / 100)
  }
  const [startX, startY] = point(bottom ? endAngle : startAngle)
  const [endX, endY] = point(bottom ? startAngle : endAngle)
  const largeArc = Math.abs(startAngle - endAngle) > 180 ? 1 : 0
  return `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} ${bottom ? 0 : 1} ${endX} ${endY}`
}

function PatternArcLabel({ cx, cy, innerRadius, outerRadius, startAngle, endAngle, index, name, value }: PieLabelRenderProps) {
  const inner = Number(innerRadius), outer = Number(outerRadius)
  if (!Number.isFinite(inner) || !Number.isFinite(outer) || !value || Math.abs(startAngle - endAngle) < 7) return null
  const namePath = `pattern-name-${index}`
  const countPath = `pattern-count-${index}`
  return <g data-testid="pattern-arc-label" pointerEvents="none">
    <defs>
      <path id={namePath} d={patternArcLabelPath(cx, cy, inner + (outer - inner) * .42, startAngle, endAngle)} />
      <path id={countPath} d={patternArcLabelPath(cx, cy, inner + (outer - inner) * .7, startAngle, endAngle)} />
    </defs>
    <text fill="var(--dashboard-label-on-pastel)" fontSize="10" fontWeight="700" textAnchor="middle"><textPath href={`#${namePath}`} startOffset="50%">{String(name)}</textPath></text>
    <text fill="var(--dashboard-label-on-pastel)" fontSize="9" textAnchor="middle"><textPath href={`#${countPath}`} startOffset="50%">{fmt(Number(value))} Alert</textPath></text>
  </g>
}

export function buildPatternHierarchy(composition: CompositionItem[], distribution: PatternDistributionItem[]) {
  const total = composition.reduce((sum, item) => sum + item.value, 0)
  const patterned = composition[0]?.value ?? 0
  const patternSegments = distribution.map(item => ({ name: item.pattern, value: item.alerts, fill: item.fill, label: `${fmt(item.alerts)} Alert` }))
  const patternShare = total ? patterned / total : 0
  return {
    total,
    patterned,
    patternShare,
    compositionArc: { startAngle: 90, endAngle: -270 },
    patternArc: { startAngle: 90, endAngle: 90 - patternShare * 360 },
    nonPatternArc: { startAngle: 90 - patternShare * 360, endAngle: -270 },
    patternSegments,
    nonPatternSegments: composition.slice(1),
    donutOuter: patternSegments,
    legend: [...patternSegments, ...composition.slice(1).map(item => ({ ...item, label: `${fmt(item.value)}건` }))],
  }
}

type TransactionPatternHierarchyProps = { composition: CompositionItem[]; distribution: PatternDistributionItem[]; view: 'bar' | 'donut' }

// Keep the exported function hook-free because a few static-geometry tests call it
// directly before passing the returned element to React's renderer.
export function TransactionPatternHierarchy(props: TransactionPatternHierarchyProps) {
  return <TransactionPatternHierarchyView {...props} />
}

function TransactionPatternHierarchyView({ composition, distribution, view }: TransactionPatternHierarchyProps) {
  const hierarchy = buildPatternHierarchy(composition, distribution)
  if (view === 'donut') return <div data-testid="transaction-pattern-donut" role="img" aria-label="내부 거래 구성과 패턴 소속 범위 안의 유형별 Alert 분포" className="flex h-full min-h-[320px] min-w-0 items-center">
    <div className="relative mx-auto w-full max-w-[900px] aspect-[900/460]">
      <ChartContainer data-testid="transaction-pattern-donut-chart" config={{ value: { label: '거래' } }} className="absolute left-[55%] top-1/2 h-full w-[51.111%] -translate-x-1/2 -translate-y-1/2 aspect-square"><PieChart accessibilityLayer><ChartTooltip content={<ChartTooltipContent hideLabel nameKey="name" />} /><Pie data={composition} dataKey="value" nameKey="name" startAngle={hierarchy.compositionArc.startAngle} endAngle={hierarchy.compositionArc.endAngle} innerRadius={`${dashboardDonutRadii.parentInner}%`} outerRadius={`${dashboardDonutRadii.parentOuter}%`} stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>{composition.map((item, index) => <Cell key={item.name} data-segment-scope="composition" data-segment-index={index} fill={item.fill} />)}</Pie><Pie data={hierarchy.donutOuter} dataKey="value" nameKey="name" startAngle={hierarchy.patternArc.startAngle} endAngle={hierarchy.patternArc.endAngle} innerRadius={`${dashboardDonutRadii.childInner}%`} outerRadius={`${dashboardDonutRadii.childOuter}%`} stroke="var(--card)" strokeWidth={2} isAnimationActive={false} label={PatternArcLabel} labelLine={false}>{hierarchy.donutOuter.map((item, index) => <Cell key={item.name} data-segment-scope="pattern" data-segment-index={index} fill={item.fill} />)}</Pie></PieChart></ChartContainer>
      <div data-testid="composition-legend" className="absolute inset-y-0 left-0 flex w-[25%] min-w-0 flex-col justify-center gap-2 pr-3 text-[11px]">
        <p className="mb-1 text-xs text-muted-foreground">안쪽 원 · 거래 구성</p>
        {composition.map(item => <div key={item.name} className="flex min-w-0 items-center gap-2"><span data-testid="composition-legend-dot" className="size-2.5 shrink-0 rounded-full border border-border" style={{ background: item.fill }} /><span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span><span className="shrink-0 tabular-nums text-muted-foreground">{fmt(item.value)}건</span></div>)}
      </div>
      <div className="pointer-events-none absolute left-[55%] top-1/2 flex size-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full text-center"><span className="text-[10px] text-muted-foreground">전체 의심 거래</span><strong className="mt-1 text-sm tabular-nums">{fmt(hierarchy.total)}건</strong><span className="mt-1 text-[9px] text-muted-foreground">패턴 소속 {fmt(hierarchy.patterned)}건</span></div>
    </div>
  </div>
  const multi = composition[1], single = composition[2]
  return <div data-testid="transaction-pattern-bar" role="img" aria-label="거래 구성과 패턴별 Alert 분포 계층 막대" className="grid h-full min-h-0 grid-rows-[24px_minmax(180px,1fr)] gap-2">
    <div className="flex min-w-0 items-center justify-end gap-4 text-[11px]" data-testid="bar-gray-callouts">
      {[multi, single].filter((item): item is CompositionItem => Boolean(item)).map(item => <div key={item.name} data-testid="bar-gray-callout" className="flex items-center gap-1.5 whitespace-nowrap"><span data-testid="bar-gray-dot" className="size-2.5 rounded-full border border-border" style={{ background: item.fill }} /><span>{item.name}</span><span className="tabular-nums text-muted-foreground">{fmt(item.value)}건</span></div>)}
    </div>
    <div
      data-testid="hierarchy-bar-grid"
      className="grid h-full min-w-0 grid-rows-2 gap-1.5 overflow-hidden rounded-lg"
      style={{ gridTemplateColumns: composition.map(item => `${item.value}fr`).join(' ') }}
    >
      <div data-testid="pattern-parent-cell" className="row-span-2 grid min-w-0 grid-rows-2 gap-1.5">
        <div data-testid="composition-bar" data-segment-scope="composition" data-segment-index={0} className="flex min-w-0 items-end justify-between gap-3 rounded-md border p-3 text-dashboard-label-on-dark" style={{ background: composition[0]?.fill }} title={`${composition[0]?.name} ${fmt(composition[0]?.value ?? 0)}건`}><span className="text-xs font-semibold">{composition[0]?.name}</span><span className="text-[11px] tabular-nums text-dashboard-label-on-dark/70">{fmt(composition[0]?.value ?? 0)}건</span></div>
        <div data-testid="pattern-parent-range" className="min-w-0">
          <div data-testid="pattern-child-range" className="grid h-full min-w-0 gap-1.5" style={{ gridTemplateColumns: hierarchy.patternSegments.map(item => `${item.value}fr`).join(' ') }}>
            {hierarchy.patternSegments.map((item, index) => <div key={item.name} data-segment-scope="pattern" data-segment-index={index} style={{ background: item.fill }} className="flex min-w-0 flex-col justify-end rounded-md border border-dashboard-segment-divider p-2 text-dashboard-label-on-pastel/75" title={`${item.name} ${item.label}`}><span data-testid="pattern-child-label" className="break-words text-[10px] font-semibold leading-tight">{item.name}</span><span className="mt-0.5 text-[10px] tabular-nums text-dashboard-label-on-pastel/55">{item.label}</span></div>)}
          </div>
        </div>
      </div>
      {composition.slice(1).map((item, index) => <div key={item.name} data-testid="composition-sibling-block" data-segment-scope="composition" data-segment-index={index + 1} className="row-span-2 min-w-0 rounded-md border border-dashboard-segment-divider" style={{ background: item.fill }} title={`${item.name} ${fmt(item.value)}건`} />)}
    </div>
  </div>
}

export function Institution({ records, onOpen }: { records: RecordItem[]; onOpen: (r: RecordItem) => void }) {
  const [range, setRange] = useState<DateRange | undefined>(defaultRange)
  const [patternView, setPatternView] = useState<'bar' | 'donut'>('bar')
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
  return (
    <>
      <SectionCards items={cards} />
      <div data-testid="institution-dashboard-grid" className="grid min-w-0 max-w-full items-stretch gap-4 @6xl:grid-cols-3">
      <section data-testid="institution-chart-group" aria-labelledby="institution-chart-title" className="flex h-full min-h-0 min-w-0 max-w-full flex-col gap-4 rounded-xl border bg-card/35 p-3 @3xl:p-4 @6xl:col-span-2">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 px-1">
          <div><h2 id="institution-chart-title" className="text-base font-semibold tracking-tight">기관 탐지 현황</h2><p className="mt-1 text-xs text-muted-foreground">한 기간 선택이 아래 세 그래프에 함께 적용됩니다.</p></div>
          <DateRangeButton value={range} onChange={next => setRange(institutionRangeAfterChange(next))} />
        </div>
        <div className="shrink-0"><ChartAreaInteractive data={charts.flow} /></div>
        <Card className="h-full min-h-0 min-w-0 max-w-full flex-1 gap-4 py-4 shadow-none" data-testid="transaction-pattern-hierarchy"><CardContent className="flex min-h-0 flex-1 flex-col px-4">
          <SectionTitle title="의심 거래 구성과 패턴 분포" description="내부는 거래 구성, 패턴 소속 영역은 유형별 Alert 비중" action={<Tabs value={patternView} onValueChange={value => setPatternView(value as 'bar' | 'donut')}><TabsList aria-label="거래 구성과 패턴 분포 보기"><TabsTrigger value="bar">계층 막대</TabsTrigger><TabsTrigger value="donut">이중 도넛</TabsTrigger></TabsList></Tabs>} />
          <div data-testid="transaction-pattern-fill" className="min-h-0 flex-1"><TransactionPatternHierarchy composition={charts.composition} distribution={charts.distribution} view={patternView} /></div>
        </CardContent></Card>
      </section>
      <section data-testid="ai-daily-report-section" aria-label="AI Daily Report" className="h-full min-w-0 @6xl:col-span-1">
        <AiDailyReport records={records} onOpen={onOpen} />
      </section>
      </div>
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
