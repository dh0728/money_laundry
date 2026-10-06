import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref, type PointerEvent } from 'react'
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import { widthFor, type GraphEdge, type GraphModel, type GraphNode } from './domain'
import { formatGraphMoney } from './v23-domain'

type Point = { x: number; y: number }
type Owner = Point & { key: string; name: string; accounts: GraphNode[]; width: number; height: number }
type OwnerLink = { start: Point; end: Point; points: Point[] }
type OwnerCamera = Point & { scale: number; fitScale: number }
export type OwnerGraphState = { positions: Record<string, Point>; camera: OwnerCamera | null }
// Figma reference: 2px frame inset + 32px fill-width header/rows, zero vertical gap.
const INSET = 2, HEADER = 32, ROW = 32, WIDTH = 220, GAP = 120, FLOW_X_GAP = 96, FLOW_Y_GAP = 28

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
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': String(FLOW_Y_GAP),
      'elk.spacing.edgeEdge': '12',
      'elk.spacing.edgeNode': '24',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(FLOW_X_GAP),
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

function avoidsOwners(points: Point[], owners: Owner[]) {
  return points.slice(1).every((b, index) => {
    const a = points[index]
    return owners.every(owner => a.y === b.y
      ? !(a.y > owner.y && a.y < owner.y + owner.height && Math.max(a.x, b.x) > owner.x && Math.min(a.x, b.x) < owner.x + owner.width)
      : !(a.x > owner.x && a.x < owner.x + owner.width && Math.max(a.y, b.y) > owner.y && Math.min(a.y, b.y) < owner.y + owner.height))
  })
}

function detourOwnerLink(path: OwnerLink, owners: Owner[], lane: number): OwnerLink {
  if (avoidsOwners(path.points, owners)) return path
  const { start, end } = path
  const sourceDirection = Math.sign(path.points[1].x - start.x) || 1
  const targetDirection = Math.sign(path.points.at(-2)!.x - end.x) || -1
  const clearance = 16 + (lane + 36) / 4
  const exitX = start.x + sourceDirection * clearance, entryX = end.x + targetDirection * clearance
  // ponytail: inspect rectangle-edge lanes, not a routing grid; overlapping blocks may have no unobstructed route.
  const lanes = [...new Set(owners.flatMap(owner => [owner.y - clearance, owner.y + owner.height + clearance]))]
    .sort((a, b) => Math.abs(a - start.y) + Math.abs(a - end.y) - Math.abs(b - start.y) - Math.abs(b - end.y) || a - b)
  for (const y of lanes) {
    const points = [start, { x: exitX, y: start.y }, { x: exitX, y }, { x: entryX, y }, { x: entryX, y: end.y }, end]
    if (avoidsOwners(points, owners)) return { start, end, points }
  }
  return path
}

function pathLength(path: OwnerLink) {
  return path.points.slice(1).reduce((total, point, index) => total + Math.abs(point.x - path.points[index].x) + Math.abs(point.y - path.points[index].y), 0)
}

function intersectedOwnerCount(path: OwnerLink, owners: Owner[]) {
  return owners.filter(owner => path.points.slice(1).some((b, index) => {
    const a = path.points[index]
    return a.y === b.y
      ? a.y > owner.y && a.y < owner.y + owner.height && Math.max(a.x, b.x) > owner.x && Math.min(a.x, b.x) < owner.x + owner.width
      : a.x > owner.x && a.x < owner.x + owner.width && Math.max(a.y, b.y) > owner.y && Math.min(a.y, b.y) < owner.y + owner.height
  })).length
}

function routeScore(path: OwnerLink, conflicts: number, owners: Owner[]) {
  const localPadding = 144
  const minX = Math.min(path.start.x, path.end.x) - localPadding, maxX = Math.max(path.start.x, path.end.x) + localPadding
  const minY = Math.min(path.start.y, path.end.y) - localPadding, maxY = Math.max(path.start.y, path.end.y) + localPadding
  const perimeterDistance = path.points.reduce((total, point) => total
    + Math.max(0, minX - point.x, point.x - maxX)
    + Math.max(0, minY - point.y, point.y - maxY), 0)
  const turns = Math.max(0, path.points.length - 2)
  const ownerIntersections = intersectedOwnerCount(path, owners)
  // Local routes win unless avoiding a real collision is worth the extra distance.
  // A perimeter wrap is a last resort because it hides the actual relationship.
  const ownerPenalty = ownerIntersections ? 1200 + (ownerIntersections - 1) * 120 : 0
  return pathLength(path) + conflicts * 5000 + ownerPenalty + turns * 16 + perimeterDistance * 12
}

function segmentsConflict(a: Point, b: Point, c: Point, d: Point) {
  const horizontalAB = a.y === b.y, horizontalCD = c.y === d.y
  if (horizontalAB === horizontalCD) {
    if (horizontalAB && a.y === c.y) return Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) < Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
    if (!horizontalAB && a.x === c.x) return Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) < Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
    return false
  }
  const horizontalStart = horizontalAB ? a : c, horizontalEnd = horizontalAB ? b : d
  const verticalStart = horizontalAB ? c : a, verticalEnd = horizontalAB ? d : b
  const x = verticalStart.x, y = horizontalStart.y
  const within = (value: number, start: number, end: number) => value >= Math.min(start, end) && value <= Math.max(start, end)
  if (!within(x, horizontalStart.x, horizontalEnd.x) || !within(y, verticalStart.y, verticalEnd.y)) return false
  const sharedEndpoint = [a, b].some(left => [c, d].some(right => left.x === right.x && left.y === right.y && left.x === x && left.y === y))
  return !sharedEndpoint
}

function pathConflicts(path: OwnerLink, routed: OwnerLink[]) {
  return routed.reduce((count, existing) => count + path.points.slice(1).reduce((pathCount, point, index) => pathCount + existing.points.slice(1).filter((other, otherIndex) => segmentsConflict(path.points[index], point, existing.points[otherIndex], other)).length, 0), 0)
}

function routeCandidates(owners: Owner[], edge: GraphEdge, route: RouteOffsets): OwnerLink[] {
  const baseLane = route.lane ?? 0
  const laneValues = [0, 16, -16, 32, -32, 48, -48, 72, -72, 96, -96, 120, -120, 144, -144].map(offset => baseLane + offset)
  const local = laneValues.flatMap(lane => {
    const path = ownerLinkPath(owners, edge, { ...route, lane })
    if (!path) return []
    const detour = detourOwnerLink(path, owners, lane)
    return JSON.stringify(path.points) === JSON.stringify(detour.points) ? [path] : [path, detour]
  })
  const base = local[0]
  if (!base) return []
  const minX = Math.min(...owners.map(owner => owner.x)), maxX = Math.max(...owners.map(owner => owner.x + owner.width))
  const minY = Math.min(...owners.map(owner => owner.y)), maxY = Math.max(...owners.map(owner => owner.y + owner.height))
  const source = owners.find(owner => owner.accounts.some(account => account.key === edge.s))!
  const target = owners.find(owner => owner.accounts.some(account => account.key === edge.t))!
  const anchor = (owner: Owner, key: string, side: 'left' | 'right', offset = 0) => {
    const point = accountRowAnchor(owner, key, side)
    return { ...point, y: point.y + offset }
  }
  const sourceDirection = Math.sign(base.points[1].x - base.start.x) || 1
  const targetDirection = Math.sign(base.points.at(-2)!.x - base.end.x) || -1
  const perimeter: OwnerLink[] = []
  for (const distance of [32, 48, 64, 88, 112]) {
    for (const x of [minX - distance, maxX + distance]) {
      const points = [base.start, { x, y: base.start.y }, { x, y: base.end.y }, base.end]
      if (avoidsOwners(points, owners)) perimeter.push({ start: base.start, end: base.end, points })
    }
    const exitX = base.start.x + sourceDirection * distance, entryX = base.end.x + targetDirection * distance
    for (const y of [minY - distance, maxY + distance]) {
      const points = [base.start, { x: exitX, y: base.start.y }, { x: exitX, y }, { x: entryX, y }, { x: entryX, y: base.end.y }, base.end]
      if (avoidsOwners(points, owners)) perimeter.push({ start: base.start, end: base.end, points })
      for (const sourceSide of ['left', 'right'] as const) for (const targetSide of ['left', 'right'] as const) {
        const start = anchor(source, edge.s, sourceSide, route.sourcePort), end = anchor(target, edge.t, targetSide, route.targetPort)
        const sourceX = sourceSide === 'left' ? minX - distance : maxX + distance
        const targetX = targetSide === 'left' ? minX - distance : maxX + distance
        const wrap = [start, { x: sourceX, y: start.y }, { x: sourceX, y }, { x: targetX, y }, { x: targetX, y: end.y }, end]
        if (avoidsOwners(wrap, owners)) perimeter.push({ start, end, points: wrap })
      }
    }
  }
  const unique = new Map([...local, ...perimeter].map(path => [JSON.stringify(path.points), path]))
  return [...unique.values()]
}

type RouteOffsets = { sourcePort?: number; targetPort?: number; lane?: number }
export function ownerLinkPath(owners: Owner[], edge: Pick<GraphEdge, 's' | 't'>, route: RouteOffsets = {}): OwnerLink | null {
  const source = owners.find(o => o.accounts.some(n => n.key === edge.s)), target = owners.find(o => o.accounts.some(n => n.key === edge.t))
  if (!source || !target) return null
  const forward = edge.s.localeCompare(edge.t) <= 0
  const pair = [edge.s, edge.t].sort().join('>')
  const channel = Math.abs([...pair].reduce((value, character) => (value * 31 + character.charCodeAt(0)) | 0, 0)) % 5
  const offset = route.lane ?? (channel - 2) * 8 + (forward ? -12 : 12)
  const anchor = (owner: Owner, key: string, side: 'left' | 'right', yOffset = 0) => {
    const point = accountRowAnchor(owner, key, side)
    return { ...point, y: point.y + yOffset }
  }
  if (source === target || source.x === target.x) {
    const side = forward ? 'right' : 'left', sign = forward ? 1 : -1
    const start = anchor(source, edge.s, side, route.sourcePort), end = anchor(target, edge.t, side, route.targetPort)
    const channelX = start.x + sign * (64 + offset)
    const points = edge.s === edge.t
      ? [start, { x: channelX, y: start.y }, { x: channelX, y: Math.min(start.y, end.y) - 42 - Math.abs(offset) }, { x: end.x, y: Math.min(start.y, end.y) - 42 - Math.abs(offset) }, end]
      : [start, { x: channelX, y: start.y }, { x: channelX, y: end.y }, end]
    return { start, end, points }
  }
  const right = target.x > source.x
  const start = anchor(source, edge.s, right ? 'right' : 'left', route.sourcePort), end = anchor(target, edge.t, right ? 'left' : 'right', route.targetPort)
  const channelX = (start.x + end.x) / 2 + offset
  if (start.y === end.y) {
    const direction = right ? 1 : -1, laneY = start.y + (forward ? -28 : 28) + offset
    const exitX = start.x + direction * 28, entryX = end.x - direction * 28
    return { start, end, points: [start, { x: exitX, y: start.y }, { x: exitX, y: laneY }, { x: entryX, y: laneY }, { x: entryX, y: end.y }, end] }
  }
  return { start, end, points: [start, { x: channelX, y: start.y }, { x: channelX, y: end.y }, end] }
}

export function routeOrthogonalLinks(owners: Owner[], edges: GraphEdge[]) {
  const ownerByAccount = new Map(owners.flatMap(owner => owner.accounts.map(account => [account.key, owner] as const)))
  const prepared = edges.map(edge => {
    const source = ownerByAccount.get(edge.s), target = ownerByAccount.get(edge.t)
    if (!source || !target) return null
    const forward = edge.s.localeCompare(edge.t) <= 0
    const sourceSide: 'left' | 'right' = source === target || source.x === target.x ? (forward ? 'right' : 'left') : target.x > source.x ? 'right' : 'left'
    const targetSide: 'left' | 'right' = source === target || source.x === target.x ? sourceSide : sourceSide === 'right' ? 'left' : 'right'
    const corridor = source === target ? `loop:${source.key}:${sourceSide}` : source.x === target.x ? `vertical:${source.x}:${sourceSide}` : `horizontal:${Math.min(source.x, target.x)}:${Math.max(source.x, target.x)}`
    return { edge, source, target, sourceSide, targetSide, corridor }
  }).filter((item): item is NonNullable<typeof item> => Boolean(item))
  const portUses = new Map<string, string[]>(), laneUses = new Map<string, string[]>()
  const token = (key: string, endpoint: 's' | 't') => `${key}:${endpoint}`
  for (const item of prepared) {
    const sourceToken = token(item.edge.key, 's'), targetToken = token(item.edge.key, 't')
    const sourceKey = item.edge.s, targetKey = item.edge.t
    portUses.set(sourceKey, [...(portUses.get(sourceKey) ?? []), sourceToken]); portUses.set(targetKey, [...(portUses.get(targetKey) ?? []), targetToken])
    laneUses.set(item.corridor, [...(laneUses.get(item.corridor) ?? []), sourceToken])
  }
  const offsets = (uses: Map<string, string[]>, maxSpan: number, maxStep = 8) => {
    const result = new Map<string, number>()
    for (const tokens of uses.values()) {
      tokens.sort(); const step = tokens.length > 1 ? Math.min(maxStep, maxSpan / (tokens.length - 1)) : 0
      tokens.forEach((item, index) => result.set(item, (index - (tokens.length - 1) / 2) * step))
    }
    return result
  }
  // Ports may be shared, but the visible routing lanes need enough separation to
  // remain individually traceable at normal dashboard zoom.
  const portOffsets = offsets(portUses, ROW * .6), laneOffsets = offsets(laneUses, 108, 12)
  const routed = new Map<string, { edge: GraphEdge; path: OwnerLink }>(), occupied: OwnerLink[] = []
  for (const item of [...prepared].sort((left, right) => left.edge.key.localeCompare(right.edge.key))) {
    const sourceToken = token(item.edge.key, 's'), targetToken = token(item.edge.key, 't')
    const candidates = routeCandidates(owners, item.edge, { sourcePort: portOffsets.get(sourceToken), targetPort: portOffsets.get(targetToken), lane: laneOffsets.get(sourceToken) })
    const path = candidates.map(candidate => {
      const conflicts = pathConflicts(candidate, occupied)
      return { candidate, conflicts, score: routeScore(candidate, conflicts, owners), key: JSON.stringify(candidate.points) }
    })
      .sort((left, right) => left.score - right.score || left.conflicts - right.conflicts || left.key.localeCompare(right.key))[0]?.candidate
    if (path) { routed.set(item.edge.key, { edge: item.edge, path }); occupied.push(path) }
  }
  return prepared.flatMap(item => routed.get(item.edge.key) ?? [])
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
  const paths = useMemo(() => routeOrthogonalLinks(owners, edges), [owners, edges])
  const initialCamera = useMemo(() => fitOwnerCamera(owners, paths.flatMap(({ path }) => path.points), width, height), [owners, paths, width, height])
  const camera = state.camera ?? initialCamera
  const scale = camera.scale, offset = camera
  const fit = () => { onStateChange({ ...state, camera: fitOwnerCamera(owners, paths.flatMap(({ path }) => path.points), width, height) }); onZoom(1, true) }
  const zoomBy = (factor: number) => {
    const ratio = Math.max(.25, Math.min(24, camera.scale / camera.fitScale * factor)), nextScale = camera.fitScale * ratio
    const multiplier = nextScale / camera.scale
    onStateChange({ ...state, camera: { ...camera, x: width / 2 + (camera.x - width / 2) * multiplier, y: height / 2 + (camera.y - height / 2) * multiplier, scale: nextScale } }); onZoom(ratio, false)
  }
  useImperativeHandle(ref, () => ({ fit, zoomBy }))
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const onWheel = (event: WheelEvent) => { event.preventDefault(); zoomBy(event.deltaY < 0 ? 1.2 : 1 / 1.2) }
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
        for (let index = 1; index < path.points.length - 1; index++) {
          const previous = path.points[index - 1], point = path.points[index], next = path.points[index + 1]
          const beforeDistance = Math.min(10, Math.hypot(point.x - previous.x, point.y - previous.y) / 2)
          const afterDistance = Math.min(10, Math.hypot(next.x - point.x, next.y - point.y) / 2)
          const before = { x: point.x + Math.sign(previous.x - point.x) * beforeDistance, y: point.y + Math.sign(previous.y - point.y) * beforeDistance }
          const after = { x: point.x + Math.sign(next.x - point.x) * afterDistance, y: point.y + Math.sign(next.y - point.y) * afterDistance }
          ctx.lineTo(before.x, before.y); ctx.quadraticCurveTo(point.x, point.y, after.x, after.y)
        }
        ctx.lineTo(path.end.x, path.end.y)
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
          const suspicious = suspiciousAccounts.has(account.key)
          ctx.globalAlpha = lit && !lit.has(account.key) ? .2 : 1
          if (selected) { ctx.fillStyle = colors.selected; ctx.fillRect(owner.x, y, owner.width, height) }
          const match = search && `${account.account} ${account.entity}`.toLowerCase().includes(search.toLowerCase())
          if (hover?.key === account.key || match) { ctx.strokeStyle = colors.fg; ctx.strokeRect(owner.x + 1, y + 1, owner.width - 2, height - 2) }
          ctx.fillStyle = selected ? colors.selectedFg : suspicious ? colors.danger : colors.fg
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
  }, [width, height, owners, sections, paths, edges, visibleNodes, selectedNode, selectedEdge, hover, lit, search, showInfo, reducedMotion, scale, offset.x, offset.y, themeVersion])

  const drag = useRef<{ start: Point; camera: OwnerCamera; state: OwnerGraphState; owners: Owner[]; ownerKey?: string; moved: boolean } | null>(null)
  const pointerPoint = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const hit = (event: PointerEvent<HTMLCanvasElement>): Hover => {
    const rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top
    const point = { x: (x - offset.x) / scale, y: (y - offset.y) / scale }, account = accountAtPoint(owners, point)
    if (account && visibleNodes.has(account.key)) return { kind: 'node', key: account.key, x, y }
    // ponytail: scan the short orthogonal segments; add a spatial index only if owner graphs become much larger.
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
