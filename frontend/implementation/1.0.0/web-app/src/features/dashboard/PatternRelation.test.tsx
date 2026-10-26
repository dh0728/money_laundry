import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { TransactionPatternHierarchy } from './PatternRelation'

it('거래 건수가 커져도 차트 높이는 고정하고 9개 유형을 겹치지 않게 표시한다', () => {
  const composition = [1, 2, 3, 4].map((value, i) => ({ name: `조합${i}`, value, fill: 'black' }))
  const distribution = Array.from({ length: 9 }, (_, i) => ({ pattern: `유형${i}`, alerts: i + 1, fill: 'black' }))
  const { rerender } = render(<TransactionPatternHierarchy composition={composition} distribution={distribution} linked={false} />)
  const before = screen.getAllByTestId('relation-total-segment').map(node => node.style.height)
  rerender(<TransactionPatternHierarchy composition={composition.map(item => ({ ...item, value: item.value * 25107 }))} distribution={distribution} linked={false} />)
  expect(screen.getByTestId('transaction-pattern-bar')).toHaveStyle({ height: '400px' })
  expect(screen.getAllByTestId('relation-total-segment').map(node => node.style.height)).toEqual(before)
  const rows = screen.getAllByTestId('relation-pattern-row')
  expect(rows).toHaveLength(9)
  rows.slice(1).forEach((row, index) => {
    expect(parseFloat(row.style.top)).toBeGreaterThan(parseFloat(rows[index].style.top) + parseFloat(rows[index].style.height))
  })
  rerender(<TransactionPatternHierarchy composition={[{ ...composition[0], value: 9 }, { ...composition[1], value: 1 }]} distribution={distribution} linked={false} />)
  expect(screen.getByTestId('transaction-pattern-bar')).toHaveStyle({ height: '400px' })
  const segments = screen.getAllByTestId('relation-total-segment')
  expect(parseFloat(segments[0].style.height) / parseFloat(segments[1].style.height)).toBeCloseTo(9)
})
