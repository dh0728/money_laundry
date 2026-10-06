import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { graphFor, records, widthFor, type GraphModel, type GraphNode, type GraphTransaction } from './domain'
import Graph, { DEFAULT_HOP, nodeRadius } from './Graph'
import FlowDetail, { FlowPanel, flowId, flowLabel } from './FlowDetail'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)
const graphSrc = readFileSync(new URL('./Graph.tsx', import.meta.url), 'utf8')

// v17·v18 그래프 테스트 중 v19(react-force-graph + 도킹/플로팅 상세)에서도 유효한 규칙만 옮겼다.
describe('widthFor(엣지 굵기, 로그 척도 1~12px)', () => {
  it('min은 1px, max는 12px, min===max면 3px', () => {
    expect(widthFor(0, 0, 100)).toBeCloseTo(1, 5)
    expect(widthFor(100, 0, 100)).toBeCloseTo(12, 5)
    expect(widthFor(5, 5, 5)).toBeCloseTo(3, 5)
  })
  it('10배 스텝마다 같은 폭만큼 커진다', () => {
    const w1 = widthFor(1_000, 100, 1_000_000), w2 = widthFor(10_000, 100, 1_000_000), w3 = widthFor(100_000, 100, 1_000_000)
    expect(w2 - w1).toBeCloseTo(w3 - w2, 5)
  })
})

describe('nodeRadius(연결성으로 노드 크기)', () => {
  const plain = (key: string, over: Partial<GraphNode> = {}): GraphNode =>
    ({ key, account: key, bank: '', entity: '', x: 0, y: 0, core: false, bridge: false, hub: false, hubDegree: 0, hop: 0, synthetic: false, ...over })
  it('연결도가 높을수록 커지고 3~14px로 clamp', () => {
    const low = nodeRadius(plain('a'), 0), mid = nodeRadius(plain('b'), 4), high = nodeRadius(plain('c'), 200)
    expect(mid).toBeGreaterThan(low); expect(high).toBeGreaterThan(mid)
    expect(low).toBeGreaterThanOrEqual(3); expect(high).toBeLessThanOrEqual(14)
  })
  it('허브는 최소 7px', () => { expect(nodeRadius(plain('h', { hub: true }), 0)).toBeGreaterThanOrEqual(7) })
})

describe('v19 관계 그래프 · react-force-graph', () => {
  const model = graphFor(records.find(r => r.kind === 'Alert')!)
  const markup = html(<Graph model={model} label="test" />)
  it('hop slider 1~5, 기본 3, 설정·그래프 가로 분할은 유지된다', () => {
    expect(DEFAULT_HOP).toBe(3)
    expect(markup).toContain('표시 범위 hop')
    expect(markup).toContain('data-split="horizontal"')
  })
  it('클릭은 물리 배치를 바꾸지 않는다: 시뮬레이션 데이터는 모델에만 의존하고 hop 밖은 흐리게만 한다', () => {
    expect(graphSrc).toMatch(/const graphData = useMemo\([\s\S]*?\}\), \[model\]\)/)
    expect(graphSrc).toContain('faded(n.key) ? .15 : 1')
    expect(graphSrc).not.toContain('cooldownTicks')
  })
  it('화살촉은 도착 계좌 경계, 자기 자신 거래·양방향 쌍은 곡선, 의심 거래는 흐름 입자', () => {
    expect(graphSrc).toContain('linkDirectionalArrowRelPos={1}')
    expect(graphSrc).toMatch(/linkCurvature=\{l => l\.s === l\.t/)
    expect(graphSrc).toMatch(/linkDirectionalParticles=\{l => l\.label === 1/)
  })
})

/* FlowDetail fixture: A→B(100+500), B→A(200·의심), B→C(300) */
function node(key: string, core = false): GraphNode {
  return { key, account: `ACC-${key}`, bank: '004', entity: `${key}상사`, x: 0, y: 0, core, bridge: false, hub: false, hubDegree: 0, hop: 0, synthetic: false }
}
function tx(id: string, from: string, to: string, usd: number, label: 0 | 1 = 0): GraphTransaction {
  return { id, at: `2026-09-${id.slice(-2)} 10:00`, usd, amount: usd, currency: 'US Dollar', format: 'wire', from, to, label }
}
const edge = (key: string, s: string, t: string, label: 0 | 1, txs: GraphTransaction[]) =>
  ({ key, s, t, label, count: txs.length, usd: txs.reduce((a, x) => a + x.usd, 0), currency: 'US Dollar', format: 'wire', first: '', last: '', bridgePath: false, synthetic: false, transactions: txs })
const model: GraphModel = {
  nodes: [node('A'), node('B', true), node('C')],
  edges: [edge('e1', 'A', 'B', 0, [tx('tx-01', 'A', 'B', 100), tx('tx-02', 'A', 'B', 500)]), edge('e2', 'B', 'A', 1, [tx('tx-03', 'B', 'A', 200, 1)]), edge('e3', 'B', 'C', 0, [tx('tx-04', 'B', 'C', 300)])],
  blocks: [0],
}

describe('v19 상세 · FlowDetail·FlowPanel', () => {
  it('탭 id·이름은 계좌·거래쌍마다 다르다', () => {
    expect(flowId({ kind: 'node', key: 'B' })).toBe('flow:B')
    expect(flowId({ kind: 'edge', s: 'A', t: 'B' })).toBe('flow:A>B')
    expect(flowLabel(model, { kind: 'node', key: 'B' })).toBe('계좌 ACC-B')
    expect(flowLabel(model, { kind: 'edge', s: 'A', t: 'B' })).toBe('ACC-A ↔ ACC-B')
  })
  it('계좌 탭은 그 계좌가 낀 거래만 표로 보여준다', () => {
    const m = html(<FlowDetail model={model} focus={{ kind: 'node', key: 'A' }} />)
    expect(m).toContain('tx-01'); expect(m).toContain('tx-03'); expect(m).not.toContain('tx-04')
    expect(m).toContain('거래 3건')
  })
  it('거래쌍 탭은 양방향 거래를 모두 보여주고 의심 거래를 표시한다', () => {
    const m = html(<FlowDetail model={model} focus={{ kind: 'edge', s: 'A', t: 'B' }} />)
    expect(m).toContain('tx-02'); expect(m).toContain('tx-03'); expect(m).toContain('의심')
  })
  it('Sankey 띠 위로 흐름 점선 애니메이션이 있다', () => {
    // ResponsiveContainer는 SSR에서 크기 0이라 그리지 않으므로 소스·CSS로 확인한다
    expect(readFileSync(new URL('./FlowDetail.tsx', import.meta.url), 'utf8')).toContain('className="flow-dash"')
    expect(readFileSync(new URL('./index.css', import.meta.url), 'utf8')).toMatch(/@keyframes flow-dash[\s\S]*prefers-reduced-motion/)
  })
  it('상세 흐름 도식에 거래 정보 on/off 토글이 있다', () => {
    const m = html(<FlowDetail model={model} focus={{ kind: 'node', key: 'B' }} />)
    expect(m).toContain('id="flow-info"'); expect(m).toContain('거래 정보')
  })
  it('상세 창은 도킹이 기본이고 떠 있는 창으로 전환 버튼·닫기 버튼이 있다', () => {
    const m = html(<FlowPanel model={model} focus={{ kind: 'node', key: 'B' }} mode="dock" onModeChange={() => {}} onClose={() => {}} />)
    expect(m).toContain('data-mode="dock"'); expect(m).toContain('떠 있는 창으로 보기'); expect(m).toContain('상세 닫기')
  })
})
