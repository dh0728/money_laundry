import { fireEvent, render, screen, within } from '@testing-library/react'
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
    detection: { received: 10, analyzed: 8, suspicious: 2 }, deliveryDate: '', pendingReports: 2, daily: [], agreements: [], types: [], activities: [], priority: [], episodeWork: { current: { open: 1, aged: 0, unreviewed: 1, created_today: 0, closed_today: 0 }, firstReview: { samples: 0, average_seconds: null }, completion: { samples: 0, average_seconds: null }, oldestOpen: [] },
  })
  render(<LiveDashboardPage onOpen={vi.fn()} />)
  expect(await screen.findByText('열린 Alert')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '기관 전체' })).toHaveAttribute('data-variant', 'default')
  expect(fetchLiveDashboard).toHaveBeenCalledWith('2023-08-12', '2023-09-10')
  expect(screen.getByText('대상 거래일 미제공')).toBeInTheDocument()
  expect(screen.getByText('전일 대비 —')).toBeInTheDocument()
  expect(screen.getByText('모델 조합 데이터가 없습니다.')).toBeInTheDocument()
  const report = within(screen.getByTestId('ai-daily-report'))
  expect(report.getByText('mock · LLM 미연동')).toBeInTheDocument()
  expect(report.getByText('수치는 서버 집계, 문장은 규칙형 시연입니다. AI 분석 결과나 세탁 확정 판정이 아닙니다.')).toBeInTheDocument()
  expect(report.getByText('미완료 보고 2건으로 오늘 탐지율 확정 전입니다.')).toBeInTheDocument()
  expect(report.getByText('우선 검토 사건이 없습니다.')).toBeInTheDocument()
})

it('서버의 전일 수치와 탐지 조합·유형·개인 활동을 그대로 표시한다', async () => {
  fetchDemoClock.mockResolvedValue({ businessAt: '2023-09-10T00:00:00Z', configured: true, revision: 1 })
  fetchLiveDashboard.mockResolvedValue({
    businessAt: '2023-09-10T00:00:00Z', personal: { pending: 2, aged: 1, closed: 3 }, institution: { alerts: 4, episodes: 1, aged: 2, today: 6, yesterday: 4 },
    detection: { received: 100, analyzed: 80, suspicious: 20 }, deliveryDate: '2023-09-09', pendingReports: 0, daily: [],
    agreements: [{ agreement: 'STRONG', count: 30 }, { agreement: 'ATYPICAL', count: 10 }, { agreement: 'PATTERN_ONLY', count: 20 }, { agreement: 'WEAK', count: 20 }],
    types: [{ type: 1, count: 12 }], activities: [{ event_id: 9, case_id: 42, action: 'COMMENT', comment: '검토 메모', business_at: '2023-09-10T01:00:00Z' }],
    priority: [], episodeWork: { current: { open: 1, aged: 0, unreviewed: 1, created_today: 0, closed_today: 0 }, firstReview: { samples: 0, average_seconds: null }, completion: { samples: 0, average_seconds: null }, oldestOpen: [] },
  })
  render(<LiveDashboardPage onOpen={vi.fn()} />)
  expect(await screen.findByText('전일 대비 +50.0%')).toBeInTheDocument()
  expect(screen.getByText('대상 거래일 2023-09-09')).toBeInTheDocument()
  expect(screen.getByText('모델 의심 · 패턴 있음')).toBeInTheDocument()
  expect(screen.getByText('30건 · 37.5%')).toBeInTheDocument()
  expect(screen.getByText('분산 송금')).toBeInTheDocument()
  const report = within(screen.getByTestId('ai-daily-report'))
  expect(report.getByText('오늘 신규 Alert 6건 · 전일 4건 · 50.0% 증가')).toBeInTheDocument()
  expect(report.getByText('오늘 대상 원장 100건 중 모델 의심 20건입니다.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '내 담당' }))
  expect(screen.getByText('검토 메모')).toBeInTheDocument()
  expect(screen.getByText(/조사 사건 42/)).toBeInTheDocument()
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
