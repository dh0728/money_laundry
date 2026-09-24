import { Fragment, useEffect, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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

type TransactionPatternHierarchyProps = { composition: CompositionItem[]; distribution: PatternDistributionItem[] }

// 넓은 차트는 좌우 관계 막대, 좁은 차트는 세로 깔때기로 그린다(PatternRelationBars가 폭을 재서 고른다).
export function TransactionPatternHierarchy({ composition, distribution }: TransactionPatternHierarchyProps) {
  return <PatternRelationBars composition={composition} distribution={distribution} />
}

// 이 폭보다 좁으면 좌우 배치 대신 세로 깔때기로 바꾼다.
export const RELATION_STACK_BREAKPOINT = 720

const sharePct = (value: number, total: number) => {
  const share = total ? value / total * 100 : 0
  return `${share >= 10 ? Math.round(share) : Math.round(share * 10) / 10}%`
}

// v24: 왼쪽 세로 기둥은 거래 건 비율(실제 비례), 오른쪽 막대는 패턴 소속 거래에서 나온 Alert 수.
// 모수가 다르므로 오른쪽 막대 길이는 기둥과 무관하게 최대 Alert 기준으로 잰다.
export function buildPatternRelationLayout(composition: CompositionItem[], distribution: PatternDistributionItem[], width: number, height: number) {
  const header = 28, padX = 12, gap = 8, bottomPad = 12
  const leftW = Math.round(Math.min(260, Math.max(176, width * .26)))
  const bodyTop = header + 8, bodyH = Math.max(120, height - bodyTop - bottomPad)
  const total = composition.reduce((sum, item) => sum + item.value, 0)
  const rowCount = Math.max(1, distribution.length)
  const pillH = Math.max(18, Math.min(28, bodyH / rowCount - 6))
  const columnW = pillH, columnX = leftW - padX - columnW, segmentGap = 2, minSegment = 4
  const available = bodyH - segmentGap * Math.max(0, composition.length - 1)
  const raw = composition.map(item => total ? item.value / total * available : available / Math.max(1, composition.length))
  const boosted = raw.map(value => Math.max(minSegment, value))
  const excess = boosted.reduce((a, b) => a + b, 0) - available
  const largest = boosted.indexOf(Math.max(...boosted))
  if (excess > 0 && largest >= 0) boosted[largest] -= excess
  let cursor = bodyTop
  const segments = composition.map((item, index) => {
    const y = cursor, h = boosted[index]
    cursor += h + segmentGap
    return { ...item, index, y, h, share: sharePct(item.value, total) }
  })
  // 이름표는 원칙적으로 칸 가운데에 두고, 좁은 칸끼리 겹치면 아래에서부터 밀어 올린다.
  const labelH = 30, labelGap = 4
  const labels = segments.map(segment => ({ index: segment.index, y: segment.y + segment.h / 2, anchorY: segment.y + segment.h / 2 }))
  for (let i = labels.length - 1; i >= 0; i--) {
    const floor = i === labels.length - 1 ? bodyTop + bodyH - labelH / 2 : labels[i + 1].y - labelH - labelGap
    labels[i].y = Math.min(labels[i].y, floor)
  }
  for (let i = 0; i < labels.length; i++) {
    const ceiling = i === 0 ? bodyTop + labelH / 2 : labels[i - 1].y + labelH + labelGap
    labels[i].y = Math.max(labels[i].y, ceiling)
  }
  const labelRight = columnX - 14
  const rightX = leftW + gap, rightW = Math.max(0, width - rightX)
  const pillW = 136, pillX = rightX + padX
  const barX = pillX + pillW + 6, barMax = Math.max(24, width - padX - barX)
  const rowH = distribution.length ? bodyH / distribution.length : 0
  const maxAlerts = Math.max(1, ...distribution.map(item => item.alerts))
  const parent = segments[0]
  const rows = distribution.map((item, index) => {
    const cy = bodyTop + rowH * (index + .5)
    const barW = Math.max(pillH, item.alerts / maxAlerts * barMax)
    const fromY = parent ? parent.y + parent.h * (index + .5) / distribution.length : cy
    return { ...item, index, cy, barW, countInside: barW >= 44, fromY }
  })
  const linkFromX = columnX + columnW, linkToX = pillX
  const links = rows.map(row => {
    const mid = (linkFromX + linkToX) / 2
    return `M ${linkFromX} ${round(row.fromY)} C ${round(mid)} ${round(row.fromY)} ${round(mid)} ${round(row.cy)} ${linkToX} ${round(row.cy)}`
  })
  return { width, height, header, padX, leftW, rightX, rightW, bodyTop, bodyH, total, columnX, columnW, segments, labels, labelRight, labelH, pillX, pillW, pillH, barX, rows, links }
}
const round = (value: number) => Math.round(value * 10) / 10

function useElementSize<T extends HTMLElement>(fallback: { width: number; height: number }) {
  const [size, setSize] = useState(fallback)
  const [node, setNode] = useState<T | null>(null)
  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize(prev => Math.abs(prev.width - width) < .1 && Math.abs(prev.height - height) < .1 ? prev : { width, height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])
  return [setNode, size] as const
}

// 좁은 차트: 전체 막대의 '패턴 소속' 칸이 아래로 퍼지며 패턴별 막대를 받친다(깔때기).
// 이름표는 막대 위에 두고, 깔때기 폭은 패턴 소속 비율에서 전체 폭으로 넓어진다.
export function PatternRelationStack({ composition, distribution }: { composition: CompositionItem[]; distribution: PatternDistributionItem[] }) {
  const total = composition.reduce((sum, item) => sum + item.value, 0)
  const patternedShare = total ? (composition[0]?.value ?? 0) / total * 100 : 100
  const maxAlerts = Math.max(1, ...distribution.map(item => item.alerts))
  const [funnelRef, funnelSize] = useElementSize<HTMLDivElement>({ width: 320, height: 44 })
  // 독립 변수: 실제로 그려진 '패턴 소속' 막대의 폭. 깔때기 상단 폭은 이 값을 그대로 따른다(종속 변수).
  const [patternedRef, patternedSize] = useElementSize<HTMLDivElement>({ width: 320 * patternedShare / 100, height: 24 })
  const funnelW = funnelSize.width, funnelH = 44
  const patternedEnd = round(Math.min(patternedSize.width, funnelW))
  // 양 끝 접선을 수직으로 둔 S자 곡선: 막대 끝에서 곧게 내려와 전체 폭으로 부드럽게 퍼진다.
  const funnel = `M 0 0 L ${patternedEnd} 0 C ${patternedEnd} ${funnelH * .6} ${round(funnelW)} ${funnelH * .4} ${round(funnelW)} ${funnelH} L 0 ${funnelH} Z`
  return <div data-testid="transaction-pattern-stack" role="img" aria-label="전체 의심 거래 구성(거래 건)과 패턴 소속 거래의 유형별 Alert 분포" className="min-w-0 rounded-lg border bg-muted/30 p-3">
    <div data-testid="relation-total-panel">
      <p className="text-xs font-medium">전체 구성 <span className="font-normal text-muted-foreground">· 거래 건</span></p>
      <ul className="mt-2.5 space-y-1">{composition.map(item => <li key={item.name} data-testid="relation-total-label" className="flex min-w-0 items-center gap-2 text-xs"><strong className="w-10 shrink-0 font-semibold tabular-nums">{sharePct(item.value, total)}</strong><span className="min-w-0 flex-1 truncate">{item.name}</span><span className="shrink-0 tabular-nums text-muted-foreground">{fmt(item.value)}건</span></li>)}</ul>
      <div className="mt-2.5 flex h-6 gap-0.5">{composition.map((item, index) => <div key={item.name} ref={index === 0 ? patternedRef : undefined} data-testid="relation-total-segment" data-segment-scope="composition" data-segment-index={index} className={`min-w-1 ${index === 0 ? 'rounded-t-md rounded-b-none' : 'rounded-md border border-dashboard-segment-divider'}`} style={{ flexGrow: item.value, flexBasis: 0, background: item.fill }} />)}</div>
    </div>
    <div ref={funnelRef} className="-mt-px h-11 w-full">
      <svg data-testid="relation-link" aria-hidden="true" className="block h-full w-full overflow-visible" width={round(funnelW)} height={funnelH} viewBox={`0 0 ${round(funnelW)} ${funnelH}`}>
        <defs><linearGradient id="pattern-funnel-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: 'var(--foreground)', stopOpacity: 1 }} /><stop offset="1" style={{ stopColor: 'var(--foreground)', stopOpacity: .08 }} /></linearGradient></defs>
        <path d={funnel} fill="url(#pattern-funnel-fade)" />
      </svg>
    </div>
    <div data-testid="relation-pattern-panel" className="rounded-b-md bg-foreground/[.08] p-2.5">
      <p className="text-xs font-medium">패턴 소속의 유형별 <span className="font-normal text-muted-foreground">· Alert</span></p>
      <div className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">{distribution.map((item, index) => <Fragment key={item.pattern}>
        <span data-testid="pattern-child-label" data-segment-index={index} className="flex h-6 items-center rounded-full bg-foreground px-2.5 font-mono text-[11px] text-background">{item.pattern}</span>
        <span className="flex min-w-0 items-center"><span data-testid="relation-pattern-bar" data-segment-scope="pattern" className="flex h-6 min-w-11 items-center justify-start rounded-full bg-foreground px-3 text-[11px] tabular-nums text-background" style={{ width: `${Math.max(8, item.alerts / maxAlerts * 100)}%` }}>{fmt(item.alerts)}</span></span>
      </Fragment>)}</div>
    </div>
  </div>
}

function PatternRelationBars({ composition, distribution }: { composition: CompositionItem[]; distribution: PatternDistributionItem[] }) {
  const [ref, size] = useElementSize<HTMLDivElement>({ width: 720, height: 320 })
  if (size.width < RELATION_STACK_BREAKPOINT) return <div ref={ref} className="h-full w-full min-w-0"><PatternRelationStack composition={composition} distribution={distribution} /></div>
  const layout = buildPatternRelationLayout(composition, distribution, size.width, size.height)
  const panel = 'absolute top-0 bottom-0 rounded-lg border bg-muted/30'
  return <div ref={ref} data-testid="transaction-pattern-bar" role="img" aria-label="전체 의심 거래 구성(거래 건)과 패턴 소속 거래의 유형별 Alert 분포" className="relative h-full min-h-[320px] w-full min-w-0 overflow-hidden">
    <div data-testid="relation-total-panel" className={panel} style={{ left: 0, width: layout.leftW }} />
    <div data-testid="relation-pattern-panel" className={panel} style={{ left: layout.rightX, width: layout.rightW }} />
    <p className="absolute text-xs font-medium" style={{ left: layout.padX, top: 8 }}>전체 구성 <span className="font-normal text-muted-foreground">· 거래 건</span></p>
    <p className="absolute text-xs font-medium" style={{ left: layout.pillX, top: 8 }}>패턴별 유형 <span className="font-normal text-muted-foreground">· Alert</span></p>
    <svg data-testid="relation-lines" className="pointer-events-none absolute inset-0 overflow-visible" width={layout.width} height={layout.height} aria-hidden="true">
      {layout.links.map((d, index) => <path key={index} data-testid="relation-link" d={d} fill="none" stroke="var(--muted-foreground)" strokeOpacity={.45} strokeWidth={1.25} />)}
      {layout.labels.map(label => {
        const segment = layout.segments[label.index]
        const d = `M ${layout.labelRight} ${round(label.y)} C ${layout.labelRight + 6} ${round(label.y)} ${layout.columnX - 6} ${round(label.anchorY)} ${layout.columnX} ${round(label.anchorY)}`
        return <g key={segment.name} data-testid="relation-label-leader"><path d={d} fill="none" stroke="var(--muted-foreground)" strokeOpacity={.5} strokeWidth={1} /><circle cx={layout.labelRight} cy={round(label.y)} r={2.5} fill="var(--muted-foreground)" /></g>
      })}
    </svg>
    {layout.segments.map(segment => <div key={segment.name} data-testid="relation-total-segment" data-segment-scope="composition" data-segment-index={segment.index} className="absolute rounded-md border border-dashboard-segment-divider" style={{ left: layout.columnX, top: segment.y, width: layout.columnW, height: segment.h, background: segment.fill }} title={`${segment.name} ${fmt(segment.value)}건 · ${segment.share}`} />)}
    {layout.labels.map(label => {
      const segment = layout.segments[label.index]
      return <div key={segment.name} data-testid="relation-total-label" className="absolute flex flex-col items-end justify-center text-right leading-tight" style={{ left: layout.padX, width: layout.labelRight - 6 - layout.padX, top: label.y - layout.labelH / 2, height: layout.labelH }} title={`${segment.name} ${fmt(segment.value)}건`}>
        <span className="max-w-full truncate text-xs"><strong className="font-semibold tabular-nums">{segment.share}</strong> {segment.name}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{fmt(segment.value)}건</span>
      </div>
    })}
    {layout.rows.map(row => <div key={row.pattern} data-testid="relation-pattern-row" data-segment-scope="pattern" data-segment-index={row.index} className="absolute flex items-center" style={{ left: layout.pillX, top: row.cy - layout.pillH / 2, height: layout.pillH, width: layout.width - layout.padX - layout.pillX }} title={`${row.pattern} ${fmt(row.alerts)} Alert`}>
      <span data-testid="pattern-child-label" className="flex h-full shrink-0 items-center rounded-full bg-foreground px-3 font-mono text-[11px] text-background" style={{ width: layout.pillW }}><span className="truncate">{row.pattern}</span></span>
      <span data-testid="relation-pattern-bar" className="ml-1.5 flex h-full items-center justify-start rounded-full bg-foreground px-3 text-[11px] tabular-nums text-background" style={{ width: row.barW }}>{row.countInside && fmt(row.alerts)}</span>
      {!row.countInside && <span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground">{fmt(row.alerts)}</span>}
    </div>)}
  </div>
}

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
          <SectionTitle title="의심 거래 구성과 패턴 분포" description="전체 구성은 거래 건, 패턴별 유형은 패턴 소속 거래의 Alert 수" />
          <div data-testid="transaction-pattern-fill" className="min-h-0 flex-1"><TransactionPatternHierarchy composition={charts.composition} distribution={charts.distribution} /></div>
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
