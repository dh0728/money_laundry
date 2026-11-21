import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { ForceGraphMethods, LinkObject, NodeObject } from 'react-force-graph-2d'
import { Maximize2, Minimize2, Minus, Network, Pause, Play, Plus, RotateCcw, Search, Shrink, StepBack, StepForward } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Kbd } from '@/components/ui/kbd'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { compactUsd, minutes, neighborhood, stepTimeline, timeLabel, timelineEvents, usd, widthFor, type GraphEdge, type GraphModel, type GraphNode } from './domain'
import { FlowPanel, type FlowFocus, type PanelMode } from './FlowDetail'
import { IconButton } from './shared'

export const DEFAULT_HOP = 3
const HOP_MIN = 1, HOP_MAX = 5
const HOP_TICKS = [1, 2, 3, 4, 5]
const PAD = 56
const NARROW_WIDTH = 900

// 의심 여부 2색: 1=빨강, 0=무채색(사용자 확정). 위험도 색은 그래프에 쓰지 않는다.
export const nodeTone = (n: GraphNode) => n.core ? 'var(--graph-l1)' : 'var(--graph-l0-node)'
export const edgeTone = (e: Pick<GraphEdge, 'label'>) => e.label === 1 ? 'var(--graph-l1)' : 'var(--graph-l0)'
// 종류별 기존(고정) 크기 — 연결도로 커진 반지름도 최소 이 크기는 유지한다(허브가 작아 보이지 않도록).
const baseRadius = (n: GraphNode) => n.hub ? 7 : n.core ? 5.5 : n.bridge ? 4.2 : 3.4
// 노드 크기 = 연결성(전체 모델에서 서로 다른 상대 계좌 수). 3~14px로 clamp, 기존 크기보다 작아지지는 않는다.
export const nodeRadius = (n: GraphNode, degree: number) => Math.max(baseRadius(n), Math.min(14, Math.max(3, 3 + 2.2 * Math.sqrt(degree))))
export const graphNodeRole = (node: GraphNode) => node.core
  ? '의심 거래 참여 계좌'
  : node.hub
    ? `허브 · 상대 계좌 ${node.hubDegree.toLocaleString()}개`
    : node.bridge
      ? '연결 경로 경유 계좌'
      : `${node.hop}단계 주변 계좌`

export function connectedEdgesByNode(edges: GraphEdge[]) {
  const lookup = new Map<string, GraphEdge[]>()
  for (const edge of edges) {
    for (const key of edge.s === edge.t ? [edge.s] : [edge.s, edge.t]) {
      const connected = lookup.get(key) ?? []
      connected.push(edge)
      lookup.set(key, connected)
    }
  }
  return lookup
}

// v19: 캔버스 렌더러는 react-force-graph-2d(vasturiano, d3-force 물리 · Obsidian 그래프와 같은 방식)를 쓴다.
// canvas는 CSS 변수를 못 읽으므로 테마 색을 한 번 풀어서 넘긴다.
// force-graph는 import 시점에 window를 읽는다 → 실제로 그릴 때만 불러온다(SSR·테스트 안전)
const ForceGraph2D = lazy(() => import('react-force-graph-2d')) as unknown as typeof import('react-force-graph-2d').default
type FNode = NodeObject<GraphNode & { id: string }>
type FLink = LinkObject<GraphNode & { id: string }, GraphEdge>
const cssVar = (name: string) => typeof window === 'undefined' ? 'currentColor' : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || getComputedStyle(document.documentElement).color || 'currentColor'
const dim = (hex: string) => hex.startsWith('#') && (hex.length === 7 || hex.length === 9) ? `${hex.slice(0, 7)}1f` : hex
export default function Graph({ model, label }: { model: GraphModel; label: string }) {
  const [showInfo, setShowInfo] = useState(false), [hop, setHop] = useState(DEFAULT_HOP)
  const [selectedNode, setSelectedNode] = useState<string | null>(null), [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [search, setSearch] = useState(''), [fullscreen, setFullscreen] = useState(false)
  // 상세: 오른쪽 도킹(좁으면 아래) 또는 RDR 9000처럼 떠 있는 창
  const [panelMode, setPanelMode] = useState<PanelMode>('dock')
  const [hover, setHover] = useState<{ kind: 'node' | 'edge'; key: string; x: number; y: number } | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const fg = useRef<ForceGraphMethods<FNode, FLink> | undefined>(undefined)
  // 확대 비율 표시: 화면 맞춤 직후 배율을 100%로 본다
  const [zoomK, setZoomK] = useState(1), fitK = useRef(1), [fitted, setFitted] = useState(true)
  const [narrow, setNarrow] = useState(false)
  const layout = useRef<HTMLDivElement>(null), [fillHeight, setFillHeight] = useState(640)
  // 본문 스크롤 영역의 남은 높이를 그래프가 정확히 채운다(하단 여백·넘침 없음)
  useLayoutEffect(() => {
    const measure = () => {
      const el = layout.current, main = el?.closest('.app-main') as HTMLElement | null
      if (!el || !main) return
      const top = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop
      const bottom = parseFloat(getComputedStyle(main).paddingBottom) || 0
      setFillHeight(Math.max(460, Math.floor(main.clientHeight - top - bottom)))
    }
    measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure)
  }, [fullscreen])
  // 카드가 900px보다 좁거나 뷰포트가 세로면(전체화면 제외) 상세 패널을 아래로 쌓는다
  useEffect(() => {
    if (fullscreen) { setNarrow(false); return }
    const el = layout.current; if (!el) return
    const evaluate = () => {
      const w = el.getBoundingClientRect().width
      const portrait = typeof window !== 'undefined' && !!window.matchMedia?.('(orientation: portrait)').matches
      setNarrow((w > 0 && w < NARROW_WIDTH) || portrait)
    }
    evaluate()
    const ro = new ResizeObserver(evaluate)
    ro.observe(el)
    window.addEventListener('resize', evaluate)
    return () => { ro.disconnect(); window.removeEventListener('resize', evaluate) }
  }, [fullscreen])
  const canvas = useRef<HTMLDivElement>(null)

  const nodeMap = useMemo(() => new Map(model.nodes.map(n => [n.key, n])), [model])
  const connectedEdges = useMemo(() => connectedEdgesByNode(model.edges), [model.edges])
  // 연결도(degree) = 전체 모델에서 서로 다른 상대 계좌 수(자기 자신 거래는 제외) → 노드 크기에 반영
  const degreeMap = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const e of model.edges) {
      if (e.s === e.t) continue
      if (!m.has(e.s)) m.set(e.s, new Set())
      if (!m.has(e.t)) m.set(e.t, new Set())
      m.get(e.s)!.add(e.t); m.get(e.t)!.add(e.s)
    }
    return m
  }, [model.edges])
  const radius = useCallback((n: GraphNode) => nodeRadius(n, degreeMap.get(n.key)?.size ?? 0), [degreeMap])
  const allowed = useMemo(() => selectedNode ? neighborhood(model, selectedNode, hop) : null, [model, selectedNode, hop])
  const nodes = useMemo(() => allowed ? model.nodes.filter(n => allowed.has(n.key)) : model.nodes, [model, allowed])
  const edges = useMemo(() => allowed ? model.edges.filter(e => allowed.has(e.s) && allowed.has(e.t)) : model.edges, [model, allowed])
  // force-graph는 받은 객체에 x·y·vx를 써넣으므로 복사본을 넘긴다.
  // 기존 사전 좌표(작은 단위)는 버리고 d3-force가 화면 단위로 새로 배치한다 — 선 굵기가 배율에 끌려 커지지 않도록.
  // 전체 시뮬레이션 데이터는 고정한다. 선택·hop 변경은 visibility만 바꿔 기존 노드 위치가 움직이지 않게 한다.
  const graphData = useMemo(() => ({
    nodes: model.nodes.map(({ x: _x, y: _y, ...n }) => ({ ...n, id: n.key })) as unknown as FNode[],
    links: model.edges.map(e => ({ ...e, source: e.s, target: e.t })) as FLink[],
  }), [model])
  const pairKeys = useMemo(() => new Set(edges.map(e => `${e.s}>${e.t}`)), [edges])
  // panel 안 최소·최대 금액 사이를 로그 척도로 매핑(widthFor) — 굵기 차이가 화면에 보이는 값들 기준으로 뚜렷하게
  const [usdMin, usdMax] = useMemo(() => {
    const values = edges.map(e => e.usd)
    return values.length ? [Math.min(...values), Math.max(...values)] : [0, 0]
  }, [edges])

  // Obsidian 그래프 기본값에 가깝게: 노드끼리 밀어내는 힘을 키우고 연결 길이를 넉넉히 둔다
  useEffect(() => {
    const g = fg.current; if (!g) return
    ;(g.d3Force('charge') as unknown as { strength: (v: number) => void } | undefined)?.strength(-160)
    ;(g.d3Force('link') as unknown as { distance: (v: number) => void } | undefined)?.distance(48)
    g.d3ReheatSimulation()
  }, [graphData, size.w > 0]) // eslint-disable-line react-hooks/exhaustive-deps
  // 화면 맞춤은 첫 배치가 끝났을 때 한 번만 자동으로 한다. 드래그 뒤 멈출 때마다 시점이 튀지 않도록.
  const firstFit = useRef(false)
  // 첫 시뮬레이션이 멈추기 전에는 내부 zoom 상태가 없어 호출하면 오류가 난다
  const ready = useRef(false)
  const fitGraph = useCallback((ms = 400) => {
    const g = fg.current; if (!g || !ready.current) return
    g.zoomToFit(ms, PAD)
    window.setTimeout(() => { fitK.current = g.zoom(); setZoomK(g.zoom()); setFitted(true) }, ms + 20)
  }, [])
  // 화면 맞춤 상태에서는 크기·범위가 바뀌어도 계속 맞춘다

  // 레이아웃 전환으로 캔버스 요소가 바뀔 때마다 관찰 대상을 다시 잡는다(callback ref)
  const canvasObserver = useRef<ResizeObserver | null>(null)
  const canvasRef = useCallback((el: HTMLDivElement | null) => {
    canvas.current = el; canvasObserver.current?.disconnect(); canvasObserver.current = null
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }))
    observer.observe(el); canvasObserver.current = observer
  }, [])

  /* 시간축 */
  const events = useMemo(() => timelineEvents(edges), [edges])
  const last = events.at(-1) ?? 0, firstEvent = (events[0] ?? 1) - 1
  const [time, setTime] = useState(Infinity), [playing, setPlaying] = useState(false)
  const current = Math.min(time, last)
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => setTime(t => { const next = stepTimeline(events, Math.min(t, last), 1); if (next === Math.min(t, last)) setPlaying(false); return next }), 380)
    return () => window.clearInterval(id)
  }, [playing, events, last])
  const allTx = edges.flatMap(e => e.transactions), shownTx = allTx.filter(t => minutes(t.at) <= current).length
  const edgeStart = (e: GraphEdge) => Math.min(...e.transactions.map(t => minutes(t.at)))
  const nodeStart = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of edges) { const s = edgeStart(e); map.set(e.s, Math.min(map.get(e.s) ?? Infinity, s)); map.set(e.t, Math.min(map.get(e.t) ?? Infinity, s)) }
    return map
  }, [edges])
  const step = (direction: 1 | -1) => { setPlaying(false); setTime(stepTimeline(events, current, direction)) }
  const togglePlay = () => { if (!playing && current >= last) setTime(firstEvent); setPlaying(p => !p) }

  const clearSelection = () => { setSelectedNode(null); setSelectedEdge(null) }
  const selectNode = (key: string) => { setSelectedNode(key); setSelectedEdge(null) }
  const resetGraph = () => { clearSelection(); setHop(DEFAULT_HOP); setSearch(''); setShowInfo(false); setTime(Infinity); setPlaying(false); fitGraph() }
  const zoomBy = (factor: number) => { const g = fg.current; if (!g || !ready.current) return; setFitted(false); g.zoom(g.zoom() * factor, 200) }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('input,textarea,[role=slider]')) return
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
    else if (e.key === ' ') { e.preventDefault(); togglePlay() }
  }

  const searchAccount = () => {
    const q = search.trim().toLowerCase(); if (!q) return
    const found = model.nodes.find(n => n.account.toLowerCase().includes(q) || n.entity.toLowerCase().includes(q))
    if (found) selectNode(found.key)
  }

  const hoverNode = hover?.kind === 'node' ? nodeMap.get(hover.key) : undefined, hoverEdge = hover?.kind === 'edge' ? model.edges.find(e => e.key === hover.key) : undefined
  const selected = model.edges.find(e => e.key === selectedEdge)
  const focus: FlowFocus | null = selected ? { kind: 'edge', s: selected.s, t: selected.t } : selectedNode ? { kind: 'node', key: selectedNode } : null
  const panel = focus && <FlowPanel model={model} focus={focus} mode={panelMode} onModeChange={setPanelMode} onClose={clearSelection} />
  const docked = panel && panelMode === 'dock'

  // Obsidian식 강조: hover한 계좌와 직접 연결된 계좌·거래만 밝게, 나머지는 흐리게
  const hoverKey = hover?.kind === 'node' ? hover.key : null
  const lit = useMemo(() => {
    if (!hoverKey) return null
    const set = new Set([hoverKey])
    for (const e of connectedEdges.get(hoverKey) ?? []) {
      if (!allowed || (allowed.has(e.s) && allowed.has(e.t))) { set.add(e.s); set.add(e.t) }
    }
    return set
  }, [hoverKey, connectedEdges, allowed])
  const pointer = useRef({ x: 0, y: 0 })
  const colors = { l1: cssVar('--graph-l1'), l1Edge: cssVar('--graph-l1-edge'), l0: cssVar('--graph-l0'), l0Particle: cssVar('--graph-l0-particle'), node: cssVar('--graph-l0-node'), fg: cssVar('--foreground'), muted: cssVar('--muted-foreground') }
  const q = search.trim().toLowerCase()
  const nodeVisible = (n: FNode) => (!allowed || allowed.has(n.key)) && (nodeStart.get(n.key) ?? -Infinity) <= current
  // hop 범위 밖은 visibility에서 숨기고, hover 비이웃만 흐리게 표시한다.
  const faded = (key: string) => Boolean(lit && !lit.has(key))
  const linkVisible = (l: FLink) => (!allowed || (allowed.has(l.s) && allowed.has(l.t))) && edgeStart(l as GraphEdge) <= current
  const linkLit = (l: FLink) => hover?.key === l.key || selectedEdge === l.key || (!faded(l.s) && !faded(l.t))

  const forceGraph = size.w > 0 && size.h > 0 && (
    <ForceGraph2D<GraphNode & { id: string }, GraphEdge>
      ref={fg} width={size.w} height={size.h} graphData={graphData} backgroundColor="transparent"
      nodeRelSize={1} nodeVal={n => radius(n) ** 2} nodeVisibility={nodeVisible} nodeLabel={() => ''}
      nodeCanvasObject={(n, ctx, scale) => {
        const r = radius(n)
        ctx.globalAlpha = faded(n.key) ? .15 : 1
        ctx.beginPath(); ctx.arc(n.x!, n.y!, hoverKey === n.key ? r + 1.6 : r, 0, 2 * Math.PI); ctx.fillStyle = n.core ? colors.l1 : colors.node; ctx.fill()
        const match = q && (n.account.toLowerCase().includes(q) || n.entity.toLowerCase().includes(q))
        if (selectedNode === n.key || match) {
          ctx.beginPath(); ctx.arc(n.x!, n.y!, r + 4.5, 0, 2 * Math.PI); ctx.strokeStyle = colors.fg; ctx.lineWidth = 2 / scale
          ctx.setLineDash(selectedNode === n.key ? [] : [3 / scale, 3 / scale]); ctx.stroke(); ctx.setLineDash([])
        }
        // Obsidian처럼 확대할수록 이름이 드러난다. 의심 거래 계좌는 항상 표시
        if (n.core || scale > 2.2 || hoverKey === n.key) {
          ctx.font = `${10 / scale}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
          ctx.fillStyle = colors.muted; ctx.fillText(n.account, n.x!, n.y! + r + 3 / scale)
        }
        ctx.globalAlpha = 1
      }}
      nodePointerAreaPaint={(n, color, ctx) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x!, n.y!, radius(n) + 4, 0, 2 * Math.PI); ctx.fill() }}
      linkVisibility={linkVisible} linkLabel={() => ''}
      linkColor={l => { const c = l.label === 1 ? colors.l1Edge : colors.l0; return linkLit(l) ? c : dim(c) }}
      // Obsidian처럼 가는 선: 금액 굵기(widthFor 1~12)를 절반 남짓으로 줄인다
      linkWidth={l => widthFor(l.usd, usdMin, usdMax) * .55 * (selectedEdge === l.key ? 1.5 : 1)}
      linkLineDash={l => l.bridgePath ? [4, 3] : null}
      // 방향: 화살촉은 도착 계좌 경계(9/19 명기: 가운데는 애매). 자기 자신 거래·양방향 쌍은 곡선으로 분리
      linkDirectionalArrowLength={l => 3 + widthFor(l.usd, usdMin, usdMax) * .5} linkDirectionalArrowRelPos={1}
      linkCurvature={l => l.s === l.t ? .9 : pairKeys.has(`${l.t}>${l.s}`) ? .18 : 0}
      // 의심 거래는 빨간 점 2개, 정상 거래는 반투명 흰 점 1개로 흐름을 구분한다.
      linkDirectionalParticles={l => l.label === 1 ? 2 : 1} linkDirectionalParticleWidth={l => l.label === 1 ? Math.max(2, widthFor(l.usd, usdMin, usdMax)) : Math.max(1.5, widthFor(l.usd, usdMin, usdMax) * .65)}
      linkDirectionalParticleColor={l => l.label === 1 ? colors.l1 : colors.l0Particle}
      linkCanvasObjectMode={() => 'after'}
      linkCanvasObject={(l, ctx, scale) => {
        if (!(showInfo || hover?.key === l.key || selectedEdge === l.key)) return
        const s = l.source as FNode, t = l.target as FNode; if (typeof s !== 'object' || typeof t !== 'object') return
        ctx.font = `${10 / scale}px ui-sans-serif, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = colors.fg
        ctx.fillText(`${l.count}건 · ${compactUsd(l.usd)}`, (s.x! + t.x!) / 2, (s.y! + t.y!) / 2 - 4 / scale)
      }}
      onNodeHover={n => setHover(n ? { kind: 'node', key: n.key, ...pointer.current } : null)}
      onLinkHover={l => setHover(l ? { kind: 'edge', key: l.key, ...pointer.current } : null)}
      onNodeClick={n => selectNode(n.key)}
      onLinkClick={l => { setSelectedEdge(l.key); setSelectedNode(null) }}
      onBackgroundClick={clearSelection}
      onZoom={({ k }) => setZoomK(k)} onZoomEnd={({ k }) => { if (ready.current && Math.abs(k - fitK.current) > .01) setFitted(false) }}
      // 시뮬레이션은 기본값(자연 감쇠)으로 끝까지 돈다. 드래그하면 다시 데워져 이웃이 따라 움직인다.
      onEngineStop={() => { ready.current = true; if (!firstFit.current) { firstFit.current = true; fitGraph() } }}
    />
  )
  const settingsFull = (
    <div className="p-4 h-full flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-sm">그래프 설정</h3>
        <IconButton label="그래프 초기화" onClick={resetGraph}><RotateCcw className="size-3.5" /></IconButton>
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="graph-info" className="text-xs font-normal leading-5">상시 거래 정보 표시</Label>
        <Switch id="graph-info" checked={showInfo} onCheckedChange={setShowInfo} />
      </div>
      <div className="space-y-3">
        <Label className="text-xs text-muted-foreground">선택 계좌 기준 연결 단계 (hop)</Label>
        <Slider aria-label="선택 계좌 기준 연결 단계 hop 수" min={HOP_MIN} max={HOP_MAX} step={1} value={[hop]} disabled={!selectedNode} onValueChange={([v]) => setHop(v)} />
        <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">{HOP_TICKS.map(v => <span key={v} className={v === hop ? 'text-foreground font-semibold' : ''}>{v}</span>)}</div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{selectedNode ? `${nodeMap.get(selectedNode)?.account} 기준 ${hop} hop 이내 노드만 표시` : '그래프에서 계좌 노드를 선택하면 hop 범위 설정이 활성화됩니다.'}</p>
      </div>
      <div className="mt-auto space-y-2.5 border-t pt-4 text-[11px] text-muted-foreground graph-legend">
        <p className="flex items-center gap-2"><i className="legend-line" style={{ background: 'var(--graph-l1)' }} />의심 거래</p>
        <p className="flex items-center gap-2"><i className="legend-line" style={{ background: 'var(--graph-l0)' }} />정상 거래</p>
        <p className="flex items-center gap-2"><i className="legend-line legend-dash" />연결 경로</p>
        <p className="flex items-center gap-2"><i className="legend-dot" style={{ background: 'var(--graph-l1)' }} />의심 거래 참여 계좌</p>
        <p className="flex items-center gap-2"><i className="legend-dot legend-dot-sm" style={{ background: 'var(--graph-l0-node)' }} />주변 계좌 · 큰 점은 허브</p>
        <p>선 굵기 · 거래 금액(USD)</p>
      </div>
    </div>
  )

  const settingsCompact = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-2.5 border-b text-xs shrink-0">
      <div className="flex items-center gap-2">
        <Label htmlFor="graph-info-c" className="text-xs font-normal">거래 정보</Label>
        <Switch id="graph-info-c" checked={showInfo} onCheckedChange={setShowInfo} />
      </div>
      <div className="flex items-center gap-2 flex-1 min-w-[180px]">
        <Label className="text-[11px] text-muted-foreground shrink-0">연결 단계 (hop)</Label>
        <Slider aria-label="선택 계좌 기준 연결 단계 hop 수" className="flex-1" min={HOP_MIN} max={HOP_MAX} step={1} value={[hop]} disabled={!selectedNode} onValueChange={([v]) => setHop(v)} />
        <span className="text-[11px] tabular-nums min-w-12 text-center shrink-0">{selectedNode ? `${hop} hop` : '계좌 선택'}</span>
      </div>
      <IconButton label="그래프 초기화" onClick={resetGraph}><RotateCcw className="size-3.5" /></IconButton>
    </div>
  )

  const mainGraph = (
    <div className="h-full flex flex-col min-w-0" tabIndex={-1} onKeyDown={onKeyDown} data-testid="graph-region">
      <div className="flex gap-2 p-3 border-b items-center shrink-0">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input aria-label="그래프 계좌 검색" placeholder="계좌번호 · 소유주 검색 후 Enter" className="pl-8 h-8 text-xs" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') searchAccount() }} />
        </div>
        <IconButton label={fullscreen ? '전체화면 종료' : '전체화면'} onClick={() => setFullscreen(f => !f)}>{fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</IconButton>
      </div>
      <div ref={canvasRef} className="relative flex-1 min-h-0 graph-canvas outline-none" tabIndex={0} role="img" aria-label={`${label} · 계좌 ${nodes.length}개, 연결 ${edges.length}개 · ←/→ 이전·다음 거래, Space 재생`} onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); pointer.current = { x: e.clientX - r.left, y: e.clientY - r.top } }}>
        <Suspense fallback={null}>{forceGraph}</Suspense>
        {hover && (hoverNode || hoverEdge) && (
          <div className="graph-tooltip" style={{ left: Math.min(hover.x + 14, size.w - 260), top: Math.min(hover.y + 14, size.h - 110) }}>
            {hoverNode && <><b>{hoverNode.entity}</b><br />{hoverNode.account} · Bank {hoverNode.bank}<br />{graphNodeRole(hoverNode)}</>}
            {hoverEdge && <><b>{hoverEdge.label === 1 ? '의심 거래' : hoverEdge.bridgePath ? '연결 경로 · 정상 거래' : '정상 거래'}</b> · {hoverEdge.count}건<br />{nodeMap.get(hoverEdge.s)!.account} → {nodeMap.get(hoverEdge.t)!.account}<br />{usd(hoverEdge.usd)}{hoverEdge.currency !== 'US Dollar' && ` (${hoverEdge.currency})`} · {hoverEdge.format}<br />{hoverEdge.first.slice(5)} ~ {hoverEdge.last.slice(5)}</>}
          </div>
        )}
        <div className="absolute bottom-3 left-3 flex items-center gap-2 text-[11px] text-muted-foreground bg-card/90 rounded-md px-2 py-1 pointer-events-none"><Network className="size-3.5" />계좌 {nodes.length} · 연결 {edges.length}</div>
        <div className="absolute bottom-3 right-3 flex items-center bg-card border rounded-md">
          <IconButton label="축소" onClick={() => zoomBy(1 / 1.2)}><Minus className="size-3.5" /></IconButton>
          <span className="text-[11px] tabular-nums w-10 text-center">{Math.round(zoomK / (fitK.current || 1) * 100)}%</span>
          <IconButton label="확대" onClick={() => zoomBy(1.2)}><Plus className="size-3.5" /></IconButton>
          <IconButton label="화면 맞춤" disabled={fitted} onClick={() => fitGraph()}><Shrink className="size-3.5" /></IconButton>
        </div>
      </div>
      <div className="graph-timebar flex items-center gap-3 border-t px-3 py-2 text-xs shrink-0">
        <span className="text-muted-foreground shrink-0">시간축</span>
        <Slider aria-label="시간축" className="flex-1 min-w-24" min={firstEvent} max={last} step={1} value={[current]} onValueChange={([v]) => { setPlaying(false); setTime(v) }} />
        <IconButton label="이전 거래 (←)" className="size-7" onClick={() => step(-1)}><StepBack className="size-3.5" /></IconButton>
        <IconButton label={playing ? '일시정지 (Space)' : '시간순 재생 (Space)'} className="size-7" onClick={togglePlay}>{playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}</IconButton>
        <IconButton label="다음 거래 (→)" className="size-7" onClick={() => step(1)}><StepForward className="size-3.5" /></IconButton>
        <span className="tabular-nums font-medium w-[86px] shrink-0">{current < (events[0] ?? 0) ? '시작 전' : timeLabel(current)}</span>
        <span className="tabular-nums text-muted-foreground shrink-0" data-testid="timeline-count">이 시각까지 시작된 거래 {shownTx} / {allTx.length}건</span>
        <span className="hidden 2xl:inline-flex items-center gap-1 text-muted-foreground shrink-0"><Kbd>←</Kbd><Kbd>→</Kbd><Kbd>Space</Kbd></span>
      </div>
    </div>
  )


  // 설정 | 그래프 | 상세(도킹). 상세는 본문을 덮지 않고 밀어낸다(v18 G5). 플로팅이면 분할 없이 위에 뜬다.
  const renderWideSplit = (testId: string) => (
    <div className="flex-1 min-h-0 flex" data-testid={testId} data-split="horizontal">
      <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
        <ResizablePanel defaultSize="210px" minSize="190px" maxSize="260px">{settingsFull}</ResizablePanel>
        <ResizableHandle />
        <ResizablePanel minSize="320px" id={`${testId}-main`}>{mainGraph}</ResizablePanel>
        {docked && (
          <>
            <ResizableHandle />
            <ResizablePanel id={`${testId}-detail`} defaultSize="440px" minSize="340px" maxSize="760px">
              <div className="h-full min-h-0" data-testid="graph-detail-panel">{panel}</div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  )

  const narrowSplit = (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="graph-split-v" data-split="vertical">
      {settingsCompact}
      <ResizablePanelGroup orientation="vertical" className="flex-1 min-h-0">
        <ResizablePanel minSize="240px" defaultSize="60%" id="graph-main-v">{mainGraph}</ResizablePanel>
        {docked && (
          <>
            <ResizableHandle />
            <ResizablePanel minSize="180px" defaultSize="40%" id="graph-detail-v">
              <div className="h-full min-h-0" data-testid="graph-detail-panel">{panel}</div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  )

  const normalBody = (
    <div ref={layout} style={{ height: fillHeight }} className="graph-layout min-h-[460px] overflow-hidden rounded-lg border bg-card flex flex-col" data-testid="graph-layout">
      {narrow ? narrowSplit : renderWideSplit('graph-split-h')}
    </div>
  )

  // 전체화면도 동일하게 밀어내는 분할(overlay graph-drawer 제거)
  const fullscreenBody = (
    <div ref={layout} className="graph-layout h-full overflow-hidden rounded-lg border bg-card flex flex-col" data-testid="graph-layout-fs">
      {renderWideSplit('graph-split-fs')}
    </div>
  )

  return (
    <>
      {!fullscreen && normalBody}
      {!fullscreen && panelMode === 'float' && panel}
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="graph-dialog w-[97vw] h-[94vh] max-w-none! p-4" showCloseButton={false}>
          <DialogTitle className="sr-only">관계 그래프 전체화면</DialogTitle>
          <DialogDescription className="sr-only">계좌 및 거래 탐색. 전체화면 종료 버튼으로 돌아갑니다.</DialogDescription>
          {fullscreen && <div className="flex-1 min-h-0">{fullscreenBody}</div>}
          {/* 전체화면(모달) 안에서는 바깥 창을 누를 수 없으므로 플로팅 상세도 대화상자 안에 띄운다 */}
          {fullscreen && panelMode === 'float' && panel}
        </DialogContent>
      </Dialog>
    </>
  )
}
