import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { login, logout } from '@/api/auth'
import { ApiError } from '@/api/common'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'

const user = { id: 42, username: 'staff42', name: '김조사', role: 'STAFF' }

vi.mock('@/lib/apiMode', () => ({ live: true, mockSavedNote: 'mock' }))
vi.mock('@/api/auth', () => ({ restoreSession: () => Promise.resolve(user), login: vi.fn(), logout: vi.fn() }))
vi.mock('@/components/LoginNetwork', () => ({ default: () => null }))

beforeEach(() => { window.location.hash = 'account' })

it('서버 세션을 복원하고 만료되면 로그인 화면으로 돌린다', async () => {
  render(<App />)
  expect(await screen.findByText('staff42')).toBeInTheDocument()
  expect(screen.getAllByText('김조사').length).toBeGreaterThan(0)
  act(() => window.dispatchEvent(new Event('auth-expired')))
  expect(await screen.findByLabelText('아이디')).toBeInTheDocument()
  expect(screen.getByText('로그인 시간이 만료됐습니다. 다시 로그인해 주세요.')).toBeInTheDocument()
})

// Existing live case UI and login flow; all transport below is synthetic.
const { caseRead, caseList, caseMoney, command, demoClock } = vi.hoisted(() => ({ caseRead: vi.fn(), caseList: vi.fn(), caseMoney: vi.fn(), command: vi.fn(), demoClock: vi.fn() }))
vi.mock('@/api/liveReview', () => ({ fetchReviewCase: caseRead, fetchReviewCases: caseList, fetchReviewMoney: caseMoney, submitReviewCommand: command, fetchReviewUsers: async () => [] }))
vi.mock('@/api/liveDashboard', async original => ({ ...await original<typeof import('@/api/liveDashboard')>(), fetchDemoClock: demoClock }))

const openCase = () => ({ caseId: 3, kind: 'ALERT', alertId: 3003, status: 'OPEN', outcome: null, revision: 7, assigneeId: 42, assigneeName: '김조사', createdAt: '', assignedAt: '', closedAt: null, ageDays: 0, pendingCount: 1, episodeId: null, sourceAlertIds: [], primaryTypes: [], summary: { txCount: 1, subjectCount: 1, seedCount: 1, riskScore: 0.9, primaryType: 'FAN_OUT', amountsByCurrency: {}, firstTxAt: null, lastTxAt: null }, groups: [{ groupId: 0, revision: 1, label: '원본', members: [{ txId: 10, reviewRole: 'SUBJECT', state: 'PENDING', decision: null, sources: [], transaction: { occurredAt: '2023-09-03T00:00:00Z', fromAccountId: 'a', toAccountId: 'b', fromBankId: 1, toBankId: 2, amountPaid: 10, amountUsd: 10, paymentCurrency: 'USD', paymentFormat: 'WIRE', role: 'SEED', isSuspicious: true, scores: null } }] }], history: [] })

async function draftBeforeExpiry() {
  vi.mocked(login).mockReset().mockResolvedValue(user as Awaited<ReturnType<typeof login>>)
  vi.mocked(logout).mockReset().mockResolvedValue(undefined)
  caseRead.mockReset().mockResolvedValue(openCase())
  caseList.mockReset().mockResolvedValue({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })
  caseMoney.mockReset().mockResolvedValue({ available: false, reason: 'EMPTY_SUBJECT_SCOPE' })
  command.mockReset()
  demoClock.mockReset().mockResolvedValue({ businessAt: '2023-09-03T09:00:00+09:00', revision: 1 })
  window.location.hash = 'alerts/3'
  render(<App />, { wrapper: NuqsTestingAdapter })
  const review = await screen.findByRole('tab', { name: '검토 의견' })
  fireEvent.mouseDown(review, { button: 0, ctrlKey: false })
  fireEvent.click(review)
  fireEvent.change(await screen.findByLabelText('변경 사유'), { target: { value: '합성 미제출 의견 — 재인증 후 계속' } })
}
async function reauthenticate() {
  fireEvent.change(await screen.findByLabelText('아이디'), { target: { value: 'synthetic-staff' } })
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'synthetic-only' } })
  fireEvent.click(screen.getByRole('button', { name: '로그인' }))
}

it('같은 서버 확인 신원으로 재인증하면 새 사건 조회 후 의견만 복원하고 자동 제출하지 않는다', async () => {
  await draftBeforeExpiry()
  act(() => window.dispatchEvent(new Event('auth-expired')))
  await reauthenticate()
  expect(await screen.findByLabelText('변경 사유')).toHaveValue('합성 미제출 의견 — 재인증 후 계속')
  expect(caseRead).toHaveBeenCalledTimes(2)
  expect(command).not.toHaveBeenCalled()
  expect(window.location.hash).toBe('#alerts/3')
})

it('다른 신원으로 재인증하면 이전 의견을 렌더하지 않는다', async () => {
  await draftBeforeExpiry()
  act(() => window.dispatchEvent(new Event('auth-expired')))
  vi.mocked(login).mockResolvedValueOnce({ ...user, id: 43, username: 'staff43' } as Awaited<ReturnType<typeof login>>)
  await reauthenticate()
  await waitFor(() => expect(window.location.hash).toBe('#dashboard'))
  expect(screen.queryByDisplayValue('합성 미제출 의견 — 재인증 후 계속')).not.toBeInTheDocument()
  window.location.hash = 'alerts/3'
  fireEvent(window, new HashChangeEvent('hashchange'))
  const review = await screen.findByRole('tab', { name: '검토 의견' })
  fireEvent.mouseDown(review, { button: 0, ctrlKey: false })
  fireEvent.click(review)
  expect(await screen.findByLabelText('변경 사유')).toHaveValue('')
  expect(command).not.toHaveBeenCalled()
})

it('재인증 후 사건 조회가 403이면 복원 의견과 이전 사건을 표시하지 않는다', async () => {
  await draftBeforeExpiry()
  act(() => window.dispatchEvent(new Event('auth-expired')))
  caseRead.mockRejectedValueOnce(new ApiError({ type: 'about:blank', title: '조회 권한 없음', status: 403, code: 'FORBIDDEN_ROLE' }))
  await reauthenticate()
  expect(await screen.findByText('조회 권한 없음')).toBeInTheDocument()
  expect(screen.queryByLabelText('변경 사유')).not.toBeInTheDocument()
  expect(screen.queryByTestId('detail-id')).not.toBeInTheDocument()
  expect(command).not.toHaveBeenCalled()
})

it('명시적 로그아웃 후 같은 신원으로 로그인해도 이전 의견을 복원하지 않는다', async () => {
  await draftBeforeExpiry()
  fireEvent.click(screen.getByRole('button', { name: /김조사/ }))
  fireEvent.click(await screen.findByRole('button', { name: '현재 세션 로그아웃' }))
  fireEvent.click(await screen.findByRole('button', { name: '로그아웃' }))
  await reauthenticate()
  await waitFor(() => expect(window.location.hash).toBe('#dashboard'))
  window.location.hash = 'alerts/3'
  fireEvent(window, new HashChangeEvent('hashchange'))
  const review = await screen.findByRole('tab', { name: '검토 의견' })
  fireEvent.mouseDown(review, { button: 0, ctrlKey: false })
  fireEvent.click(review)
  expect(await screen.findByLabelText('변경 사유')).toHaveValue('')
  expect(command).not.toHaveBeenCalled()
})

it('같은 ID라도 역할이 바뀌면 이전 의견을 복원하지 않는다', async () => {
  await draftBeforeExpiry()
  act(() => window.dispatchEvent(new Event('auth-expired')))
  vi.mocked(login).mockResolvedValueOnce({ ...user, role: 'ADMIN' } as Awaited<ReturnType<typeof login>>)
  await reauthenticate()
  await waitFor(() => expect(window.location.hash).toBe('#dashboard'))
  expect(screen.queryByDisplayValue('합성 미제출 의견 — 재인증 후 계속')).not.toBeInTheDocument()
  expect(command).not.toHaveBeenCalled()
})
