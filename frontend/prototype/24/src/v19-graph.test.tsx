import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { graphFor, records, widthFor, type GraphModel, type GraphNode, type GraphTransaction } from './domain'
import Graph, { DEFAULT_HOP, nodeRadius, seedComponentPositions } from './Graph'
import * as graph from './Graph'
import FlowDetail, { FlowPanel, flowId, flowLabel, flowLinkLabel, flowTipContent, sankeyLabelLayout, sankeyLinkLabelLayout } from './FlowDetail'
import * as flowDetail from './FlowDetail'

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

  it('그래프 tooltip 역할 문구에 내부 합성 데이터 표시를 노출하지 않는다', async () => {
    const module = await import('./Graph') as unknown as { graphNodeRole?: (node: GraphNode) => string }
    expect(module.graphNodeRole).toBeTypeOf('function')
    expect(module.graphNodeRole!(plain('s', { synthetic: true }))).toBe('0단계 주변 계좌')
  })
})

describe('v19 관계 그래프 · react-force-graph', () => {
  const model = graphFor(records.find(r => r.kind === 'Alert')!)
  const markup = html(<Graph model={model} label="test" />)
  it('hop slider 1~5, 기본 3, 설정·그래프 가로 분할은 유지된다', () => {
    expect(DEFAULT_HOP).toBe(3)
    expect(markup).toContain('선택 계좌 기준 연결 단계 hop 수')
    expect(markup).toContain('그래프에서 계좌 노드를 선택하면 hop 범위 설정이 활성화됩니다.')
    expect(markup).toContain('data-split="horizontal"')
  })
  it('hop 범위 밖은 숨기되 시뮬레이션 데이터는 고정해 선택 시 배치가 움직이지 않는다', () => {
    expect(graphSrc).toMatch(/const graphData = useMemo\([\s\S]*?nodes: seedComponentPositions\(model\)[\s\S]*?links: model\.edges\.map[\s\S]*?\}\), \[model\]\)/)
    expect(graphSrc).toContain('(!allowed || allowed.has(n.key))')
    expect(graphSrc).toContain('allowed.has(l.s) && allowed.has(l.t)')
    expect(graphSrc).not.toContain('allowed && !allowed.has(key)')
    expect(graphSrc).not.toContain('cooldownTicks')
  })
  it('연결되지 않은 성분은 서로 다른 클러스터 중심에서 시작한다', () => {
    const disconnected: GraphModel = {
      nodes: [node('A'), node('B'), node('C'), node('D')],
      edges: [edge('ab', 'A', 'B', 0, []), edge('cd', 'C', 'D', 0, [])],
      blocks: [],
    }
    const positioned = seedComponentPositions(disconnected)
    const center = (keys: string[]) => keys.reduce((sum, key) => sum + positioned.find(item => item.key === key)!.x, 0) / keys.length
    expect(Math.abs(center(['A', 'B']) - center(['C', 'D']))).toBeGreaterThanOrEqual(320)
  })
  it('계좌·소유주 보기 선택과 공용 시간축을 표시한다', () => {
    expect(markup).toContain('계좌별 보기')
    expect(markup).toContain('소유주별 보기')
    expect(markup).toContain('aria-label="그래프 보기"')
    expect(markup).toContain('data-testid="graph-view-switch"')
    expect(markup).toContain('grid w-full grid-cols-2')
    expect(graphSrc).toContain("viewMode === 'owner' ? 'translate-x-full' : 'translate-x-0'")
    expect(markup).toContain('aria-label="시간축"')
  })
  it('화살촉 없이 자기 자신 거래·양방향 곡선과 모션 설정을 따르는 흐름 입자를 쓴다', () => {
    expect(graphSrc).toContain('linkDirectionalArrowLength={0}')
    expect(graphSrc).toMatch(/linkCurvature=\{l => l\.s === l\.t/)
    expect(graphSrc).toContain('linkDirectionalParticles={l => flowParticleCount(effectiveFlowLabel(l, suspiciousNodes), reducedMotion)}')
    expect(graphSrc).toContain('linkDirectionalParticleColor={l => flowParticleColor(effectiveFlowLabel(l, suspiciousNodes), colors.l1, colors.l0Particle)}')
    expect(readFileSync(new URL('./index.css', import.meta.url), 'utf8')).toContain('--graph-l1-edge:#ff000073')
  })
  it('화면 맞춤은 확대·축소 묶음에 함께 있다', () => {
    const toolbar = graphSrc.slice(graphSrc.indexOf('className="flex gap-2 p-3'), graphSrc.indexOf('<div ref={canvasRef}'))
    const zoomControls = graphSrc.slice(graphSrc.indexOf('className="absolute bottom-3 right-3'))
    expect(toolbar).not.toContain('label="화면 맞춤"')
    expect(zoomControls).toContain('label="화면 맞춤"')
  })
  it('초기화는 드래그한 소유주 위치와 카메라를 함께 버린다', () => {
    expect(graph.resetOwnerGraphState).toBeTypeOf('function')
    expect(graph.resetOwnerGraphState!({ positions: { moved: { x: 10, y: 20 } }, camera: { x: 3, y: 4, scale: 2, fitScale: 1 } }))
      .toEqual({ positions: {}, camera: null })
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

it('indexes incident edges in model order, preserving reciprocal pairs and including self-transfers once', () => {
  expect(graph.connectedEdgesByNode).toBeTypeOf('function')
  const loop = edge('loop', 'A', 'A', 0, [tx('tx-05', 'A', 'A', 50)])
  const lookup = graph.connectedEdgesByNode([...model.edges, loop])
  expect(lookup.get('A')?.map(e => e.key)).toEqual(['e1', 'e2', 'loop'])
  expect(lookup.get('B')?.map(e => e.key)).toEqual(['e1', 'e2', 'e3'])
  expect(lookup.get('C')?.map(e => e.key)).toEqual(['e3'])
  expect(lookup.get('missing')).toBeUndefined()
  expect(lookup.get('A')?.[0]).toBe(model.edges[0])
})

describe('v19 상세 · FlowDetail·FlowPanel', () => {
  it('centers each Sankey link stack using that side’s throughput and keeps relative stacking offsets', () => {
    expect(flowDetail.centerSankeyLink).toBeTypeOf('function')
    const source = { dy: 100, value: 1000, outgoing: 400, incoming: 1000 }
    const target = { dy: 80, value: 800, outgoing: 800, incoming: 200 }
    const corrected = flowDetail.centerSankeyLink({ sourceY: 55, targetY: 115, payload: { source, target } })
    expect(corrected).toEqual({ sourceY: 85, targetY: 145 })
    expect(sankeyLinkLabelLayout({ sourceX: 20, targetX: 180, ...corrected })).toEqual({ x: 100, y: 115 })
    expect(flowDetail.centerSankeyLink({ sourceY: 65, targetY: 125, payload: { source, target } })).toEqual({ sourceY: 95, targetY: 155 })
    const empty = { dy: 0, value: 0, outgoing: 0, incoming: 0 }
    expect(flowDetail.centerSankeyLink({ sourceY: 20, targetY: 30, payload: { source: empty, target: empty } })).toEqual({ sourceY: 20, targetY: 30 })
  })
  it('Sankey 계좌 라벨은 선택/좌/우 위치와 관계없이 노드 막대 세로 중앙에 맞춘다', () => {
    const selected = sankeyLabelLayout({ x: 200, y: 40, width: 10, height: 32, index: 0 })
    expect(selected).toMatchObject({ y: 56, dominantBaseline: 'middle' })
    expect(selected.x).toBeGreaterThan(210)
    expect(selected.textAnchor).toBe('start')
    expect(sankeyLabelLayout({ x: 80, y: 70, width: 10, height: 18, index: 1 })).toMatchObject({ y: 79, dominantBaseline: 'middle' })
    expect(sankeyLabelLayout({ x: 320, y: 90, width: 10, height: 20, index: 2 })).toMatchObject({ y: 100, dominantBaseline: 'middle' })
  })
  it('Sankey 링크 tooltip은 날짜/기간을 첫 줄, 금액을 둘째 줄에 두고 단일 거래의 불필요한 건수는 생략한다', () => {
    const range = flowTipContent({ source: { name: 'ACC-A' }, target: { name: 'ACC-B' }, value: 600, count: 2, first: '2026-09-01 10:00', last: '2026-09-02 10:00' })
    expect(range).toEqual({ primary: '09-01 ~ 09-02', secondary: '600$ · 2건' })
    expect(`${range.primary} ${range.secondary}`).not.toContain('ACC-A')
    expect(`${range.primary} ${range.secondary}`).not.toContain('ACC-B')

    expect(flowTipContent({ source: { name: 'ACC-A' }, target: { name: 'ACC-B' }, value: 200, count: 1, first: '2026-09-03 10:00', last: '2026-09-03 10:00' }))
      .toEqual({ primary: '09-03 10:00', secondary: '200$' })
  })
  it('Sankey 상시 라벨은 날짜·금액만 쓰고 각 흐름선 정중앙에 놓인다', () => {
    expect(flowLinkLabel({ value: 8_800, count: 1, first: '2026-09-10 07:18', last: '2026-09-10 07:18' })).toBe('8.8K$ · 09-10 07:18')
    expect(flowLinkLabel({ value: 600, count: 2, first: '2026-09-01 10:00', last: '2026-09-02 10:00' })).toBe('600$ · 2건 · 09-01 ~ 09-02')
    expect(sankeyLinkLabelLayout({ sourceX: 20, targetX: 180, sourceY: 40, targetY: 100 })).toEqual({ x: 100, y: 70 })
  })
  it('Recharts가 감싼 Sankey link payload도 기간과 금액·건수로 표시한다', () => {
    const browserPayload = {
      payload: {
        payload: {
          source: { name: '80C8966E0' }, target: { name: '80DADEFF0' },
          value: 1_247_009, count: 4,
          first: '2026-09-05 03:28', last: '2026-09-13 12:57',
        },
        name: '80C8966E0 - 80DADEFF0',
        value: 1_247_009,
      },
      name: '80C8966E0 - 80DADEFF0',
      value: 1_247_009,
    }
    const content = flowTipContent(browserPayload)
    expect(content).toEqual({ primary: '09-05 ~ 09-13', secondary: '1,247,009$ · 4건' })
    expect(`${content.primary} ${content.secondary}`).not.toMatch(/80C8966E0|80DADEFF0/)
  })
  it('Sankey node tooltip fallback은 계좌와 금액을 읽을 수 있다', () => {
    expect(flowTipContent({ name: ' ACC-A ', value: 300 })).toEqual({ primary: 'ACC-A', secondary: '300$' })
  })
  it('탭 id·이름은 계좌·거래쌍마다 다르다', () => {
    expect(flowId({ kind: 'node', key: 'B' })).toBe('flow:B')
    expect(flowId({ kind: 'edge', s: 'A', t: 'B' })).toBe('flow:A>B')
    expect(flowLabel(model, { kind: 'node', key: 'B' })).toBe('계좌 ACC-B')
    expect(flowLabel(model, { kind: 'edge', s: 'A', t: 'B' })).toBe('ACC-A ↔ ACC-B')
  })
  it('계좌 상세는 요약·Sankey만 두고 중복 거래 표는 넣지 않는다', () => {
    const m = html(<FlowDetail model={model} focus={{ kind: 'node', key: 'A' }} />)
    expect(m).toContain('>거래</div>'); expect(m).toContain('>3건</div>')
    expect(m).not.toContain('<table')
    expect(m).not.toContain('tx-01')
  })
  it('거래쌍 상세도 중복 거래 표 없이 집계만 보여준다', () => {
    const m = html(<FlowDetail model={model} focus={{ kind: 'edge', s: 'A', t: 'B' }} />)
    expect(m).toContain('>거래</div>'); expect(m).toContain('>3건</div>')
    expect(m).not.toContain('<table')
  })
  it('Sankey 띠 위로 의심 거래는 빨간 흐름 점, 정상 거래는 반투명 흰 점이 이동한다', () => {
    // ResponsiveContainer는 SSR에서 크기 0이라 그리지 않으므로 소스·CSS로 확인한다
    const source = readFileSync(new URL('./FlowDetail.tsx', import.meta.url), 'utf8')
    expect(source).toContain('className="flow-dash"')
    expect(source).toContain('stroke={l.suspect ? red : \'var(--foreground)\'}')
    expect(source).toContain('strokeOpacity={l.suspect ? 1 : .5}')
    expect(readFileSync(new URL('./index.css', import.meta.url), 'utf8')).toMatch(/@keyframes flow-dash[\s\S]*prefers-reduced-motion/)
  })
  it('상세 흐름 도식에 거래 정보 on/off 토글이 있다', () => {
    const m = html(<FlowDetail model={model} focus={{ kind: 'node', key: 'B' }} />)
    expect(m).toContain('id="flow-info"'); expect(m).toContain('거래 정보')
  })
  it('상세 흐름 조작부는 카드 우하단에 붙고 화면 맞춤 상태에서는 맞춤 버튼이 비활성화된다', () => {
    const source = readFileSync(new URL('./FlowDetail.tsx', import.meta.url), 'utf8')
    expect(source).toContain('className="absolute bottom-3 right-3')
    expect(source).toContain('label="화면 맞춤" disabled={fitted}')
  })
  it('휠 한 칸은 deltaY를 곱하지 않고 고정 step으로 확대한다', () => {
    expect(readFileSync(new URL('./FlowDetail.tsx', import.meta.url), 'utf8')).toMatch(/<TransformWrapper[^>]*smooth=\{false\}/)
  })
  it('상세 창은 도킹이 기본이고 떠 있는 창으로 전환 버튼·닫기 버튼이 있다', () => {
    const m = html(<FlowPanel model={model} focus={{ kind: 'node', key: 'B' }} mode="dock" onModeChange={() => {}} onClose={() => {}} />)
    expect(m).toContain('data-mode="dock"'); expect(m).toContain('떠 있는 창으로 보기'); expect(m).toContain('상세 닫기')
  })
})
