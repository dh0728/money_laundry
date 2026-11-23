import type { ElkNode } from 'elkjs/lib/elk-api'
import { caseGraphBudget, type GraphEdge, type GraphNode } from './case-selectors'

export type CaseDirection = 'RIGHT' | 'DOWN'
export type CasePositions = Record<string, { x: number; y: number }>
// Matches the v3 node surface: space-64 * 3, space-64 + space-16.
export const caseNodeSize = { width: 192, height: 80 }
export function caseLayoutRequest(nodes: GraphNode[], edges: GraphEdge[], direction: CaseDirection): ElkNode {
  if (nodes.length > caseGraphBudget.nodes || edges.length > caseGraphBudget.edges) throw new Error('화면 배치 한도를 초과했습니다.')
  return {
    id: 'case-relationships',
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': direction, 'elk.spacing.nodeNode': '64', 'elk.layered.spacing.nodeNodeBetweenLayers': '128', 'elk.separateConnectedComponents': 'true', 'elk.randomSeed': '1' },
    children: nodes.map(node => ({ id: node.id, ...caseNodeSize })),
    edges: edges.map(edge => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  }
}
export function caseLayoutPositions(result: ElkNode, ids: string[]): CasePositions {
  const children = new Map(result.children?.map(node => [node.id, node]))
  return Object.fromEntries(ids.map(id => {
    const node = children.get(id)
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) throw new Error('배치 결과에 유효한 노드 위치가 없습니다.')
    return [id, { x: node.x!, y: node.y! }]
  }))
}
export function seedCasePositions(nodes: GraphNode[]): CasePositions {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)))
  return Object.fromEntries(nodes.map((node, index) => [node.id, { x: (index % columns) * (caseNodeSize.width + 64), y: Math.floor(index / columns) * (caseNodeSize.height + 64) }]))
}
