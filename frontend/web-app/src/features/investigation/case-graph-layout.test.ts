import { describe, expect, it } from 'vitest'
import ELK from 'elkjs/lib/elk.bundled.js'
import { caseLayoutPositions, caseLayoutRequest } from '@/features/graph/case-graph-layout'
import type { GraphEdge, GraphNode } from './case-selectors'

const nodes: GraphNode[] = ['a', 'b', 'c', 'isolated'].map(id => ({ id, label: id, accountIds: [], abnormal: false }))
const edges: GraphEdge[] = [['a', 'b'], ['b', 'a'], ['b', 'b'], ['b', 'c']].map(([source, target]) => ({ id: `${source}>${target}`, source, target, amountUsd: 100, count: 1, risk: 'low', width: 1, transactionIds: [1] }))
describe('bounded ELK relationship layout', () => {
  it.each(['RIGHT', 'DOWN'] as const)('lays out reciprocal, self and disconnected relationships in %s', async direction => {
    const engine = new ELK()
      const request = caseLayoutRequest(nodes, edges, direction)
      const result = await engine.layout(request)
      const positions = caseLayoutPositions(result, nodes.map(node => node.id))
      expect(Object.keys(positions)).toHaveLength(4)
      expect(new Set(Object.values(positions).map(p => `${p.x},${p.y}`)).size).toBe(4)
      for (const a of result.children!) for (const b of result.children!) if (a !== b) {
        expect(a.x! + a.width! <= b.x! || b.x! + b.width! <= a.x! || a.y! + a.height! <= b.y! || b.y! + b.height! <= a.y!).toBe(true)
      }
  })
  it('rejects oversized node input before reading a row', () => {
    const oversized = new Proxy(new Array<GraphNode>(201), { get: (target, key) => { if (key === 'length') return target.length; throw new Error('Row accessed') } })
    expect(() => caseLayoutRequest(oversized, [], 'RIGHT')).toThrow('화면 배치 한도를 초과했습니다')
  })
  it('rejects incomplete or nonfinite worker coordinates', () => {
    expect(() => caseLayoutPositions({ id: 'x', children: [{ id: 'a', x: Infinity, y: 0 }] }, ['a'])).toThrow('유효한 노드 위치')
    expect(() => caseLayoutPositions({ id: 'x' }, ['a'])).toThrow('유효한 노드 위치')
  })
})
