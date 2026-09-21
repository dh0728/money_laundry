import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { GraphModel, GraphNode, GraphTransaction } from './domain'
import SankeyPanel, { sankeyLayout, type SankeyFocus } from './Sankey'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

function node(key: string, core = false): GraphNode {
  return { key, account: key, bank: '004', entity: `${key}상사`, x: 0, y: 0, core, bridge: false, hub: false, hubDegree: 0, hop: 0, synthetic: false }
}
function tx(id: string, from: string, to: string, usdAmount: number, label: 0 | 1 = 0): GraphTransaction {
  return { id, at: `2026-09-${id.slice(-2)} 10:00`, usd: usdAmount, amount: usdAmount, currency: 'US Dollar', format: 'wire', from, to, label }
}

// A→B(작음+큼), B→A(가운데), B→C(가운데) : B를 중심으로 A는 양방향 상대, C는 수신만
const model: GraphModel = {
  nodes: [node('A'), node('B', true), node('C')],
  edges: [
    { key: 'e1', s: 'A', t: 'B', label: 0, count: 2, usd: 600, currency: 'US Dollar', format: 'wire', first: '', last: '', bridgePath: false, synthetic: false, transactions: [tx('tx-01', 'A', 'B', 100), tx('tx-02', 'A', 'B', 500)] },
    { key: 'e2', s: 'B', t: 'A', label: 1, count: 1, usd: 200, currency: 'US Dollar', format: 'wire', first: '', last: '', bridgePath: false, synthetic: false, transactions: [tx('tx-03', 'B', 'A', 200, 1)] },
    { key: 'e3', s: 'B', t: 'C', label: 0, count: 1, usd: 300, currency: 'US Dollar', format: 'wire', first: '', last: '', bridgePath: false, synthetic: false, transactions: [tx('tx-04', 'B', 'C', 300)] },
  ],
  blocks: [0],
}

describe('sankeyLayout · edge focus (A ↔ B)', () => {
  const focus: SankeyFocus = { kind: 'edge', s: 'A', t: 'B' }
  const layout = sankeyLayout(model, focus, 400)

  it('양방향 거래가 모두 band로 나오고, 방향값이 둘 다 존재한다', () => {
    expect(layout.bands).toHaveLength(3) // tx-01, tx-02, tx-03
    const directions = new Set(layout.bands.map(b => b.direction))
    expect(directions.has('a-to-b')).toBe(true)
    expect(directions.has('b-to-a')).toBe(true)
  })

  it('모든 band에 화살촉이 있다 (거래 수만큼)', () => {
    expect(layout.bands.filter(b => b.arrow.length > 0)).toHaveLength(3)
  })

  it('금액이 클수록 두께가 크다', () => {
    const t01 = layout.bands.find(b => b.tx.id === 'tx-01')!
    const t02 = layout.bands.find(b => b.tx.id === 'tx-02')!
    expect(t02.thickness).toBeGreaterThan(t01.thickness)
  })
})

describe('sankeyLayout · node focus (B 중심)', () => {
  const focus: SankeyFocus = { kind: 'node', key: 'B' }
  const layout = sankeyLayout(model, focus, 400)

  it('보낸 상대는 왼쪽, 받는 상대는 오른쪽에 온다', () => {
    const left = layout.bars.filter(b => b.side === 'left').map(b => b.key)
    const right = layout.bars.filter(b => b.side === 'right').map(b => b.key)
    expect(left).toContain('A') // A → B
    expect(right).toContain('C') // B → C
  })

  it('양방향 상대(A)는 왼쪽과 오른쪽에 모두 나타난다', () => {
    const sides = layout.bars.filter(b => b.key === 'A').map(b => b.side)
    expect(sides).toContain('left')
    expect(sides).toContain('right')
  })

  it('중앙 bar(B)가 존재한다', () => {
    expect(layout.bars.some(b => b.key === 'B' && b.side === 'center')).toBe(true)
  })
})

describe('SankeyPanel', () => {
  it('data-testid로 렌더된다', () => {
    const markup = html(<SankeyPanel model={model} focus={{ kind: 'edge', s: 'A', t: 'B' }} onClose={() => {}} />)
    expect(markup).toContain('data-testid="sankey-panel"')
  })

  it('node focus도 정상 렌더된다', () => {
    const markup = html(<SankeyPanel model={model} focus={{ kind: 'node', key: 'B' }} onClose={() => {}} />)
    expect(markup).toContain('data-testid="sankey-panel"')
    expect(markup).toContain('거래 흐름')
  })
})
