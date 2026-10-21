import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { memorySnapshot } from '@/lib/memory'
import { loadMockAlertDetail } from '@/mocks/alertDetail'
import { transactionExplorerNormal } from '@/mocks/transactions'
import AlertTxTable from './AlertTxTable'

afterEach(() => window.history.replaceState({}, '', '/'))

describe('Alert 거래 표', () => {
  it('live 금액 문자열은 정수·소수 정밀도를 유지한다', async () => {
    const { detail } = await loadMockAlertDetail(3000, 'normal')
    render(<AlertTxTable remote rows={[{ ...detail.transactions[0], amountPaid: '9007199254740993.123456', paymentCurrency: 'USD' }]} />)
    expect(screen.getByText('9,007,199,254,740,993.123456$')).toBeInTheDocument()
  })

  it('기존 mock 금액 표시의 기본 소수 두 자리는 유지한다', async () => {
    const { detail } = await loadMockAlertDetail(3000, 'normal')
    render(<AlertTxTable rows={[{ ...detail.transactions[0], amountPaid: 1.234567, paymentCurrency: 'USD' }]} />)
    expect(screen.getByText('1.23$')).toBeInTheDocument()
  })

  it('live 소수 금액 문자열을 숫자 값 순으로 정렬한다', async () => {
    const { detail } = await loadMockAlertDetail(3000, 'normal')
    render(<AlertTxTable remote rows={['20.11', '100.2', '1.11', '1.2'].map((amountPaid, index) => ({ ...detail.transactions[0], txId: index + 1, amountPaid }))} />)
    const column = screen.getByRole('columnheader', { name: /금액/ })
    fireEvent.click(within(column).getByRole('button'))
    const ids = screen.getAllByRole('row').slice(1).map(row => within(row).getByText(/^T-/).textContent)
    expect(ids).toEqual(column.getAttribute('aria-sort') === 'ascending' ? ['T-3', 'T-4', 'T-1', 'T-2'] : ['T-2', 'T-1', 'T-4', 'T-3'])
  })

  it.each([null, '', ' ', 'bad', 'Infinity'])('live 무효 금액 %s는 0이나 부분 금액으로 표시하지 않는다', async amountPaid => {
    const { detail } = await loadMockAlertDetail(3000, 'normal')
    render(<AlertTxTable remote rows={[{ ...detail.transactions[0], amountPaid }]} />)
    expect(screen.getByText('금액 확인 불가')).toBeInTheDocument()
    expect(screen.queryByText('0$')).not.toBeInTheDocument()
  })

  it('거래 ID를 누르면 거래 내역으로 가고, 그 거래가 거래 내역 mock에도 있다', async () => {
    const { detail } = await loadMockAlertDetail(3000, 'normal')
    render(<AlertTxTable rows={detail.transactions} />)
    const first = detail.transactions[0]
    fireEvent.click(screen.getByRole('button', { name: `${first.txId} 거래 거래 내역에서 보기` }))
    expect(window.location.hash).toBe('#transactions')
    expect(memorySnapshot('transactions:target', null)).toEqual({ type: 'transaction', transactionId: String(first.txId) })
    expect(transactionExplorerNormal.transactions.some(t => t.txId === first.txId)).toBe(true)
  })

  it('점수는 위험도 태그, 편입 역할은 태그로 보인다', async () => {
    const { detail } = await loadMockAlertDetail(3000, 'normal')
    render(<AlertTxTable rows={detail.transactions} />)
    const row = screen.getAllByRole('row')[1]
    expect(within(row).getByTitle(/모델 위험 점수/)).toBeInTheDocument()
    expect(within(row).getByText('시작 거래')).toHaveAttribute('data-slot', 'badge')
  })
})
