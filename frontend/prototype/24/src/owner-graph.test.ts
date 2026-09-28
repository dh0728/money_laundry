import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphModel, GraphNode } from './domain'
import { accountAtPoint, accountRowAnchor, buildElkOwnerGraph, effectiveFlowLabel, flowParticleColor, flowParticleCount, flowParticleRadius, groupOwners, layoutOwnerClasses, layoutOwnerGraphWithElk, ownerClusterSections, ownerCompartments, ownerHasSuspiciousAccount, ownerLinkContains, ownerLinkPath, pointOnOwnerLink, resolveOwnerClusterOverlaps, routeOrthogonalLinks, separateOwnerClusters } from './OwnerGraph'
import { readFileSync } from 'node:fs'
import * as ownerGraph from './OwnerGraph'

const node = (key: string, entity: string): GraphNode => ({ key, entity, account: `ACC-${key}`, bank: '004', x: 0, y: 0, core: false, bridge: false, hub: false, hubDegree: 0, hop: 0, synthetic: false })
const edge = (key: string, s: string, t: string): GraphEdge => ({ key, s, t, label: 0, count: 1, usd: 1, currency: 'USD', format: 'ACH', first: '', last: '', bridgePath: false, synthetic: false, transactions: [] })
const model: GraphModel = { nodes: [node('A', 'Alpha'), node('B', 'Alpha'), node('C', 'Beta'), node('D', ''), node('E', '')], edges: [], blocks: [] }

describe('v23 Figma 소유주 노드 형식', () => {
  const source = readFileSync(new URL('./OwnerGraph.tsx', import.meta.url), 'utf8')
  it('각 계좌 행의 좌우에 직접 연결되는 포트를 그린다', () => {
    expect(source).toContain("for (const side of ['left', 'right'] as const)")
    expect(source).toContain('accountRowAnchor(owner, account.key, side)')
  })
  it('의심 계좌가 포함된 소유주는 붉은 외곽선, 일반 소유주는 밝은 외곽선으로 구분한다', () => {
    expect(source).toContain('suspiciousAccounts')
    expect(source).toContain('ownerSuspicious')
    expect(source).toContain('ctx.roundRect')
    const alpha = groupOwners(model).find(owner => owner.name === 'Alpha')!
    expect(ownerHasSuspiciousAccount(alpha, new Set(['B']))).toBe(true)
    expect(ownerHasSuspiciousAccount(alpha, new Set(['C']))).toBe(false)
  })
})

describe('ELK owner graph layout', () => {
  it('gives every account row fixed left and right ports for orthogonal routing', () => {
    const owners = groupOwners(model)
    const graph = buildElkOwnerGraph(owners, [edge('flow', 'A', 'C')])
    expect(graph.layoutOptions).toMatchObject({
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.mergeEdges': 'false',
    })
    const alpha = graph.children!.find(child => child.id === 'owner:Alpha')!
    expect(alpha.layoutOptions?.['elk.portConstraints']).toBe('FIXED_POS')
    expect(alpha.ports).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'owner:Alpha::A::left', x: 0, y: 50 }),
      expect.objectContaining({ id: 'owner:Alpha::A::right', x: 220, y: 50 }),
      expect.objectContaining({ id: 'owner:Alpha::B::left', x: 0, y: 82 }),
      expect.objectContaining({ id: 'owner:Alpha::B::right', x: 220, y: 82 }),
    ]))
    expect(graph.edges?.[0]).toMatchObject({
      id: 'flow',
      sources: ['owner:Alpha::A::right'],
      targets: ['owner:Beta::C::left'],
    })
  })

  it('allows several directed edges to share one circular account port and branch after it', async () => {
    const flow: GraphModel = { ...model, edges: [edge('a-to-c', 'A', 'C'), edge('a-to-d', 'A', 'D')] }
    const graph = buildElkOwnerGraph(groupOwners(flow), flow.edges)
    expect(graph.edges?.map(item => item.sources[0])).toEqual([
      'owner:Alpha::A::right',
      'owner:Alpha::A::right',
    ])
    const result = await layoutOwnerGraphWithElk(flow, new Set(flow.nodes.map(item => item.key)), flow.edges)
    expect(result.links[0].path.start).toEqual(result.links[1].path.start)
    expect(result.links[0].path.points).not.toEqual(result.links[1].path.points)
  })

  it('uses ELK bend points while preserving exact account-row endpoints', async () => {
    const flow: GraphModel = { ...model, edges: [edge('a-to-c', 'A', 'C'), edge('b-to-d', 'B', 'D')] }
    const result = await layoutOwnerGraphWithElk(flow, new Set(flow.nodes.map(item => item.key)), flow.edges)
    expect(result.engine).toBe('elk-layered')
    expect(result.links).toHaveLength(2)
    const ownerFor = (account: string) => result.owners.find(owner => owner.accounts.some(item => item.key === account))!
    for (const { edge: item, path } of result.links) {
      expect(path.start).toEqual(accountRowAnchor(ownerFor(item.s), item.s, 'right'))
      expect(path.end).toEqual(accountRowAnchor(ownerFor(item.t), item.t, 'left'))
      for (let index = 1; index < path.points.length; index++) {
        const previous = path.points[index - 1], current = path.points[index]
        expect(current.x === previous.x || current.y === previous.y).toBe(true)
      }
    }
  })
})

describe('owner class geometry', () => {
  it('wraps each disconnected owner component in a dynamic section', () => {
    const flow: GraphModel = { ...model, edges: [edge('connected', 'A', 'C')] }
    const owners = groupOwners(flow).map((owner, index) => ({ ...owner, x: index * 300, y: index % 2 * 80 }))
    const sections = ownerClusterSections(owners, flow.edges)
    const connected = sections.find(section => section.ownerKeys.includes('owner:Alpha'))!
    expect(connected.ownerKeys).toEqual(expect.arrayContaining(['owner:Alpha', 'owner:Beta']))
    expect(connected.x).toBeLessThan(owners[0].x)
    expect(connected.width).toBeGreaterThan(owners[1].x + owners[1].width - owners[0].x)
    expect(sections).toHaveLength(3)
  })
  it('pushes an overlapping disconnected section away as one cluster', () => {
    const flow: GraphModel = { ...model, edges: [edge('alpha-beta', 'A', 'C'), edge('d-e', 'D', 'E')] }
    const owners = groupOwners(flow).map(owner => {
      if (owner.key === 'owner:Alpha') return { ...owner, x: 0, y: 0 }
      if (owner.key === 'owner:Beta') return { ...owner, x: 260, y: 0 }
      if (owner.key === 'account:D') return { ...owner, x: 160, y: 30 }
      return { ...owner, x: 420, y: 30 }
    })
    const beforeD = owners.find(owner => owner.key === 'account:D')!, beforeE = owners.find(owner => owner.key === 'account:E')!
    const positions = resolveOwnerClusterOverlaps(owners, flow.edges, 'owner:Alpha')
    const after = owners.map(owner => ({ ...owner, ...positions[owner.key] }))
    const sections = ownerClusterSections(after, flow.edges)
    const first = sections.find(section => section.ownerKeys.includes('owner:Alpha'))!, second = sections.find(section => section.ownerKeys.includes('account:D'))!
    expect(first.x + first.width <= second.x || second.x + second.width <= first.x || first.y + first.height <= second.y || second.y + second.height <= first.y).toBe(true)
    expect(positions['account:D'].x - beforeD.x).toBe(positions['account:E'].x - beforeE.x)
    expect(positions['account:D'].y - beforeD.y).toBe(positions['account:E'].y - beforeE.y)
  })
  it('applies section separation to the initial rendered owner layout, before any drag', () => {
    const flow: GraphModel = { ...model, edges: [edge('alpha-beta', 'A', 'C'), edge('d-e', 'D', 'E')] }
    const owners = groupOwners(flow).map(owner => ({ ...owner, x: 0, y: 0 }))
    const separated = separateOwnerClusters(owners, flow.edges)
    const sections = ownerClusterSections(separated, flow.edges)
    for (let left = 0; left < sections.length; left++) for (let right = left + 1; right < sections.length; right++) {
      const a = sections[left], b = sections[right]
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
    }
    const source = readFileSync(new URL('./OwnerGraph.tsx', import.meta.url), 'utf8')
    expect(source).toContain('separateOwnerClusters(positionedOwners, edges)')
  })
  it('detours around intervening owner blocks without diagonal wires', () => {
    const owners = groupOwners({ ...model, nodes: [node('A', 'Alpha'), node('C', 'Beta'), node('D', 'Middle')] })
      .map((owner, index) => ({ ...owner, x: [0, 700, 350][index], y: 0 }))
    const links = routeOrthogonalLinks(owners, [edge('a', 'A', 'C'), edge('b', 'A', 'C')])
    for (const { path } of links) {
      for (let i = 1; i < path.points.length; i++) {
        const a = path.points[i - 1], b = path.points[i]
        expect(a.x === b.x || a.y === b.y).toBe(true)
        const crossesMiddle = a.y === b.y
          ? a.y > 0 && a.y < 60 && Math.max(a.x, b.x) > 350 && Math.min(a.x, b.x) < 570
          : a.x > 350 && a.x < 570 && Math.max(a.y, b.y) > 0 && Math.min(a.y, b.y) < 60
        expect(crossesMiddle).toBe(false)
      }
    }
    expect(links[0].path.points).not.toEqual(links[1].path.points)
    const crossingLane = (points: { x: number; y: number }[]) => points.find((point, index) => {
      const previous = points[index - 1]
      return previous && point.y === previous.y && Math.min(point.x, previous.x) < 350 && Math.max(point.x, previous.x) > 570
    })!.y
    expect(crossingLane(links[0].path.points)).not.toBe(crossingLane(links[1].path.points))
  })
  it('moves a grabbed owner in graph coordinates while background drags only pan the camera', () => {
    expect(ownerGraph.dragOwnerGraph).toBeTypeOf('function')
    const owners = [{ ...groupOwners(model)[0], x: 10, y: 20 }]
    const camera = { x: 100, y: 50, scale: 2, fitScale: 2 }
    const state = { positions: {}, camera }
    // Header at graph (30, 25), rendered at (160, 100).
    const moved = ownerGraph.dragOwnerGraph(state, owners, camera, { x: 160, y: 100 }, { x: 120, y: 160 })
    expect(moved.positions['owner:Alpha']).toEqual({ x: -10, y: 50 })
    expect(moved.camera).toEqual(camera)
    const panned = ownerGraph.dragOwnerGraph(state, owners, camera, { x: 0, y: 0 }, { x: 40, y: -20 })
    expect(panned.positions).toEqual({})
    expect(panned.camera).toEqual({ ...camera, x: 140, y: 30 })
    expect(ownerGraph.dragOwnerGraph(state, owners, camera, { x: 160, y: 100 }, { x: 161, y: 102 })).toBe(state)
  })
  it('restores manually positioned owners when hidden accounts become visible again', () => {
    expect(ownerGraph.positionOwners).toBeTypeOf('function')
    const base = layoutOwnerClasses(model), positions = { 'owner:Alpha': { x: -70, y: 400 } }
    const visible = ownerGraph.positionOwners(base, positions, new Set(['B', 'C']))
    expect(visible[0]).toMatchObject({ x: -70, y: 400, height: 68 })
    expect(visible[0].accounts.map(account => account.key)).toEqual(['B'])
    const restored = ownerGraph.positionOwners(base, positions, new Set(['A', 'B', 'C']))
    expect(restored[0]).toMatchObject({ x: -70, y: 400, height: 100 })
    expect(base[0].x).not.toBe(-70)
  })
  it('fits negative owner coordinates and routed wires within viewport padding', () => {
    expect(ownerGraph.fitOwnerCamera).toBeTypeOf('function')
    const owners = [{ ...groupOwners(model)[0], x: -400, y: -200 }]
    const camera = ownerGraph.fitOwnerCamera(owners, [{ x: -460, y: -260 }], 800, 500)
    expect(camera.scale).toBeGreaterThan(0)
    for (const point of [{ x: -460, y: -260 }, { x: -180, y: -114 }]) {
      expect(point.x * camera.scale + camera.x).toBeGreaterThanOrEqual(24)
      expect(point.y * camera.scale + camera.y).toBeGreaterThanOrEqual(24)
      expect(point.x * camera.scale + camera.x).toBeLessThanOrEqual(776)
      expect(point.y * camera.scale + camera.y).toBeLessThanOrEqual(476)
    }
  })
  it('groups known owners while keeping unknown owners separate and preserving account order', () => {
    const owners = groupOwners(model)
    expect(owners.map(o => o.accounts.map(n => n.key))).toEqual([['A', 'B'], ['C'], ['D'], ['E']])
    expect(model.nodes.map(n => n.key)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })
  it('builds an owner header plus individually bounded account-row compartments', () => {
    const owner = { ...groupOwners(model)[0], x: 10, y: 20 }
    const parts = ownerCompartments(owner)
    expect(parts.header).toEqual({ x: 12, y: 22, width: 216, height: 32 })
    expect(parts.rows.map(row => ({ key: row.account.key, y: row.y, height: row.height }))).toEqual([
      { key: 'A', y: 54, height: 32 },
      { key: 'B', y: 86, height: 32 },
    ])
  })
  it('removes hidden accounts and owners before laying out the visible class diagram', () => {
    const owners = groupOwners(model, new Set(['B', 'C']))
    expect(owners.map(owner => [owner.name, owner.accounts.map(account => account.key)])).toEqual([
      ['Alpha', ['B']],
      ['Beta', ['C']],
    ])
    expect(owners.every(owner => owner.y === 0)).toBe(true)
  })
  it('lays connected owners out deterministically by flow direction instead of input-order grid cells', () => {
    const flow: GraphModel = { ...model, edges: [edge('1', 'A', 'C'), edge('2', 'C', 'D'), edge('3', 'D', 'E')] }
    const first = layoutOwnerClasses(flow)
    const second = layoutOwnerClasses(flow)
    expect(second).toEqual(first)
    const ownerFor = (account: string) => first.find(owner => owner.accounts.some(item => item.key === account))!
    expect(ownerFor('A').x).toBeLessThan(ownerFor('C').x)
    expect(ownerFor('C').x).toBeLessThanOrEqual(ownerFor('D').x)
    expect(ownerFor('D').x).toBeLessThan(ownerFor('E').x)
    expect(new Set(first.map(owner => owner.x)).size).toBeGreaterThan(2)
  })
  it('uses connectivity layers for balanced cycles instead of falling back to the uniform grid', () => {
    const cycle: GraphModel = { ...model, nodes: model.nodes.slice(0, 4), edges: [edge('1', 'A', 'C'), edge('2', 'C', 'D'), edge('3', 'D', 'A')] }
    const grid = groupOwners(cycle).map(owner => ({ key: owner.key, x: owner.x, y: owner.y }))
    const layout = layoutOwnerClasses(cycle).map(owner => ({ key: owner.key, x: owner.x, y: owner.y }))
    expect(layout).not.toEqual(grid)
    expect(layoutOwnerClasses(cycle)).toEqual(layoutOwnerClasses(cycle))
  })
  it('splits overloaded flow layers so large fan-out diagrams stay readable', () => {
    const nodes = [node('ROOT', 'Root'), ...Array.from({ length: 41 }, (_, index) => node(`N${index}`, `Owner ${index}`))]
    const fanOut: GraphModel = { nodes, edges: nodes.slice(1).map((item, index) => edge(`e${index}`, 'ROOT', item.key)), blocks: [] }
    const owners = layoutOwnerClasses(fanOut)
    const countsByX = new Map<number, number>()
    for (const owner of owners) countsByX.set(owner.x, (countsByX.get(owner.x) ?? 0) + 1)

    expect(Math.max(...countsByX.values())).toBeLessThanOrEqual(10)
    expect(countsByX.size).toBeGreaterThanOrEqual(5)
    expect(owners.find(owner => owner.accounts[0].key === 'ROOT')!.x).toBeLessThan(Math.min(...owners.filter(owner => owner.accounts[0].key !== 'ROOT').map(owner => owner.x)))
  })
  it('anchors and hit areas identify the exact account row, excluding header and outside', () => {
    const owner = { ...groupOwners(model)[0], x: 10, y: 20 }
    expect(accountRowAnchor(owner, 'A', 'right')).toEqual({ x: 230, y: 70 })
    expect(accountRowAnchor(owner, 'B', 'left')).toEqual({ x: 10, y: 102 })
    expect(accountAtPoint([owner], { x: 50, y: 70 })?.key).toBe('A')
    expect(accountAtPoint([owner], { x: 50, y: 102 })?.key).toBe('B')
    expect(accountAtPoint([owner], { x: 50, y: 30 })).toBeUndefined()
    expect(accountAtPoint([owner], { x: 231, y: 70 })).toBeUndefined()
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
  it('routes every owner relation as deterministic right-angle segments', () => {
    const owners = groupOwners(model)
    const path = ownerLinkPath(owners, { s: 'A', t: 'C' })!
    expect(path.points[0]).toEqual(path.start)
    expect(path.points.at(-1)).toEqual(path.end)
    expect(path.points.length).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < path.points.length; i++) {
      const previous = path.points[i - 1], current = path.points[i]
      expect(current.x === previous.x || current.y === previous.y).toBe(true)
    }
    expect(ownerLinkPath(owners, { s: 'A', t: 'C' })!.points).toEqual(path.points)
    expect(ownerLinkPath(owners, { s: 'C', t: 'A' })!.points).not.toEqual(path.points)
  })
  it('moves particles and hit testing along the orthogonal polyline, including loops', () => {
    const elbow = { start: { x: 0, y: 0 }, end: { x: 100, y: 100 }, points: [{ x: 0, y: 0 }, { x: 75, y: 0 }, { x: 75, y: 100 }, { x: 100, y: 100 }] }
    expect(pointOnOwnerLink(elbow, .25)).toEqual({ x: 50, y: 0 })
    expect(pointOnOwnerLink(elbow, .5)).toEqual({ x: 75, y: 25 })
    expect(ownerLinkContains(elbow, { x: 75, y: 23 }, 1)).toBe(true)
    expect(ownerLinkContains(elbow, { x: 67, y: 23 }, 3)).toBe(false)
    const self = ownerLinkPath(groupOwners(model), { s: 'A', t: 'A' })!
    expect(ownerLinkContains(self, pointOnOwnerLink(self, .37), 1)).toBe(true)
  })
  it('allocates distinct account ports and lanes for overlapping links and self loops', () => {
    const owners = layoutOwnerClasses(model)
    const links = routeOrthogonalLinks(owners, [edge('a', 'A', 'C'), edge('b', 'A', 'C'), edge('c', 'A', 'A'), edge('d', 'A', 'A')])
    expect(new Set(links.map(link => `${link.path.start.x}:${link.path.start.y}`)).size).toBe(4)
    expect(new Set(links.map(link => JSON.stringify(link.path.points))).size).toBe(4)
    for (const { path } of links) {
      for (let index = 1; index < path.points.length; index++) {
        expect(path.points[index].x === path.points[index - 1].x || path.points[index].y === path.points[index - 1].y).toBe(true)
      }
    }
    const routeByKey = (items: ReturnType<typeof routeOrthogonalLinks>) => Object.fromEntries(items.map(item => [item.edge.key, item.path]))
    expect(routeByKey(routeOrthogonalLinks(owners, [edge('a', 'A', 'C'), edge('b', 'A', 'C')]))).toEqual(routeByKey(routeOrthogonalLinks(owners, [edge('b', 'A', 'C'), edge('a', 'A', 'C')])))
  })
  it('keeps shortest-path crossing routes deterministic without edge crossings', () => {
    const crossingModel: GraphModel = {
      nodes: [node('A', 'Alpha'), node('B', 'Beta'), node('C', 'Gamma'), node('D', 'Delta')],
      edges: [], blocks: [],
    }
    const positions = new Map([
      ['A', { x: 0, y: 0 }], ['B', { x: 0, y: 180 }],
      ['C', { x: 520, y: 0 }], ['D', { x: 520, y: 180 }],
    ])
    const owners = groupOwners(crossingModel).map(owner => ({ ...owner, ...positions.get(owner.accounts[0].key)! }))
    const routes = routeOrthogonalLinks(owners, [edge('b-to-c', 'B', 'C'), edge('a-to-d', 'A', 'D')])
    const interiorCollision = (left: (typeof routes)[number]['path'], right: (typeof routes)[number]['path']) => {
      const between = (value: number, a: number, b: number) => value > Math.min(a, b) && value < Math.max(a, b)
      for (let leftIndex = 1; leftIndex < left.points.length; leftIndex++) {
        const a = left.points[leftIndex - 1], b = left.points[leftIndex]
        for (let rightIndex = 1; rightIndex < right.points.length; rightIndex++) {
          const c = right.points[rightIndex - 1], d = right.points[rightIndex]
          if (a.y === b.y && c.y === d.y && a.y === c.y && Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) < Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))) return true
          if (a.x === b.x && c.x === d.x && a.x === c.x && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) < Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))) return true
          if (a.y === b.y && c.x === d.x && between(c.x, a.x, b.x) && between(a.y, c.y, d.y)) return true
          if (a.x === b.x && c.y === d.y && between(a.x, c.x, d.x) && between(c.y, a.y, b.y)) return true
        }
      }
      return false
    }

    expect(routes).toHaveLength(2)
    expect(interiorCollision(routes[0].path, routes[1].path), JSON.stringify(routes.map(route => [route.edge.key, route.path.points]))).toBe(false)
    expect(routes[0].path.points).not.toEqual(routes[1].path.points)
    const byKey = (items: typeof routes) => Object.fromEntries(items.map(item => [item.edge.key, item.path]))
    expect(byKey(routeOrthogonalLinks(owners, [edge('a-to-d', 'A', 'D'), edge('b-to-c', 'B', 'C')])))
      .toEqual(byKey(routeOrthogonalLinks(owners, [edge('b-to-c', 'B', 'C'), edge('a-to-d', 'A', 'D')])))
  })
  it('keeps inter-owner routes near the connected owners instead of wrapping the whole graph perimeter', () => {
    const owners = groupOwners({ ...model, nodes: [node('A', 'Alpha'), node('C', 'Beta'), node('D', 'Middle')] })
      .map((owner, index) => ({ ...owner, x: [0, 700, 350][index], y: [0, 160, 80][index] }))
    const routes = routeOrthogonalLinks(owners, [edge('a', 'A', 'C'), edge('b', 'D', 'C')])
    const minX = Math.min(...owners.map(owner => owner.x))
    const maxX = Math.max(...owners.map(owner => owner.x + owner.width))
    const minY = Math.min(...owners.map(owner => owner.y))
    const maxY = Math.max(...owners.map(owner => owner.y + owner.height))
    for (const { path } of routes) {
      expect(Math.min(...path.points.map(point => point.x))).toBeGreaterThanOrEqual(minX - 128)
      expect(Math.max(...path.points.map(point => point.x))).toBeLessThanOrEqual(maxX + 128)
      expect(Math.min(...path.points.map(point => point.y))).toBeGreaterThanOrEqual(minY - 128)
      expect(Math.max(...path.points.map(point => point.y))).toBeLessThanOrEqual(maxY + 128)
    }
  })
  it('keeps dense local relations local instead of using unrelated owners as a perimeter', () => {
    const denseModel: GraphModel = {
      nodes: [node('A', 'Alpha'), node('B', 'Beta'), node('F1', 'Far one'), node('F2', 'Far two')],
      edges: [], blocks: [],
    }
    const positions = new Map([
      ['A', { x: 0, y: 0 }], ['B', { x: 520, y: 180 }],
      ['F1', { x: 1800, y: 900 }], ['F2', { x: 2200, y: 1200 }],
    ])
    const owners = groupOwners(denseModel).map(owner => ({ ...owner, ...positions.get(owner.accounts[0].key)! }))
    const routes = routeOrthogonalLinks(owners, Array.from({ length: 12 }, (_, index) => edge(`local-${index}`, 'A', 'B')))

    expect(routes).toHaveLength(12)
    for (const { path } of routes) {
      expect(Math.min(...path.points.map(point => point.x))).toBeGreaterThanOrEqual(-160)
      expect(Math.max(...path.points.map(point => point.x))).toBeLessThanOrEqual(900)
      expect(Math.min(...path.points.map(point => point.y))).toBeGreaterThanOrEqual(-160)
      expect(Math.max(...path.points.map(point => point.y))).toBeLessThanOrEqual(500)
    }
  })
  it('assigns dense parallel relations to separate interior segments', () => {
    const parallelModel: GraphModel = {
      nodes: [node('A', 'Alpha'), node('B', 'Beta')],
      edges: [], blocks: [],
    }
    const owners = groupOwners(parallelModel).map((owner, index) => ({ ...owner, x: index * 520, y: index * 180 }))
    const routes = routeOrthogonalLinks(owners, Array.from({ length: 8 }, (_, index) => edge(`parallel-${index}`, 'A', 'B')))
    const overlaps = (left: (typeof routes)[number]['path'], right: (typeof routes)[number]['path']) => left.points.slice(1).some((b, index) => {
      const a = left.points[index]
      return right.points.slice(1).some((d, otherIndex) => {
        const c = right.points[otherIndex]
        if (a.y === b.y && c.y === d.y && a.y === c.y) return Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) < Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
        if (a.x === b.x && c.x === d.x && a.x === c.x) return Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) < Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
        return false
      })
    })

    expect(routes).toHaveLength(8)
    for (let left = 0; left < routes.length; left++) for (let right = left + 1; right < routes.length; right++) {
      expect(overlaps(routes[left].path, routes[right].path), `${routes[left].edge.key} overlaps ${routes[right].edge.key}`).toBe(false)
    }
    const interiorVerticalLanes = routes.flatMap(({ path }) => path.points.slice(1).flatMap((point, index) => {
      const previous = path.points[index]
      return point.x === previous.x && point.x > owners[0].x + owners[0].width && point.x < owners[1].x
        ? [point.x]
        : []
    }))
    const uniqueLanes = [...new Set(interiorVerticalLanes)].sort((a, b) => a - b)
    for (let index = 1; index < uniqueLanes.length; index++) {
      expect(uniqueLanes[index] - uniqueLanes[index - 1]).toBeGreaterThanOrEqual(12)
    }
  })
  it('keeps same-owner return lanes inside the drawable coordinate bounds', () => {
    const flow: GraphModel = { nodes: [node('A', 'Alpha'), node('B', 'Alpha')], edges: [edge('return', 'B', 'A')], blocks: [] }
    const paths = routeOrthogonalLinks(layoutOwnerClasses(flow), flow.edges).flatMap(item => item.path.points)
    expect(Math.min(...paths.map(point => point.x))).toBeGreaterThanOrEqual(0)
    expect(Math.min(...paths.map(point => point.y))).toBeGreaterThanOrEqual(0)
  })
})

it('disables all flow particles for reduced motion and otherwise distinguishes suspicious flows', () => {
  expect(flowParticleCount(1, true)).toBe(0)
  expect(flowParticleCount(0, true)).toBe(0)
  expect(flowParticleCount(1, false)).toBe(3)
  expect(flowParticleCount(0, false)).toBe(1)
  expect(flowParticleRadius(1)).toBeGreaterThan(flowParticleRadius(0))
  expect(flowParticleColor(1, 'red', 'gray')).toBe('red')
  expect(flowParticleColor(0, 'red', 'gray')).toBe('gray')
})

it('treats a suspicious node self-transfer as a suspicious red flow even when its edge aggregate is normal', () => {
  const suspicious = new Set(['A'])
  expect(effectiveFlowLabel(edge('self', 'A', 'A'), suspicious)).toBe(1)
  expect(effectiveFlowLabel(edge('plain-self', 'B', 'B'), suspicious)).toBe(0)
  expect(effectiveFlowLabel({ ...edge('explicit', 'B', 'C'), label: 1 }, suspicious)).toBe(1)
})

it('uses a non-passive native wheel listener so graph zoom does not scroll the page', () => {
  const source = readFileSync(new URL('./OwnerGraph.tsx', import.meta.url), 'utf8')
  expect(source).toContain("addEventListener('wheel', onWheel, { passive: false })")
  expect(source).toContain("removeEventListener('wheel', onWheel)")
  expect(source).not.toContain('onWheel={')
})
