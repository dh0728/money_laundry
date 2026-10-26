import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { graphFor, records, widthFor } from './domain'
import Graph, { DEFAULT_HOP, edgeGeometry, loopGeometry } from './Graph'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

// Figma 재검토 반영: hop 1~5, 패널 상대 굵기, self-loop 화살촉, Sankey 전환(피그마 리뷰 항목 6·5·4·-)
describe('v15c · 관계 그래프(hop 확장·굵기·self-loop)', () => {
  const record = records.find(r => r.kind === 'Alert' && graphFor(r).edges.some(e => e.s === e.t))!
  const model = graphFor(record)
  const markup = html(<Graph model={model} label="test" />)

  it('hop slider는 1~5이고 기본값은 3이며 눈금 5개가 markup에 나온다', () => {
    expect(DEFAULT_HOP).toBe(3)
    expect(markup).toContain('표시 범위 hop')
    expect(markup).toMatch(/<span class="">1<\/span><span class="">2<\/span><span class="text-foreground font-semibold">3<\/span><span class="">4<\/span><span class="">5<\/span>/)
  })

  it('엣지 굵기는 패널에 보이는 min~max usd를 제곱근 척도로 1.2~14px에 매핑한다', () => {
    expect(widthFor(0, 0, 100)).toBeCloseTo(1.2, 5)
    expect(widthFor(100, 0, 100)).toBeCloseTo(14, 5)
    expect(widthFor(25, 0, 100)).toBeGreaterThan(widthFor(1, 0, 100))
    expect(widthFor(25, 0, 100)).toBeLessThan(14)
    expect(widthFor(5, 5, 5)).toBeCloseTo((1.2 + 14) / 2, 5) // min===max일 때 중간값으로 안전하게 처리
  })

  it('self-loop 엣지는 화살촉이 있는 고리 path를 그린다', () => {
    const g = loopGeometry({ x: 100, y: 100 }, 5, 4)
    expect(g.path).toMatch(/^M[\d.]+,[\d.]+ C/) // 노드 위로 뚜렷하게 솟는 곡선
    expect(g.arrow).toMatch(/^M[\d.-]+,[\d.-]+ L[\d.-]+,[\d.-]+ L[\d.-]+,[\d.-]+ Z$/) // 닫힌 삼각형 화살촉
    // 실제 데이터에도 self-loop 엣지가 존재하고, 렌더 결과에도 loop 표시와 함께 나온다
    expect(model.edges.some(e => e.s === e.t)).toBe(true)
    expect(markup).toContain('data-loop="true"')
  })

  it('일반(비-loop) 엣지는 몸통과 화살촉이 하나로 이어진 채운 폴리곤이며, 굵을수록 화살촉도 넓어진다', () => {
    const g = edgeGeometry({ x: 0, y: 0 }, { x: 200, y: 0 }, 5, 5, 6)
    expect(g.polygon.startsWith('M')).toBe(true)
    expect(g.polygon.trim().endsWith('Z')).toBe(true)
    expect(g.polygon.match(/-?[\d.]+/g)!.length).toBe(12) // 6개 좌표(s1,b1,h1,tip,h2,b2)
    const headSpan = (w: number) => {
      const nums = edgeGeometry({ x: 0, y: 0 }, { x: 300, y: 0 }, 5, 5, w).polygon.match(/-?[\d.]+/g)!.map(Number)
      return Math.hypot(nums[4] - nums[8], nums[5] - nums[9])
    }
    expect(headSpan(8)).toBeGreaterThan(headSpan(2))
  })

  // SankeyPanel이 SSR에서 미리 선택된 엣지로 렌더되는 경우는 상태(useState) 초기화 흐름상 어려워 생략한다.
})
