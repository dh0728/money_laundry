import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AgeBadge } from './badges'
import { CaseAgeTag } from './semantic-tags'

describe('경과일 태그', () => {
  it('목록·상세 배지는 오늘부터 3일까지 주의, 4일부터 위험으로 표시한다', () => {
    const cases = [
      { days: 0, label: '오늘', tone: 'caution' },
      { days: 1, label: '1일 경과', tone: 'caution' },
      { days: 2, label: '2일 경과', tone: 'caution' },
      { days: 3, label: '3일 경과', tone: 'caution' },
      { days: 4, label: '4일 경과', tone: 'danger' },
      { days: 14, label: '14일 경과', tone: 'danger' },
    ]
    render(<>{cases.map(({ days }) => <AgeBadge key={days} days={days} />)}</>)
    for (const { label, tone } of cases) expect(screen.getByText(label)).toHaveAttribute('data-tone', tone)
  })

  it('업무 카드는 3일부터 경과일을 표시하며 같은 위험 기준을 쓴다', () => {
    render(<><CaseAgeTag days={2} /><CaseAgeTag days={3} /><CaseAgeTag days={4} /></>)
    expect(screen.queryByText('2일 경과')).toBeNull()
    expect(screen.getByText('3일 경과')).toHaveAttribute('data-tone', 'caution')
    expect(screen.getByText('4일 경과')).toHaveAttribute('data-tone', 'danger')
  })
})
