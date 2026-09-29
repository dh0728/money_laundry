import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref, type PointerEvent } from 'react'
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import { widthFor, type GraphEdge, type GraphModel, type GraphNode } from './model'
import { formatGraphMoney } from './model'

type Point = { x: number; y: number }
type Owner = Point & { key: string; name: string; accounts: GraphNode[]; width: number; height: number }
/** points는 곡선을 잘게 나눈 점들이다(맞춤·충돌 판정·흐르는 점 위치에 쓴다). c1·c2는 베지어 조절점 */
type OwnerLink = { start: Point; end: Point; points: Point[]; c1?: Point; c2?: Point }
type OwnerCamera = Point & { scale: number; fitScale: number }
export type OwnerGraphState = { positions: Record<string, Point>; camera: OwnerCamera | null }
// Figma reference: 2px frame inset + 32px fill-width header/rows, zero vertical gap.
const INSET = 2, HEADER = 32, ROW = 32, WIDTH = 220, GAP = 120, FLOW_X_GAP = 96, FLOW_Y_GAP = 28, CURVE_X_GAP = 160

export function groupOwners(model: GraphModel, visibleNodes?: ReadonlySet<string>): Owner[] {
  const groups = new Map<string, Owner>()
  for (const account of model.nodes) {
    if (visibleNodes && !visibleNodes.has(account.key)) continue
    const key = account.entity.trim() ? `owner:${account.entity}` : `account:${account.key}`
    if (!groups.has(key)) groups.set(key, { key, name: account.entity || '소유주 미상', accounts: [], x: 0, y: 0, width: WIDTH, height: INSET * 2 + HEADER })
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

export function layoutOwnerClasses(model: GraphModel, visibleNodes?: ReadonlySet<string>): Owner[] {
  const owners = groupOwners(model, visibleNodes)
  const inset = () => { for (const owner of owners) { owner.x += 120; owner.y += 88 } return owners }
  if (owners.length < 2 || !model.edges.length) return inset()
  const ownerByAccount = new Map(owners.flatMap(owner => owner.accounts.map(account => [account.key, owner] as const)))
  const stats = new Map(owners.map(owner => [owner.key, { incoming: 0, outgoing: 0, neighbors: new Set<string>() }]))
  for (const edge of model.edges) {
    const source = ownerByAccount.get(edge.s), target = ownerByAccount.get(edge.t)
    if (!source || !target || source === target) continue
    stats.get(source.key)!.outgoing++; stats.get(target.key)!.incoming++
    stats.get(source.key)!.neighbors.add(target.key); stats.get(target.key)!.neighbors.add(source.key)
  }
  const scores = [...new Set(owners.map(owner => stats.get(owner.key)!.outgoing - stats.get(owner.key)!.incoming))].sort((a, b) => b - a)
  let columns = Math.min(5, scores.length)
  const ownerColumn = new Map<string, number>()
  if (scores.length > 1) {
    const scoreColumn = new Map(scores.map((score, index) => [score, Math.round(index * (columns - 1) / (scores.length - 1))]))
    for (const owner of owners) {
      const stat = stats.get(owner.key)!
      ownerColumn.set(owner.key, scoreColumn.get(stat.outgoing - stat.incoming)!)
    }
  } else {
    if (!owners.some(owner => stats.get(owner.key)!.neighbors.size)) return inset()
    const seen = new Set<string>(), roots = [...owners].sort((a, b) => stats.get(b.key)!.neighbors.size - stats.get(a.key)!.neighbors.size || a.key.localeCompare(b.key))
    let maxColumn = 0
    for (const root of roots) {
      if (seen.has(root.key)) continue
      const queue = [{ key: root.key, column: 0 }]; seen.add(root.key)
      for (let index = 0; index < queue.length; index++) {
        const current = queue[index]; ownerColumn.set(current.key, current.column); maxColumn = Math.max(maxColumn, current.column)
        for (const key of [...stats.get(current.key)!.neighbors].sort()) if (!seen.has(key)) { seen.add(key); queue.push({ key, column: Math.min(4, current.column + 1) }) }
      }
    }
    columns = maxColumn + 1
  }
  const byColumn = new Map<number, Owner[]>()
  for (const owner of owners) {
    const column = ownerColumn.get(owner.key) ?? 0
    byColumn.set(column, [...(byColumn.get(column) ?? []), owner])
  }
  const positioned = new Map<string, Owner>(), columnGap = WIDTH + FLOW_X_GAP
  const maxRows = Math.max(6, Math.ceil(Math.sqrt(owners.length) * 1.5))
  const physicalColumns: Owner[][] = []
  let physicalColumn = 0
  for (let column = 0; column < columns; column++) {
    const items = byColumn.get(column) ?? []
    items.sort((a, b) => {
      const barycenter = (owner: Owner) => {
        const placed = [...stats.get(owner.key)!.neighbors].map(key => positioned.get(key)).filter((item): item is Owner => Boolean(item))
        return placed.length ? placed.reduce((sum, item) => sum + item.y + item.height / 2, 0) / placed.length : Infinity
      }
      const delta = barycenter(a) - barycenter(b)
      return Number.isFinite(delta) && delta !== 0 ? delta : stats.get(b.key)!.neighbors.size - stats.get(a.key)!.neighbors.size || a.key.localeCompare(b.key)
    })
    for (let start = 0; start < items.length; start += maxRows) {
      const chunk = items.slice(start, start + maxRows)
      let y = 0
      for (const owner of chunk) {
        owner.x = physicalColumn * columnGap; owner.y = y; y += owner.height + FLOW_Y_GAP; positioned.set(owner.key, owner)
      }
      physicalColumns.push(chunk)
      physicalColumn++
    }
  }
  const columnHeight = (items: Owner[]) => items.length ? items.at(-1)!.y + items.at(-1)!.height : 0
  const maxHeight = Math.max(0, ...physicalColumns.map(columnHeight))
  for (const items of physicalColumns) {
    const offset = (maxHeight - columnHeight(items)) / 2
    for (const owner of items) owner.y += offset
  }
  return inset()
}

export function ownerCompartments(owner: Owner) {
  return {
    header: { x: owner.x + INSET, y: owner.y + INSET, width: owner.width - INSET * 2, height: HEADER },
    rows: owner.accounts.map((account, index) => ({ account, x: owner.x + INSET, y: owner.y + INSET + HEADER + index * ROW, width: owner.width - INSET * 2, height: ROW })),
  }
}

export function accountRowAnchor(owner: Owner, key: string, side: 'left' | 'right'): Point {
  return { x: owner.x + (side === 'right' ? owner.width : 0), y: owner.y + INSET + HEADER + (owner.accounts.findIndex(n => n.key === key) + .5) * ROW }
}

export const ownerHasSuspiciousAccount = (owner: Owner, suspiciousAccounts: ReadonlySet<string>) => owner.accounts.some(account => suspiciousAccounts.has(account.key))

export type OwnerClusterSection = Point & { key: string; ownerKeys: string[]; width: number; height: number }

function ownerComponents(owners: Owner[], edges: GraphEdge[]) {
  const ownerByAccount = new Map(owners.flatMap(owner => owner.accounts.map(account => [account.key, owner.key] as const)))
  const adjacency = new Map(owners.map(owner => [owner.key, new Set<string>()]))
  for (const edge of edges) {
    const source = ownerByAccount.get(edge.s), target = ownerByAccount.get(edge.t)
    if (!source || !target || source === target) continue
    adjacency.get(source)?.add(target); adjacency.get(target)?.add(source)
  }
  const seen = new Set<string>(), components: string[][] = []
  for (const owner of owners) {
    if (seen.has(owner.key)) continue
    const queue = [owner.key]; seen.add(owner.key)
    for (let index = 0; index < queue.length; index++) {
      for (const next of adjacency.get(queue[index]) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next) }
    }
    components.push(queue.sort())
  }
  return components
}

export function ownerClusterSections(owners: Owner[], edges: GraphEdge[], padding = 28): OwnerClusterSection[] {
  const byKey = new Map(owners.map(owner => [owner.key, owner]))
  return ownerComponents(owners, edges).map(ownerKeys => {
    const items = ownerKeys.flatMap(key => byKey.get(key) ?? [])
    const minX = Math.min(...items.map(owner => owner.x)), minY = Math.min(...items.map(owner => owner.y))
    const maxX = Math.max(...items.map(owner => owner.x + owner.width)), maxY = Math.max(...items.map(owner => owner.y + owner.height))
    return { key: ownerKeys.join('|'), ownerKeys, x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 }
  })
}

export function resolveOwnerClusterOverlaps(owners: Owner[], edges: GraphEdge[], anchoredOwnerKey?: string, gap = 20) {
  const mutable = owners.map(owner => ({ ...owner }))
  const positions = new Map(mutable.map(owner => [owner.key, owner]))
  const shift = (keys: string[], dx: number, dy: number) => {
    for (const key of keys) { const owner = positions.get(key); if (owner) { owner.x += dx; owner.y += dy } }
  }
  for (let pass = 0; pass < 12; pass++) {
    const sections = ownerClusterSections(mutable, edges)
    let changed = false
    for (let left = 0; left < sections.length; left++) for (let right = left + 1; right < sections.length; right++) {
      const a = sections[left], b = sections[right]
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      if (overlapX <= 0 || overlapY <= 0) continue
      const aAnchored = !!anchoredOwnerKey && a.ownerKeys.includes(anchoredOwnerKey)
      const bAnchored = !!anchoredOwnerKey && b.ownerKeys.includes(anchoredOwnerKey)
      const horizontal = overlapX <= overlapY
      const direction = horizontal
        ? (a.x + a.width / 2 <= b.x + b.width / 2 ? 1 : -1)
        : (a.y + a.height / 2 <= b.y + b.height / 2 ? 1 : -1)
      const distance = (horizontal ? overlapX : overlapY) + gap
      const moveA = bAnchored ? -distance : aAnchored ? 0 : -distance / 2
      const moveB = aAnchored ? distance : bAnchored ? 0 : distance / 2
      shift(a.ownerKeys, horizontal ? direction * moveA : 0, horizontal ? 0 : direction * moveA)
      shift(b.ownerKeys, horizontal ? direction * moveB : 0, horizontal ? 0 : direction * moveB)
      changed = true
    }
    if (!changed) break
  }
  return Object.fromEntries(mutable.map(owner => [owner.key, { x: owner.x, y: owner.y }]))
}

export function separateOwnerClusters(owners: Owner[], edges: GraphEdge[], anchoredOwnerKey?: string) {
  const positions = resolveOwnerClusterOverlaps(owners, edges, anchoredOwnerKey)
  return owners.map(owner => ({ ...owner, ...positions[owner.key] }))
}

const elk = new ELK()
const ownerPortId = (owner: Owner, account: string, side: 'left' | 'right') => `${owner.key}::${account}::${side}`

export function buildElkOwnerGraph(owners: Owner[], edges: GraphEdge[]): ElkNode {
  const ownerByAccount = new Map(owners.flatMap(owner => owner.accounts.map(account => [account.key, owner] as const)))
  return {
    id: 'owner-graph',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'SPLINES',
      'elk.spacing.nodeNode': String(FLOW_Y_GAP),
      'elk.spacing.edgeEdge': '12',
      'elk.spacing.edgeNode': '24',
      // 곡선이 휘어질 가로 공간을 넉넉히 둔다
      'elk.layered.spacing.nodeNodeBetweenLayers': String(CURVE_X_GAP),
      'elk.layered.unnecessaryBendpoints': 'false',
      'elk.layered.mergeEdges': 'false',
      'elk.layered.nodePlacement.favorStraightEdges': 'true',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.separateConnectedComponents': 'true',
    },
    children: owners.map(owner => ({
      id: owner.key,
      width: owner.width,
      height: owner.height,
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports: owner.accounts.flatMap((account, index) => {
        const y = INSET + HEADER + (index + .5) * ROW
        return ([['left', 0, 'WEST'], ['right', owner.width, 'EAST']] as const).map(([side, x, elkSide]) => ({
          id: ownerPortId(owner, account.key, side), width: 0, height: 0, x, y,
          layoutOptions: { 'elk.port.side': elkSide },
        }))
      }),
    })),
    edges: edges.flatMap(edge => {
      const source = ownerByAccount.get(edge.s), target = ownerByAccount.get(edge.t)
      if (!source || !target) return []
      return [{ id: edge.key, sources: [ownerPortId(source, edge.s, 'right')], targets: [ownerPortId(target, edge.t, 'left')] }]
    }),
  }
}

export async function layoutOwnerGraphWithElk(model: GraphModel, visibleNodes: ReadonlySet<string>, edges: GraphEdge[]) {
  const sourceOwners = groupOwners(model, visibleNodes)
  const graph = await elk.layout(buildElkOwnerGraph(sourceOwners, edges))
  const byId = new Map(sourceOwners.map(owner => [owner.key, owner]))
  const owners = (graph.children ?? []).flatMap(child => {
    const owner = byId.get(child.id)
    return owner ? [{ ...owner, x: child.x ?? 0, y: child.y ?? 0 }] : []
  })
  const edgeById = new Map(edges.map(edge => [edge.key, edge]))
  const links = (graph.edges ?? []).flatMap(result => {
    const edge = edgeById.get(result.id), section = result.sections?.[0]
    if (!edge || !section) return []
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(point => ({ x: point.x, y: point.y }))
    return [{ edge, path: { start: points[0], end: points.at(-1)!, points } }]
  })
  return { engine: 'elk-layered' as const, owners, links }
}

export function accountAtPoint(owners: Owner[], point: Point): GraphNode | undefined {
  for (const owner of owners) {
    if (point.x < owner.x || point.x > owner.x + owner.width || point.y < owner.y + INSET + HEADER || point.y >= owner.y + owner.height - INSET) continue
    return owner.accounts[Math.floor((point.y - owner.y - INSET - HEADER) / ROW)]
  }
}

export function positionOwners(base: Owner[], positions: OwnerGraphState['positions'], visibleNodes: ReadonlySet<string>): Owner[] {
  return base.flatMap(owner => {
    const accounts = owner.accounts.filter(account => visibleNodes.has(account.key))
    return accounts.length ? [{ ...owner, ...positions[owner.key], accounts, height: INSET * 2 + HEADER + accounts.length * ROW }] : []
  })
}

export function fitOwnerCamera(owners: Owner[], wirePoints: Point[], width: number, height: number): OwnerCamera {
  const points = [...wirePoints, ...owners.flatMap(owner => [owner, { x: owner.x + owner.width, y: owner.y + owner.height }])]
  const minX = points.length ? Math.min(...points.map(p => p.x)) : 0, minY = points.length ? Math.min(...points.map(p => p.y)) : 0
  const maxX = points.length ? Math.max(...points.map(p => p.x)) : 1, maxY = points.length ? Math.max(...points.map(p => p.y)) : 1
  const scale = Math.max(.001, Math.min(Math.max(1, width - 48) / Math.max(1, maxX - minX), Math.max(1, height - 48) / Math.max(1, maxY - minY), 1.5))
  return { x: width / 2 - (minX + maxX) / 2 * scale, y: height / 2 - (minY + maxY) / 2 * scale, scale, fitScale: scale }
}

const ownerAtPoint = (owners: Owner[], point: Point) => [...owners].reverse().find(owner => point.x >= owner.x && point.x <= owner.x + owner.width && point.y >= owner.y && point.y <= owner.y + owner.height)
const graphPoint = (point: Point, camera: OwnerCamera): Point => ({ x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale })

export function dragOwnerGraph(state: OwnerGraphState, owners: Owner[], camera: OwnerCamera, start: Point, current: Point): OwnerGraphState {
  const dx = current.x - start.x, dy = current.y - start.y
  if (Math.hypot(dx, dy) <= 3) return state
  const owner = ownerAtPoint(owners, graphPoint(start, camera))
  return owner
    ? { camera, positions: { ...state.positions, [owner.key]: { x: owner.x + dx / camera.scale, y: owner.y + dy / camera.scale } } }
    : { positions: state.positions, camera: { ...camera, x: camera.x + dx, y: camera.y + dy } }
}

// web-app: 소유주별 보기 선은 ComfyUI 워크플로처럼 곡선으로 잇는다(김명기 결정, 2026-09-28).
// 나가는 선은 계좌 행 오른쪽 포트, 들어오는 선은 왼쪽 포트에서 수평으로 나가고 들어온다.
// v24의 직각 경로 탐색은 선끼리 겹쳐 무엇이 무엇과 이어졌는지 읽기 어려웠다.
// 교차 최소화는 상자 배치(ELK layered)가 맡고, 선은 두 포트 사이 3차 베지어로 그린다.
const CURVE_SAMPLES = 32
const cubicPoint = (a: Point, b: Point, c: Point, d: Point, t: number): Point => {
  const u = 1 - t
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  }
}

export function bezierOwnerLink(start: Point, end: Point, options: { self?: boolean; below?: number } = {}): OwnerLink {
  const dx = end.x - start.x
  let c1: Point, c2: Point
  if (options.below !== undefined) {
    // 되돌아가는 선(받는 쪽이 왼쪽): 두 상자 아래로 U자로 돌아 들어가 가운데 선들을 가로지르지 않는다.
    // 3차 베지어는 조절점 깊이의 3/4까지 내려가므로 4/3을 곱한다.
    const depth = (options.below - Math.max(start.y, end.y)) * 4 / 3
    c1 = { x: start.x + 120, y: start.y + depth }; c2 = { x: end.x - 120, y: end.y + depth }
  } else if (options.self) {
    c1 = { x: start.x + 96, y: start.y - ROW - 28 }; c2 = { x: end.x - 96, y: end.y - ROW - 28 }
  } else {
    // 앞으로 가는 선은 가로 거리의 절반만큼 수평으로 나갔다 들어온다(ComfyUI와 같은 모양)
    const bend = Math.max(48, Math.abs(dx) * .5)
    c1 = { x: start.x + bend, y: start.y }; c2 = { x: end.x - bend, y: end.y }
  }
  const points = Array.from({ length: CURVE_SAMPLES + 1 }, (_, index) => cubicPoint(start, c1, c2, end, index / CURVE_SAMPLES))
  return { start, end, points, c1, c2 }
}

export function routeCurvedLinks(owners: Owner[], edges: GraphEdge[]) {
  const ownerByAccount = new Map(owners.flatMap(owner => owner.accounts.map(account => [account.key, owner] as const)))
  return edges.flatMap(edge => {
    const source = ownerByAccount.get(edge.s), target = ownerByAccount.get(edge.t)
    if (!source || !target) return []
    const start = accountRowAnchor(source, edge.s, 'right'), end = accountRowAnchor(target, edge.t, 'left')
    const self = edge.s === edge.t
    const backward = !self && end.x < start.x + 24
    const below = backward ? Math.max(source.y + source.height, target.y + target.height) + 36 : undefined
    return [{ edge, path: bezierOwnerLink(start, end, { self, below }) }]
  })
}

export function pointOnOwnerLink(path: OwnerLink, progress: number): Point {
  const lengths = path.points.slice(1).map((point, index) => Math.hypot(point.x - path.points[index].x, point.y - path.points[index].y))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  let remaining = Math.max(0, Math.min(1, progress)) * total
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index]
    if (remaining <= length) {
      const start = path.points[index], end = path.points[index + 1], ratio = length ? remaining / length : 0
      return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio }
    }
    remaining -= length
  }
  return path.end
}

export function ownerLinkContains(path: OwnerLink, point: Point, tolerance: number): boolean {
  for (let i = 1; i < path.points.length; i++) {
    const previous = path.points[i - 1], next = path.points[i], dx = next.x - previous.x, dy = next.y - previous.y
    const projection = Math.max(0, Math.min(1, ((point.x - previous.x) * dx + (point.y - previous.y) * dy) / (dx * dx + dy * dy || 1)))
    if (Math.hypot(point.x - previous.x - projection * dx, point.y - previous.y - projection * dy) <= tolerance) return true
  }
  return false
}

export const flowParticleCount = (label: 0 | 1, reducedMotion: boolean) => reducedMotion ? 0 : label === 1 ? 3 : 1
export const flowParticleRadius = (label: 0 | 1) => label === 1 ? 3.2 : 1.8
export const flowParticleColor = (label: 0 | 1, suspicious: string, normal: string) => label === 1 ? suspicious : normal
export const effectiveFlowLabel = (edge: Pick<GraphEdge, 's' | 't' | 'label'>, suspiciousNodes: ReadonlySet<string>): 0 | 1 =>
  edge.label === 1 || (edge.s === edge.t && suspiciousNodes.has(edge.s)) ? 1 : 0
export type OwnerGraphControls = { fit: () => void; zoomBy: (factor: number) => void }
type Hover = { kind: 'node' | 'edge'; key: string; x: number; y: number } | null
type Props = {
  ref?: Ref<OwnerGraphControls>; model: GraphModel; width: number; height: number
  state: OwnerGraphState; onStateChange: (state: OwnerGraphState) => void
  visibleNodes: Set<string>; edges: GraphEdge[]; selectedNode: string | null; selectedEdge: string | null
  hover: Hover; lit: Set<string> | null; search: string; showInfo: boolean; reducedMotion: boolean
  onHover: (hover: Hover) => void; onSelectNode: (key: string) => void; onSelectEdge: (key: string) => void; onClear: () => void
  onZoom: (ratio: number, fitted: boolean) => void
}

export default function OwnerGraph({ ref, model, width, height, state, onStateChange, visibleNodes, edges, selectedNode, selectedEdge, hover, lit, search, showInfo, reducedMotion, onHover, onSelectNode, onSelectEdge, onClear, onZoom }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const fallbackOwners = useMemo(() => layoutOwnerClasses(model), [model])
  const layoutKey = useMemo(() => `${[...visibleNodes].sort().join('|')}::${edges.map(edge => edge.key).sort().join('|')}`, [visibleNodes, edges])
  const [elkLayout, setElkLayout] = useState<{ key: string; result: Awaited<ReturnType<typeof layoutOwnerGraphWithElk>> } | null>(null)
  useEffect(() => {
    let current = true
    layoutOwnerGraphWithElk(model, visibleNodes, edges)
      .then(result => { if (current) setElkLayout({ key: layoutKey, result }) })
      .catch(() => { if (current) setElkLayout(null) })
    return () => { current = false }
  }, [model, layoutKey])
  const activeElkLayout = elkLayout?.key === layoutKey ? elkLayout.result : null
  const baseOwners = activeElkLayout?.owners ?? fallbackOwners
  const positionedOwners = useMemo(() => positionOwners(baseOwners, state.positions, visibleNodes), [baseOwners, state.positions, visibleNodes])
  const owners = useMemo(() => separateOwnerClusters(positionedOwners, edges), [positionedOwners, edges])
  const sections = useMemo(() => ownerClusterSections(owners, edges), [owners, edges])
  const paths = useMemo(() => routeCurvedLinks(owners, edges), [owners, edges])
  // 선이 실제로 붙은 쪽에만 포트 점을 그린다. 양쪽에 다 있으면 양쪽이 이어진 것처럼 보인다.
  const ports = useMemo(() => ({ out: new Set(paths.map(({ edge }) => edge.s)), in: new Set(paths.map(({ edge }) => edge.t)) }), [paths])
  const initialCamera = useMemo(() => fitOwnerCamera(owners, paths.flatMap(({ path }) => path.points), width, height), [owners, paths, width, height])
  const camera = state.camera ?? initialCamera
  const scale = camera.scale, offset = camera
  // camera=null이면 크기·배치가 바뀔 때마다 맞춤 카메라를 다시 계산한다(맞춤 상태 유지)
  const fit = () => { onStateChange({ ...state, camera: null }); onZoom(1, true) }
  const zoomBy = (factor: number) => {
    const ratio = Math.max(.25, Math.min(24, camera.scale / camera.fitScale * factor)), nextScale = camera.fitScale * ratio
    const multiplier = nextScale / camera.scale
    onStateChange({ ...state, camera: { ...camera, x: width / 2 + (camera.x - width / 2) * multiplier, y: height / 2 + (camera.y - height / 2) * multiplier, scale: nextScale } }); onZoom(ratio, false)
  }
  useImperativeHandle(ref, () => ({ fit, zoomBy }))
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    // 계좌별 보기(d3-zoom 기본값)와 같은 휠 감도: 스크롤 양에 비례해 조금씩 바뀐다
    const onWheel = (event: WheelEvent) => { event.preventDefault(); zoomBy(Math.pow(2, -event.deltaY * (event.deltaMode === 1 ? .05 : event.deltaMode ? 1 : .002))) }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [camera, state, width, height])
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
    const colors = { fg: color('--foreground'), bg: color('--background'), card: color('--card'), header: color('--muted'), muted: color('--muted-foreground'), border: color('--border'), selected: color('--selection-background'), selectedFg: color('--selection-foreground'), danger: color('--graph-l1'), dangerEdge: color('--graph-l1-edge'), edge: color('--graph-l0'), particle: color('--graph-l0-particle') }
    const values = edges.map(e => e.usd), min = Math.min(...values), max = Math.max(...values)
    const suspiciousAccounts = new Set([
      ...model.nodes.filter(node => node.core).map(node => node.key),
      ...edges.filter(edge => edge.label === 1).flatMap(edge => [edge.s, edge.t]),
    ])
    let animation = 0
    const draw = (time: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height)
      ctx.translate(offset.x, offset.y); ctx.scale(scale, scale)
      for (let index = 0; sections.length > 1 && index < sections.length; index++) {
        const section = sections[index]
        ctx.globalAlpha = .14; ctx.beginPath(); ctx.roundRect(section.x, section.y, section.width, section.height, 18 / scale)
        ctx.fillStyle = colors.muted; ctx.fill(); ctx.globalAlpha = .58; ctx.strokeStyle = colors.border; ctx.lineWidth = 1 / scale; ctx.stroke()
        ctx.globalAlpha = .7; ctx.fillStyle = colors.muted; ctx.font = `${10 / scale}px ui-sans-serif, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'
        ctx.fillText(`연결 그룹 ${index + 1}`, section.x + 10 / scale, section.y - 6 / scale)
      }
      const orderedPaths = [...paths].sort((left, right) => left.edge.label - right.edge.label || left.edge.key.localeCompare(right.edge.key))
      for (const { edge, path } of orderedPaths) {
        const flowLabel = effectiveFlowLabel(edge, suspiciousAccounts)
        const emphasized = selectedEdge === edge.key || hover?.key === edge.key
        ctx.globalAlpha = lit && (!lit.has(edge.s) || !lit.has(edge.t)) ? .12 : emphasized ? 1 : flowLabel === 1 ? .88 : .52
        ctx.beginPath(); ctx.moveTo(path.start.x, path.start.y)
        if (path.c1 && path.c2) ctx.bezierCurveTo(path.c1.x, path.c1.y, path.c2.x, path.c2.y, path.end.x, path.end.y)
        else for (const point of path.points.slice(1)) ctx.lineTo(point.x, point.y)
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        const lineWidth = widthFor(edge.usd, min, max) * .55 * (selectedEdge === edge.key ? 1.5 : 1)
        ctx.setLineDash(edge.bridgePath ? [4, 3] : [])
        ctx.strokeStyle = colors.bg; ctx.lineWidth = lineWidth + 3.2 / scale; ctx.stroke()
        ctx.strokeStyle = flowLabel === 1 ? colors.dangerEdge : colors.edge; ctx.lineWidth = lineWidth; ctx.stroke(); ctx.setLineDash([])
        const count = flowParticleCount(flowLabel, reducedMotion)
        for (let i = 0; i < count; i++) {
          const point = pointOnOwnerLink(path, (time / 2800 + i / count) % 1)
          ctx.beginPath(); ctx.arc(point.x, point.y, flowParticleRadius(flowLabel) / scale, 0, Math.PI * 2)
          ctx.fillStyle = flowParticleColor(flowLabel, colors.danger, colors.particle); ctx.fill()
        }
        if (showInfo || hover?.key === edge.key || selectedEdge === edge.key) {
          const point = pointOnOwnerLink(path, .5)
          ctx.fillStyle = colors.fg; ctx.font = '11px ui-sans-serif, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
          ctx.fillText(`${edge.count}건 · ${formatGraphMoney(edge)}`, point.x, point.y - 5)
        }
      }
      for (const owner of owners) {
        const ownerSuspicious = ownerHasSuspiciousAccount(owner, suspiciousAccounts)
        ctx.globalAlpha = 1
        ctx.beginPath(); ctx.roundRect(owner.x, owner.y, owner.width, owner.height, 10)
        ctx.fillStyle = colors.card; ctx.fill()
        ctx.save(); ctx.beginPath(); ctx.roundRect(owner.x + 1, owner.y + 1, owner.width - 2, owner.height - 2, 9); ctx.clip()
        const compartments = ownerCompartments(owner)
        ctx.fillStyle = colors.header; ctx.fillRect(compartments.header.x, compartments.header.y, compartments.header.width, compartments.header.height)
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = colors.fg; ctx.font = '600 12px ui-sans-serif, sans-serif'
        ctx.fillText(owner.name, owner.x + 12, owner.y + INSET + HEADER / 2, owner.width - 24)
        ctx.strokeStyle = colors.border
        ctx.beginPath(); ctx.moveTo(owner.x + INSET, owner.y + INSET + HEADER); ctx.lineTo(owner.x + owner.width - INSET, owner.y + INSET + HEADER); ctx.stroke()
        compartments.rows.forEach(({ account, y, height }) => {
          const selected = selectedNode === account.key
          // web-app: 호버한 계좌 행은 테두리 대신 테마 반대색으로 칠한다(v23 선택·호버 반전 규칙)
          const hovered = !selected && hover?.kind === 'node' && hover.key === account.key
          const suspicious = suspiciousAccounts.has(account.key)
          ctx.globalAlpha = lit && !lit.has(account.key) ? .2 : 1
          if (selected || hovered) { ctx.fillStyle = selected ? colors.selected : colors.fg; ctx.fillRect(owner.x, y, owner.width, height) }
          const match = search && `${account.account} ${account.entity}`.toLowerCase().includes(search.toLowerCase())
          if (match && !selected && !hovered) { ctx.strokeStyle = colors.fg; ctx.lineWidth = 1 / scale; ctx.strokeRect(owner.x + 1, y + 1, owner.width - 2, height - 2) }
          ctx.fillStyle = selected ? colors.selectedFg : hovered ? colors.bg : suspicious ? colors.danger : colors.fg
          ctx.font = '11px ui-monospace, monospace'; ctx.fillText(account.account, owner.x + 12, y + height / 2, owner.width - 70)
          ctx.textAlign = 'right'; ctx.font = '9px ui-monospace, monospace'; ctx.fillText(account.bank, owner.x + owner.width - 10, y + height / 2, 42); ctx.textAlign = 'left'
          ctx.globalAlpha = 1; ctx.strokeStyle = colors.border; ctx.beginPath(); ctx.moveTo(owner.x + INSET, y + height); ctx.lineTo(owner.x + owner.width - INSET, y + height); ctx.stroke()
        })
        ctx.restore()
        ctx.beginPath(); ctx.roundRect(owner.x, owner.y, owner.width, owner.height, 10)
        ctx.strokeStyle = ownerSuspicious ? colors.danger : colors.fg; ctx.lineWidth = 2.5 / scale; ctx.stroke()
        for (const account of owner.accounts) {
          const suspicious = suspiciousAccounts.has(account.key)
          for (const side of ['left', 'right'] as const) {
            if (!(side === 'right' ? ports.out : ports.in).has(account.key)) continue
            const point = accountRowAnchor(owner, account.key, side)
            ctx.beginPath(); ctx.arc(point.x, point.y, 5, 0, Math.PI * 2)
            ctx.fillStyle = suspicious ? colors.danger : colors.fg; ctx.fill()
            ctx.strokeStyle = colors.bg; ctx.lineWidth = 1.5 / scale; ctx.stroke()
          }
        }
      }
      ctx.globalAlpha = 1
      if (!reducedMotion && paths.length) animation = requestAnimationFrame(draw)
    }
    draw(performance.now())
    return () => cancelAnimationFrame(animation)
  }, [width, height, owners, sections, paths, ports, edges, visibleNodes, selectedNode, selectedEdge, hover, lit, search, showInfo, reducedMotion, scale, offset.x, offset.y, themeVersion])

  const drag = useRef<{ start: Point; camera: OwnerCamera; state: OwnerGraphState; owners: Owner[]; ownerKey?: string; moved: boolean } | null>(null)
  const pointerPoint = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const hit = (event: PointerEvent<HTMLCanvasElement>): Hover => {
    const rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top
    const point = { x: (x - offset.x) / scale, y: (y - offset.y) / scale }, account = accountAtPoint(owners, point)
    if (account && visibleNodes.has(account.key)) return { kind: 'node', key: account.key, x, y }
    // 곡선을 나눈 짧은 선분들을 훑는다. 소유주 그래프가 훨씬 커지면 공간 색인을 붙인다.
    for (const { edge, path } of [...paths].reverse()) {
      if (ownerLinkContains(path, point, 7 / scale)) return { kind: 'edge', key: edge.key, x, y }
    }
    return null
  }
  return <canvas ref={canvas} style={{ width, height, touchAction: 'none' }} aria-label="소유주 클래스별 계좌 자금 흐름" data-testid="owner-graph"
    onPointerDown={event => {
      if (event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      const start = pointerPoint(event), grabbed = ownerAtPoint(owners, graphPoint(start, camera))
      drag.current = { start, camera, state, owners, ownerKey: grabbed?.key, moved: false }
    }}
    onPointerMove={event => {
      if (drag.current) {
        const raw = dragOwnerGraph(drag.current.state, drag.current.owners, drag.current.camera, drag.current.start, pointerPoint(event))
        if (raw !== drag.current.state) drag.current.moved = true
        if (drag.current.moved) {
          const movedOwners = drag.current.owners.map(owner => ({ ...owner, ...raw.positions[owner.key] }))
          const positions = drag.current.ownerKey ? resolveOwnerClusterOverlaps(movedOwners, edges, drag.current.ownerKey) : raw.positions
          onStateChange({ ...raw, positions: { ...raw.positions, ...positions } }); onZoom(camera.scale / camera.fitScale, false); onHover(null); event.currentTarget.style.cursor = 'grabbing'
        }
      } else { const target = hit(event); event.currentTarget.style.cursor = ownerAtPoint(owners, graphPoint(pointerPoint(event), camera)) ? 'grab' : target ? 'pointer' : 'grab'; onHover(target) }
    }}
    onPointerUp={event => { if (drag.current && !drag.current.moved) { const target = hit(event); if (target?.kind === 'node') onSelectNode(target.key); else if (target) onSelectEdge(target.key); else onClear() } drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
    onPointerCancel={() => { drag.current = null }} onPointerLeave={() => onHover(null)} />
}
