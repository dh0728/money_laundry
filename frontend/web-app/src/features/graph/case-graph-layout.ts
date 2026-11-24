import type { ElkNode } from 'elkjs/lib/elk-api'
import { readChartNumber } from '@/components/charts/chart-design-values'
import { caseGraphBudget, type GraphEdge, type GraphNode } from '@/features/investigation/case-selectors'

export type CaseDirection = 'RIGHT' | 'DOWN'
export type CasePositions = Record<string, { x: number; y: number }>
export function readCaseLayoutMetrics() {
  return {
    width: readChartNumber('--case-graph-layout-node-width', 192),
    height: readChartNumber('--case-graph-layout-node-height', 80),
    gap: readChartNumber('--aml-space-64', 64),
  }
}

export function caseLayoutRequest(nodes: GraphNode[], edges: GraphEdge[], direction: CaseDirection): ElkNode {
  if (nodes.length > caseGraphBudget.nodes || edges.length > caseGraphBudget.edges) throw new Error('화면 배치 한도를 초과했습니다.')
  const { width, height, gap } = readCaseLayoutMetrics()
  return {
    id: 'case-relationships',
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': direction, 'elk.spacing.nodeNode': String(gap), 'elk.layered.spacing.nodeNodeBetweenLayers': String(2 * gap), 'elk.separateConnectedComponents': 'true', 'elk.randomSeed': '1' },
    children: nodes.map(node => ({ id: node.id, width, height })),
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
export function seedCasePositions(nodes: GraphNode[], { width, height, gap } = readCaseLayoutMetrics()): CasePositions {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)))
  return Object.fromEntries(nodes.map((node, index) => [node.id, { x: (index % columns) * (width + gap), y: Math.floor(index / columns) * (height + gap) }]))
}
