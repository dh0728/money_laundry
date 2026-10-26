import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import LiveLedgerPage from './LiveLedgerPage'
const { owners, accounts, transactions } = vi.hoisted(() => ({ owners: vi.fn(), accounts: vi.fn(), transactions: vi.fn() }))
vi.mock('@/api/liveLedger', () => ({ fetchLedgerOwners: owners, fetchLedgerAccounts: accounts, fetchLedgerTransactions: transactions, fetchPaymentFormats: async () => [] }))
const page = (content: unknown[]) => ({ content, page: 0, size: 20, totalElements: content.length, totalPages: 1 })
it('소유주 이름을 표시하되 계좌 조회에는 원래 소유주 ID를 전달한다', async () => {
  owners.mockResolvedValue(page([{ id: 'owner-uuid', name: '김민준#00001' }]))
  accounts.mockResolvedValue(page([{ id: 'account-a', ownerId: 'owner-uuid', ownerName: '김민준#00001', bankId: 1 }]))
  transactions.mockResolvedValue(page([]))
  render(<LiveLedgerPage />)
  fireEvent.click(await screen.findByText('김민준#00001'))
  await waitFor(() => expect(accounts).toHaveBeenCalledWith(expect.anything(), 'owner-uuid'))
  expect(await within(screen.getByTestId('account-section')).findByText('account-a')).toBeInTheDocument()
  expect(screen.queryByText('owner-uuid')).not.toBeInTheDocument()
})
