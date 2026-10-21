// 패턴 보기(김명기 10/12): 시간축을 빼고 "모양"에 집중하는 보기. 시간순은 소유주 보기가 맡는다.
// dev의 force 그래프(react-force-graph-2d, Obsidian 그래프와 같은 방식)로 계좌를 끌어 놀 수 있고,
// 놓으면 천천히 템플릿 모양 쪽으로 돌아온다. `원래 패턴으로` = templateLayout(보내는 쪽 → 받는 쪽 층, 이웃 평균 높이)으로 즉시 복원.
// 패턴 이름은 구조로 추정한 값(FE 제안)이고 모델 값이 아니다. 번호는 시간순 그래프와 같은 규칙(처음 나온 순서).
import { Component, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { NODE_SIZE, templateLayout, type Timeline } from './timeLayout'

const ForceGraph2D = lazy(() => import('react-force-graph-2d')) as unknown as typeof import('react-force-graph-2d').default
const R = NODE_SIZE / 2
const usdShort = (v: number): string => !Number.isFinite(v) ? '확인 불가' : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : `${Math.round(v)}`

export type PatternControls = { zoomTo: (k: number) => void; fit: () => void; reset: () => void }
export type PatternSelection = { type: 'nodes'; ids: string[] } | { type: 'link'; id: string } | null
type PNode = { id: string; n: number; tx: number; ty: number; x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number }
type PLink = { id: string; pair: string; source: string | PNode; target: string | PNode; count: number; sumUsd: number; maxScore: number | null; width: number; curvature: number; merged: boolean; __controlPoints?: number[] }
// 선 규칙(김명기 10/12): 두 계좌 사이 한 건이면 최단 거리 직선. 여러 건이면 건마다 선을 따로 두고 베지어로 갈라 보임.
// 수십 건이 쌓이거나(MERGE_COUNT 초과) 선 굵기가 너무 두꺼워지면(MERGE_WIDTH 초과) 한 줄로 통합해 `N건 · 금액`으로 적는다
const MERGE_COUNT = 6, MERGE_WIDTH = 24

// 위험 색(--risk-N)을 캔버스가 쓸 실제 색으로 바꾼다
function resolveColor(name: string) {
  const el = document.createElement('span'); el.style.color = `var(${name})`; document.body.appendChild(el)
  const c = getComputedStyle(el).color; el.remove(); return c
}

function PatternLoading() {
  return <p role="status" className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">패턴 그래프를 불러오는 중…</p>
}

class PatternLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <div role="alert" className="absolute inset-0 flex items-center justify-center px-6 text-center">
      <div><p className="text-sm font-medium">패턴 그래프를 불러오지 못했습니다.</p><p className="mt-2 text-xs text-muted-foreground">상단의 소유주 보기로 전환해 조사를 계속하거나 페이지를 새로고침해 주세요.</p></div>
    </div>
    return this.props.children
  }
}

type PatternMethods = import('react-force-graph-2d').ForceGraphMethods<PNode, PLink>

export default function PatternGraph({ g, selected, onSelect, onZoom, controls, active = true }: { g: Timeline; selected: PatternSelection; onSelect: (s: PatternSelection) => void; onZoom: (k: number) => void; controls: Ref<PatternControls>; active?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null)
  const fg = useRef<PatternMethods>(undefined)
  const activeRef = useRef(active)
  useLayoutEffect(() => {
    activeRef.current = active
    if (active) fg.current?.resumeAnimation()
    else fg.current?.pauseAnimation()
  }, [active])
  const attachGraph = useCallback((graph: PatternMethods | null) => {
    fg.current = graph ?? undefined
    // Lazy imports may attach after the parent investigation tab has already hidden this graph.
    if (activeRef.current) graph?.resumeAnimation()
    else graph?.pauseAnimation()
  }, [])
  const [size, setSize] = useState({ w: 0, h: 0 })
  const fitted = useRef(false), lastK = useRef(0)
  // 조작(김명기 10/12, 소유주 보기와 같게): 빈 곳 왼쪽 끌기 = 다중 선택, 빈 곳 오른쪽(휠) 클릭하고 끌기 = 화면 이동, 계좌를 잡고 끌 때만 옮기기
  const press = useRef<{ x: number; y: number; id: string | null } | null>(null)
  const hover = useRef<PNode | null>(null), drag = useRef<{ mode: 'pan' | 'marquee'; sx: number; sy: number; cx: number; cy: number } | null>(null), justDragged = useRef(false)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const local = (e: React.PointerEvent) => { const r = wrap.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const selectedIds = useMemo(() => new Set(selected?.type === 'nodes' ? selected.ids : []), [selected])
  // force-graph는 그리는 도중에 배율 이벤트를 보낸다(dev Graph.tsx와 같은 주의). 그 자리에서 상태를 바꾸면 무한 갱신이 되므로 한 박자 늦춘다
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const el = wrap.current; if (!el) return
    const ro = new ResizeObserver(([e]) => {
      // Hidden investigation tabs have zero size; keep the mounted canvas and its camera.
      if (e.contentRect.width > 0 && e.contentRect.height > 0) setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) })
    })
    ro.observe(el); return () => ro.disconnect()
  }, [])

  const data = useMemo(() => {
    const pos = templateLayout(g.tx, [...g.numbers.keys()])
    const nodes: PNode[] = [...g.numbers].map(([account, n]) => { const p = pos.get(account)!; return { id: account, n, tx: p.x, ty: p.y, x: p.x, y: p.y } })
    const usds = g.tx.map(t => Number.isFinite(t.amountUsd) ? t.amountUsd : 0), lo = Math.max(1, Math.min(...usds)), hi = Math.max(lo, Math.max(...usds))
    const w = (v: number) => !Number.isFinite(v) ? 1.5 : 1.5 + 6.5 * (hi === lo ? 0.5 : (Math.log(Math.max(1, v)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)))
    const byDir = new Map<string, typeof g.tx>()
    for (const t of g.tx) if (t.fromAccount !== t.toAccount) byDir.set(`${t.fromAccount}>${t.toAccount}`, [...(byDir.get(`${t.fromAccount}>${t.toAccount}`) ?? []), t])
    const links: PLink[] = []
    for (const [pair, list] of byDir) {
      const [from, to] = pair.split('>'), bi = byDir.has(`${to}>${from}`), sum = list.reduce((a, t) => a + t.amountUsd, 0), scores = list.flatMap(t => t.launderingScore == null ? [] : [t.launderingScore]), maxScore = scores.length ? Math.max(...scores) : null
      const widths = list.map(t => w(t.amountUsd)), merged = list.length > MERGE_COUNT || widths.reduce((a, b) => a + b, 0) > MERGE_WIDTH
      if (merged) links.push({ id: pair, pair, source: from, target: to, count: list.length, sumUsd: sum, maxScore, width: Math.min(10, w(sum)), curvature: bi ? 0.22 : 0, merged: true })
      else list.forEach((t, k) => links.push({ id: `${pair}#${t.txId}`, pair, source: from, target: to, count: 1, sumUsd: t.amountUsd, maxScore: t.launderingScore, width: widths[k], curvature: (bi ? 0.22 : 0) + (k - (list.length - 1) / 2) * 0.2, merged: false }))
    }
    return { nodes, links }
  }, [g])

  const previousData = useRef<typeof data | null>(null)
  useLayoutEffect(() => {
    const previous = new Map(previousData.current?.nodes.map(node => [node.id, node]))
    for (const node of data.nodes) {
      const old = previous.get(node.id)
      if (old) { node.x = old.x; node.y = old.y; node.vx = old.vx; node.vy = old.vy; node.fx = old.fx; node.fy = old.fy; node.tx = old.tx; node.ty = old.ty }
    }
    previousData.current = data
  }, [data])

  // 템플릿 자리로 약하게 끌어당기는 힘: 끌어 놓은 노드는 이웃과 함께 출렁이다 천천히 원래 모양 쪽으로 돌아온다.
  // force 그래프는 lazy로 늦게 뜨므로 ref가 붙는 순간(그리고 데이터가 바뀔 때) 첫 프레임에서 설정한다
  const configured = useRef<unknown>(null)
  const configure = (f: import('react-force-graph-2d').ForceGraphMethods<PNode, PLink>) => {
    if (configured.current === data) return
    configured.current = data
    const pull = Object.assign((alpha: number) => { for (const n of data.nodes) { n.vx = (n.vx ?? 0) + (n.tx - (n.x ?? 0)) * 0.05 * alpha; n.vy = (n.vy ?? 0) + (n.ty - (n.y ?? 0)) * 0.05 * alpha } }, { initialize: () => {} })
    f.d3Force('pattern', pull as never)
    ;(f.d3Force('charge') as unknown as { strength: (v: number) => { distanceMax: (d: number) => void } } | undefined)?.strength(-320).distanceMax(230) // 가까운 계좌끼리만 밀어내서 덩어리끼리 멀어지지 않게
    ;(f.d3Force('link') as unknown as { distance: (v: number) => void } | undefined)?.distance(150)
    f.d3ReheatSimulation()
  }

  useImperativeHandle(controls, () => ({
    zoomTo: k => fg.current?.zoom(k, 120),
    fit: () => fg.current?.zoomToFit(300, 60),
    reset: () => { for (const n of data.nodes) { n.x = n.tx; n.y = n.ty; n.vx = 0; n.vy = 0; n.fx = undefined; n.fy = undefined } fg.current?.d3ReheatSimulation() },
  }), [data])

  const colors = useMemo(() => {
    const css = getComputedStyle(document.documentElement), c = (n: string) => css.getPropertyValue(n).trim()
    return { card: resolveColor('--card'), fg: resolveColor('--foreground'), border: resolveColor('--border'), muted: resolveColor('--muted-foreground'), bg: resolveColor('--background'), blue: resolveColor('--palette-blue-500'), risk: Array.from({ length: 10 }, (_, i) => resolveColor(`--risk-${i}`)), _: c('--card') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.documentElement.className])
  const riskColor = (score: number | null) => score == null ? colors.muted : colors.risk[Math.min(9, Math.max(0, Math.floor(score * 10)))]

  // 휠은 소유주 보기와 같게: 그냥 휠을 굴리면 포인터 자리를 기준으로 확대·축소(Windows 크롬은 Ctrl+휠이 브라우저 배율이라 쓰지 않는다)
  useEffect(() => {
    const el = wrap.current; if (!el) return
    const onWheel = (e: WheelEvent) => {
      const f = fg.current; if (!f) return
      e.preventDefault()
      const k = f.zoom(), r = el.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top
      const nk = Math.min(2.5, Math.max(0.2, k * Math.pow(2, -e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002)))), g0 = f.screen2GraphCoords(px, py)
      f.zoom(nk, 0); f.centerAt(g0.x - (px - r.width / 2) / nk, g0.y - (py - r.height / 2) / nk, 0)
    }
    el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel)
  }, [size.w])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const f = fg.current; if (!f) return
    const p = local(e)
    // 클릭 판정은 직접 한다: 포인터 아래 계좌를 찾아 두고, 거의 안 움직이고 떼면 선택·해제를 전환
    const gp = f.screen2GraphCoords(p.x, p.y), hit = data.nodes.find(n => Math.hypot((n.x ?? 0) - gp.x, (n.y ?? 0) - gp.y) <= R + 4)
    press.current = e.button === 0 ? { x: p.x, y: p.y, id: hit?.id ?? null } : null
    if (e.button === 0 && !hit) { drag.current = { mode: 'marquee', sx: p.x, sy: p.y, cx: 0, cy: 0 }; setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }) }
    else if (e.button === 1 || e.button === 2) { const c = f.centerAt(); drag.current = { mode: 'pan', sx: p.x, sy: p.y, cx: c.x, cy: c.y }; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault() }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current, f = fg.current; if (!d || !f) return
    const p = local(e)
    if (d.mode === 'marquee') {
      // A click must reach the canvas link handler; capture only once a box drag starts.
      if (Math.hypot(p.x - d.sx, p.y - d.sy) >= 5 && !e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.setPointerCapture(e.pointerId)
      setBox({ x0: d.sx, y0: d.sy, x1: p.x, y1: p.y })
    }
    else { const k = f.zoom(); f.centerAt(d.cx - (p.x - d.sx) / k, d.cy - (p.y - d.sy) / k) }
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current, f = fg.current; drag.current = null
    const pr = press.current; press.current = null
    if (pr && pr.id && e.button === 0) { const p = local(e); if (Math.hypot(p.x - pr.x, p.y - pr.y) < 5) onSelect(selected?.type === 'nodes' && selected.ids.length === 1 && selected.ids[0] === pr.id ? null : { type: 'nodes', ids: [pr.id] }); return }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d || !f || d.mode !== 'marquee' || !box) { setBox(null); return }
    const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1), y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1)
    setBox(null)
    if (x1 - x0 < 5 && y1 - y0 < 5) { if (e.button === 0) onSelect(null); return } // 빈 곳을 그냥 누르면 선택 해제
    justDragged.current = true; setTimeout(() => { justDragged.current = false }, 50)
    const ids = data.nodes.filter(n => { const s = f.graph2ScreenCoords(n.x ?? 0, n.y ?? 0); return s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1 }).map(n => n.id)
    onSelect(ids.length ? { type: 'nodes', ids } : null)
  }

  return <div ref={wrap} className="absolute inset-0" data-testid="pattern-graph" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onContextMenu={e => e.preventDefault()}>
    {box && <div className="pointer-events-none absolute z-10 border border-[var(--palette-blue-500)] bg-[var(--palette-blue-500)]/10" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />}
    {size.w > 0 && <PatternLoadBoundary><Suspense fallback={<PatternLoading />}><ForceGraph2D<PNode, PLink> ref={attachGraph as unknown as typeof fg} onRenderFramePre={() => { if (fg.current) configure(fg.current) }} width={size.w} height={size.h} graphData={data} backgroundColor="rgba(0,0,0,0)"
      warmupTicks={150} cooldownTicks={200} enableZoomInteraction={false} enablePanInteraction={false} enableNodeDrag onNodeHover={(n: PNode | null) => { hover.current = n }}
      nodeRelSize={R} nodeVal={1} nodeLabel="" linkLabel=""
      linkCurvature="curvature" linkWidth={(l: PLink) => selected?.type === 'link' && selected.id === l.pair ? l.width + 2 : l.width}
      linkColor={(l: PLink) => riskColor(l.maxScore)} linkDirectionalArrowLength={10} linkDirectionalArrowRelPos={0.88}
      linkDirectionalParticles={reduced ? 0 : 2} linkDirectionalParticleWidth={(l: PLink) => Math.max(2.5, l.width / 2.6)} linkDirectionalParticleSpeed={0.004} linkDirectionalParticleColor={() => colors.fg}
      linkCanvasObjectMode={() => 'after'}
      linkCanvasObject={(l: PLink, ctx: CanvasRenderingContext2D) => {
        const s = l.source as PNode, t = l.target as PNode; if (s.x == null || t.x == null) return
        const cp = l.__controlPoints, mx = cp ? 0.25 * s.x! + 0.5 * cp[0] + 0.25 * t.x! : (s.x! + t.x!) / 2, my = cp ? 0.25 * s.y! + 0.5 * cp[1] + 0.25 * t.y! : (s.y! + t.y!) / 2
        const text = l.merged ? `${l.count}건 · ${usdShort(l.sumUsd)}` : usdShort(l.sumUsd)
        ctx.font = '12px ui-sans-serif, sans-serif'; const w = ctx.measureText(text).width + 10
        ctx.fillStyle = colors.bg; ctx.globalAlpha = 0.92; ctx.beginPath(); ctx.roundRect(mx - w / 2, my - 9, w, 18, 4); ctx.fill(); ctx.globalAlpha = 1
        ctx.strokeStyle = colors.border; ctx.lineWidth = 1; ctx.stroke(); ctx.fillStyle = colors.fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, mx, my)
      }}
      nodeCanvasObject={(n: PNode, ctx: CanvasRenderingContext2D) => {
        const on = selectedIds.has(n.id), x = n.x ?? 0, y = n.y ?? 0
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fillStyle = colors.card; ctx.fill()
        ctx.lineWidth = on ? 4 : 2; ctx.strokeStyle = on ? colors.blue : colors.border; ctx.stroke()
        ctx.fillStyle = colors.fg; ctx.font = 'bold 20px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(n.n), x, y + 1)
        ctx.font = '12px ui-monospace, monospace'; ctx.fillStyle = colors.muted; ctx.textBaseline = 'top'; ctx.fillText(n.id, x, y + R + 4)
      }}
      nodePointerAreaPaint={(n: PNode, color: string, ctx: CanvasRenderingContext2D) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x ?? 0, n.y ?? 0, R + 4, 0, Math.PI * 2); ctx.fill() }}
      onLinkClick={(l: PLink) => { if (!justDragged.current) onSelect({ type: 'link', id: l.pair }) }}
      onZoom={({ k }: { k: number }) => { if (Math.abs(k - lastK.current) < 0.004) return; lastK.current = k; setTimeout(() => onZoom(k), 0) }}
      onEngineStop={() => { if (!fitted.current && fg.current) { fitted.current = true; fg.current.zoomToFit(0, 100); fg.current.zoom(Math.min(2.5, Math.max(0.85, fg.current.zoom())), 0) } }} /></Suspense></PatternLoadBoundary>}
  </div>
}
