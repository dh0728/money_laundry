import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { memorySnapshot } from '@/lib/memory'
import { loadMockAlertDetail } from '@/mocks/alertDetail'
import { transactionExplorerNormal } from '@/mocks/transactions'
import AlertTxTable from './AlertTxTable'

afterEach(() => window.history.replaceState({}, '', '/'))

describe('Alert 거래 표', () => {
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
