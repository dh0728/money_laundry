import { NuqsAdapter } from 'nuqs/adapters/react'
import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { SharedPeriod, WorkspaceProvider } from '@/lib/WorkspaceProvider'
import LiveDashboardPage from './LiveDashboardPage'
import LiveLedgerPage from './LiveLedgerPage'
import LiveCasesPage from './LiveCasesPage'

const { dashboard, owners, accounts, transactions, cases, clock } = vi.hoisted(() => ({
  dashboard: vi.fn(), owners: vi.fn(), accounts: vi.fn(), transactions: vi.fn(), cases: vi.fn(), clock: vi.fn(),
}))
vi.mock('@/api/liveDashboard', async original => ({ ...await original<typeof import('@/api/liveDashboard')>(), fetchDemoClock: clock, fetchLiveDashboard: dashboard }))
vi.mock('@/api/liveLedger', () => ({ fetchLedgerOwners: owners, fetchLedgerAccounts: accounts, fetchLedgerTransactions: transactions, fetchPaymentFormats: async () => ['WIRE'] }))
vi.mock('@/api/liveReview', () => ({ fetchReviewUsers: async () => [], fetchReviewCases: cases, fetchReviewCase: vi.fn(), fetchReviewMoney: vi.fn(), setReviewMoneyScope: vi.fn(), submitReviewCommand: vi.fn() }))
vi.mock('@/features/graph/v24/Graph', () => ({ default: () => null }))
vi.mock('@/components/DateRangeButton', () => ({ DateRangeButton: ({ value, onChange }: { value: { from?: Date; to?: Date }; onChange: (range: { from: Date; to: Date }) => void }) => <button onClick={() => onChange({ from: new Date(2023,8,1), to: new Date(2023,8,10) })}>기간 {value?.from?.toLocaleDateString('sv-SE')}</button> }))
const noop = () => undefined
const page = <T,>(content: T[]) => ({ content, totalElements: content.length, page: 0, size: 20, totalPages: 1 })
function Screens() {
  const [tab, setTab] = useState('dashboard')
  return <><nav>{['dashboard', 'ledger', 'alerts', 'episodes'].map(name => <button key={name} onClick={() => setTab(name)}>{name}</button>)}</nav><SharedPeriod>
    {tab === 'dashboard' ? <LiveDashboardPage onOpen={noop} /> : tab === 'ledger' ? <LiveLedgerPage onOpen={noop} />
      : <LiveCasesPage kind={tab === 'alerts' ? 'ALERT' : 'EPISODE'} onOpen={noop} onBack={noop} />}
  </SharedPeriod></>
}

it('actual live pages share the chosen range and preserve the owner/account and cached dashboard on tab return', async () => {
  clock.mockResolvedValue({ businessAt: '2023-09-10T09:00:00+09:00', revision: 1 })
  dashboard.mockResolvedValue({ businessAt: '2023-09-10T09:00:00+09:00', personal: { pending: 0, aged: 0, closed: 0 },
    institution: { alerts: 0, episodes: 0, aged: 0, today: 0, yesterday: 0 }, openAlertsAgedOver3Days: 0,
    detection: { received: 0, analyzed: 0, suspicious: 0 }, deliveryDate: '', pendingReports: 0,
    daily: [], agreements: [], types: [], activities: [], priority: [],
    episodeWork: { current: { unreviewed: 0 }, firstReview: { average_seconds: null }, completion: { average_seconds: null } } })
  owners.mockResolvedValue(page([{ id: 'owner-one' }]))
  accounts.mockResolvedValue(page([{ id: 'account-one', ownerId: 'owner-one', bankId: 12 }]))
  transactions.mockResolvedValue(page([])); cases.mockResolvedValue(page([]))
  render(<NuqsAdapter><WorkspaceProvider><Screens /></WorkspaceProvider></NuqsAdapter>)
  await screen.findByText('오늘 유입 Alert')
  fireEvent.click(screen.getByRole('button', { name: /기간 2023/ }))
  await waitFor(() => expect(dashboard).toHaveBeenLastCalledWith('2023-09-01', '2023-09-10'))
  fireEvent.click(screen.getByRole('button', { name: 'ledger' }))
  fireEvent.click(await screen.findByRole('button', { name: /owner-one/ }))
  fireEvent.click(await screen.findByRole('button', { name: /account-one/ }))
  await waitFor(() => expect(transactions).toHaveBeenCalled())
  expect(owners).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2023-09-01', to: '2023-09-10' }))
  for (const tab of ['alerts', 'episodes']) {
    fireEvent.click(screen.getByRole('button', { name: tab }))
    await waitFor(() => expect(cases).toHaveBeenCalledWith(expect.objectContaining({ kind: tab === 'alerts' ? 'ALERT' : 'EPISODE', from: '2023-09-01', to: '2023-09-10' })))
  }
  fireEvent.click(screen.getByRole('button', { name: 'ledger' }))
  expect(screen.getByRole('button', { name: /owner-one/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: /account-one/ })).toHaveAttribute('aria-pressed', 'true')
  expect(owners).toHaveBeenCalledTimes(1)
  expect(accounts).toHaveBeenCalledTimes(1)
  expect(transactions).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'dashboard' }))
  expect(screen.getByText('오늘 유입 Alert')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '기간 2023-09-01' })).toBeInTheDocument()
  expect(dashboard).toHaveBeenCalledTimes(2)
  expect(clock).toHaveBeenCalledTimes(1)
})
