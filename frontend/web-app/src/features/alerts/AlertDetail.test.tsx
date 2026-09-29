import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
