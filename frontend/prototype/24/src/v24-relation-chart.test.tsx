import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildPatternRelationLayout, PatternRelationStack, RELATION_STACK_BREAKPOINT } from './Dashboard'

const composition = [
  { name: '패턴 소속', value: 11442, fill: 'dark' },
  { name: '패턴 외 · 다건 묶음', value: 360, fill: 'mid' },
  { name: '패턴 외 · 단일 거래', value: 96, fill: 'light' },
]
const distribution = [
  { pattern: 'FAN_OUT', alerts: 210, fill: 'fan' },
  { pattern: 'CYCLE', alerts: 105, fill: 'cycle' },
]

describe('v24 관계 막대', () => {
  const layout = buildPatternRelationLayout(composition, distribution, 760, 420)

  it('왼쪽 기둥은 거래 건 비율대로 나누고 아주 작은 칸도 최소 두께를 가진다', () => {
    const [patterned, multi, single] = layout.segments
    expect(patterned.h / layout.bodyH).toBeGreaterThan(.9)
    expect(multi.h).toBeGreaterThan(single.h)
    expect(single.h).toBeGreaterThanOrEqual(4)
    expect(single.y + single.h).toBeCloseTo(layout.bodyTop + layout.bodyH, 0)
    expect(layout.segments.map(segment => segment.share)).toEqual(['96%', '3%', '0.8%'])
  })

  it('작은 칸 이름표가 서로 겹치지 않도록 밀어낸다', () => {
    for (let i = 1; i < layout.labels.length; i++) {
      expect(layout.labels[i].y - layout.labels[i - 1].y).toBeGreaterThanOrEqual(layout.labelH)
    }
    expect(layout.labels.at(-1)!.y + layout.labelH / 2).toBeLessThanOrEqual(layout.bodyTop + layout.bodyH + .01)
  })

  it('오른쪽 막대는 거래 건이 아니라 가장 많은 Alert를 기준으로 길이를 잰다', () => {
    const [fan, cycle] = layout.rows
    expect(cycle.barW / fan.barW).toBeCloseTo(.5, 1)
    expect(layout.links).toHaveLength(2)
    // 연결선은 패턴 소속 칸 범위 안에서만 출발한다.
    const parent = layout.segments[0]
    for (const row of layout.rows) {
      expect(row.fromY).toBeGreaterThanOrEqual(parent.y)
      expect(row.fromY).toBeLessThanOrEqual(parent.y + parent.h)
    }
  })

  it('좁은 화면용 쌓기 형태도 두 단위를 따로 표기한다', () => {
    const markup = renderToStaticMarkup(<PatternRelationStack composition={composition} distribution={distribution} />)
    expect(markup).toContain('거래 건')
    expect(markup).toContain('Alert')
    expect((markup.match(/data-testid="relation-total-segment"/g) ?? [])).toHaveLength(3)
    expect((markup.match(/data-testid="relation-pattern-bar"/g) ?? [])).toHaveLength(2)
    expect(markup).toContain('width:50%')
  })

  it('차트 폭 720px 미만부터 세로 깔때기로 전환한다', () => {
    expect(RELATION_STACK_BREAKPOINT).toBe(720)
  })
})
