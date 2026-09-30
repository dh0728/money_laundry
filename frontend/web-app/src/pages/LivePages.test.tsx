import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import LiveDashboardPage from './LiveDashboardPage'
import LiveLedgerPage from './LiveLedgerPage'

const { fetchDemoClock, fetchLiveDashboard, fetchLedgerOwners, fetchLedgerAccounts, fetchLedgerTransactions, fetchPaymentFormats } = vi.hoisted(() => ({
  fetchDemoClock: vi.fn(), fetchLiveDashboard: vi.fn(), fetchLedgerOwners: vi.fn(), fetchLedgerAccounts: vi.fn(), fetchLedgerTransactions: vi.fn(), fetchPaymentFormats: vi.fn(),
}))
vi.mock('@/api/liveDashboard', async importOriginal => ({ ...await importOriginal<typeof import('@/api/liveDashboard')>(), fetchDemoClock, fetchLiveDashboard }))
vi.mock('@/api/liveReview', () => ({ fetchReviewCases: async () => ({ content: [], totalElements: 0, totalPages: 0 }) }))
vi.mock('@/api/liveLedger', () => ({ fetchLedgerOwners, fetchLedgerAccounts, fetchLedgerTransactions, fetchPaymentFormats }))

const page = <T,>(content: T[]) => ({ content, page: 0, size: 20, totalElements: content.length, totalPages: content.length ? 1 : 0 })

beforeEach(() => { vi.clearAllMocks() })

it('실제 대시보드는 PC 날짜 대신 서버 업무 날짜로 기간을 정한다', async () => {
  fetchDemoClock.mockResolvedValue({ businessAt: '2023-09-10T00:00:00Z', configured: true, revision: 1 })
  fetchLiveDashboard.mockResolvedValue({
    businessAt: '2023-09-10T00:00:00Z', personal: { pending: 2, aged: 1, closed: 3 }, institution: { alerts: 4, episodes: 1, aged: 2, today: 1, yesterday: 0 },
    detection: { received: 10, analyzed: 8, suspicious: 2 }, deliveryDate: '', pendingReports: 2, daily: [], agreements: [], types: [], activities: [], priority: [], episodeWork: { current: { open: 1, aged: 0, unreviewed: 1, created_today: 0, closed_today: 0 }, firstReview: { samples: 0, average_seconds: null }, completion: { samples: 0, average_seconds: null }, oldestOpen: [] },
  })
  render(<LiveDashboardPage onOpen={vi.fn()} />)
  expect(await screen.findByText('오늘 유입 Alert')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: '기관 전체' })).toHaveAttribute('aria-selected', 'true')
  expect(fetchLiveDashboard).toHaveBeenCalledWith('2023-08-12', '2023-09-10')
  expect(screen.getByText('대상 거래일 미제공')).toBeInTheDocument()
  expect(screen.getByText('전일 대비')).toBeInTheDocument()
  expect(screen.getByText('모델 조합 데이터가 없습니다.')).toBeInTheDocument()
  const report = within(screen.getByTestId('ai-daily-report'))
  expect(report.getByRole('heading', { name: 'RDR 9000 Daily Report' })).toBeInTheDocument()
  expect(report.getByTestId('rdr-eye')).toBeInTheDocument()
  expect(report.getByTitle('규칙 기반 시연 문장. LLM 미연동.')).toBeInTheDocument()
  expect(screen.getByTestId('institution-recent')).toBeInTheDocument()
  expect(report.getByText(/미완료 보고 2건/)).toBeInTheDocument()
  expect(screen.queryByText('내 우선 검토 사건')).not.toBeInTheDocument()
})

it('서버 집계를 mock의 기관·개인 화면 배치에 공급한다', async () => {
  fetchDemoClock.mockResolvedValue({ businessAt: '2023-09-10T00:00:00Z', configured: true, revision: 1 })
  fetchLiveDashboard.mockResolvedValue({
    businessAt: '2023-09-10T00:00:00Z', personal: { pending: 2, aged: 1, closed: 3 }, institution: { alerts: 4, episodes: 1, aged: 2, today: 6, yesterday: 4 },
    detection: { received: 100, analyzed: 80, suspicious: 20 }, deliveryDate: '2023-09-09', pendingReports: 0, daily: [], dailyAlertStatus: [{ date: '2023-09-09', pending: 3, inProgress: 2, done: 1 }],
    agreements: [{ agreement: 'STRONG', count: 30 }, { agreement: 'ATYPICAL', count: 10 }, { agreement: 'PATTERN_ONLY', count: 20 }, { agreement: 'WEAK', count: 20 }],
    types: [{ type: 1, count: 12 }], activities: [{ event_id: 9, case_id: 42, action: 'COMMENT', comment: '검토 메모', business_at: '2023-09-10T01:00:00Z' }],
    priority: [], episodeWork: { current: { open: 1, aged: 0, unreviewed: 1, created_today: 0, closed_today: 0 }, firstReview: { samples: 0, average_seconds: null }, completion: { samples: 0, average_seconds: null }, oldestOpen: [] },
  })
  render(<LiveDashboardPage onOpen={vi.fn()} />)
  expect(await screen.findByText('오늘 유입 Alert')).toBeInTheDocument()
  expect(screen.getByText('+50%')).toBeInTheDocument()
  const statusChart = within(screen.getByTestId('alert-flow-chart'))
  expect(statusChart.queryByText('FE 제안')).not.toBeInTheDocument()
  expect(statusChart.queryByText(/API 미연결/)).not.toBeInTheDocument()
  const statusRow = within(statusChart.getByRole('row', { name: '2023-09-09 3 2 1 6' }))
  expect(statusRow.getAllByRole('cell')).toHaveLength(4)
  expect(screen.getByText('대상 거래일 2023-09-09')).toBeInTheDocument()
  expect(screen.getByText('모델 의심 · 패턴 있음')).toBeInTheDocument()
  expect(screen.getByText('30건')).toBeInTheDocument()
  expect(screen.getByText('FAN-OUT')).toBeInTheDocument()
  const report = within(screen.getByTestId('ai-daily-report'))
  expect(report.getByText(/신규 Alert 6건 · 전일 4건 · 50.0% 증가/)).toBeInTheDocument()
  expect(report.getByText(/오늘 수신 거래 100건/)).toBeInTheDocument()
  fireEvent.mouseDown(screen.getByRole('tab', { name: '내 담당' }), { button: 0, ctrlKey: false })
  expect(screen.getByTestId('personal-top')).toBeInTheDocument()
  expect(screen.getByTestId('personal-ai-summary')).toBeInTheDocument()
  expect(screen.getByTestId('work-queue')).toBeInTheDocument()
})

it('실제 거래에서 미분석을 정상으로 바꾸지 않고 원본 Alert와 Episode ID를 구별한다', async () => {
  fetchLedgerOwners.mockResolvedValue(page([{ id: 'owner-uuid' }]))
  fetchPaymentFormats.mockResolvedValue(['WIRE'])
  fetchLedgerAccounts.mockResolvedValue(page([{ id: 'account-uuid', ownerId: 'owner-uuid', bankId: 13 }]))
  fetchLedgerTransactions.mockResolvedValue(page([{ txId: 101, occurredAt: '2023-09-10T00:00:00Z', fromAccountId: 'account-uuid', toAccountId: 'other-uuid', amountPaid: 100, paymentCurrency: 'USD', paymentFormat: 'WIRE', judgement: 'UNANALYZED', isSuspicious: null, alertIds: [3000], episodeIds: [800] }]))
  const onOpen = vi.fn()
  render(<LiveLedgerPage onOpen={onOpen} />)
  fireEvent.click(await screen.findByRole('button', { name: /owner-uuid/ }))
  fireEvent.click(await screen.findByRole('button', { name: /account-uuid/ }))
  fireEvent.click(await screen.findByRole('button', { name: /101/ }))
  expect(await screen.findAllByText('미분석')).not.toHaveLength(0)
  expect(screen.getByText('Alert · A-3000')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Episode · E-800' })).toHaveAttribute('href', '#episodes/800')
  expect(screen.queryByRole('link', { name: /A-3000/ })).not.toBeInTheDocument()
})
