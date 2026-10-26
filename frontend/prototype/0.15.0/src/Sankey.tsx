import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { usd, type GraphModel, type GraphNode, type GraphTransaction } from './domain'
import { IconButton } from './shared'

export type SankeyFocus = { kind: 'edge'; s: string; t: string } | { kind: 'node'; key: string }

/* ---------------------------------------------------------------- 순수 레이아웃 계산 */

const VIEW_W = 360
const MARGIN = 28 // 가운데 막대 위 계좌 label이 잘리지 않을 여백
const BAR_W = 8
const GAP = 2 // 같은 구간 안 band 사이 간격
const GROUP_GAP = 5 // node focus에서 거래상대별 bar 사이 간격
const SEGMENT_GAP = 6 // edge focus에서 보냄/받음 구간 사이 간격
const MIN_THICK = 2
const MIN_HEIGHT = 320

// 계좌 이름이 잘리지 않도록 양쪽에 label 영역을 확보하고, 실제 panel 폭으로 그려 글자 크기를 일정하게 유지한다
const LABEL_W = 108
const geometry = (width: number) => ({ LEFT_X: LABEL_W, RIGHT_X: width - LABEL_W - BAR_W, CENTER_X: width / 2 - BAR_W / 2 })

export type SankeyItem = { tx: GraphTransaction; y0: number; y1: number; thickness: number }
export type SankeyGroup = { key: string; y0: number; y1: number; items: SankeyItem[] }
export type SankeyBar = {
  key: string
  side: 'left' | 'center' | 'right'
  account: string
  entity: string
  bank: string
  core: boolean
  x: number
  y0: number
  y1: number
  labelX: number
  labelY: number
  labelAnchor: 'start' | 'end' | 'middle'
}
export type SankeyBand = {
  tx: GraphTransaction
  direction: 'a-to-b' | 'b-to-a' | 'in' | 'out'
  thickness: number
  path: string
  arrow: string
}
export type SankeySummary = { outCount: number; outUsd: number; inCount: number; inUsd: number; first: string; last: string }
export type SankeyLayout = { width: number; height: number; bars: SankeyBar[]; bands: SankeyBand[]; summary: SankeySummary }

const nodeOf = (model: GraphModel, key: string): GraphNode =>
  model.nodes.find(n => n.key === key) ?? { key, account: key, bank: '', entity: '', x: 0, y: 0, core: false, bridge: false, hub: false, hubDegree: 0, hop: 0, synthetic: false }

function edgesBetween(model: GraphModel, s: string, t: string) {
  return model.edges.filter(e => e.s === s && e.t === t)
}

// 거래상대별로 묶어 세로로 쌓는다: 같은 상대의 거래는 시간순, 상대끼리는 첫 거래 시각순.
function layoutFlow(txs: GraphTransaction[], counterpartyOf: (tx: GraphTransaction) => string, scale: number, startY: number, groupGap: number): { groups: SankeyGroup[]; total: number } {
  const byKey = new Map<string, GraphTransaction[]>()
  for (const tx of txs) {
    const k = counterpartyOf(tx)
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k)!.push(tx)
  }
  const order = [...byKey.entries()]
    .map(([k, list]) => ({ k, list: list.slice().sort((a, b) => a.at.localeCompare(b.at)) }))
    .sort((a, b) => a.list[0].at.localeCompare(b.list[0].at))
  let y = startY
  const groups: SankeyGroup[] = []
  for (const { k, list } of order) {
    const items: SankeyItem[] = []
    let gy = y
    for (const tx of list) {
      const thickness = Math.max(MIN_THICK, tx.usd * scale)
      items.push({ tx, y0: gy, y1: gy + thickness, thickness })
      gy += thickness + GAP
    }
    const groupEnd = gy - GAP
    groups.push({ key: k, y0: y, y1: groupEnd, items })
    y = groupEnd + groupGap
  }
  const total = groups.length ? y - groupGap - startY : 0
  return { groups, total }
}

function ribbon(x0: number, y0a: number, y0b: number, x1Bar: number, y1a: number, y1b: number, thickness: number): { path: string; arrow: string } {
  const arrowLen = Math.min(14, 6 + thickness * .4)
  const x1 = x1Bar - arrowLen
  const cx = (x0 + x1) / 2
  const midY = (y1a + y1b) / 2
  const half = thickness / 2 + 2
  const path = `M${x0},${y0a} C${cx},${y0a} ${cx},${y1a} ${x1},${y1a} L${x1},${y1b} C${cx},${y1b} ${cx},${y0b} ${x0},${y0b} Z`
  const arrow = `M${x1},${midY - half} L${x1Bar},${midY} L${x1},${midY + half} Z`
  return { path, arrow }
}
// 왼쪽에서 오는 band(오른쪽 방향 화살촉): x1Bar가 목적지 왼쪽 끝
function ribbonRight(x0: number, y0a: number, y0b: number, x1Bar: number, y1a: number, y1b: number, thickness: number) {
  return ribbon(x0, y0a, y0b, x1Bar, y1a, y1b, thickness)
}
// 오른쪽에서 오는 band(왼쪽 방향 화살촉): 좌우를 뒤집어 같은 공식을 재사용
function ribbonLeft(x0: number, y0a: number, y0b: number, x1Bar: number, y1a: number, y1b: number, thickness: number) {
  const arrowLen = Math.min(14, 6 + thickness * .4)
  const x1 = x1Bar + arrowLen
  const cx = (x0 + x1) / 2
  const midY = (y1a + y1b) / 2
  const half = thickness / 2 + 2
  const path = `M${x0},${y0a} C${cx},${y0a} ${cx},${y1a} ${x1},${y1a} L${x1},${y1b} C${cx},${y1b} ${cx},${y0b} ${x0},${y0b} Z`
  const arrow = `M${x1},${midY - half} L${x1Bar},${midY} L${x1},${midY + half} Z`
  return { path, arrow }
}

function summarize(outTx: GraphTransaction[], inTx: GraphTransaction[]): SankeySummary {
  const all = [...outTx, ...inTx].map(t => t.at).sort()
  return {
    outCount: outTx.length, outUsd: outTx.reduce((s, t) => s + t.usd, 0),
    inCount: inTx.length, inUsd: inTx.reduce((s, t) => s + t.usd, 0),
    first: all[0] ?? '', last: all.at(-1) ?? '',
  }
}

// 거래가 적을 때 띠 하나가 panel 전체를 덮지 않도록, 가장 큰 거래도 maxBand px을 넘지 않게 척도를 제한한다
const MAX_BAND = 56
function computeScale(stacks: { usdSum: number; count: number; extraGap: number; maxUsd?: number }[], availableHeight: number, maxBand = Infinity): number {
  let scale = Infinity
  for (const s of stacks) {
    if (s.usdSum <= 0) continue
    const gapPx = Math.max(0, s.count - 1) * GAP + s.extraGap
    const candidate = (availableHeight - gapPx) / s.usdSum
    if (candidate > 0 && candidate < scale) scale = candidate
  }
  const largest = Math.max(0, ...stacks.map(s => s.maxUsd ?? 0))
  if (largest > 0) scale = Math.min(scale, maxBand / largest)
  return isFinite(scale) && scale > 0 ? scale : 1
}

function layoutEdge(model: GraphModel, s: string, t: string, height: number, width: number): SankeyLayout {
  const { LEFT_X, RIGHT_X } = geometry(width)
  const A = nodeOf(model, s), B = nodeOf(model, t)
  const abTx = edgesBetween(model, s, t).flatMap(e => e.transactions).sort((a, b) => a.at.localeCompare(b.at))
  const baTx = edgesBetween(model, t, s).flatMap(e => e.transactions).sort((a, b) => a.at.localeCompare(b.at))

  const availableHeight = Math.max(100, height - MARGIN * 2)
  const segGapA = abTx.length && baTx.length ? SEGMENT_GAP : 0
  const segGapB = segGapA
  const scale = computeScale([
    { usdSum: abTx.reduce((s2, x) => s2 + x.usd, 0) + baTx.reduce((s2, x) => s2 + x.usd, 0), count: abTx.length + baTx.length, extraGap: segGapA, maxUsd: Math.max(0, ...abTx.map(x => x.usd), ...baTx.map(x => x.usd)) },
    { usdSum: baTx.reduce((s2, x) => s2 + x.usd, 0) + abTx.reduce((s2, x) => s2 + x.usd, 0), count: baTx.length + abTx.length, extraGap: segGapB },
  ], availableHeight, MAX_BAND)

  const aOut = layoutFlow(abTx, () => 'B', scale, MARGIN, 0)
  const aIn = layoutFlow(baTx, () => 'A', scale, MARGIN + aOut.total + segGapA, 0)
  const bOut = layoutFlow(baTx, () => 'A', scale, MARGIN, 0)
  const bIn = layoutFlow(abTx, () => 'B', scale, MARGIN + bOut.total + segGapB, 0)

  const aItems = [...aOut.groups.flatMap(g => g.items), ...aIn.groups.flatMap(g => g.items)]
  const bItems = [...bOut.groups.flatMap(g => g.items), ...bIn.groups.flatMap(g => g.items)]
  const aBottom = aIn.groups.length ? aIn.groups.at(-1)!.y1 : (aOut.groups.length ? aOut.groups.at(-1)!.y1 : MARGIN)
  const bBottom = bIn.groups.length ? bIn.groups.at(-1)!.y1 : (bOut.groups.length ? bOut.groups.at(-1)!.y1 : MARGIN)
  const naturalContent = Math.max(aBottom, bBottom) + MARGIN
  const finalHeight = Math.max(MIN_HEIGHT, height, naturalContent)

  const bars: SankeyBar[] = [
    { key: A.key, side: 'left', account: A.account, entity: A.entity, bank: A.bank, core: A.core, x: LEFT_X, y0: MARGIN, y1: aBottom, labelX: LEFT_X - 6, labelY: (MARGIN + aBottom) / 2, labelAnchor: 'end' },
    { key: B.key, side: 'right', account: B.account, entity: B.entity, bank: B.bank, core: B.core, x: RIGHT_X, y0: MARGIN, y1: bBottom, labelX: RIGHT_X + BAR_W + 6, labelY: (MARGIN + bBottom) / 2, labelAnchor: 'start' },
  ]

  const bands: SankeyBand[] = []
  // A→B: A의 보냄(top) → B의 받음(bottom, bIn 좌표계 재사용)
  aOut.groups[0]?.items.forEach((item, i) => {
    const target = bIn.groups[0]!.items[i]
    const { path, arrow } = ribbonRight(LEFT_X + BAR_W, item.y0, item.y1, RIGHT_X, target.y0, target.y1, item.thickness)
    bands.push({ tx: item.tx, direction: 'a-to-b', thickness: item.thickness, path, arrow })
  })
  // B→A: B의 보냄(top) → A의 받음(bottom, aIn 좌표계 재사용)
  bOut.groups[0]?.items.forEach((item, i) => {
    const target = aIn.groups[0]!.items[i]
    const { path, arrow } = ribbonLeft(RIGHT_X, item.y0, item.y1, LEFT_X + BAR_W, target.y0, target.y1, item.thickness)
    bands.push({ tx: item.tx, direction: 'b-to-a', thickness: item.thickness, path, arrow })
  })
  void aItems; void bItems

  return { width, height: finalHeight, bars, bands, summary: summarize(abTx, baTx) }
}

function layoutNode(model: GraphModel, key: string, height: number, width: number): SankeyLayout {
  const { LEFT_X, RIGHT_X, CENTER_X } = geometry(width)
  const center = nodeOf(model, key)
  const incoming = model.edges.filter(e => e.t === key)
  const outgoing = model.edges.filter(e => e.s === key)
  const receivedTx = incoming.flatMap(e => e.transactions)
  const sentTx = outgoing.flatMap(e => e.transactions)

  const availableHeight = Math.max(100, height - MARGIN * 2)
  const receivedUsd = receivedTx.reduce((s, t) => s + t.usd, 0)
  const sentUsd = sentTx.reduce((s, t) => s + t.usd, 0)
  const leftGroupCount = new Set(receivedTx.map(t => t.from)).size
  const rightGroupCount = new Set(sentTx.map(t => t.to)).size
  const scale = computeScale([
    { usdSum: receivedUsd, count: receivedTx.length, extraGap: Math.max(0, leftGroupCount - 1) * (GROUP_GAP - GAP), maxUsd: Math.max(0, ...receivedTx.map(x => x.usd), ...sentTx.map(x => x.usd)) },
    { usdSum: sentUsd, count: sentTx.length, extraGap: Math.max(0, rightGroupCount - 1) * (GROUP_GAP - GAP) },
  ], availableHeight, MAX_BAND)

  const left = layoutFlow(receivedTx, tx => tx.from, scale, MARGIN, GROUP_GAP)
  const right = layoutFlow(sentTx, tx => tx.to, scale, MARGIN, GROUP_GAP)

  const naturalContent = Math.max(MARGIN + left.total, MARGIN + right.total) + MARGIN
  const finalHeight = Math.max(MIN_HEIGHT, height, naturalContent)

  const bars: SankeyBar[] = []
  for (const g of left.groups) {
    const n = nodeOf(model, g.key)
    bars.push({ key: n.key, side: 'left', account: n.account, entity: n.entity, bank: n.bank, core: n.core, x: LEFT_X, y0: g.y0, y1: g.y1, labelX: LEFT_X - 6, labelY: (g.y0 + g.y1) / 2, labelAnchor: 'end' })
  }
  for (const g of right.groups) {
    const n = nodeOf(model, g.key)
    bars.push({ key: n.key, side: 'right', account: n.account, entity: n.entity, bank: n.bank, core: n.core, x: RIGHT_X, y0: g.y0, y1: g.y1, labelX: RIGHT_X + BAR_W + 6, labelY: (g.y0 + g.y1) / 2, labelAnchor: 'start' })
  }
  const centerY0 = MARGIN
  const centerY1 = Math.max(MARGIN + left.total, MARGIN + right.total)
  bars.push({ key: center.key, side: 'center', account: center.account, entity: center.entity, bank: center.bank, core: center.core, x: CENTER_X, y0: centerY0, y1: centerY1, labelX: CENTER_X + BAR_W / 2, labelY: centerY0 - 8, labelAnchor: 'middle' })

  const bands: SankeyBand[] = []
  for (const g of left.groups) for (const item of g.items) {
    const { path, arrow } = ribbonRight(LEFT_X + BAR_W, item.y0, item.y1, CENTER_X, item.y0, item.y1, item.thickness)
    bands.push({ tx: item.tx, direction: 'in', thickness: item.thickness, path, arrow })
  }
  for (const g of right.groups) for (const item of g.items) {
    const { path, arrow } = ribbonRight(CENTER_X + BAR_W, item.y0, item.y1, RIGHT_X, item.y0, item.y1, item.thickness)
    bands.push({ tx: item.tx, direction: 'out', thickness: item.thickness, path, arrow })
  }

  return { width, height: finalHeight, bars, bands, summary: summarize(sentTx, receivedTx) }
}

export function sankeyLayout(model: GraphModel, focus: SankeyFocus, height: number, width = VIEW_W): SankeyLayout {
  const w = Math.max(VIEW_W, width)
  return focus.kind === 'edge' ? layoutEdge(model, focus.s, focus.t, height, w) : layoutNode(model, focus.key, height, w)
}

/* ---------------------------------------------------------------- 컴포넌트 */

const dirText = (tx: GraphTransaction, model: GraphModel) => `${nodeOf(model, tx.from).account} → ${nodeOf(model, tx.to).account}`

export default function SankeyPanel({ model, focus, onClose }: { model: GraphModel; focus: SankeyFocus; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null), [width, setWidth] = useState(VIEW_W)
  useEffect(() => {
    const el = box.current; if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    observer.observe(el); return () => observer.disconnect()
  }, [])
  const layout = sankeyLayout(model, focus, 420, width)
  const { summary } = layout
  const title = focus.kind === 'edge'
    ? `${nodeOf(model, focus.s).account} ↔ ${nodeOf(model, focus.t).account}`
    : `계좌 ${nodeOf(model, focus.key).account} 거래 흐름`
  const allTx = layout.bands.map(b => b.tx).sort((a, b) => a.at.localeCompare(b.at))

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="sankey-panel">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold font-mono truncate">{title}</h3>
          <IconButton label="거래 상세 닫기" onClick={onClose}><X className="size-4" /></IconButton>
        </div>
        <p className="text-xs text-muted-foreground mt-1">보냄 {summary.outCount}건 {usd(summary.outUsd)} · 받음 {summary.inCount}건 {usd(summary.inUsd)}</p>
        {summary.first && <p className="text-[10px] text-muted-foreground mt-1.5 tabular-nums">{summary.first.slice(5)} – {summary.last.slice(5)}</p>}
      </div>
      <ScrollArea type="always" className="flex-1 min-h-0">
        <div className="p-4" ref={box}>
          <svg viewBox={`0 0 ${layout.width} ${layout.height}`} width="100%" style={{ display: 'block' }} role="img" aria-label={title}>
            {layout.bands.map(b => (
              <g key={b.tx.id}>
                <path d={b.path} fill={b.tx.label === 1 ? 'var(--graph-l1)' : 'var(--graph-l0)'} opacity={.75}
                  data-tx={b.tx.id} data-direction={b.direction} data-thickness={b.thickness}>
                  <title>{`${b.tx.id} · ${b.tx.at.slice(5)} · ${usd(b.tx.usd)} · ${b.tx.label === 1 ? '세탁 거래' : '정상 거래'}`}</title>
                </path>
                <path d={b.arrow} fill={b.tx.label === 1 ? 'var(--graph-l1)' : 'var(--graph-l0)'} opacity={.9} />
              </g>
            ))}
            {layout.bars.map(bar => (
              <g key={`${bar.side}:${bar.key}`}>
                <rect x={bar.x} y={bar.y0} width={BAR_W} height={Math.max(1, bar.y1 - bar.y0)} rx={1.5}
                  fill={bar.core ? 'var(--graph-l1)' : 'var(--graph-l0-node)'} />
                <text x={bar.labelX} y={bar.labelY - 2} textAnchor={bar.labelAnchor} className="graph-label font-mono" fontSize="10" fontWeight="600"
                  fill={bar.core ? 'var(--graph-l1)' : 'var(--foreground)'}>{bar.account}</text>
                <text x={bar.labelX} y={bar.labelY + 9} textAnchor={bar.labelAnchor} className="graph-label" fontSize="9" fill="var(--muted-foreground)">{bar.entity.length > 18 ? bar.entity.slice(0, 17) + '…' : bar.entity}</text>
              </g>
            ))}
          </svg>
          <ul className="mt-3 space-y-1 text-[11px]">
            {allTx.map(tx => (
              <li key={tx.id} className="flex items-center gap-2 py-1 border-b last:border-b-0">
                {tx.label === 1 && <span className="size-1.5 rounded-full shrink-0" style={{ background: 'var(--graph-l1)' }} aria-hidden />}
                <span className="font-mono text-muted-foreground shrink-0">{tx.id}</span>
                <span className="tabular-nums text-muted-foreground shrink-0">{tx.at.slice(5)}</span>
                <span className="truncate">{dirText(tx, model)}</span>
                <span className="ml-auto font-mono tabular-nums shrink-0">{usd(tx.usd)}</span>
              </li>
            ))}
          </ul>
        </div>
      </ScrollArea>
    </div>
  )
}
