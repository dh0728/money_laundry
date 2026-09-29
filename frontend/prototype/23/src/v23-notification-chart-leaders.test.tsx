import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TransactionPatternHierarchy } from './Dashboard'
import { records } from './domain'
import { Notifications } from './UtilityPages'

const html = (node: React.ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>)

describe('v23 알림 카드 포커스 범위', () => {
  it('본문 버튼이 아니라 카드 블록 전체가 포커스·호버 상태를 가진다', () => {
    const markup = html(<Notifications records={records} onOpen={() => {}} />)
    const card = markup.match(/<div[^>]*class="[^"]*notification-card[^"]*"[^>]*>/)?.[0] ?? ''
    const action = markup.match(/<button[^>]*class="[^"]*notification-card-action[^"]*"[^>]*>/)?.[0] ?? ''

    expect(card).toContain('relative')
    expect(card).toContain('focus-within:ring')
    expect(action).toContain('absolute')
    expect(action).toContain('inset-0')
    expect(action).toContain('rounded-lg')
    expect(markup).toContain('data-testid="notification-card-content"')
  })
})

describe('v23 계층 차트 범례 배치', () => {
  const composition = [
    { name: '패턴 소속', value: 60, fill: 'dark' },
    { name: '패턴 외 · 다건 묶음', value: 30, fill: 'mid' },
    { name: '패턴 외 · 단일 거래', value: 10, fill: 'light' },
  ]
  const distribution = [
    { pattern: 'FAN_OUT', alerts: 3, fill: 'fan' },
    { pattern: 'CYCLE', alerts: 1, fill: 'cycle' },
  ]

  it('막대는 두 좁은 회색 영역만 오른쪽 색점 범례로 표시한다', () => {
    const markup = html(<TransactionPatternHierarchy composition={composition} distribution={distribution} view="bar" />)

    expect(markup).not.toContain('data-testid="composition-legend"')
    expect(markup).not.toContain('data-testid="pattern-legend"')
    expect((markup.match(/data-testid="bar-gray-callout"/g) ?? [])).toHaveLength(2)
    expect((markup.match(/data-testid="bar-gray-dot"/g) ?? [])).toHaveLength(2)
    expect(markup).not.toContain('data-testid="bar-gray-leader"')
    expect((markup.match(/data-testid="pattern-child-label"/g) ?? [])).toHaveLength(2)
    expect((markup.match(/data-testid="composition-sibling-block"/g) ?? [])).toHaveLength(2)
    expect(markup).toContain('data-testid="pattern-parent-cell"')
    expect(markup).toContain('data-testid="pattern-child-range"')
  })

  it('도넛은 안쪽 거래 구성 범례만 두고 패턴 범례는 쓰지 않는다', () => {
    const markup = html(<TransactionPatternHierarchy composition={composition} distribution={distribution} view="donut" />)

    expect(markup).toContain('data-testid="composition-legend"')
    expect(markup).not.toContain('data-testid="pattern-legend"')
    expect((markup.match(/data-testid="composition-legend-dot"/g) ?? [])).toHaveLength(3)
    expect(markup).not.toContain('data-testid="donut-label-connector"')
  })
})
