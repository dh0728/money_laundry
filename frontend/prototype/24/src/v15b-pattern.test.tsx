import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PatternGlyph, { patternLayouts, type PatternKey } from './PatternGlyph'

const ALL_KEYS: PatternKey[] = [
  'FAN_OUT', 'FAN_IN', 'GATHER-SCATTER', 'SCATTER-GATHER', 'CYCLE', 'RANDOM', 'BIPARTITE', 'STACK', 'NON_PATTERN',
]

describe('PatternGlyph · IBM AML 논문 Figure 2 도식', () => {
  it.each(ALL_KEYS)('%s 패턴이 svg로 렌더된다', (key) => {
    const html = renderToStaticMarkup(<PatternGlyph pattern={key} />)
    expect(html).toContain('<svg')
    expect(html).toContain(`data-pattern="${key}"`)
    expect(html).toContain(`aria-label="${key} 패턴 도식"`)
  })

  it('그라디언트를 쓰지 않는다 (브랜드: 블랙/화이트 + 레드 accent, flat)', () => {
    for (const key of ALL_KEYS) {
      const html = renderToStaticMarkup(<PatternGlyph pattern={key} />)
      expect(html).not.toMatch(/linearGradient|radialGradient/)
    }
  })

  it('알 수 없는/NORMAL 패턴은 NON_PATTERN과 같은 강조 없는 중립 그래프로 대체된다', () => {
    for (const p of ['NORMAL', '알수없음', '']) {
      const html = renderToStaticMarkup(<PatternGlyph pattern={p} />)
      expect(html).toContain(`data-pattern="${p}"`)
      // NON_PATTERN 레이아웃에는 강조(빨강) 노드가 없다 -> var(--graph-l1) fill 이 등장하지 않아야 한다
      expect(html).not.toContain('fill="var(--graph-l1)"')
    }
  })

  const edgeCounts: Record<string, number> = {
    FAN_OUT: 4,
    FAN_IN: 4,
    'GATHER-SCATTER': 6,
    'SCATTER-GATHER': 8,
    CYCLE: 5,
    BIPARTITE: 6,
    STACK: 12,
  }

  it.each(Object.entries(edgeCounts))('%s 엣지 개수는 %i개다 (논문 Figure 2 기준)', (key, count) => {
    expect(patternLayouts[key as PatternKey].edges.length).toBe(count)
  })

  it('CYCLE의 각 노드는 in-degree 1, out-degree 1을 갖는다 (단순 순환)', () => {
    const { nodes, edges } = patternLayouts.CYCLE
    const indeg = new Array(nodes.length).fill(0)
    const outdeg = new Array(nodes.length).fill(0)
    for (const [from, to] of edges) { outdeg[from]++; indeg[to]++ }
    expect(indeg).toEqual(new Array(nodes.length).fill(1))
    expect(outdeg).toEqual(new Array(nodes.length).fill(1))
  })

  const highlightCounts: Record<string, number> = {
    FAN_OUT: 1,
    FAN_IN: 1,
    'GATHER-SCATTER': 1,
    'SCATTER-GATHER': 4,
    CYCLE: 1,
    BIPARTITE: 2,
    STACK: 3,
  }

  it.each(Object.entries(highlightCounts))('%s 강조(빨강) 노드 개수는 %i개다', (key, count) => {
    const n = patternLayouts[key as PatternKey].nodes.filter(node => node.highlight).length
    expect(n).toBe(count)
  })

  it('NON_PATTERN은 강조 노드가 없고 서로 연결되지 않은 조각들로 구성된다', () => {
    const { nodes, edges } = patternLayouts.NON_PATTERN
    expect(nodes.some(n => n.highlight)).toBe(false)
    expect(edges.length).toBeGreaterThan(0)
    expect(edges.length).toBeLessThan(nodes.length) // 전부 연결되지 않은 조각(트리보다 엣지 수가 적음)
  })

  it('BIPARTITE는 왼쪽 강조 2개 × 오른쪽 hollow 3개가 모두 연결된다', () => {
    const { nodes, edges } = patternLayouts.BIPARTITE
    const leftIdx = nodes.map((n, i) => (n.highlight ? i : -1)).filter(i => i >= 0)
    const rightIdx = nodes.map((n, i) => (!n.highlight ? i : -1)).filter(i => i >= 0)
    expect(leftIdx.length).toBe(2)
    expect(rightIdx.length).toBe(3)
    for (const l of leftIdx) for (const r of rightIdx) {
      expect(edges.some(([from, to]) => from === l && to === r)).toBe(true)
    }
  })

  it('viewBox는 0 0 120 100으로 고정된다', () => {
    for (const key of ALL_KEYS) {
      const html = renderToStaticMarkup(<PatternGlyph pattern={key} />)
      expect(html).toContain('viewBox="0 0 120 100"')
    }
  })

  it('화살표 끝은 노드 중심이 아니라 노드 반지름만큼 떨어진 지점에서 멈춘다', () => {
    const html = renderToStaticMarkup(<PatternGlyph pattern="FAN_OUT" />)
    const { nodes, edges } = patternLayouts.FAN_OUT
    const [from, to] = edges[0]
    const a = nodes[from], b = nodes[to]
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    const ux = (b.x - a.x) / dist, uy = (b.y - a.y) / dist
    const expectedX2 = b.x - ux * 7
    const expectedY2 = b.y - uy * 7
    expect(html).toContain(`x2="${expectedX2}"`)
    expect(html).toContain(`y2="${expectedY2}"`)
  })
})
