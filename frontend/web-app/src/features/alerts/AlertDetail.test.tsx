import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { writeMemory } from '@/lib/memory'
import { loadMockAlertDetail } from '@/mocks/alertDetail'
import AlertDetail from './AlertDetail'

describe('Alert 개요의 패턴 후보', () => {
  it('선택한 거래의 mock 점수를 높은 순서로 보이고 다른 거래를 선택하면 갱신한다', async () => {
    const { detail, graph, history } = await loadMockAlertDetail(3000, 'normal')
    writeMemory(`alert:${detail.alertId}:tab`, 'overview')
    const { rerender } = render(<AlertDetail alert={detail} graph={graph} relabels={{}} onRelabel={() => {}}
      history={history} responsible episodes={[]} onOpenEpisode={() => {}} onSubmit={() => {}} />)

    expect(screen.getByText('선택 거래의 모델 점수이며 Alert 전체 확률이 아닙니다.')).toBeInTheDocument()
    const candidates = within(screen.getByRole('list', { name: '거래 패턴 후보' }))
    expect(screen.getByTestId('grouping')).not.toContainElement(candidates.getAllByRole('listitem')[0])
    expect(screen.getByTestId('pattern-candidates')).toContainElement(candidates.getAllByRole('listitem')[0])
    expect(candidates.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      '1.NON_PATTERN60.0%', '2.SCATTER-GATHER28.0%', '3.RANDOM12.0%',
    ])
    expect(candidates.getAllByText(/NON_PATTERN|SCATTER-GATHER|RANDOM/).every(badge => badge.classList.contains('semantic-pattern-badge'))).toBe(true)

    fireEvent.change(screen.getByRole('combobox', { name: '확률을 볼 거래' }), { target: { value: detail.transactions[1].txId } })
    expect(candidates.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      '1.NON_PATTERN70.0%', '2.SCATTER-GATHER21.0%', '3.RANDOM9.0%',
    ])

    rerender(<AlertDetail alert={{ ...detail, transactions: detail.transactions.map(row => ({ ...row, typeProbabilities: undefined })) }}
      graph={graph} relabels={{}} onRelabel={() => {}} history={history} responsible episodes={[]}
      onOpenEpisode={() => {}} onSubmit={() => {}} />)
    expect(screen.getByTestId('pattern-candidates')).toHaveTextContent('표시할 거래별 패턴 후보가 없습니다.')
    expect(screen.queryByRole('list', { name: '거래 패턴 후보' })).not.toBeInTheDocument()
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
  const row = screen.getByRole('row', { name: new RegExp(String(detail.transactions[0].txId)) })
  fireEvent.click(within(row).getByText('09-23 09:00'))
  expect(screen.getByRole('checkbox', { name: `거래 T-${detail.transactions[0].txId} 선택` })).toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: `거래 T-${detail.transactions[0].txId} 선택` }))
  expect(screen.getByRole('checkbox', { name: `거래 T-${detail.transactions[0].txId} 선택` })).not.toBeChecked()
  fireEvent.click(within(row).getByText('09-23 09:00'))
  fireEvent.change(screen.getByRole('textbox', { name: '거래 제외 사유' }), { target: { value: '관련 없는 거래' } })
  fireEvent.click(screen.getByRole('button', { name: '선택 거래 제외' }))
  expect(exclude).toHaveBeenCalledWith([detail.transactions[0].txId], '관련 없는 거래')
})
