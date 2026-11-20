import type { ForceGraphMethods } from 'react-force-graph-2d'
import type { GraphEdge } from './model'

// Disconnected account components need distinct starting basins. d3-force can then
// refine each component without first tangling unrelated nodes at the origin.
export function seedComponentPositions<Node extends { key: string; x: number; y: number }>(model: {
  nodes: Node[]
  edges: Array<Pick<GraphEdge, 's' | 't'>>
}): Array<Node & { component: number }> {
  const adjacency = new Map(model.nodes.map(node => [node.key, new Set<string>()]))
  for (const edge of model.edges) {
    adjacency.get(edge.s)?.add(edge.t)
    adjacency.get(edge.t)?.add(edge.s)
  }
  const byKey = new Map(model.nodes.map(node => [node.key, node]))
  const seen = new Set<string>(), components: Node[][] = []
  for (const node of model.nodes) {
    if (seen.has(node.key)) continue
    const queue = [node.key]; seen.add(node.key)
    for (let index = 0; index < queue.length; index++) {
      for (const next of adjacency.get(queue[index]) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next) }
    }
    components.push(queue.flatMap(key => byKey.get(key) ?? []))
  }
  const columns = Math.max(1, Math.ceil(Math.sqrt(components.length)))
  return components.flatMap((component, index) => {
    const averageX = component.reduce((sum, node) => sum + node.x, 0) / Math.max(1, component.length)
    const averageY = component.reduce((sum, node) => sum + node.y, 0) / Math.max(1, component.length)
    const centerX = index % columns * 220, centerY = Math.floor(index / columns) * 180 // web-app: 묶음 시작 간격을 좁힘
    return component.map(node => ({ ...node, component: index, x: centerX + (node.x - averageX) * 52, y: centerY + (node.y - averageY) * 52 }))
  })
}

export function configureDevAccountForces<Node, Link>(g: Pick<ForceGraphMethods<Node, Link>, 'd3Force' | 'd3ReheatSimulation'>) {
  // web-app: 밀어내는 힘은 가까운 거리(90)에서만 작용시키고, 약한 중심 인력을 더해
  // 서로 떨어진 묶음이 겹치지 않을 만큼만 가깝게 모이게 한다(사용자가 끌어서 옮길 수 있다)
  const charge = g.d3Force('charge') as unknown as { strength: (v: number) => { distanceMax: (d: number) => void } } | undefined
  charge?.strength(-160).distanceMax(70)
  ;(g.d3Force('link') as unknown as { distance: (v: number) => void } | undefined)?.distance(56)
  // 떨어진 묶음끼리 가깝게: 노드마다 당기면 묶음 안쪽까지 찌그러지므로 묶음(연결 성분) 무게중심을 원점으로 당기고,
  // 묶음을 원(무게중심·가장 먼 노드 거리 + 여백)으로 보고 서로 겹치면 밀어낸다 → 가깝게 모이되 섞이지 않는다.
  let nodes: { x?: number; y?: number; vx?: number; vy?: number; component?: number }[] = []
  const GROUP_GAP = 36
  const gather = Object.assign((alpha: number) => {
    const groups = new Map<number, { x: number; y: number; r: number; members: typeof nodes; dx: number; dy: number }>()
    for (const node of nodes) { const k = node.component ?? 0; const t = groups.get(k) ?? { x: 0, y: 0, r: 0, members: [], dx: 0, dy: 0 }; t.x += node.x ?? 0; t.y += node.y ?? 0; t.members.push(node); groups.set(k, t) }
    const list = [...groups.values()]
    for (const t of list) { t.x /= t.members.length; t.y /= t.members.length; for (const m of t.members) t.r = Math.max(t.r, Math.hypot((m.x ?? 0) - t.x, (m.y ?? 0) - t.y)); t.dx = -t.x * 0.2 * alpha; t.dy = -t.y * 0.2 * alpha }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, overlap = a.r + b.r + GROUP_GAP - d
      if (overlap <= 0) continue
      const push = overlap * 0.5, ux = dx / d, uy = dy / d
      a.dx -= ux * push; a.dy -= uy * push; b.dx += ux * push; b.dy += uy * push
    }
    for (const t of list) for (const m of t.members) { m.vx = (m.vx ?? 0) + t.dx; m.vy = (m.vy ?? 0) + t.dy }
  }, { initialize: (next: typeof nodes) => { nodes = next } })
  g.d3Force('gravity', gather as never)
  g.d3ReheatSimulation()
}
