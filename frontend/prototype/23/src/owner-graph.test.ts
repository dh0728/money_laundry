import { describe, expect, it } from 'vitest'
import type { GraphModel, GraphNode } from './domain'
import { accountAtPoint, accountRowAnchor, groupOwners, ownerLinkPath, pointOnOwnerLink, ownerLinkContains, flowParticleCount } from './OwnerGraph'
import { readFileSync } from 'node:fs'

const node = (key: string, entity: string): GraphNode => ({ key, entity, account: `ACC-${key}`, bank: '004', x: 0, y: 0, core: false, bridge: false, hub: false, hubDegree: 0, hop: 0, synthetic: false })
const model: GraphModel = { nodes: [node('A', 'Alpha'), node('B', 'Alpha'), node('C', 'Beta'), node('D', ''), node('E', '')], edges: [], blocks: [] }

describe('owner class geometry', () => {
  it('groups known owners while keeping unknown owners separate and preserving account order', () => {
    const owners = groupOwners(model)
    expect(owners.map(o => o.accounts.map(n => n.key))).toEqual([['A', 'B'], ['C'], ['D'], ['E']])
    expect(model.nodes.map(n => n.key)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })
  it('anchors and hit areas identify the exact account row, excluding header and outside', () => {
    const owner = { ...groupOwners(model)[0], x: 10, y: 20 }
    expect(accountRowAnchor(owner, 'A', 'right')).toEqual({ x: 230, y: 67 })
    expect(accountRowAnchor(owner, 'B', 'left')).toEqual({ x: 10, y: 93 })
    expect(accountAtPoint([owner], { x: 50, y: 67 })?.key).toBe('A')
    expect(accountAtPoint([owner], { x: 50, y: 93 })?.key).toBe('B')
    expect(accountAtPoint([owner], { x: 50, y: 30 })).toBeUndefined()
    expect(accountAtPoint([owner], { x: 231, y: 67 })).toBeUndefined()
  })
  it('routes same-owner, reciprocal and self transfers outside the class with correct particle endpoints', () => {
    const owners = groupOwners(model)
    const forward = ownerLinkPath(owners, { s: 'A', t: 'B' })!
    const reverse = ownerLinkPath(owners, { s: 'B', t: 'A' })!
    const self = ownerLinkPath(owners, { s: 'A', t: 'A' })!
    expect(forward.start.y).not.toBe(forward.end.y)
    expect(pointOnOwnerLink(forward, .5).x).toBeGreaterThan(owners[0].x + owners[0].width)
    expect(pointOnOwnerLink(reverse, .5).x).toBeLessThan(owners[0].x)
    expect(pointOnOwnerLink(self, .5).x).toBeGreaterThan(self.start.x)
    expect(self.start).toEqual(self.end)
    for (const path of [forward, reverse, self]) {
      expect(pointOnOwnerLink(path, 0)).toEqual(path.start)
      expect(pointOnOwnerLink(path, 1)).toEqual(path.end)
    }
    expect(ownerLinkPath(owners, { s: 'missing', t: 'B' })).toBeNull()
  })
  it('separates reciprocal inter-owner paths without changing source/target rows', () => {
    const owners = groupOwners(model)
    const forward = ownerLinkPath(owners, { s: 'A', t: 'C' })!
    const reverse = ownerLinkPath(owners, { s: 'C', t: 'A' })!
    expect(forward.start).toEqual(reverse.end)
    expect(forward.end).toEqual(reverse.start)
    expect(pointOnOwnerLink(forward, .5)).not.toEqual(pointOnOwnerLink(reverse, .5))
  })
  it('keeps thin link hit areas continuous between samples, including loops', () => {
    const straight = { start: { x: 0, y: 0 }, c1: { x: 1000, y: 0 }, c2: { x: 2000, y: 0 }, end: { x: 3000, y: 0 } }
    expect(ownerLinkContains(straight, { x: 23, y: 2 }, 3)).toBe(true)
    expect(ownerLinkContains(straight, { x: 23, y: 10 }, 3)).toBe(false)
    const self = ownerLinkPath(groupOwners(model), { s: 'A', t: 'A' })!
    expect(ownerLinkContains(self, pointOnOwnerLink(self, .37), 1)).toBe(true)
  })
})

it('disables all flow particles for reduced motion and otherwise distinguishes suspicious flows', () => {
  expect(flowParticleCount(1, true)).toBe(0)
  expect(flowParticleCount(0, true)).toBe(0)
  expect(flowParticleCount(1, false)).toBe(2)
  expect(flowParticleCount(0, false)).toBe(1)
})

it('uses a non-passive native wheel listener so graph zoom does not scroll the page', () => {
  const source = readFileSync(new URL('./OwnerGraph.tsx', import.meta.url), 'utf8')
  expect(source).toContain("addEventListener('wheel', onWheel, { passive: false })")
  expect(source).toContain("removeEventListener('wheel', onWheel)")
  expect(source).not.toContain('onWheel={')
})
