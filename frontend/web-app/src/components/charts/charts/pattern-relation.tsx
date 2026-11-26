// v24 Dashboard.tsx의 관계 막대(넓은 화면)·세로 깔때기(좁은 화면)를 그대로 옮김.
// 왼쪽은 의심 거래 건 구성, 오른쪽은 패턴 소속 거래에서 나온 유형별 Alert 수다. 모수가 달라 길이를 서로 맞추지 않는다.
import { Fragment, useEffect, useId, useState, type ComponentProps, type CSSProperties } from 'react'
import { fmt } from '@/lib/format'
import { Box, Text } from '../../layout-primitives'
import { readChartNumber } from '../chart-design-values'
import './pattern-relation.css'

export type CompositionItem = { name: string; value: number; fill: string }
export type PatternDistributionItem = { pattern: string; alerts: number; fill: string }

// 넓은 차트는 좌우 관계 막대, 좁은 차트는 세로 깔때기로 그린다(PatternRelationBars가 폭을 재서 고른다).
type PatternProps = { composition: CompositionItem[]; distribution: PatternDistributionItem[]; linked?: boolean; unit?: string }
export function TransactionPatternHierarchy(props: PatternProps) {
  return <PatternRelationBars {...props} />
}

// 이 폭보다 좁으면 좌우 배치 대신 세로 깔때기로 바꾼다.
export const RELATION_STACK_BREAKPOINT = 720
function readPatternRelationSizes() {
  return {
    breakpoint: readChartNumber('--pattern-relation-breakpoint', RELATION_STACK_BREAKPOINT),
    height: readChartNumber('--pattern-relation-wide-height', 400),
    headingHeight: readChartNumber('--pattern-relation-heading-height', 28),
    panelPadding: readChartNumber('--aml-space-12', 12),
    panelGap: readChartNumber('--aml-space-8', 8),
    minColumnWidth: readChartNumber('--pattern-relation-column-min', 176),
    maxColumnWidth: readChartNumber('--pattern-relation-column-max', 260),
    columnShare: readChartNumber('--pattern-relation-column-share', 0.26),
    minBodyHeight: readChartNumber('--pattern-relation-body-min', 120),
    minPillHeight: readChartNumber('--pattern-relation-pill-min-height', 18),
    pillWidth: readChartNumber('--pattern-relation-pill-width', 136),
    rowGap: readChartNumber('--aml-space-6', 6),
    segmentGap: readChartNumber('--aml-space-2', 2),
    segmentMin: readChartNumber('--aml-space-4', 4),
    labelHeight: readChartNumber('--pattern-relation-label-height', 30),
    leaderGap: readChartNumber('--pattern-relation-leader-gap', 14),
    minBarWidth: readChartNumber('--aml-space-24', 24),
    insetCountWidth: readChartNumber('--pattern-relation-count-inset-width', 44),
  }
}

type PositionedRelationBoxProps = Omit<ComponentProps<'div'>, 'style'> & {
  x: number
  y: number
  width: number
  height: number
  fill?: string
}

function PositionedRelationBox({ className, x, y, width, height, fill, ...props }: PositionedRelationBoxProps) {
  return (
    <Box
      {...props}
      className={`pattern-relation-positioned absolute ${className ?? ''}`}
      style={{
        '--relation-x': `${x}px`,
        '--relation-y': `${y}px`,
        '--relation-width': `${width}px`,
        '--relation-height': `${height}px`,
        '--relation-fill': fill,
      } as CSSProperties}
    />
  )
}

const sharePct = (value: number, total: number) => {
  const share = total ? value / total * 100 : 0
  return `${share >= 10 ? Math.round(share) : Math.round(share * 10) / 10}%`
}

// v24: 왼쪽 세로 기둥은 거래 건 비율(실제 비례), 오른쪽 막대는 패턴 소속 거래에서 나온 Alert 수.
// 모수가 다르므로 오른쪽 막대 길이는 기둥과 무관하게 최대 Alert 기준으로 잰다.
function buildPatternRelationLayout(composition: CompositionItem[], distribution: PatternDistributionItem[], width: number, sizes: ReturnType<typeof readPatternRelationSizes>) {
  const { height, headingHeight, panelPadding: padX, panelGap: gap, rowGap, segmentGap, segmentMin, labelHeight: labelH } = sizes
  const leftW = Math.round(Math.min(sizes.maxColumnWidth, Math.max(sizes.minColumnWidth, width * sizes.columnShare)))
  const bodyTop = headingHeight + gap, bodyH = Math.max(sizes.minBodyHeight, height - bodyTop - padX)
  const total = composition.reduce((sum, item) => sum + item.value, 0)
  const rowCount = Math.max(1, distribution.length)
  const pillH = Math.max(sizes.minPillHeight, Math.min(headingHeight, bodyH / rowCount - rowGap))
  const columnW = pillH, columnX = leftW - padX - columnW
  const available = bodyH - segmentGap * Math.max(0, composition.length - 1)
  const raw = composition.map(item => total ? item.value / total * available : available / Math.max(1, composition.length))
  const boosted = raw.map(value => Math.max(segmentMin, value))
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
  const labelGap = segmentMin
  const labels = segments.map(segment => ({ index: segment.index, y: segment.y + segment.h / 2, anchorY: segment.y + segment.h / 2 }))
  for (let i = labels.length - 1; i >= 0; i--) {
    const floor = i === labels.length - 1 ? bodyTop + bodyH - labelH / 2 : labels[i + 1].y - labelH - labelGap
    labels[i].y = Math.min(labels[i].y, floor)
  }
  for (let i = 0; i < labels.length; i++) {
    const ceiling = i === 0 ? bodyTop + labelH / 2 : labels[i - 1].y + labelH + labelGap
    labels[i].y = Math.max(labels[i].y, ceiling)
  }
  const labelRight = columnX - sizes.leaderGap
  const rightX = leftW + gap, rightW = Math.max(0, width - rightX)
  const pillW = sizes.pillWidth, pillX = rightX + padX
  const barX = pillX + pillW + rowGap, barMax = Math.max(sizes.minBarWidth, width - padX - barX)
  const rowH = distribution.length ? bodyH / distribution.length : 0
  const maxAlerts = Math.max(1, ...distribution.map(item => item.alerts))
  const parent = segments[0]
  const rows = distribution.map((item, index) => {
    const cy = bodyTop + rowH * (index + .5)
    const barW = Math.max(pillH, item.alerts / maxAlerts * barMax)
    const fromY = parent ? parent.y + parent.h * (index + .5) / distribution.length : cy
    return { ...item, index, cy, barW, countInside: barW >= sizes.insetCountWidth, fromY }
  })
  const linkFromX = columnX + columnW, linkToX = pillX
  const links = rows.map(row => {
    const mid = (linkFromX + linkToX) / 2
    return `M ${linkFromX} ${round(row.fromY)} C ${round(mid)} ${round(row.fromY)} ${round(mid)} ${round(row.cy)} ${linkToX} ${round(row.cy)}`
  })
  return { width, height, padX, leftW, rightX, rightW, columnX, columnW, segments, labels, labelRight, labelH, pillX, pillW, pillH, rows, links }
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
export function PatternRelationStack({ composition, distribution, linked = true, unit = 'Alert' }: PatternProps) {
  const total = composition.reduce((sum, item) => sum + item.value, 0)
  const patternedShare = total ? (composition[0]?.value ?? 0) / total * 100 : 100
  const maxAlerts = Math.max(1, ...distribution.map(item => item.alerts))
  const funnelGradient = useId()
  const [sizes] = useState(() => ({
    fallbackWidth: readChartNumber('--pattern-relation-fallback-width', 320),
    funnelHeight: readChartNumber('--pattern-relation-funnel-height', 44),
    barHeight: readChartNumber('--aml-space-24', 24),
    minShare: readChartNumber('--pattern-relation-min-share', 8),
  }))
  const [funnelRef, funnelSize] = useElementSize<HTMLDivElement>({ width: sizes.fallbackWidth, height: sizes.funnelHeight })
  // 독립 변수: 실제로 그려진 '패턴 소속' 막대의 폭. 깔때기 상단 폭은 이 값을 그대로 따른다(종속 변수).
  const [patternedRef, patternedSize] = useElementSize<HTMLDivElement>({ width: sizes.fallbackWidth * patternedShare / 100, height: sizes.barHeight })
  const funnelW = funnelSize.width, funnelH = sizes.funnelHeight
  const patternedEnd = round(Math.min(patternedSize.width, funnelW))
  // 양 끝 접선을 수직으로 둔 S자 곡선: 막대 끝에서 곧게 내려와 전체 폭으로 부드럽게 퍼진다.
  const funnel = `M 0 0 L ${patternedEnd} 0 C ${patternedEnd} ${funnelH * .6} ${round(funnelW)} ${funnelH * .4} ${round(funnelW)} ${funnelH} L 0 ${funnelH} Z`
  return <Box data-testid="transaction-pattern-stack" role="img" aria-label={linked ? '전체 의심 거래 구성(거래 건)과 패턴 소속 거래의 유형별 Alert 분포' : '전체 분석 거래의 모델 조합과 의심 거래의 유형별 건수'} className="min-w-0 rounded-lg border bg-muted/30 p-3">
    <Box data-testid="relation-total-panel">
      <Text className="text-xs font-medium">전체 구성 <Text as="span" className="font-normal text-muted-foreground">· 거래 건</Text></Text>
      <Box as="ul" className="mt-2.5 space-y-1">{composition.map(item => <Box as="li" key={item.name} data-testid="relation-total-label" className="flex min-w-0 items-center gap-2 text-xs"><Text as="strong" className="w-10 shrink-0 font-semibold tabular-nums">{sharePct(item.value, total)}</Text><Text as="span" className="min-w-0 flex-1 truncate">{item.name}</Text><Text as="span" className="shrink-0 tabular-nums text-muted-foreground">{fmt(item.value)}건</Text></Box>)}</Box>
      <Box className="mt-2.5 flex h-6 gap-0.5">{composition.map((item, index) => (
        <Box
          key={item.name} ref={index === 0 ? patternedRef : undefined}
          data-testid="relation-total-segment" data-segment-scope="composition" data-segment-index={index}
          className={`pattern-relation-segment pattern-relation-stack-segment min-w-1 ${index === 0 ? 'rounded-t-md rounded-b-none' : 'rounded-md border border-dashboard-segment-divider'}`}
          style={{ '--relation-share': item.value, '--relation-fill': item.fill } as CSSProperties}
        />
      ))}</Box>
    </Box>
    <Box ref={funnelRef} hidden={!linked} className="pattern-relation-funnel -mt-px w-full">
      <svg data-testid="relation-link" aria-hidden="true" className="block h-full w-full overflow-visible" width={round(funnelW)} height={funnelH} viewBox={`0 0 ${round(funnelW)} ${funnelH}`}>
        <defs><linearGradient id={funnelGradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="pattern-relation-funnel-stop" />
          <stop offset="1" className="pattern-relation-funnel-stop" />
        </linearGradient></defs>
        <path d={funnel} fill={`url(#${funnelGradient})`} />
      </svg>
    </Box>
    <Box data-testid="relation-pattern-panel" className="rounded-b-md bg-foreground/[.08] p-2.5">
      <Text className="text-xs font-medium">{linked ? '패턴 소속의 유형별' : '의심 거래 유형별'} <Text as="span" className="font-normal text-muted-foreground">· {unit}</Text></Text>
      <Box className="pattern-relation-stack-patterns mt-2.5 grid items-center gap-x-2 gap-y-1.5">{distribution.map((item, index) => <Fragment key={item.pattern}>
        <Text as="span" data-testid="pattern-child-label" data-segment-index={index} className="flex h-6 items-center rounded-full bg-foreground px-2.5 font-mono text-2xs text-background">{item.pattern}</Text>
        <Text as="span" className="flex min-w-0 items-center"><Text as="span" data-testid="relation-pattern-bar" data-segment-scope="pattern" className="pattern-relation-bar flex h-6 min-w-11 items-center justify-start rounded-full bg-foreground px-3 text-2xs tabular-nums text-background" style={{ '--relation-width': `${Math.max(sizes.minShare, item.alerts / maxAlerts * 100)}%` } as CSSProperties}>{fmt(item.alerts)}</Text></Text>
      </Fragment>)}</Box>
    </Box>
  </Box>
}

function PatternRelationBars({ composition, distribution, linked = true, unit = 'Alert' }: PatternProps) {
  const [sizes] = useState(readPatternRelationSizes)
  const [ref, size] = useElementSize<HTMLDivElement>({ width: sizes.breakpoint, height: sizes.height })
  if (size.width < sizes.breakpoint) return (
    <Box ref={ref} className="pattern-relation-stack-scroll w-full min-w-0 overflow-y-auto">
      <PatternRelationStack composition={composition} distribution={distribution} linked={linked} unit={unit} />
    </Box>
  )
  const layout = buildPatternRelationLayout(composition, distribution, size.width, sizes)
  const panel = 'pattern-relation-panel absolute top-0 bottom-0 rounded-lg border bg-muted/30'
  return <Box ref={ref} data-testid="transaction-pattern-bar" role="img" aria-label={linked ? '전체 의심 거래 구성(거래 건)과 패턴 소속 거래의 유형별 Alert 분포' : '전체 분석 거래의 모델 조합과 의심 거래의 유형별 건수'}
    style={{ '--relation-height': `${sizes.height}px` } as CSSProperties}
    className="pattern-relation-wide relative w-full min-w-0 overflow-hidden">
    <Box data-testid="relation-total-panel" className={panel} style={{ '--relation-width': `${layout.leftW}px` } as CSSProperties} />
    <Box data-testid="relation-pattern-panel" className={panel} style={{ '--relation-x': `${layout.rightX}px`, '--relation-width': `${layout.rightW}px` } as CSSProperties} />
    <Text className="pattern-relation-heading absolute text-xs font-medium" style={{ '--relation-x': `${layout.padX}px` } as CSSProperties}>전체 구성 <Text as="span" className="font-normal text-muted-foreground">· 거래 건</Text></Text>
    <Text className="pattern-relation-heading absolute text-xs font-medium" style={{ '--relation-x': `${layout.pillX}px` } as CSSProperties}>패턴별 유형 <Text as="span" className="font-normal text-muted-foreground">· {unit}</Text></Text>
    <svg data-testid="relation-lines" className="pointer-events-none absolute inset-0 overflow-visible" width={layout.width} height={layout.height} aria-hidden="true">
      {linked && layout.links.map((d, index) => <path key={index} data-testid="relation-link" d={d} fill="none" className="pattern-relation-connector" />)}
      {layout.labels.map(label => {
        const segment = layout.segments[label.index]
        const d = `M ${layout.labelRight} ${round(label.y)} C ${layout.labelRight + sizes.rowGap} ${round(label.y)} ${layout.columnX - sizes.rowGap} ${round(label.anchorY)} ${layout.columnX} ${round(label.anchorY)}`
        return <g key={segment.name} data-testid="relation-label-leader">
          <path d={d} fill="none" className="pattern-relation-leader" />
          <circle cx={layout.labelRight} cy={round(label.y)} className="pattern-relation-dot" />
        </g>
      })}
    </svg>
    {layout.segments.map(segment => <PositionedRelationBox key={segment.name} data-testid="relation-total-segment" data-segment-scope="composition" data-segment-index={segment.index}
      className="pattern-relation-segment rounded-md border border-dashboard-segment-divider"
      x={layout.columnX} y={segment.y} width={layout.columnW} height={segment.h} fill={segment.fill}
      title={`${segment.name} ${fmt(segment.value)}건 · ${segment.share}`} />)}
    {layout.labels.map(label => {
      const segment = layout.segments[label.index]
      return <PositionedRelationBox key={segment.name} data-testid="relation-total-label" className="flex flex-col items-end justify-center text-right leading-tight"
        x={layout.padX} y={label.y - layout.labelH / 2} width={layout.labelRight - sizes.rowGap - layout.padX} height={layout.labelH}
        title={`${segment.name} ${fmt(segment.value)}건`}>
        <Text as="span" className="max-w-full truncate text-xs"><Text as="strong" className="font-semibold tabular-nums">{segment.share}</Text> {segment.name}</Text>
        <Text as="span" className="text-2xs tabular-nums text-muted-foreground">{fmt(segment.value)}건</Text>
      </PositionedRelationBox>
    })}
    {layout.rows.map(row => <PositionedRelationBox key={row.pattern} data-testid="relation-pattern-row" data-segment-scope="pattern" data-segment-index={row.index}
      className="flex items-center"
      x={layout.pillX} y={row.cy - layout.pillH / 2} width={layout.width - layout.padX - layout.pillX} height={layout.pillH}
      title={`${row.pattern} ${fmt(row.alerts)} ${unit}`}>
      <Text as="span" data-testid="pattern-child-label" className="pattern-relation-bar flex h-full shrink-0 items-center rounded-full bg-foreground px-3 font-mono text-2xs text-background"
        style={{ '--relation-width': `${layout.pillW}px` } as CSSProperties}><Text as="span" className="truncate">{row.pattern}</Text></Text>
      <Text as="span" data-testid="relation-pattern-bar" className="pattern-relation-bar ml-1.5 flex h-full items-center justify-start rounded-full bg-foreground px-3 text-2xs tabular-nums text-background"
        style={{ '--relation-width': `${row.barW}px` } as CSSProperties}>{row.countInside && fmt(row.alerts)}</Text>
      {!row.countInside && <Text as="span" className="ml-1.5 text-2xs tabular-nums text-muted-foreground">{fmt(row.alerts)}</Text>}
    </PositionedRelationBox>)}
  </Box>
}

