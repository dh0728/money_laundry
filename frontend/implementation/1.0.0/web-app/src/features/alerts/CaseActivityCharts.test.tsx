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
  ChartLegend: () => <div>통화 범례</div>, ChartLegendContent: () => null,
  ChartTooltip: () => null, ChartTooltipContent: () => null,
}))
const amounts = {
  USD: { daily: [{ day: '09-02', amount: 30 }], senders: [{ name: 'a', v: 30 }] },
  CHF: { daily: [{ day: '09-01', amount: 10 }, { day: '09-02', amount: 20 }], senders: [{ name: 'b', v: 30 }] },
}
it('다중 통화는 전체가 기본이며 USD 가치로 누적하고 개별 통화로 전환한다', () => {
  render(<CaseActivityCharts amounts={amounts} dailyUsdByCurrency={{ CHF: [{ day: '09-01', amount: 11 }, { day: '09-02', amount: 22 }], USD: [{ day: '09-02', amount: 30 }] }} />)
  const select = screen.getByRole('combobox', { name: '금액 차트 통화' })
  expect(select).toHaveValue('__all__')
  expect(JSON.parse(screen.getByTestId('bars').getAttribute('data-rows')!)).toEqual([
    { day: '09-01', currency0: 11, currency1: 0 },
    { day: '09-02', currency0: 22, currency1: 30 },
  ])
  expect(screen.getAllByTestId('series')).toHaveLength(2)
  for (const bar of screen.getAllByTestId('series')) expect(bar).toHaveAttribute('data-stack', 'usd')
  expect(screen.getByText('언제 집중됐는지 · 전체 · USD 환산')).toBeInTheDocument()
  fireEvent.change(select, { target: { value: 'USD' } })
  expect(JSON.parse(screen.getByTestId('bars').getAttribute('data-rows')!)).toEqual(amounts.USD.daily)
  expect(screen.getAllByTestId('series')).toHaveLength(1)
  expect(screen.getByTestId('series')).not.toHaveAttribute('data-stack')
  fireEvent.change(select, { target: { value: '__all__' } })
  expect(screen.getAllByTestId('series')).toHaveLength(2)
})
it('단일 통화와 빈 데이터에서 전체 선택을 노출하지 않는다', () => {
  const { rerender } = render(<CaseActivityCharts amounts={{ USD: amounts.USD }} />)
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  rerender(<CaseActivityCharts amounts={{}} />)
  expect(screen.getByText('일별 금액 집계 없음')).toBeInTheDocument()
})

it('환산액 누락은 부분 합계나 0 막대로 표시하지 않는다', () => {
  render(<CaseActivityCharts amounts={amounts} dailyUsdByCurrency={null} />)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '__all__' } })
  expect(screen.getByText('USD 환산액 미제공')).toBeInTheDocument()
  expect(screen.queryByTestId('bars')).not.toBeInTheDocument()
})
