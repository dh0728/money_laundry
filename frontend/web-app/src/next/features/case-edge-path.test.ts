import { describe, expect, it } from 'vitest'
import { Position } from '@xyflow/react'
import { caseEdgePath } from './case-edge-path'

describe('directed return and self connections', () => {
  it('routes a right-to-left return above the node bodies and retains both endpoints', () => {
    const [path, x, y] = caseEdgePath({ sourceX: 520, sourceY: 40, targetX: 10, targetY: 40, sourcePosition: Position.Right, targetPosition: Position.Left, loop: false })
    expect(path.startsWith('M 520 40 C')).toBe(true)
    expect(path.endsWith('10 40')).toBe(true)
    expect(x).toBeGreaterThan(10)
    expect(y).toBeLessThan(0)
  })
  it('routes vertical return and self connections to the right of the nodes', () => {
    for (const loop of [false, true]) {
      const [path, x] = caseEdgePath({ sourceX: 96, sourceY: 300, targetX: 96, targetY: 0, sourcePosition: Position.Bottom, targetPosition: Position.Top, loop })
      expect(path.startsWith('M 96 300 C')).toBe(true)
      expect(path.endsWith('96 0')).toBe(true)
      expect(x).toBeGreaterThan(192)
    }
  })
})
