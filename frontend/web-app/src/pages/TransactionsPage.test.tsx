import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { buildTransactionIndex } from '@/features/transactions/transactionIndex'
import { transactionExplorerNormal } from '@/mocks/transactions'
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
