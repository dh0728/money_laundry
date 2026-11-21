import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { graphFor, records, widthFor, type GraphModel, type GraphNode, type GraphTransaction } from './domain'
import Graph, { DEFAULT_HOP, edgeGeometry, loopGeometry, nodeRadius } from './Graph'
import SankeyPanel, { DEFAULT_PAIR_SORT, PAIR_SORTS, pairLayout, sankeyLayout } from './Sankey'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

// v17 Figma 재검토 반영: 엣지 균일 굵기(로그)+분리된 화살촉, 노드는 연결도로 커짐,
// 두 계좌(edge) focus는 전용 pair 패널, 계좌(node) focus는 Sankey 유지(목록 제거·라벨 온-band).
describe('v17 · widthFor(엣지 굵기, 로그 척도 1~12px)', () => {
  it('min은 1px, max는 12px에 매핑되고 min===max면 3px(중간값)이다', () => {
    expect(widthFor(0, 0, 100)).toBeCloseTo(1, 5)
    expect(widthFor(100, 0, 100)).toBeCloseTo(12, 5)
    expect(widthFor(5, 5, 5)).toBeCloseTo(3, 5)
  })
  it('로그 척도라 10배 차이가 시각적으로 뚜렷하게 커진다', () => {
    const w1 = widthFor(1_000, 100, 1_000_000), w2 = widthFor(10_000, 100, 1_000_000), w3 = widthFor(100_000, 100, 1_000_000)
    expect(w2).toBeGreaterThan(w1); expect(w3).toBeGreaterThan(w2)
    // 각 10배 스텝마다 폭이 같은 만큼(로그 등간격) 늘어난다
    expect(w2 - w1).toBeCloseTo(w3 - w2, 5)
  })
})

describe('v17 · edgeGeometry(균일 stroke + 분리된 화살촉)', () => {
  it('시작점은 출발 노드 경계에, 화살촉 끝은 도착 노드 경계에 여백 없이 붙는다', () => {
    const g = edgeGeometry({ x: 0, y: 0 }, { x: 200, y: 0 }, 5, 8, 6)
    expect(g.start.x).toBeCloseTo(5, 5) // a.x + ra
    expect(g.tip.x).toBeCloseTo(192, 5) // b.x - rb
  })
  it('line(몸통)과 arrow(화살촉)가 분리된 별도 path이며, 화살촉은 닫힌 삼각형이다', () => {
    const g = edgeGeometry({ x: 0, y: 0 }, { x: 200, y: 0 }, 5, 5, 6)
    expect(g.line.startsWith('M')).toBe(true)
    expect(g.arrow).toMatch(/^M[\d.-]+,[\d.-]+ L[\d.-]+,[\d.-]+ L[\d.-]+,[\d.-]+ Z$/)
    expect('polygon' in g).toBe(false) // v16의 하나로 이어진 폴리곤 방식이 아니다
  })
  it('굵을수록 화살촉도 뚜렷하게 넓어진다(4 + width*.9)', () => {
    const headSpan = (w: number) => {
      const nums = edgeGeometry({ x: 0, y: 0 }, { x: 300, y: 0 }, 5, 5, w).arrow.match(/-?[\d.]+/g)!.map(Number)
      return Math.hypot(nums[2] - nums[4], nums[3] - nums[5]) // h1(인덱스2·3) ~ h2(인덱스4·5)
    }
    expect(headSpan(8)).toBeGreaterThan(headSpan(2))
  })
})

describe('v17 · loopGeometry(self-loop, 최대 2.5px)', () => {
  it('화살촉이 있는 고리 path이고, 굵기는 금액과 무관하게 2.5px를 넘지 않는다', () => {
    const thin = loopGeometry({ x: 100, y: 100 }, 5, 1), thick = loopGeometry({ x: 100, y: 100 }, 5, 40)
    expect(thin.path).toMatch(/^M[\d.]+,[\d.]+ C/)
    expect(thick.arrow).toMatch(/^M[\d.-]+,[\d.-]+ L[\d.-]+,[\d.-]+ L[\d.-]+,[\d.-]+ Z$/)
    expect(thin.width).toBeLessThanOrEqual(2.5)
    expect(thick.width).toBeLessThanOrEqual(2.5)
  })
})

describe('v17 · nodeRadius(연결성으로 노드 크기)', () => {
  const plain = (key: string, over: Partial<GraphNode> = {}): GraphNode =>
    ({ key, account: key, bank: '', entity: '', x: 0, y: 0, core: false, bridge: false, hub: false, hubDegree: 0, hop: 0, synthetic: false, ...over })

  it('연결도(degree)가 높을수록 반지름이 커지고 3~14px로 clamp된다', () => {
    const low = nodeRadius(plain('a'), 0), mid = nodeRadius(plain('b'), 4), high = nodeRadius(plain('c'), 200)
    expect(mid).toBeGreaterThan(low)
    expect(high).toBeGreaterThan(mid)
    expect(low).toBeGreaterThanOrEqual(3)
    expect(high).toBeLessThanOrEqual(14)
  })
  it('허브는 연결도가 낮아도 기존 크기(7px) 이상을 유지한다', () => {
    expect(nodeRadius(plain('h', { hub: true }), 0)).toBeGreaterThanOrEqual(7)
  })
})

describe('v17 · 관계 그래프 렌더(hop·균일 stroke·self-loop)', () => {
  const record = records.find(r => r.kind === 'Alert' && graphFor(r).edges.some(e => e.s === e.t))!
  const model = graphFor(record)
  const markup = html(<Graph model={model} label="test" />)

  it('hop slider는 1~5이고 기본값은 3이며 눈금 5개가 markup에 나온다', () => {
    expect(DEFAULT_HOP).toBe(3)
    expect(markup).toContain('표시 범위 hop')
    expect(markup).toMatch(/<span class="">1<\/span><span class="">2<\/span><span class="text-foreground font-semibold">3<\/span><span class="">4<\/span><span class="">5<\/span>/)
  })

  it('엣지는 stroke-width 속성이 있는 균일 굵기 line과 분리된 화살촉(fill polygon)으로 렌더된다', () => {
    expect(markup).toMatch(/stroke-width="[\d.]+"/)
  })

  it('self-loop 엣지가 존재하고 markup에도 표시된다', () => {
    expect(model.edges.some(e => e.s === e.t)).toBe(true)
    expect(markup).toContain('data-loop="true"')
  })
})

/* ---------------------------------------------------------------- Sankey/Pair 패널 공통 fixture */
// A→B(작음+큼), B→A(가운데), B→C(가운데): B를 중심으로 A는 양방향 상대, C는 수신만
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

describe('v17 · sankeyLayout · 계좌(node) focus (B 중심, 목록 없음)', () => {
  const focus = { kind: 'node' as const, key: 'B' }
  const layout = sankeyLayout(model, focus, 400)

  it('보낸 상대는 왼쪽, 받는 상대는 오른쪽에 온다', () => {
    const left = layout.bars.filter(b => b.side === 'left').map(b => b.key)
    const right = layout.bars.filter(b => b.side === 'right').map(b => b.key)
    expect(left).toContain('A')
    expect(right).toContain('C')
  })
  it('양방향 상대(A)는 왼쪽과 오른쪽에 모두 나타난다', () => {
    const sides = layout.bars.filter(b => b.key === 'A').map(b => b.side)
    expect(sides).toContain('left'); expect(sides).toContain('right')
  })
  it('중앙 bar(B)가 존재하고, 각 band는 라벨 배치용 mid 좌표를 갖는다', () => {
    expect(layout.bars.some(b => b.key === 'B' && b.side === 'center')).toBe(true)
    expect(layout.bands.every(b => typeof b.mid.x === 'number' && typeof b.mid.y === 'number')).toBe(true)
  })

  it('SankeyPanel(node focus)은 data-testid="sankey-panel"로 렌더되고 거래 목록(li)이 없다', () => {
    const markup = html(<SankeyPanel model={model} focus={focus} onClose={() => {}} />)
    expect(markup).toContain('data-testid="sankey-panel"')
    expect(markup).not.toContain('<li')
  })
})

describe('v17 · pairLayout · 두 계좌(edge) focus (A ↔ B)', () => {
  it('양방향 거래가 모두 band로 나오고 방향값이 둘 다 존재한다', () => {
    const bands = pairLayout(model, 'A', 'B')
    expect(bands).toHaveLength(3) // tx-01, tx-02, tx-03
    const dirs = new Set(bands.map(b => b.direction))
    expect(dirs.has('a-to-b')).toBe(true); expect(dirs.has('b-to-a')).toBe(true)
  })

  it('기본 정렬은 시간순(오래된→최신)이다', () => {
    expect(DEFAULT_PAIR_SORT).toBe('time-asc')
    const bands = pairLayout(model, 'A', 'B')
    const ats = bands.map(b => b.tx.at)
    expect(ats).toEqual(ats.slice().sort())
  })

  it('정렬 옵션 4종(시간순·시간역순·금액큰순·금액작은순)이 존재한다', () => {
    expect(PAIR_SORTS.map(o => o.value)).toEqual(['time-asc', 'time-desc', 'amount-desc', 'amount-asc'])
    const byAmountDesc = pairLayout(model, 'A', 'B', 'amount-desc')
    expect(byAmountDesc[0]!.tx.usd).toBeGreaterThanOrEqual(byAmountDesc.at(-1)!.tx.usd)
    const byAmountAsc = pairLayout(model, 'A', 'B', 'amount-asc')
    expect(byAmountAsc[0]!.tx.usd).toBeLessThanOrEqual(byAmountAsc.at(-1)!.tx.usd)
  })

  it('금액이 클수록 band 높이가 크고, 28~96px 범위 안에 있다', () => {
    const bands = pairLayout(model, 'A', 'B')
    const t01 = bands.find(b => b.tx.id === 'tx-01')!, t02 = bands.find(b => b.tx.id === 'tx-02')!
    expect(t02.height).toBeGreaterThan(t01.height)
    expect(bands.every(b => b.height >= 28 && b.height <= 96)).toBe(true)
  })
})

describe('v17 · PairPanel(SankeyPanel · edge focus, band 안에 정보·목록 없음)', () => {
  const markup = html(<SankeyPanel model={model} focus={{ kind: 'edge', s: 'A', t: 'B' }} onClose={() => {}} />)

  it('data-testid="pair-panel"로 렌더되고 거래 목록(ul/li)이 없다', () => {
    expect(markup).toContain('data-testid="pair-panel"')
    expect(markup).not.toContain('<ul')
    expect(markup).not.toContain('<li')
  })
  it('band 안에 거래 정보(거래ID·금액)가 직접 표시된다', () => {
    expect(markup).toContain('tx-01')
    expect(markup).toContain('$100')
  })
  it('정렬 버튼이 존재한다', () => {
    expect(markup).toContain('정렬 방식')
  })
})
