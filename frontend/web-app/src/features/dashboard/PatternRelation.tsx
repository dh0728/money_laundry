// v24 Dashboard.tsx의 관계 막대(넓은 화면)·세로 깔때기(좁은 화면)를 그대로 옮김.
// 왼쪽은 의심 거래 건 구성, 오른쪽은 패턴 소속 거래에서 나온 유형별 Alert 수다. 모수가 달라 길이를 서로 맞추지 않는다.
import { Fragment, useEffect, useState } from 'react'
import { fmt } from '@/lib/format'

export type CompositionItem = { name: string; value: number; fill: string }
export type PatternDistributionItem = { pattern: string; alerts: number; fill: string }

// 넓은 차트는 좌우 관계 막대, 좁은 차트는 세로 깔때기로 그린다(PatternRelationBars가 폭을 재서 고른다).
export function TransactionPatternHierarchy({ composition, distribution }: { composition: CompositionItem[]; distribution: PatternDistributionItem[] }) {
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
function buildPatternRelationLayout(composition: CompositionItem[], distribution: PatternDistributionItem[], width: number, height: number) {
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

