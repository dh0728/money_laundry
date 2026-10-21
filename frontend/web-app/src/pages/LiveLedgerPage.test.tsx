import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import LiveLedgerPage from './LiveLedgerPage'
import { toast } from 'sonner'
const { owners, accounts, transactions } = vi.hoisted(() => ({ owners: vi.fn(), accounts: vi.fn(), transactions: vi.fn() }))
const { reviewCases } = vi.hoisted(() => ({ reviewCases: vi.fn() }))
vi.mock('@/api/liveLedger', () => ({ fetchLedgerOwners: owners, fetchLedgerAccounts: accounts, fetchLedgerTransactions: transactions, fetchPaymentFormats: async () => [] }))
vi.mock('@/api/liveReview', () => ({ fetchReviewCases: reviewCases }))
const page = (content: unknown[]) => ({ content, page: 0, size: 20, totalElements: content.length, totalPages: 1 })
it('선택 전에도 전체 조건의 계좌와 거래를 조회하고 화면에 표시한다', async () => {
  owners.mockResolvedValue(page([{ id: 'owner-uuid', name: '김민준#00001' }]))
  accounts.mockResolvedValue(page([{ id: 'account-a', ownerId: 'owner-uuid', ownerName: '김민준#00001', bankId: 1 }]))
  transactions.mockResolvedValue(page([{
    txId: 11, occurredAt: '2023-09-10T00:00:00Z', amountUsd: 8, amountPaid: 10,
    paymentCurrency: 'USD', paymentFormat: 'WIRE', isSuspicious: true,
    fromAccountId: 'account-a', toAccountId: 'account-b',
    fromOwnerName: '김민준#00001', toOwnerName: '상대', alertIds: [], episodeIds: [],
  }]))
  render(<LiveLedgerPage />)
  await waitFor(() => expect(accounts).toHaveBeenCalledWith(expect.anything(), undefined))
  await waitFor(() => expect(transactions).toHaveBeenCalledWith(expect.anything(), undefined, undefined))
  expect(await within(screen.getByTestId('account-section')).findByText('account-a')).toBeInTheDocument()
  expect(await within(screen.getByTestId('transaction-section')).findByText('11')).toBeInTheDocument()
  expect(screen.getByTestId('transaction-section')).toHaveTextContent('조건에 맞는 전체 거래')
})
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
it('거래에 연결된 Alert를 정확한 caseId로 연다', async () => {
  owners.mockResolvedValue(page([]))
  accounts.mockResolvedValue(page([]))
  transactions.mockResolvedValue(page([{
    txId: 11, occurredAt: '2023-09-10T00:00:00Z', amountUsd: 8, amountPaid: 10,
    paymentCurrency: 'USD', paymentFormat: 'WIRE', isSuspicious: true,
    fromAccountId: 'account-a', toAccountId: 'account-b',
    fromOwnerName: '김민준#00001', toOwnerName: '상대', alertIds: [3001], episodeIds: [],
  }]))
  reviewCases.mockResolvedValue(page([{ alertId: 3001, caseId: 1 }]))
  const onOpen = vi.fn()
  render(<LiveLedgerPage onOpen={onOpen} />)
  fireEvent.click(await within(screen.getByTestId('transaction-section')).findByText('11'))
  fireEvent.click(screen.getByRole('link', { name: 'Alert · A-3001' }))
  await waitFor(() => expect(reviewCases).toHaveBeenCalledWith({ kind: 'ALERT', query: 'A-3001', page: 0, size: 100 }))
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith('ALERT', 1))
})
it('연결된 Alert가 조회되지 않으면 이동하지 않고 오류를 알린다', async () => {
  owners.mockResolvedValue(page([]))
  accounts.mockResolvedValue(page([]))
  transactions.mockResolvedValue(page([{
    txId: 11, occurredAt: '2023-09-10T00:00:00Z', amountUsd: 8, amountPaid: 10,
    paymentCurrency: 'USD', paymentFormat: 'WIRE', isSuspicious: true,
    fromAccountId: 'account-a', toAccountId: 'account-b',
    fromOwnerName: '김민준#00001', toOwnerName: '상대', alertIds: [3001], episodeIds: [],
  }]))
  reviewCases.mockResolvedValue(page([]))
  const error = vi.spyOn(toast, 'error').mockImplementation(() => '')
  const onOpen = vi.fn()
  render(<LiveLedgerPage onOpen={onOpen} />)
  fireEvent.click(await within(screen.getByTestId('transaction-section')).findByText('11'))
  fireEvent.click(screen.getByRole('link', { name: 'Alert · A-3001' }))
  await waitFor(() => expect(error).toHaveBeenCalledWith('연결된 Alert를 찾을 수 없습니다.'))
  expect(onOpen).not.toHaveBeenCalled()
  error.mockRestore()
})
it('조회 결과가 없으면 각 단계에 빈 결과를 표시한다', async () => {
  owners.mockResolvedValue(page([]))
  accounts.mockResolvedValue(page([]))
  transactions.mockResolvedValue(page([]))
  render(<LiveLedgerPage />)
  expect(await screen.findByText('조건에 맞는 소유주가 없습니다.')).toBeInTheDocument()
  expect(screen.getByText('조건에 맞는 계좌가 없습니다.')).toBeInTheDocument()
  expect(screen.getByText('조건에 맞는 거래가 없습니다.')).toBeInTheDocument()
})
it('거래 조회 실패는 거래 단계에서 재시도할 수 있다', async () => {
  transactions.mockClear()
  owners.mockResolvedValue(page([]))
  accounts.mockResolvedValue(page([]))
  transactions.mockRejectedValueOnce(new Error('거래 조회 실패')).mockResolvedValue(page([]))
  render(<LiveLedgerPage />)
  const section = screen.getByTestId('transaction-section')
  expect(await within(section).findByText('데이터를 불러오지 못했습니다')).toBeInTheDocument()
  fireEvent.click(within(section).getByRole('button', { name: '다시 시도' }))
  expect(await within(section).findByText('조건에 맞는 거래가 없습니다.')).toBeInTheDocument()
  expect(transactions).toHaveBeenCalledTimes(2)
})
