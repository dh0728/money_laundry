import { useEffect, useRef, useState } from 'react'
import { ArrowUpDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { compactUsd, usd, type GraphModel, type GraphNode, type GraphTransaction } from './domain'
import { IconButton } from './shared'

export type SankeyFocus = { kind: 'edge'; s: string; t: string } | { kind: 'node'; key: string }

type Point = { x: number; y: number }

/* ---------------------------------------------------------------- 순수 레이아웃 계산(계좌 focus · Sankey) */

const VIEW_W = 360
const MARGIN = 28 // 가운데 막대 위 계좌 label이 잘리지 않을 여백
const BAR_W = 8
const GAP = 2 // 같은 구간 안 band 사이 간격
const GROUP_GAP = 5 // node focus에서 거래상대별 bar 사이 간격
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
export type SankeyBand = { tx: GraphTransaction; direction: 'in' | 'out'; thickness: number; path: string; arrow: string; mid: Point }
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

// 왼쪽에서 오는 band(오른쪽 방향 화살촉): x1Bar가 목적지 왼쪽 끝. mid는 라벨 배치 기준점.
function ribbonRight(x0: number, y0a: number, y0b: number, x1Bar: number, y1a: number, y1b: number, thickness: number): { path: string; arrow: string; mid: Point } {
  const arrowLen = Math.min(14, 6 + thickness * .4)
  const x1 = x1Bar - arrowLen
  const cx = (x0 + x1) / 2
  const midY = (y1a + y1b) / 2
  const half = thickness / 2 + 2
  const path = `M${x0},${y0a} C${cx},${y0a} ${cx},${y1a} ${x1},${y1a} L${x1},${y1b} C${cx},${y1b} ${cx},${y0b} ${x0},${y0b} Z`
  const arrow = `M${x1},${midY - half} L${x1Bar},${midY} L${x1},${midY + half} Z`
  const mid = { x: (x0 + x1Bar) / 2, y: (y0a + y0b + y1a + y1b) / 4 }
  return { path, arrow, mid }
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
const MAX_BAND = 120 // 넓어진 계좌 panel에서도 띠가 작게 몰리지 않도록 상한을 키운다
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
    const { path, arrow, mid } = ribbonRight(LEFT_X + BAR_W, item.y0, item.y1, CENTER_X, item.y0, item.y1, item.thickness)
    bands.push({ tx: item.tx, direction: 'in', thickness: item.thickness, path, arrow, mid })
  }
  for (const g of right.groups) for (const item of g.items) {
    const { path, arrow, mid } = ribbonRight(CENTER_X + BAR_W, item.y0, item.y1, RIGHT_X, item.y0, item.y1, item.thickness)
    bands.push({ tx: item.tx, direction: 'out', thickness: item.thickness, path, arrow, mid })
  }

  return { width, height: finalHeight, bars, bands, summary: summarize(sentTx, receivedTx) }
}

export function sankeyLayout(model: GraphModel, focus: { kind: 'node'; key: string }, height: number, width = VIEW_W): SankeyLayout {
  return layoutNode(model, focus.key, height, Math.max(VIEW_W, width))
}

/* ---------------------------------------------------------------- 두 계좌(edge) focus · pair 패널 */

export type PairSort = 'time-asc' | 'time-desc' | 'amount-desc' | 'amount-asc'
export const PAIR_SORTS: { value: PairSort; label: string }[] = [
  { value: 'time-asc', label: '시간순(오래된→최신)' },
  { value: 'time-desc', label: '시간 역순' },
  { value: 'amount-desc', label: '금액 큰 순' },
  { value: 'amount-asc', label: '금액 작은 순' },
]
export const DEFAULT_PAIR_SORT: PairSort = 'time-asc'

export type PairBand = { tx: GraphTransaction; direction: 'a-to-b' | 'b-to-a'; height: number }

// 패널 안에서 band 높이 = 로그 척도로 28~96px(값이 하나뿐이면 중간값)
const PAIR_MIN_HEIGHT = 28, PAIR_MAX_HEIGHT = 96
function pairBandHeight(value: number, min: number, max: number) {
  const lo = Math.log(Math.max(min, 1e-9)), hi = Math.log(Math.max(max, 1e-9))
  if (!(hi - lo > 1e-9)) return (PAIR_MIN_HEIGHT + PAIR_MAX_HEIGHT) / 2
  const v = Math.min(max, Math.max(min, value))
  const t = (Math.log(Math.max(v, 1e-9)) - lo) / (hi - lo)
  return PAIR_MIN_HEIGHT + t * (PAIR_MAX_HEIGHT - PAIR_MIN_HEIGHT)
}

function sortTagged(list: { tx: GraphTransaction; direction: 'a-to-b' | 'b-to-a' }[], sort: PairSort) {
  const out = list.slice()
  if (sort === 'time-asc') out.sort((a, b) => a.tx.at.localeCompare(b.tx.at))
  else if (sort === 'time-desc') out.sort((a, b) => b.tx.at.localeCompare(a.tx.at))
  else if (sort === 'amount-desc') out.sort((a, b) => b.tx.usd - a.tx.usd)
  else out.sort((a, b) => a.tx.usd - b.tx.usd)
  return out
}

// A↔B 사이 양방향 거래를 하나의 목록으로 합쳐 정렬·척도 계산까지 끝낸 band 배열을 돌려준다.
export function pairLayout(model: GraphModel, s: string, t: string, sort: PairSort = DEFAULT_PAIR_SORT): PairBand[] {
  const abTx = edgesBetween(model, s, t).flatMap(e => e.transactions)
  const baTx = edgesBetween(model, t, s).flatMap(e => e.transactions)
  const tagged: { tx: GraphTransaction; direction: 'a-to-b' | 'b-to-a' }[] = [
    ...abTx.map(tx => ({ tx, direction: 'a-to-b' as const })),
    ...baTx.map(tx => ({ tx, direction: 'b-to-a' as const })),
  ]
  const amounts = tagged.map(x => x.tx.usd)
  const min = amounts.length ? Math.min(...amounts) : 0, max = amounts.length ? Math.max(...amounts) : 0
  return sortTagged(tagged, sort).map(({ tx, direction }) => ({ tx, direction, height: pairBandHeight(tx.usd, min, max) }))
}

const laneTone = (n: GraphNode) => n.core ? 'var(--graph-l1)' : 'var(--graph-l0-node)'

/* ---------------------------------------------------------------- 컴포넌트 */

export default function SankeyPanel({ model, focus, onClose }: { model: GraphModel; focus: SankeyFocus; onClose: () => void }) {
  return focus.kind === 'edge'
    ? <PairPanel model={model} s={focus.s} t={focus.t} onClose={onClose} />
    : <NodeSankeyPanel model={model} focus={focus} onClose={onClose} />
}

// 두 계좌 focus: 좌우 끝 lane(전체 스크롤 높이) 사이를 잇는 전체 폭 화살표 band. A→B는 오른쪽, B→A는 왼쪽을 향한다.
// 거래 정보(id·시각·금액·수단)는 band 안에 바로 표시하므로 아래 목록은 두지 않는다.
function PairPanel({ model, s, t, onClose }: { model: GraphModel; s: string; t: string; onClose: () => void }) {
  const [sort, setSort] = useState<PairSort>(DEFAULT_PAIR_SORT)
  const A = nodeOf(model, s), B = nodeOf(model, t)
  const bands = pairLayout(model, s, t, sort)
  const count = bands.length, total = bands.reduce((sum, b) => sum + b.tx.usd, 0)
  const dates = bands.map(b => b.tx.at).sort()
  const currentSort = PAIR_SORTS.find(o => o.value === sort)!

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="pair-panel">
      <div className="p-4 border-b">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold font-mono truncate">{A.account} ↔ {B.account}</h3>
          <div className="flex flex-col items-center gap-1 shrink-0">
            <IconButton label="거래 상세 닫기" onClick={onClose}><X className="size-4" /></IconButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7" aria-label={`정렬 방식 · 현재 ${currentSort.label}`}><ArrowUpDown className="size-3.5" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup value={sort} onValueChange={v => setSort(v as PairSort)}>
                  {PAIR_SORTS.map(o => <DropdownMenuRadioItem key={o.value} value={o.value}>{o.label}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">{count}건 · {usd(total)}</p>
        {dates.length > 0 && <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">{dates[0].slice(5)} – {dates.at(-1)!.slice(5)}</p>}
        <div className="flex items-center justify-between mt-2.5 text-xs gap-2">
          <span className="font-mono font-semibold truncate">{A.account}<span className="ml-1.5 text-[10px] font-normal text-muted-foreground">{A.entity}</span></span>
          <span className="font-mono font-semibold text-right truncate">{B.account}<span className="ml-1.5 text-[10px] font-normal text-muted-foreground">{B.entity}</span></span>
        </div>
      </div>
      <ScrollArea type="always" className="flex-1 min-h-0 pair-scroll">
        <div className="pair-body relative py-3">
          <div className="pair-lane" style={{ left: 0, background: laneTone(A) }} />
          <div className="pair-lane" style={{ right: 0, background: laneTone(B) }} />
          {bands.map(b => (
            <div key={b.tx.id} className="pair-row">
              <div className="pair-band" data-tx={b.tx.id} data-dir={b.direction} data-label={b.tx.label} style={{ height: b.height }}
                title={`${b.tx.id} · ${b.tx.at} · ${usd(b.tx.usd)} · ${b.tx.label === 1 ? '세탁 거래' : '정상 거래'}`}>
                <div className="pair-band-info">
                  <span className="pair-band-meta">{b.tx.id}</span>
                  <span className="pair-band-meta">{b.tx.at}</span>
                  <span className="pair-band-amount">{usd(b.tx.usd)}</span>
                  <span className="pair-band-sub">{b.tx.currency} · {b.tx.format}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

// 계좌 focus: Sankey(중앙 bar + 양쪽 거래상대)를 유지하되, 금액·시각 라벨을 band 위에 직접 표시하고
// 아래 거래 목록은 없앤다(한눈에 보이는 것이 목적).
function NodeSankeyPanel({ model, focus, onClose }: { model: GraphModel; focus: { kind: 'node'; key: string }; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null), root = useRef<HTMLDivElement>(null), [width, setWidth] = useState(VIEW_W), [height, setHeight] = useState(420)
  useEffect(() => {
    const el = box.current, panel = root.current; if (!el || !panel) return
    // 폭은 본문, 높이는 panel 전체에서 머리글을 뺀 값으로 잡아 Sankey가 panel을 채우게 한다
    const observer = new ResizeObserver(() => { setWidth(Math.round(el.clientWidth - 32)); setHeight(Math.max(320, Math.round(panel.clientHeight - 130))) })
    observer.observe(el); observer.observe(panel); return () => observer.disconnect()
  }, [])
  const layout = sankeyLayout(model, focus, height, width)
  const { summary } = layout
  const center = nodeOf(model, focus.key)
  const title = `계좌 ${center.account} 거래 흐름`

  return (
    <div ref={root} className="flex flex-col h-full min-h-0" data-testid="sankey-panel">
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
            {layout.bands.map(b => {
              const fill = b.tx.label === 1 ? 'var(--graph-l1)' : 'var(--graph-l0)'
              const thin = b.thickness < 16
              return (
                <g key={b.tx.id}>
                  <path d={b.path} fill={fill} opacity={.75} data-tx={b.tx.id} data-direction={b.direction} data-thickness={b.thickness}>
                    <title>{`${b.tx.id} · ${b.tx.at.slice(5)} · ${usd(b.tx.usd)} · ${b.tx.label === 1 ? '세탁 거래' : '정상 거래'}`}</title>
                  </path>
                  <path d={b.arrow} fill={fill} opacity={.9} />
                  {thin ? (
                    <text x={b.mid.x} y={b.mid.y - b.thickness / 2 - 5} textAnchor="middle" className="graph-label sankey-band-label" fontSize="8.5">{compactUsd(b.tx.usd)} · {b.tx.at.slice(5)}</text>
                  ) : (
                    <text x={b.mid.x} y={b.mid.y} textAnchor="middle" className="sankey-band-label-inside" fontSize="9">
                      <tspan x={b.mid.x} dy="-4" fontWeight="700">{compactUsd(b.tx.usd)}</tspan>
                      <tspan x={b.mid.x} dy="11">{b.tx.at.slice(5)}</tspan>
                    </text>
                  )}
                </g>
              )
            })}
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
        </div>
      </ScrollArea>
    </div>
  )
}
