import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { graphFor, records, type GraphModel, type GraphNode, type GraphTransaction } from './domain'
import Graph, { edgeGeometry } from './Graph'
import SankeyPanel, { LEFT_GAP, GROUP_GAP, pairLayout, sankeyLayout, sankeyZoomAt } from './Sankey'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

function node(key: string, core = false): GraphNode {
  return { key, account: key, bank: '004', entity: `${key}상사`, x: 0, y: 0, core, bridge: false, hub: false, hubDegree: 0, hop: 0, synthetic: false }
}
function tx(id: string, from: string, to: string, usdAmount: number, label: 0 | 1 = 0): GraphTransaction {
  return { id, at: `2026-09-${id.slice(-2)} 10:00`, usd: usdAmount, amount: usdAmount, currency: 'US Dollar', format: 'wire', from, to, label }
}
const model: GraphModel = {
  nodes: [node('A'), node('B', true), node('C')],
  edges: [
    { key: 'e1', s: 'A', t: 'B', label: 0, count: 2, usd: 600, currency: 'US Dollar', format: 'wire', first: '', last: '', bridgePath: false, synthetic: false, transactions: [tx('tx-01', 'A', 'B', 100), tx('tx-02', 'A', 'B', 500)] },
    { key: 'e2', s: 'B', t: 'A', label: 1, count: 1, usd: 200, currency: 'US Dollar', format: 'wire', first: '', last: '', bridgePath: false, synthetic: false, transactions: [tx('tx-03', 'B', 'A', 200, 1)] },
    { key: 'e3', s: 'B', t: 'C', label: 0, count: 1, usd: 300, currency: 'US Dollar', format: 'wire', first: '', last: '', bridgePath: false, synthetic: false, transactions: [tx('tx-04', 'B', 'C', 300)] },
  ],
  blocks: [0],
}

describe('v18 G1/G2 · 엣지 선택 계좌는 출발 위·도착 아래 세로 스택', () => {
  const markup = html(<SankeyPanel model={model} focus={{ kind: 'edge', s: 'A', t: 'B' }} onClose={() => {}} />)

  it('pair-accounts가 flex-col 세로 스택이고 source가 destination보다 앞에 온다', () => {
    expect(markup).toContain('data-testid="pair-accounts"')
    expect(markup).toContain('flex flex-col')
    const src = markup.indexOf('data-side="source"')
    const dst = markup.indexOf('data-side="destination"')
    expect(src).toBeGreaterThan(-1)
    expect(dst).toBeGreaterThan(src)
  })

  it('가로 justify-between 계좌 헤더를 쓰지 않는다', () => {
    // 이전 v17 패턴: flex items-center justify-between … A … B
    expect(markup).not.toMatch(/justify-between mt-2\.5 text-xs gap-2/)
    expect(markup).toContain('출발')
    expect(markup).toContain('도착')
  })
})

describe('v18 G3 · 화살촉을 엣지 정중앙에', () => {
  it('edgeGeometry 화살 tip이 start–tip 중점에 가깝다', () => {
    const g = edgeGeometry({ x: 0, y: 0 }, { x: 200, y: 0 }, 5, 5, 6)
    // start≈5, tip≈195, mid≈100 → arrowTip = mid + headLen/2
    expect(g.mid.x).toBeCloseTo(100, 5)
    expect(g.arrowTip.x).toBeGreaterThan(g.mid.x - 1)
    expect(g.arrowTip.x).toBeLessThan(g.tip.x)
    // tip(도착 경계)에 붙어 있지 않다
    expect(Math.abs(g.arrowTip.x - g.tip.x)).toBeGreaterThan(20)
  })

  it('Sankey band 화살도 리본 가로 중앙(mid.x) 부근에 있다', () => {
    const layout = sankeyLayout(model, { kind: 'node', key: 'B' }, 400)
    expect(layout.bands.length).toBeGreaterThan(0)
    for (const b of layout.bands) {
      // arrow path: M baseX,.. L tipX,midY L baseX,.. — tipX ≈ mid.x + arrowLen/2
      const nums = b.arrow.match(/-?[\d.]+/g)!.map(Number)
      const tipX = nums[2]
      expect(Math.abs(tipX - b.mid.x)).toBeLessThan(20)
    }
  })
})

describe('v18 G4 · 왼쪽 가로 여백 ~5px, 세로 간격 유지', () => {
  it('LEFT_GAP은 5이고 GROUP_GAP(세로)도 5이다', () => {
    expect(LEFT_GAP).toBe(5)
    expect(GROUP_GAP).toBe(5)
  })

  it('pair/sankey 패널 markup에 data-left-gap="5"가 있다', () => {
    const pair = html(<SankeyPanel model={model} focus={{ kind: 'edge', s: 'A', t: 'B' }} onClose={() => {}} />)
    const sankey = html(<SankeyPanel model={model} focus={{ kind: 'node', key: 'B' }} onClose={() => {}} />)
    expect(pair).toContain('data-left-gap="5"')
    expect(sankey).toContain('data-left-gap="5"')
  })
})

describe('v18 G5 · 상세는 push(비-overlay) + zoom/pan', () => {
  const record = records.find(r => r.kind === 'Alert' && graphFor(r).edges.length > 0)!
  const graphModel = graphFor(record)
  const markup = html(<Graph model={graphModel} label="v18" />)

  it('graph-drawer overlay 클래스를 쓰지 않는다', () => {
    expect(markup).not.toContain('graph-drawer')
    expect(markup).toContain('data-testid="graph-layout"')
    expect(markup).toContain('data-testid="graph-split-h"')
  })

  it('pair/sankey viewport가 있어 확대·패닝 대상이다', () => {
    const pair = html(<SankeyPanel model={model} focus={{ kind: 'edge', s: 'A', t: 'B' }} onClose={() => {}} />)
    const sankey = html(<SankeyPanel model={model} focus={{ kind: 'node', key: 'B' }} onClose={() => {}} />)
    expect(pair).toContain('data-testid="pair-viewport"')
    expect(sankey).toContain('data-testid="sankey-viewport"')
  })

  it('sankeyZoomAt은 노드 그래프와 같이 커서 기준 배율을 바꾼다', () => {
    const next = sankeyZoomAt({ k: 1, x: 0, y: 0 }, 2, 100, 50)
    expect(next.k).toBe(2)
    expect(next.x).toBe(100 - 100 * 2) // px - (px - x)*(k'/k)
    expect(next.y).toBe(50 - 50 * 2)
  })
})

describe('v18 G6/G7 · 중간 분할·상세 패널 리사이즈', () => {
  const record = records.find(r => r.kind === 'Alert')!
  const markup = html(<Graph model={graphFor(record)} label="v18" />)

  it('가로 ResizablePanelGroup이 설정·그래프 분할을 제공한다', () => {
    expect(markup).toContain('data-testid="graph-split-h"')
    expect(markup).toContain('data-slot="resizable-handle"')
    expect(markup).toContain('data-slot="resizable-panel-group"')
  })

  it('pairLayout·sankeyLayout은 여전히 동작한다(회귀)', () => {
    expect(pairLayout(model, 'A', 'B')).toHaveLength(3)
    expect(sankeyLayout(model, { kind: 'node', key: 'B' }, 400).bars.some(b => b.side === 'center')).toBe(true)
  })
})
