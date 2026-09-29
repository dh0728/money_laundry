import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import LiveDashboardPage from './LiveDashboardPage'
import LiveLedgerPage from './LiveLedgerPage'

const { fetchDemoClock, fetchLiveDashboard, fetchLedgerOwners, fetchLedgerAccounts, fetchLedgerTransactions, fetchPaymentFormats } = vi.hoisted(() => ({
  fetchDemoClock: vi.fn(), fetchLiveDashboard: vi.fn(), fetchLedgerOwners: vi.fn(), fetchLedgerAccounts: vi.fn(), fetchLedgerTransactions: vi.fn(), fetchPaymentFormats: vi.fn(),
}))
vi.mock('@/api/liveDashboard', async importOriginal => ({ ...await importOriginal<typeof import('@/api/liveDashboard')>(), fetchDemoClock, fetchLiveDashboard }))
vi.mock('@/api/liveLedger', () => ({ fetchLedgerOwners, fetchLedgerAccounts, fetchLedgerTransactions, fetchPaymentFormats }))

const page = <T,>(content: T[]) => ({ content, page: 0, size: 20, totalElements: content.length, totalPages: content.length ? 1 : 0 })

beforeEach(() => { vi.clearAllMocks() })

it('실제 대시보드는 PC 날짜 대신 서버 업무 날짜로 기간을 정한다', async () => {
  fetchDemoClock.mockResolvedValue({ businessAt: '2023-09-10T00:00:00Z', configured: true, revision: 1 })
  fetchLiveDashboard.mockResolvedValue({
    businessAt: '2023-09-10T00:00:00Z', personal: { pending: 2, aged: 1, closed: 3 }, institution: { alerts: 4, episodes: 1, aged: 2, today: 1, yesterday: 0 },
    detection: { received: 10, analyzed: 8, suspicious: 2 }, pendingReports: 0, daily: [], agreements: [], types: [], priority: [], episodeWork: { current: { open: 1, aged: 0, unreviewed: 1, created_today: 0, closed_today: 0 }, firstReview: { samples: 0, average_seconds: null }, completion: { samples: 0, average_seconds: null }, oldestOpen: [] },
  })
  render(<LiveDashboardPage onOpen={vi.fn()} />)
  expect(await screen.findByText('내 미처리')).toBeInTheDocument()
  expect(fetchLiveDashboard).toHaveBeenCalledWith('2023-08-12', '2023-09-10')
})

it('실제 거래에서 미분석을 정상으로 바꾸지 않고 원본 Alert와 Episode ID를 구별한다', async () => {
  fetchLedgerOwners.mockResolvedValue(page([{ id: 'owner-uuid' }]))
  fetchPaymentFormats.mockResolvedValue(['WIRE'])
  fetchLedgerAccounts.mockResolvedValue(page([{ id: 'account-uuid', ownerId: 'owner-uuid', bankId: 13 }]))
  fetchLedgerTransactions.mockResolvedValue(page([{ txId: 101, occurredAt: '2023-09-10T00:00:00Z', fromAccountId: 'account-uuid', toAccountId: 'other-uuid', amountPaid: 100, paymentCurrency: 'USD', paymentFormat: 'WIRE', judgement: 'UNANALYZED', isSuspicious: null, alertIds: [3000], episodeIds: [800] }]))
  const onOpen = vi.fn()
  render(<LiveLedgerPage onOpen={onOpen} />)
  fireEvent.click(await screen.findByRole('button', { name: /소유주 owner-uuid/ }))
  fireEvent.click(await screen.findByRole('button', { name: /계좌 account-uuid/ }))
  expect(await screen.findByText('미분석')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'A-3000' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'E-800' }))
  expect(onOpen).toHaveBeenCalledWith('EPISODE', 800)
})
