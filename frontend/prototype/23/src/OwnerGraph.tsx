import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref, type PointerEvent } from 'react'
import { compactUsd, widthFor, type GraphEdge, type GraphModel, type GraphNode } from './domain'

type Point = { x: number; y: number }
type Owner = Point & { key: string; name: string; accounts: GraphNode[]; width: number; height: number }
type OwnerLink = { start: Point; c1: Point; c2: Point; end: Point }
const HEADER = 34, ROW = 26, WIDTH = 220, GAP = 120

export function groupOwners(model: GraphModel): Owner[] {
  const groups = new Map<string, Owner>()
  for (const account of model.nodes) {
    const key = account.entity.trim() ? `owner:${account.entity}` : `account:${account.key}`
    if (!groups.has(key)) groups.set(key, { key, name: account.entity || '소유주 미상', accounts: [], x: 0, y: 0, width: WIDTH, height: HEADER })
    const owner = groups.get(key)!
    owner.accounts.push(account); owner.height += ROW
  }
  const owners = [...groups.values()], columns = Math.ceil(Math.sqrt(owners.length))
  let y = 0
  for (let i = 0; i < owners.length; i += columns) {
    const row = owners.slice(i, i + columns)
    row.forEach((owner, column) => { owner.x = column * (WIDTH + GAP); owner.y = y })
    y += Math.max(...row.map(owner => owner.height)) + GAP
  }
  return owners
}

export function accountRowAnchor(owner: Owner, key: string, side: 'left' | 'right'): Point {
  return { x: owner.x + (side === 'right' ? owner.width : 0), y: owner.y + HEADER + (owner.accounts.findIndex(n => n.key === key) + .5) * ROW }
}

export function accountAtPoint(owners: Owner[], point: Point): GraphNode | undefined {
  for (const owner of owners) {
    if (point.x < owner.x || point.x > owner.x + owner.width || point.y < owner.y + HEADER || point.y >= owner.y + owner.height) continue
    return owner.accounts[Math.floor((point.y - owner.y - HEADER) / ROW)]
  }
}

export function ownerLinkPath(owners: Owner[], edge: Pick<GraphEdge, 's' | 't'>): OwnerLink | null {
  const source = owners.find(o => o.accounts.some(n => n.key === edge.s)), target = owners.find(o => o.accounts.some(n => n.key === edge.t))
  if (!source || !target) return null
  const forward = edge.s.localeCompare(edge.t) <= 0
  if (source === target || source.x === target.x) {
    const side = forward ? 'right' : 'left', sign = forward ? 1 : -1
    const start = accountRowAnchor(source, edge.s, side), end = accountRowAnchor(target, edge.t, side)
    const self = edge.s === edge.t
    return { start, end, c1: { x: start.x + sign * 72, y: start.y - (self ? 42 : 0) }, c2: { x: end.x + sign * 72, y: end.y + (self ? 42 : 0) } }
  }
  const right = target.x > source.x
  const start = accountRowAnchor(source, edge.s, right ? 'right' : 'left'), end = accountRowAnchor(target, edge.t, right ? 'left' : 'right')
  const dx = (end.x - start.x) * .45, bend = forward ? -24 : 24
  return { start, end, c1: { x: start.x + dx, y: start.y + bend }, c2: { x: end.x - dx, y: end.y + bend } }
}

export function pointOnOwnerLink(path: OwnerLink, progress: number): Point {
  const t = Math.max(0, Math.min(1, progress)), u = 1 - t
  return { x: u ** 3 * path.start.x + 3 * u ** 2 * t * path.c1.x + 3 * u * t ** 2 * path.c2.x + t ** 3 * path.end.x,
    y: u ** 3 * path.start.y + 3 * u ** 2 * t * path.c1.y + 3 * u * t ** 2 * path.c2.y + t ** 3 * path.end.y }
}

export function ownerLinkContains(path: OwnerLink, point: Point, tolerance: number): boolean {
  let previous = path.start
  for (let i = 1; i <= 64; i++) {
    const next = pointOnOwnerLink(path, i / 64), dx = next.x - previous.x, dy = next.y - previous.y
    const projection = Math.max(0, Math.min(1, ((point.x - previous.x) * dx + (point.y - previous.y) * dy) / (dx * dx + dy * dy || 1)))
    if (Math.hypot(point.x - previous.x - projection * dx, point.y - previous.y - projection * dy) <= tolerance) return true
    previous = next
  }
  return false
}

export const flowParticleCount = (label: 0 | 1, reducedMotion: boolean) => reducedMotion ? 0 : label === 1 ? 2 : 1
export type OwnerGraphControls = { fit: () => void; zoomBy: (factor: number) => void }
type Hover = { kind: 'node' | 'edge'; key: string; x: number; y: number } | null
type Props = {
  ref?: Ref<OwnerGraphControls>; model: GraphModel; width: number; height: number
  visibleNodes: Set<string>; edges: GraphEdge[]; selectedNode: string | null; selectedEdge: string | null
  hover: Hover; lit: Set<string> | null; search: string; showInfo: boolean; reducedMotion: boolean
  onHover: (hover: Hover) => void; onSelectNode: (key: string) => void; onSelectEdge: (key: string) => void; onClear: () => void
  onZoom: (ratio: number, fitted: boolean) => void
}

export default function OwnerGraph({ ref, model, width, height, visibleNodes, edges, selectedNode, selectedEdge, hover, lit, search, showInfo, reducedMotion, onHover, onSelectNode, onSelectEdge, onClear, onZoom }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const owners = useMemo(() => groupOwners(model), [model])
  const paths = useMemo(() => edges.flatMap(edge => {
    const path = ownerLinkPath(owners, edge)
    return path ? [{ edge, path }] : []
  }), [owners, edges])
  const bounds = useMemo(() => ({ w: Math.max(1, ...owners.map(o => o.x + o.width)) + 160, h: Math.max(1, ...owners.map(o => o.y + o.height)) + 120 }), [owners])
  const fitScale = Math.min(width / bounds.w, height / bounds.h, 1.5)
  const [camera, setCamera] = useState({ x: 0, y: 0, ratio: 1 })
  const scale = fitScale * camera.ratio, offset = { x: (width - (bounds.w - 160) * scale) / 2 + camera.x, y: (height - (bounds.h - 120) * scale) / 2 + camera.y }
  const fit = () => { setCamera({ x: 0, y: 0, ratio: 1 }); onZoom(1, true) }
  const zoomBy = (factor: number) => {
    const ratio = Math.max(.25, Math.min(24, camera.ratio * factor))
    setCamera({ x: camera.x * ratio / camera.ratio, y: camera.y * ratio / camera.ratio, ratio }); onZoom(ratio, false)
  }
  useImperativeHandle(ref, () => ({ fit, zoomBy }))
  // Theme changes are independent of React renders; redraw canvas when the root theme changes.
  const [themeVersion, setThemeVersion] = useState(0)
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeVersion(v => v + 1))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext('2d')
    if (!el || !ctx || width <= 0 || height <= 0) return
    const dpr = window.devicePixelRatio || 1
    el.width = Math.round(width * dpr); el.height = Math.round(height * dpr)
    const style = getComputedStyle(document.documentElement), color = (name: string) => style.getPropertyValue(name).trim() || style.color
    const colors = { fg: color('--foreground'), card: color('--card'), muted: color('--muted-foreground'), border: color('--border'), selected: color('--selection-background'), selectedFg: color('--selection-foreground'), danger: color('--graph-l1'), dangerEdge: color('--graph-l1-edge'), edge: color('--graph-l0'), particle: color('--graph-l0-particle') }
    const values = edges.map(e => e.usd), min = Math.min(...values), max = Math.max(...values)
    let animation = 0
    const draw = (time: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height)
      ctx.translate(offset.x, offset.y); ctx.scale(scale, scale)
      for (const { edge, path } of paths) {
        ctx.globalAlpha = lit && (!lit.has(edge.s) || !lit.has(edge.t)) ? .15 : 1
        ctx.beginPath(); ctx.moveTo(path.start.x, path.start.y); ctx.bezierCurveTo(path.c1.x, path.c1.y, path.c2.x, path.c2.y, path.end.x, path.end.y)
        ctx.strokeStyle = edge.label === 1 ? colors.dangerEdge : colors.edge
        ctx.lineWidth = widthFor(edge.usd, min, max) * .55 * (selectedEdge === edge.key ? 1.5 : 1)
        ctx.setLineDash(edge.bridgePath ? [4, 3] : []); ctx.stroke(); ctx.setLineDash([])
        const count = flowParticleCount(edge.label, reducedMotion)
        for (let i = 0; i < count; i++) {
          const point = pointOnOwnerLink(path, (time / 2800 + i / count) % 1)
          ctx.beginPath(); ctx.arc(point.x, point.y, edge.label === 1 ? 3 : 2, 0, Math.PI * 2)
          ctx.fillStyle = edge.label === 1 ? colors.danger : colors.particle; ctx.fill()
        }
        if (showInfo || hover?.key === edge.key || selectedEdge === edge.key) {
          const point = pointOnOwnerLink(path, .5)
          ctx.fillStyle = colors.fg; ctx.font = '11px ui-sans-serif, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
          ctx.fillText(`${edge.count}건 · ${compactUsd(edge.usd)}`, point.x, point.y - 5)
        }
      }
      for (const owner of owners) {
        if (!owner.accounts.some(n => visibleNodes.has(n.key))) continue
        ctx.globalAlpha = 1; ctx.fillStyle = colors.card; ctx.fillRect(owner.x, owner.y, owner.width, owner.height)
        ctx.strokeStyle = colors.border; ctx.lineWidth = 1 / scale; ctx.strokeRect(owner.x, owner.y, owner.width, owner.height)
        ctx.save(); ctx.beginPath(); ctx.rect(owner.x + 1, owner.y + 1, owner.width - 2, owner.height - 2); ctx.clip()
        ctx.fillStyle = colors.fg; ctx.font = '600 12px ui-sans-serif, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
        ctx.fillText(owner.name, owner.x + 10, owner.y + HEADER / 2, owner.width - 20)
        ctx.beginPath(); ctx.moveTo(owner.x, owner.y + HEADER); ctx.lineTo(owner.x + owner.width, owner.y + HEADER); ctx.stroke()
        owner.accounts.forEach((account, i) => {
          const y = owner.y + HEADER + i * ROW, active = visibleNodes.has(account.key), selected = selectedNode === account.key
          ctx.globalAlpha = !active || (lit && !lit.has(account.key)) ? .2 : 1
          if (selected) { ctx.fillStyle = colors.selected; ctx.fillRect(owner.x, y, owner.width, ROW) }
          const match = search && `${account.account} ${account.entity}`.toLowerCase().includes(search.toLowerCase())
          if (active && (hover?.key === account.key || match)) { ctx.strokeStyle = colors.fg; ctx.strokeRect(owner.x + 1, y + 1, owner.width - 2, ROW - 2) }
          ctx.fillStyle = selected ? colors.selectedFg : account.core ? colors.danger : colors.muted
          ctx.font = '11px ui-monospace, monospace'; ctx.fillText(`${account.account} · ${account.bank}`, owner.x + 10, y + ROW / 2, owner.width - 20)
        })
        ctx.restore()
      }
      ctx.globalAlpha = 1
      if (!reducedMotion && paths.length) animation = requestAnimationFrame(draw)
    }
    draw(performance.now())
    return () => cancelAnimationFrame(animation)
  }, [width, height, owners, paths, edges, visibleNodes, selectedNode, selectedEdge, hover, lit, search, showInfo, reducedMotion, scale, offset.x, offset.y, themeVersion])

  const drag = useRef<{ start: Point; camera: Point; moved: boolean } | null>(null)
  const hit = (event: PointerEvent<HTMLCanvasElement>): Hover => {
    const rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top
    const point = { x: (x - offset.x) / scale, y: (y - offset.y) / scale }, account = accountAtPoint(owners, point)
    if (account && visibleNodes.has(account.key)) return { kind: 'node', key: account.key, x, y }
    // ponytail: sampled Bézier hit area; use a spatial index only if very large owner graphs need it.
    for (const { edge, path } of [...paths].reverse()) {
      if (ownerLinkContains(path, point, 7 / scale)) return { kind: 'edge', key: edge.key, x, y }
    }
    return null
  }
  return <canvas ref={canvas} style={{ width, height, touchAction: 'none' }} aria-label="소유주별 계좌 자금 흐름" data-testid="owner-graph"
    onWheel={event => { event.preventDefault(); zoomBy(event.deltaY < 0 ? 1.2 : 1 / 1.2) }}
    onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { start: { x: event.clientX, y: event.clientY }, camera, moved: false } }}
    onPointerMove={event => {
      if (drag.current) {
        const dx = event.clientX - drag.current.start.x, dy = event.clientY - drag.current.start.y
        if (Math.hypot(dx, dy) > 3) drag.current.moved = true
        if (drag.current.moved) { setCamera({ ...camera, x: drag.current.camera.x + dx, y: drag.current.camera.y + dy }); onZoom(camera.ratio, false); onHover(null) }
      } else { const target = hit(event); event.currentTarget.style.cursor = target ? 'pointer' : 'grab'; onHover(target) }
    }}
    onPointerUp={event => { if (drag.current && !drag.current.moved) { const target = hit(event); if (target?.kind === 'node') onSelectNode(target.key); else if (target) onSelectEdge(target.key); else onClear() } drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
    onPointerCancel={() => { drag.current = null }} onPointerLeave={() => onHover(null)} />
}
