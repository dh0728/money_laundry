import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Maximize2, Minimize2, Minus, Network, Pause, Play, Plus, RotateCcw, Search, Shrink, StepBack, StepForward } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Kbd } from '@/components/ui/kbd'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { compactUsd, minutes, neighborhood, stepTimeline, timeLabel, timelineEvents, usd, widthFor, type GraphEdge, type GraphModel, type GraphNode } from './domain'
import SankeyPanel, { type SankeyFocus } from './Sankey'
import { IconButton } from './shared'

export const DEFAULT_HOP = 3
const HOP_MIN = 1, HOP_MAX = 5
const HOP_TICKS = [1, 2, 3, 4, 5]
const PAD = 56
const NARROW_WIDTH = 900
type View = { k: number; x: number; y: number }
type Point = { x: number; y: number }

// 세탁 여부 2색: 1=빨강, 0=무채색(사용자 확정). 위험도 색은 그래프에 쓰지 않는다.
export const nodeTone = (n: GraphNode) => n.core ? 'var(--graph-l1)' : 'var(--graph-l0-node)'
export const edgeTone = (e: Pick<GraphEdge, 'label'>) => e.label === 1 ? 'var(--graph-l1)' : 'var(--graph-l0)'
const radius = (n: GraphNode) => n.hub ? 7 : n.core ? 5.5 : n.bridge ? 4.2 : 3.4

export function fitView(nodes: GraphNode[], width: number, height: number): View {
  if (!nodes.length || width < 10 || height < 10) return { k: 1, x: 0, y: 0 }
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const k = Math.min((width - PAD * 2) / Math.max(maxX - minX, .2), (height - PAD * 2) / Math.max(maxY - minY, .2))
  return { k, x: width / 2 - (minX + maxX) / 2 * k, y: height / 2 - (minY + maxY) / 2 * k }
}
export const sameView = (a: View, b: View) => Math.abs(a.k - b.k) / Math.max(b.k, 1) < .01 && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1

// 직선 엣지: 하나의 채운 폴리곤(두꺼운 몸통 + 넓어진 화살촉)으로 그려 얇은 선에서도 화살촉이 압도하지 않고
// 굵은 선은 확실히 굵어 보이게 한다. body 폭=width, 화살촉 폭≈width*1.8+6, 길이≈width*1.4+6.
export function edgeGeometry(a: Point, b: Point, ra: number, rb: number, width: number) {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1
  const ux = dx / length, uy = dy / length
  const nx = -uy, ny = ux
  const start = { x: a.x + ux * (ra + 1.5), y: a.y + uy * (ra + 1.5) }
  const tip = { x: b.x - ux * (rb + 1.5), y: b.y - uy * (rb + 1.5) }
  const shaftLen = Math.hypot(tip.x - start.x, tip.y - start.y)
  const headLen = Math.min(width * 1.4 + 6, Math.max(shaftLen - 1, 1))
  const headWidth = width * 1.8 + 6
  const headBase = { x: tip.x - ux * headLen, y: tip.y - uy * headLen }
  const halfW = width / 2, halfHead = headWidth / 2
  const off = (p: Point, d: number) => ({ x: p.x + nx * d, y: p.y + ny * d })
  const s1 = off(start, halfW), s2 = off(start, -halfW)
  const b1 = off(headBase, halfW), b2 = off(headBase, -halfW)
  const h1 = off(headBase, halfHead), h2 = off(headBase, -halfHead)
  return {
    polygon: `M${s1.x},${s1.y} L${b1.x},${b1.y} L${h1.x},${h1.y} L${tip.x},${tip.y} L${h2.x},${h2.y} L${b2.x},${b2.y} Z`,
    line: `M${start.x},${start.y} L${tip.x},${tip.y}`,
    mid: { x: (start.x + tip.x) / 2, y: (start.y + tip.y) / 2 },
  }
}

// 자기 자신에게 돌아오는 거래: 노드 위쪽으로 뚜렷한 고리를 그리고 끝에 노드를 향하는 화살촉을 둔다.
export function loopGeometry(center: Point, r: number, width: number) {
  const gap = 6 + width * .4
  const start = { x: center.x - gap, y: center.y - r }
  const end = { x: center.x + gap, y: center.y - r }
  const bulge = 20 + width * 3
  const c1 = { x: start.x - bulge, y: start.y - bulge }, c2 = { x: end.x + bulge, y: end.y - bulge }
  const path = `M${start.x},${start.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`
  // 곡선이 end에 도달하는 접선 방향(대각선 아래-왼쪽 = 노드를 향함)은 폭에 무관하게 일정하다
  const ux = -Math.SQRT1_2, uy = Math.SQRT1_2, nx = -uy, ny = ux
  const headLen = 5 + width * 1.2, halfHead = 3 + width * .9
  const tip = { x: end.x + ux * 1.5, y: end.y + uy * 1.5 }
  const base = { x: tip.x - ux * headLen, y: tip.y - uy * headLen }
  const arrow = `M${tip.x},${tip.y} L${base.x + nx * halfHead},${base.y + ny * halfHead} L${base.x - nx * halfHead},${base.y - ny * halfHead} Z`
  return { path, arrow }
}

export default function Graph({ model, label }: { model: GraphModel; label: string }) {
  const [showInfo, setShowInfo] = useState(false), [hop, setHop] = useState(DEFAULT_HOP)
  const [selectedNode, setSelectedNode] = useState<string | null>(null), [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [search, setSearch] = useState(''), [fullscreen, setFullscreen] = useState(false)
  const [hover, setHover] = useState<{ kind: 'node' | 'edge'; key: string; x: number; y: number } | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 }), [view, setView] = useState<View>({ k: 1, x: 0, y: 0 }), [fitted, setFitted] = useState(true)
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
  const canvas = useRef<HTMLDivElement>(null), drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null)

  const nodeMap = useMemo(() => new Map(model.nodes.map(n => [n.key, n])), [model])
  const allowed = useMemo(() => selectedNode ? neighborhood(model, selectedNode, hop) : null, [model, selectedNode, hop])
  const nodes = useMemo(() => allowed ? model.nodes.filter(n => allowed.has(n.key)) : model.nodes, [model, allowed])
  const edges = useMemo(() => allowed ? model.edges.filter(e => allowed.has(e.s) && allowed.has(e.t)) : model.edges, [model, allowed])
  const fit = useMemo(() => fitView(nodes, size.w, size.h), [nodes, size.w, size.h])
  // panel 안 최소·최대 금액 사이를 제곱근 척도로 매핑(굵기 차이가 화면에 보이는 값들 기준으로 뚜렷하게)
  const [usdMin, usdMax] = useMemo(() => {
    const values = edges.map(e => e.usd)
    return values.length ? [Math.min(...values), Math.max(...values)] : [0, 0]
  }, [edges])

  // 화면 맞춤 상태에서는 크기·범위가 바뀌어도 계속 맞춘다
  useEffect(() => { if (fitted) setView(fit) }, [fit, fitted])
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

  const project = (n: GraphNode) => ({ x: n.x * view.k + view.x, y: n.y * view.k + view.y })
  const clearSelection = () => { setSelectedNode(null); setSelectedEdge(null) }
  const selectNode = (key: string) => { setSelectedNode(key); setSelectedEdge(null) }
  const closePanel = () => { setSelectedEdge(null); setSelectedNode(null) } // 패널을 닫으면 hop 필터(선택 계좌)도 함께 해제한다
  const resetGraph = () => { clearSelection(); setHop(DEFAULT_HOP); setSearch(''); setShowInfo(false); setFitted(true); setTime(Infinity); setPlaying(false) }
  const zoomAt = (factor: number, px = size.w / 2, py = size.h / 2) => {
    setFitted(false)
    setView(v => { const k = Math.min(v.k * 6, Math.max(v.k / 6, v.k * factor)); return { k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) } })
  }
  useEffect(() => {
    const el = canvas.current; if (!el) return
    const wheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(e.deltaY > 0 ? 1 / 1.12 : 1.12, e.clientX - r.left, e.clientY - r.top) }
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel)
  })

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest('[data-graph-item]')) return
    drag.current = { x: e.clientX, y: e.clientY, view, moved: false }; e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current; if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    d.moved = true; setFitted(false); setView({ ...d.view, x: d.view.x + dx, y: d.view.y + dy })
  }
  const onPointerUp = () => { const d = drag.current; drag.current = null; if (d && !d.moved) clearSelection() } // 빈 공간 click = 선택 해제

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

  const selected = model.edges.find(e => e.key === selectedEdge)
  const hoverNode = hover?.kind === 'node' ? nodeMap.get(hover.key) : undefined, hoverEdge = hover?.kind === 'edge' ? model.edges.find(e => e.key === hover.key) : undefined
  // 엣지 선택은 물론, 계좌 선택(hop 필터) 상태에서도 거래 흐름 패널을 연다
  const focus: SankeyFocus | null = selected ? { kind: 'edge', s: selected.s, t: selected.t } : selectedNode ? { kind: 'node', key: selectedNode } : null

  const svg = (
    <svg role="img" aria-label={`${label} · 계좌 ${nodes.length}개, 연결 ${edges.length}개`} width={size.w} height={size.h} className="absolute inset-0 touch-none select-none"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null }}>
      {edges.slice().sort((a, b) => a.label - b.label).map(e => {
        const s = nodeMap.get(e.s)!, t = nodeMap.get(e.t)!, a = project(s), b = project(t)
        const width = widthFor(e.usd, usdMin, usdMax), future = edgeStart(e) > current, active = selectedEdge === e.key, hovered = hover?.key === e.key
        const lit = hovered || active || (hover?.kind === 'node' && (hover.key === e.s || hover.key === e.t))
        const tone = edgeTone(e)
        const loop = e.s === e.t
        const geometry = loop ? null : edgeGeometry(a, b, radius(s), radius(t), width)
        const loopG = loop ? loopGeometry(a, radius(s), width) : null
        const info = showInfo || hovered || active
        return (
          <g key={e.key} data-graph-item="edge" data-label={e.label} data-loop={loop || undefined} className={`graph-edge ${future ? 'is-future' : ''} ${lit ? 'is-lit' : ''}`} role="button" tabIndex={0}
            aria-label={`${s.account}에서 ${t.account}로 ${e.count}건 ${usd(e.usd)}${e.label === 1 ? ' · 세탁 거래' : ''}`}
            onClick={() => { setSelectedEdge(e.key); setSelectedNode(null) }}
            onKeyDown={k => { if (k.key === 'Enter') { setSelectedEdge(e.key); setSelectedNode(null) } }}
            onPointerEnter={p => { const r = canvas.current!.getBoundingClientRect(); setHover({ kind: 'edge', key: e.key, x: p.clientX - r.left, y: p.clientY - r.top }) }}
            onPointerLeave={() => setHover(null)}>
            {loop
              ? <>
                <path d={loopG!.path} fill="none" stroke={tone} strokeWidth={width} strokeLinecap="round" />
                <path d={loopG!.arrow} fill={tone} />
                {info && <text x={a.x} y={a.y - radius(s) - 26 - width} textAnchor="middle" className="graph-label" fontSize="10">{e.count}건 · {compactUsd(e.usd)}</text>}
              </>
              : <>
                <path d={geometry!.line} fill="none" stroke="transparent" strokeWidth={Math.max(16, width + 10)} />
                <path d={geometry!.polygon} fill={tone} opacity={e.bridgePath ? .55 : 1} />
                {info && <text x={geometry!.mid.x} y={geometry!.mid.y - width / 2 - 6} textAnchor="middle" className="graph-label" fontSize="10">{e.count}건 · {compactUsd(e.usd)}</text>}
              </>}
          </g>
        )
      })}
      {nodes.map(n => {
        const p = project(n), r = radius(n), future = (nodeStart.get(n.key) ?? -Infinity) > current, active = selectedNode === n.key
        const match = search.trim() && (n.account.toLowerCase().includes(search.trim().toLowerCase()) || n.entity.toLowerCase().includes(search.trim().toLowerCase()))
        const glow = hover?.kind === 'node' && hover.key === n.key
        const shape = <circle cx={p.x} cy={p.y} r={glow ? r + 1.6 : r} fill={nodeTone(n)} className={glow ? 'graph-glow' : ''} />
        return (
          <g key={n.key} data-graph-item="node" data-core={n.core} className={`graph-node ${future ? 'is-future' : ''}`} role="button" tabIndex={0}
            aria-label={`계좌 ${n.account} · ${n.entity}${n.core ? ' · 세탁 거래 참여' : ''}`}
            onClick={() => selectNode(n.key)} onKeyDown={k => { if (k.key === 'Enter') selectNode(n.key) }}
            onPointerEnter={ev => { const b = canvas.current!.getBoundingClientRect(); setHover({ kind: 'node', key: n.key, x: ev.clientX - b.left, y: ev.clientY - b.top }) }}
            onPointerLeave={() => setHover(null)}>
            <circle cx={p.x} cy={p.y} r={r + 8} fill="transparent" />
            {shape}
            {(active || match) && <circle cx={p.x} cy={p.y} r={r + 4.5} fill="none" stroke="var(--foreground)" strokeWidth={2} strokeDasharray={active ? undefined : '3 3'} />}
            {n.core && <text x={p.x} y={p.y + r + 12} textAnchor="middle" className="graph-label graph-account" fontSize="10">{n.account}</text>}
          </g>
        )
      })}
    </svg>
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
        <Label className="text-xs text-muted-foreground">표시 범위</Label>
        <Slider aria-label="표시 범위 hop" min={HOP_MIN} max={HOP_MAX} step={1} value={[hop]} disabled={!selectedNode} onValueChange={([v]) => setHop(v)} />
        <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">{HOP_TICKS.map(v => <span key={v} className={v === hop ? 'text-foreground font-semibold' : ''}>{v}</span>)}</div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{selectedNode ? `${nodeMap.get(selectedNode)?.account}에서 ${hop}단계 이내 계좌` : '계좌를 선택하면 연결 단계를 좁힐 수 있습니다.'}</p>
      </div>
      <div className="mt-auto space-y-2.5 border-t pt-4 text-[11px] text-muted-foreground graph-legend">
        <p className="flex items-center gap-2"><i className="legend-line" style={{ background: 'var(--graph-l1)' }} />세탁 거래</p>
        <p className="flex items-center gap-2"><i className="legend-line" style={{ background: 'var(--graph-l0)' }} />정상 거래</p>
        <p className="flex items-center gap-2"><i className="legend-line legend-dash" />연결 경로</p>
        <p className="flex items-center gap-2"><i className="legend-dot" style={{ background: 'var(--graph-l1)' }} />세탁 거래 참여 계좌</p>
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
        <Label className="text-[11px] text-muted-foreground shrink-0">범위</Label>
        <Slider aria-label="표시 범위 hop" className="flex-1" min={HOP_MIN} max={HOP_MAX} step={1} value={[hop]} disabled={!selectedNode} onValueChange={([v]) => setHop(v)} />
        <span className="text-[11px] tabular-nums w-3 text-center shrink-0">{hop}</span>
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
        <IconButton label="화면 맞춤" disabled={fitted && sameView(view, fit)} onClick={() => { setFitted(true); setView(fit) }}><Shrink className="size-4" /></IconButton>
        <IconButton label={fullscreen ? '전체화면 종료' : '전체화면'} onClick={() => setFullscreen(f => !f)}>{fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</IconButton>
      </div>
      <div ref={canvasRef} className="relative flex-1 min-h-0 graph-canvas outline-none" tabIndex={0} aria-label="관계 그래프 영역 · ←/→ 이전·다음 거래, Space 재생">
        {svg}
        {hover && (hoverNode || hoverEdge) && (
          <div className="graph-tooltip" style={{ left: Math.min(hover.x + 14, size.w - 260), top: Math.min(hover.y + 14, size.h - 110) }}>
            {hoverNode && <><b>{hoverNode.entity}</b><br />{hoverNode.account} · Bank {hoverNode.bank}<br />{hoverNode.core ? '세탁 거래 참여 계좌' : hoverNode.hub ? `허브 · 상대 계좌 ${hoverNode.hubDegree.toLocaleString()}개` : hoverNode.bridge ? '연결 경로 경유 계좌' : `${hoverNode.hop}단계 주변 계좌`}{hoverNode.synthetic && ' · 합성 예시'}</>}
            {hoverEdge && <><b>{hoverEdge.label === 1 ? '세탁 거래' : hoverEdge.bridgePath ? '연결 경로 · 정상 거래' : '정상 거래'}</b> · {hoverEdge.count}건<br />{nodeMap.get(hoverEdge.s)!.account} → {nodeMap.get(hoverEdge.t)!.account}<br />{usd(hoverEdge.usd)}{hoverEdge.currency !== 'US Dollar' && ` (${hoverEdge.currency})`} · {hoverEdge.format}<br />{hoverEdge.first.slice(5)} ~ {hoverEdge.last.slice(5)}</>}
          </div>
        )}
        <div className="absolute bottom-3 left-3 flex items-center gap-2 text-[11px] text-muted-foreground bg-card/90 rounded-md px-2 py-1 pointer-events-none"><Network className="size-3.5" />계좌 {nodes.length} · 연결 {edges.length}</div>
        <div className="absolute bottom-3 right-3 flex items-center bg-card border rounded-md">
          <IconButton label="축소" onClick={() => zoomAt(1 / 1.2)}><Minus className="size-3.5" /></IconButton>
          <span className="text-[11px] tabular-nums w-10 text-center">{Math.round(view.k / (fit.k || 1) * 100)}%</span>
          <IconButton label="확대" onClick={() => zoomAt(1.2)}><Plus className="size-3.5" /></IconButton>
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

  const panel = focus && <SankeyPanel model={model} focus={focus} onClose={closePanel} />

  // 비-전체화면: 넓은 화면은 설정·그래프·상세를 좌우로, 좁거나 세로 화면은 위아래로 쌓는다
  const normalBody = (
    <div ref={layout} style={{ height: fillHeight }} className="graph-layout min-h-[460px] overflow-hidden rounded-lg border bg-card flex flex-col">
      {narrow ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-auto">
          {settingsCompact}
          <div className="flex-1 min-h-[440px]">{mainGraph}</div>
          {panel && <div className="border-t shrink-0" style={{ height: 420 }}>{panel}</div>}
        </div>
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
          <ResizablePanel defaultSize="210px" minSize="190px" maxSize="260px">{settingsFull}</ResizablePanel>
          <ResizableHandle />
          <ResizablePanel minSize="320px">{mainGraph}</ResizablePanel>
          {panel && (
            <>
              <ResizableHandle />
              <ResizablePanel defaultSize="360px" minSize="300px" maxSize="480px">{panel}</ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      )}
    </div>
  )

  // 전체화면: 그래프 영역(설정+캔버스+시간축)만 채우고, 상세는 그 위에 겹치는 드로어로 연다.
  // 드로어는 리사이즈 패널 그룹 밖에 있어 열고 닫아도 그래프 폭 재계산이 필요 없다(닫은 뒤 잘림 버그의 원인 제거).
  const fullscreenBody = (
    <div ref={layout} className="graph-layout h-full overflow-hidden rounded-lg border bg-card flex flex-col">
      <div className="relative flex-1 min-h-0">
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          <ResizablePanel defaultSize="210px" minSize="190px" maxSize="260px">{settingsFull}</ResizablePanel>
          <ResizableHandle />
          <ResizablePanel minSize="320px">{mainGraph}</ResizablePanel>
        </ResizablePanelGroup>
        {panel && <div className="graph-drawer">{panel}</div>}
      </div>
    </div>
  )

  return (
    <>
      {!fullscreen && normalBody}
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="graph-dialog w-[97vw] h-[94vh] max-w-none! p-4" showCloseButton={false}>
          <DialogTitle className="sr-only">관계 그래프 전체화면</DialogTitle>
          <DialogDescription className="sr-only">계좌 및 거래 탐색. 전체화면 종료 버튼으로 돌아갑니다.</DialogDescription>
          {fullscreen && <div className="flex-1 min-h-0">{fullscreenBody}</div>}
        </DialogContent>
      </Dialog>
    </>
  )
}
