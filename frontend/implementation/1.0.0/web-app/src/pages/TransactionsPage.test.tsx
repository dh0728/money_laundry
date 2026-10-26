import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { buildTransactionIndex } from '@/features/transactions/transactionIndex'
import { transactionExplorerNormal } from '@/mocks/transactions'
import { writeMemory } from '@/lib/memory'
import TransactionsPage from './TransactionsPage'

const useScenario = (scenario: string) => window.history.replaceState({}, '', scenario ? `/?mock=${scenario}` : '/')
afterEach(() => useScenario(''))

describe('거래 내역', () => {
  it('소유주를 고르면 그 소유주의 계좌와 거래가 이어서 나온다', async () => {
    render(<TransactionsPage />)
    const owners = await screen.findByTestId('owner-section')
    fireEvent.click(within(owners).getAllByRole('button')[0])
    const accounts = screen.getByTestId('account-section')
    expect(within(accounts).getAllByTestId('account-item').length).toBeGreaterThan(0)
    expect(within(screen.getByTestId('transaction-section')).getAllByRole('button').length).toBeGreaterThan(0)
  })

  it('거래 배지는 선택 상태에 맞춰 반전되고 상세 금액에 송금 방향이 보인다', async () => {
    render(<TransactionsPage />)
    const owners = await screen.findByTestId('owner-section')
    fireEvent.click(within(owners).getAllByRole('button')[0])
    const transaction = within(screen.getByTestId('transaction-section')).getAllByTestId('transaction-item')[0]
    expect(within(transaction).getByText(/송금|수취/)).toHaveClass('bg-foreground', '!border-transparent', '!text-background')
    fireEvent.click(transaction)
    expect(transaction).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('transaction-flow-direction')).toBeInTheDocument()
  })

  it('선택 거래의 연결 Alert를 누르면 해당 Alert 상세 주소로 이동한다', async () => {
    const transaction = transactionExplorerNormal.transactions.find(item => item.alertIds.includes(3000))!
    writeMemory('transactions:target', { type: 'transaction', transactionId: String(transaction.txId) })
    render(<TransactionsPage />)
    const link = await screen.findByRole('link', { name: 'Alert · A-3000' })
    fireEvent.click(link)
    await waitFor(() => expect(window.location.hash).toBe('#alerts/3000'))
  })

  it('빈 결과와 오류를 보여 준다', async () => {
    useScenario('empty')
    const { unmount } = render(<TransactionsPage />)
    expect(await screen.findByText('조회된 거래가 없습니다.')).toBeInTheDocument()
    unmount()
    useScenario('error')
    render(<TransactionsPage />)
    expect(await screen.findByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })
})

describe('거래 색인', () => {
  it('모든 거래의 양쪽 계좌가 소유주에 연결된다', () => {
    const index = buildTransactionIndex(transactionExplorerNormal)
    expect(index.transactions.every(tx => tx.fromOwner !== '소유주 미상' && tx.toOwner !== '소유주 미상')).toBe(true)
    expect(index.owners.reduce((n, owner) => n + owner.accountIds.length, 0)).toBe(index.accounts.length)
  })
})
