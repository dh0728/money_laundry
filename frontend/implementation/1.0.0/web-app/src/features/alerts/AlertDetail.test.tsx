import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { writeMemory } from '@/lib/memory'
import { loadMockAlertDetail } from '@/mocks/alertDetail'
import AlertDetail from './AlertDetail'

describe('기존 Alert 개요의 근거와 출처', () => {
  it('씨앗 거래별 점수와 mock 출처를 표시하고 룰 미연동을 미적중으로 바꾸지 않는다', async () => {
    const { detail, graph, history } = await loadMockAlertDetail(3000, 'normal')
    writeMemory(`alert:${detail.alertId}:tab`, 'overview')
    const { rerender } = render(<AlertDetail alert={detail} graph={graph} relabels={{}} onRelabel={() => {}}
      history={history} responsible episodes={[]} onOpenEpisode={() => {}} onSubmit={() => {}} />)
    // The per-transaction candidate selector was replaced by the current seven-question overview.
    const why = screen.getByText('왜 Alert가 됐나').closest('[data-slot="card"]') as HTMLElement
    const table = within(why).getByRole('table')
    const seeds = detail.transactions.filter(row => row.role === 'SEED').slice(0, 4)
    expect(within(table).getAllByRole('row')).toHaveLength(seeds.length + 1)
    for (const seed of seeds) {
      expect(within(table).getByRole('row', { name: new RegExp(`T-${seed.txId} `) })).toHaveTextContent(seed.launderingScore.toFixed(2))
    }
    expect(screen.getByText('시연용 임의 점수')).toBeInTheDocument()
    expect(screen.getByText('demo-random-v1')).toBeInTheDocument()
    expect(within(why).getByText(/룰 엔진이 아직 연결되지 않아/)).toHaveTextContent('"걸린 룰 없음"과 다릅니다.')
    const changed = { ...detail, transactions: detail.transactions.map(row => row.txId === seeds[0].txId ? { ...row, launderingScore: 0.27 } : row) }
    rerender(<AlertDetail alert={changed} graph={graph} relabels={{}} onRelabel={() => {}} history={history}
      responsible episodes={[]} onOpenEpisode={() => {}} onSubmit={() => {}} />)
    expect(within(table).getByRole('row', { name: new RegExp(`T-${seeds[0].txId} `) })).toHaveTextContent('0.27')
  })
})

it('거래 탭에서 거래를 골라 사유와 함께 제외 요청한다', async () => {
  const { detail, graph, history } = await loadMockAlertDetail(3000, 'normal')
  writeMemory(`alert:${detail.alertId}:tab`, 'transactions')
  const exclude = vi.fn()
  render(<AlertDetail alert={detail} graph={graph} relabels={{}} onRelabel={() => {}}
    history={history} responsible episodes={[]} onOpenEpisode={() => {}} onSubmit={() => {}}
    onExcludeTransactions={exclude} />)

  fireEvent.click(screen.getByRole('button', { name: '거래 선택' }))
  const cancel = screen.getByRole('button', { name: '선택 취소' })
  const excludeButton = screen.getByRole('button', { name: '선택 거래 제외' })
  expect(cancel.nextElementSibling).toBe(excludeButton)
  expect(screen.getByRole('textbox', { name: '거래 제외 사유' }).closest('label')?.parentElement).not.toContainElement(excludeButton)
  const row = screen.getByRole('row', { name: new RegExp(String(detail.transactions[0].txId)) })
  fireEvent.click(within(row).getByText('09-23 09:00'))
  expect(screen.getByRole('checkbox', { name: `거래 T-${detail.transactions[0].txId} 선택` })).toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: `거래 T-${detail.transactions[0].txId} 선택` }))
  expect(screen.getByRole('checkbox', { name: `거래 T-${detail.transactions[0].txId} 선택` })).not.toBeChecked()
  fireEvent.click(within(row).getByText('09-23 09:00'))
  fireEvent.change(screen.getByRole('textbox', { name: '거래 제외 사유' }), { target: { value: '관련 없는 거래' } })
  fireEvent.click(screen.getByRole('button', { name: '선택 거래 제외' }))
  expect(exclude).not.toHaveBeenCalled()
  expect(screen.getByRole('alertdialog')).toHaveTextContent('선택 거래를 제외할까요?')
  fireEvent.click(screen.getByRole('button', { name: '돌아가기' }))
  expect(screen.getByRole('textbox', { name: '거래 제외 사유' })).toHaveValue('관련 없는 거래')
  expect(screen.getByRole('checkbox', { name: `거래 T-${detail.transactions[0].txId} 선택` })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: '선택 거래 제외' }))
  fireEvent.click(screen.getByRole('button', { name: '거래 제외 확인' }))
  expect(exclude).toHaveBeenCalledWith([detail.transactions[0].txId], '관련 없는 거래')
})
