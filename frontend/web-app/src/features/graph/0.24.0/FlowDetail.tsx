// v19: 그래프에서 계좌·거래쌍을 누르면 여는 상세. 오른쪽 도킹(좁으면 아래) 또는 RDR 9000처럼 떠 있는 창.
// 흐름 도식은 이미 설치된 recharts의 Sankey, 떠 있는 창은 react-rnd(드래그·리사이즈)를 쓴다.
import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { Rnd } from 'react-rnd'
import { PanelRight, PictureInPicture2, X } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { FlowSankey, type FlowSankeyData } from '@/components/charts/charts/sankey/flow-sankey'
import { readChartNumber } from '@/components/charts/chart-design-values'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { compactUsd, usd, type GraphModel, type GraphTransaction } from './model'
import { IconButton } from '@/components/IconButton'
import { readPanelBounds } from './model'
import { Box, Heading } from '@/components/layout-primitives'

export type PanelMode = 'dock' | 'float'
export type FlowFocus = { kind: 'edge'; s: string; t: string } | { kind: 'node'; key: string }
export const flowId = (f: FlowFocus) => f.kind === 'node' ? `flow:${f.key}` : `flow:${f.s}>${f.t}`

const accountOf = (model: GraphModel, key: string) => model.nodes.find(n => n.key === key)?.account ?? key
export const flowLabel = (model: GraphModel, f: FlowFocus) => f.kind === 'node' ? `계좌 ${accountOf(model, f.key)}` : `${accountOf(model, f.s)} ↔ ${accountOf(model, f.t)}`

// 거래의 송·수취 계좌는 엣지(s→t) key로 판정한다
type Row = GraphTransaction & { s: string; t: string }

// 계좌 focus: 보낸 상대(왼쪽) → 선택 계좌(가운데) → 받은 상대(오른쪽). 같은 상대는 금액을 합친다.
function sankeyFor(model: GraphModel, focus: FlowFocus, txs: Row[]): FlowSankeyData {
  const center = focus.kind === 'node' ? focus.key : focus.s
  const nodes: FlowSankeyData['nodes'] = [{ name: accountOf(model, center), suspect: false, incoming: 0, outgoing: 0 }]
  const links = new Map<string, FlowSankeyData['links'][number]>()
  const indexOf = (side: 'in' | 'out', key: string) => {
    const name = `${accountOf(model, key)}${side === 'in' ? ' ' : '  '}` // 같은 계좌가 양쪽에 나오면 이름으로 구분
    let i = nodes.findIndex(n => n.name === name)
    if (i < 0) { nodes.push({ name, suspect: false, incoming: 0, outgoing: 0 }); i = nodes.length - 1 }
    return i
  }
  for (const tx of txs) {
    if (tx.s === tx.t) continue // 자기 자신 거래는 흐름 도식에서 제외(목록에는 남음)
    const incoming = tx.t === center
    const other = incoming ? tx.s : tx.t
    const o = indexOf(incoming ? 'in' : 'out', other)
    const [source, target] = incoming ? [o, 0] : [0, o]
    nodes[source].outgoing += tx.usd; nodes[target].incoming += tx.usd
    const k = `${source}>${target}`
    const link = links.get(k) ?? { source, target, value: 0, suspect: false, count: 0, first: tx.at, last: tx.at }
    link.value += tx.usd; link.suspect ||= tx.label === 1; link.count += 1
    if (tx.at < link.first) link.first = tx.at
    if (tx.at > link.last) link.last = tx.at
    links.set(k, link)
    if (tx.label === 1) { nodes[o].suspect = true; nodes[0].suspect = true }
  }
  return { nodes, links: [...links.values()] }
}

export default function FlowDetail({ model, focus }: { model: GraphModel; focus: FlowFocus }) {
  const txs = useMemo<Row[]>(() => {
    const hit = (s: string, t: string) => focus.kind === 'node'
      ? s === focus.key || t === focus.key
      : (s === focus.s && t === focus.t) || (s === focus.t && t === focus.s)
    return model.edges.filter(e => hit(e.s, e.t)).flatMap(e => e.transactions.map(tx => ({ ...tx, s: e.s, t: e.t }))).sort((a, b) => a.at.localeCompare(b.at))
  }, [model, focus])
  const data = useMemo(() => sankeyFor(model, focus, txs), [model, focus, txs])
  const suspect = txs.filter(t => t.label === 1)
  const total = txs.reduce((s, t) => s + t.usd, 0)
  // 관계 그래프의 '상시 거래 정보 표시'와 같은 역할: 띠마다 금액을 글자로 보인다
  const [showInfo, setShowInfo] = useState(false)

  return (
    <Box className="flex flex-col gap-4" data-testid="flow-detail">
      <Box className="grid grid-cols-2 @3xl:grid-cols-4 gap-4">
        {[['거래', `${txs.length}건`], ['합계', usd(total)], ['의심 거래', `${suspect.length}건 · ${compactUsd(suspect.reduce((s, t) => s + t.usd, 0))}`], ['기간', txs.length ? `${txs[0].at.slice(5, 16)} ~ ${txs[txs.length - 1].at.slice(5, 16)}` : '—']].map(([k, v]) => (
          <Card key={k} className="shadow-none"><CardHeader><CardDescription>{k}</CardDescription><CardTitle className="tabular-nums">{v}</CardTitle></CardHeader></Card>
        ))}
      </Box>
      {data.links.length > 0 && (
        <Card className="relative shadow-none">
          <CardHeader>
            <CardTitle>자금 흐름</CardTitle>
            <CardDescription>{focus.kind === 'node' ? '왼쪽 보낸 계좌 → 선택 계좌 → 오른쪽 받은 계좌 · 굵기는 금액(USD)' : '두 계좌 사이 방향별 금액(USD)'}</CardDescription>
            <CardAction className="flex items-center gap-2">
              <Label htmlFor="flow-info" className="text-xs font-normal">거래 정보</Label>
              <Switch id="flow-info" checked={showInfo} onCheckedChange={setShowInfo} />
            </CardAction>
          </CardHeader>
          <CardContent>
            <FlowSankey data={data} showInfo={showInfo} formatAmount={usd} formatCompactAmount={compactUsd} />
          </CardContent>
        </Card>
      )}
    </Box>
  )
}

// 상세 창 셸: 제목 + (도킹 ↔ 플로팅) + 닫기. 본문은 container query로 좁은 폭에서 한 줄씩 쌓인다.
function readFlowPanelSizes() {
  return {
    margin: readChartNumber('--aml-space-16', 16),
    headerGap: readChartNumber('--aml-space-8', 8),
    initialRight: readChartNumber('--aml-space-24', 24),
    initialTop: readChartNumber('--flow-panel-initial-top', 88),
    initialWidth: readChartNumber('--flow-panel-initial-width', 560),
    initialHeight: readChartNumber('--flow-panel-initial-height', 620),
    minWidth: readChartNumber('--graph-detail-min-width', 340),
    minHeight: readChartNumber('--flow-panel-min-height', 320),
  }
}

function normalizeFlowGeometry(rect: { x: number; y: number; width: number; height: number }, bounds: ReturnType<typeof readPanelBounds>, sizes: ReturnType<typeof readFlowPanelSizes>) {
  const { margin, headerGap, minWidth, minHeight } = sizes
  const top = Math.max(margin, bounds.headerBottom + headerGap)
  const right = Math.min(bounds.width, bounds.contentRight)
  const maxWidth = Math.max(1, right - 2 * margin)
  const maxHeight = Math.max(1, bounds.height - top - margin)
  const width = Math.min(maxWidth, Math.max(Math.min(minWidth, maxWidth), rect.width))
  const height = Math.min(maxHeight, Math.max(Math.min(minHeight, maxHeight), rect.height))
  return { x: Math.max(margin, Math.min(rect.x, right - width - margin)), y: Math.max(top, Math.min(rect.y, bounds.height - height - margin)), width, height }
}

export function FlowPanel({ model, focus, mode, onModeChange, onClose, extra }: { model: GraphModel; focus: FlowFocus; mode: PanelMode; onModeChange: (m: PanelMode) => void; onClose: () => void; extra?: ReactNode }) {
  const [bounds, setBounds] = useState(readPanelBounds)
  const [sizes] = useState(readFlowPanelSizes)
  const [geometry, setGeometry] = useState(() => ({
    x: Math.max(sizes.margin, bounds.width - sizes.initialWidth - sizes.initialRight),
    y: sizes.initialTop,
    width: sizes.initialWidth,
    height: sizes.initialHeight,
  }))
  const fitted = normalizeFlowGeometry(geometry, bounds, sizes)
  const limits = normalizeFlowGeometry({ ...geometry, width: Infinity, height: Infinity }, bounds, sizes)
  useLayoutEffect(() => {
    const reclamp = () => {
      const next = readPanelBounds()
      setBounds(prev => Object.keys(next).every(key => next[key as keyof typeof next] === prev[key as keyof typeof prev]) ? prev : next)
    }
    reclamp()
    const observer = new ResizeObserver(reclamp)
    for (const selector of ['.app-main', '.app-header']) {
      const element = document.querySelector(selector)
      if (element) observer.observe(element)
    }
    window.addEventListener('resize', reclamp)
    return () => { observer.disconnect(); window.removeEventListener('resize', reclamp) }
  }, [])
  const body = (
    <Box className="flex flex-col h-full min-h-0 bg-card" data-testid="flow-panel" data-mode={mode}>
      <Box className="flow-panel-handle flex items-center gap-2 border-b px-3 py-2 shrink-0">
        <Heading level={3} className="flex-1 min-w-0 truncate text-sm font-semibold" translate="no">{flowLabel(model, focus)}</Heading>
        <IconButton label={mode === 'dock' ? '떠 있는 창으로 보기' : '오른쪽에 고정'} className="size-7" onClick={() => onModeChange(mode === 'dock' ? 'float' : 'dock')}>
          {mode === 'dock' ? <PictureInPicture2 /> : <PanelRight />}
        </IconButton>
        <IconButton label="상세 닫기" className="size-7" onClick={onClose}><X /></IconButton>
      </Box>
      <Box className="@container flex-1 min-h-0 overflow-auto p-3"><FlowDetail model={model} focus={focus} />{extra}</Box>
    </Box>
  )
  if (mode === 'dock') return body
  return (
    // 떠 있는 창: 화면 안에서만 끌고(bounds) 가장자리로 크기 조절. 제목 줄을 잡아 이동한다.
    <Box className="fixed inset-0 z-50 pointer-events-none">
      <Rnd bounds="parent" dragHandleClassName="flow-panel-handle" minWidth={Math.min(sizes.minWidth, limits.width)} minHeight={Math.min(sizes.minHeight, limits.height)} maxWidth={limits.width} maxHeight={limits.height}
        size={{ width: fitted.width, height: fitted.height }} position={{ x: fitted.x, y: fitted.y }}
        onDragStop={(_event, position) => setGeometry(normalizeFlowGeometry({ ...fitted, x: position.x, y: position.y }, readPanelBounds(), sizes))}
        onResizeStop={(_event, _direction, element, _delta, position) => setGeometry(normalizeFlowGeometry({ ...position, width: element.offsetWidth, height: element.offsetHeight }, readPanelBounds(), sizes))}
        className="pointer-events-auto overflow-hidden rounded-xl border shadow-2xl">
        {body}
      </Rnd>
    </Box>
  )
}
