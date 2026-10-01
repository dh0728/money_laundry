import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { CaseActivityCharts } from './CaseActivityCharts'

vi.mock('recharts', () => ({
  BarChart: ({ data, children }: { data: unknown; children: ReactNode }) => <div data-testid="bars" data-rows={JSON.stringify(data)}>{children}</div>,
  Bar: ({ dataKey, stackId }: { dataKey: string; stackId?: string }) => <span data-testid="series" data-key={dataKey} data-stack={stackId} />,
  CartesianGrid: () => null, Cell: () => null, XAxis: () => null, YAxis: () => null,
}))
vi.mock('@/components/ui/chart', () => ({
  ChartContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChartTooltip: () => null, ChartTooltipContent: () => null,
}))
const amounts = {
  USD: { daily: [{ day: '09-02', amount: 30 }], senders: [{ name: 'a', v: 30 }] },
  CHF: { daily: [{ day: '09-01', amount: 10 }, { day: '09-02', amount: 20 }], senders: [{ name: 'b', v: 30 }] },
}
it('전체 선택 시 USD 합계 단일 막대를 표시하고 개별 통화로 복귀한다', () => {
  render(<CaseActivityCharts amounts={amounts} dailyUsd={[{ day: '09-01', amount: 11 }, { day: '09-02', amount: 52 }]} />)
  const select = screen.getByRole('combobox', { name: '금액 차트 통화' })
  expect(select).toHaveValue('CHF')
  fireEvent.change(select, { target: { value: '__all__' } })
  expect(JSON.parse(screen.getByTestId('bars').getAttribute('data-rows')!)).toEqual([
    { day: '09-01', amount: 11 },
    { day: '09-02', amount: 52 },
  ])
  expect(screen.getAllByTestId('series')).toHaveLength(1)
  for (const bar of screen.getAllByTestId('series')) expect(bar).not.toHaveAttribute('data-stack')
  expect(screen.getByText('언제 집중됐는지 · 전체 · USD 환산')).toBeInTheDocument()
  fireEvent.change(select, { target: { value: 'USD' } })
  expect(JSON.parse(screen.getByTestId('bars').getAttribute('data-rows')!)).toEqual(amounts.USD.daily)
  expect(screen.getAllByTestId('series')).toHaveLength(1)
})
it('단일 통화와 빈 데이터에서 전체 선택을 노출하지 않는다', () => {
  const { rerender } = render(<CaseActivityCharts amounts={{ USD: amounts.USD }} />)
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  rerender(<CaseActivityCharts amounts={{}} />)
  expect(screen.getByText('일별 금액 집계 없음')).toBeInTheDocument()
})

it('환산액 누락은 부분 합계나 0 막대로 표시하지 않는다', () => {
  render(<CaseActivityCharts amounts={amounts} dailyUsd={null} />)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '__all__' } })
  expect(screen.getByText('USD 환산액 미제공')).toBeInTheDocument()
  expect(screen.queryByTestId('bars')).not.toBeInTheDocument()
})
