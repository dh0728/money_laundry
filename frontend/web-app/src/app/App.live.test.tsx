import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { login } from '@/api/auth'
import { ApiError } from '@/api/common'
import { clearWorkspaceViews, useViewState } from '@/lib/workspaceState'

const user = { id: 42, username: 'staff42', name: '김조사', role: 'STAFF' }

vi.mock('@/lib/apiMode', () => ({ live: true, fixture: false, mockSavedNote: 'mock' }))
vi.mock('@/api/auth', () => ({ restoreSession: () => Promise.resolve(user), login: vi.fn(), logout: vi.fn() }))
vi.mock('@/components/LoginNetwork', () => ({ default: () => null }))
vi.mock('@/api/liveDashboard', async original => ({ ...await original<typeof import('@/api/liveDashboard')>(), fetchDemoClock: async () => ({ businessAt: '2023-09-10T09:00:00+09:00', revision: 1 }) }))
const readFail = vi.hoisted(() => ({ next: null as unknown }))
vi.mock('@/api/liveReview', () => ({
  fetchReviewUsers: async () => [],
  fetchReviewCases: async () => ({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }),
  fetchReviewCase: async () => {
    if (readFail.next) { const error = readFail.next; readFail.next = null; throw error }
    return {
    caseId: 1, kind: 'ALERT', alertId: 1, status: 'OPEN', outcome: null, assigneeId: 42, assigneeName: '김조사', revision: 1,
    createdAt: '', assignedAt: '', closedAt: null, ageDays: 0, pendingCount: 1, episodeId: null, sourceAlertIds: [], primaryTypes: [],
    summary: { txCount: 1, subjectCount: 1, seedCount: 1, riskScore: 0.8, primaryType: 'Fan-out', amountsByCurrency: {}, firstTxAt: null, lastTxAt: null },
    groups: [{ groupId: 0, label: '원본', revision: 1, members: [{ txId: 1, reviewRole: 'SUBJECT', state: 'PENDING', decision: null, sources: [], transaction: { occurredAt: '2023-09-10T00:00:00Z', fromAccountId: 'a', toAccountId: 'b', fromBankId: 1, toBankId: 2, amountPaid: '10', amountUsd: '10', paymentCurrency: 'USD', paymentFormat: 'WIRE', role: 'SEED', isSuspicious: true, scores: null } }] }], history: [],
    }
  },
  fetchReviewMoney: async () => ({ available: false, reason: 'EMPTY_SUBJECT_SCOPE', selectedAccounts: ['a'], candidateAccounts: ['a', 'b'], revision: 1 }),
  fetchAlertEvidence: async () => ({ coverage: [] }),
  submitReviewCommand: vi.fn(), setReviewMoneyScope: vi.fn(),
}))

vi.mock('@/pages/AccountPage', async original => {
  const actual = await original<typeof import('@/pages/AccountPage')>()
  return { default: function AccountWithViewInput(props: { onLogout: () => void }) {
    const [value, setValue] = useViewState('auth-test/filter', '')
    return <><actual.default {...props} /><input aria-label="검증용 조회 조건" value={value} onChange={event => setValue(event.target.value)} /></>
  } }
})

beforeEach(() => { readFail.next = null; window.location.hash = 'account'; clearWorkspaceViews('42:STAFF'); clearWorkspaceViews('42:ADMIN'); clearWorkspaceViews('99:STAFF') })

it('서버 세션을 복원하고 만료되면 로그인 화면으로 돌린다', async () => {
  render(<App />)
  expect(await screen.findByText('staff42')).toBeInTheDocument()
  expect(screen.getAllByText('김조사').length).toBeGreaterThan(0)
  act(() => window.dispatchEvent(new Event('auth-expired')))
  expect(await screen.findByLabelText('아이디')).toBeInTheDocument()
  expect(screen.getByText('로그인 시간이 만료됐습니다. 다시 로그인해 주세요.')).toBeInTheDocument()
})


it.each([true, false])('세션 만료 후 동일 직원 여부(%s)에 따라 조사 경로를 복귀하거나 초기화한다', async sameUser => {
  vi.mocked(login).mockResolvedValue({ ...user, id: sameUser ? user.id : 99, role: 'STAFF' })
  render(<App />)
  await screen.findByText('staff42')
  act(() => window.dispatchEvent(new Event('auth-expired')))
  fireEvent.change(await screen.findByLabelText('아이디'), { target: { value: 'synthetic' } })
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'synthetic-only' } })
  fireEvent.click(screen.getByRole('button', { name: '로그인' }))
  await waitFor(() => expect(screen.queryByLabelText('아이디')).not.toBeInTheDocument())
  await waitFor(() => expect(window.location.hash).toBe(sameUser ? '#account' : '#dashboard'))
})


async function completeLogin() {
  fireEvent.change(await screen.findByLabelText('아이디'), { target: { value: 'synthetic' } })
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'synthetic-only' } })
  fireEvent.click(screen.getByRole('button', { name: '로그인' }))
  await waitFor(() => expect(screen.queryByLabelText('아이디')).not.toBeInTheDocument())
}
it('401 keeps same-user view inputs, while explicit logout clears them and does not resume', async () => {
  vi.mocked(login).mockResolvedValue({ ...user, role: 'STAFF' })
  render(<App />)
  fireEvent.change(await screen.findByLabelText('검증용 조회 조건'), { target: { value: 'private filter' } })
  act(() => window.dispatchEvent(new Event('auth-expired')))
  expect(await screen.findByLabelText('아이디')).toBeInTheDocument()
  expect(screen.queryByDisplayValue('private filter')).not.toBeInTheDocument()
  await completeLogin()
  expect(screen.getByLabelText('검증용 조회 조건')).toHaveValue('private filter')
  fireEvent.click(screen.getByRole('button', { name: '현재 세션 로그아웃' }))
  fireEvent.click(screen.getByRole('button', { name: /^로그아웃$/ }))
  await screen.findByLabelText('아이디')
  await completeLogin()
  await waitFor(() => expect(window.location.hash).toBe('#dashboard'))
  act(() => { window.location.hash = 'account'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
  expect(await screen.findByLabelText('검증용 조회 조건')).toHaveValue('')
})
it.each([{ id: 99, role: 'STAFF' as const }, { id: 42, role: 'ADMIN' as const }])('different user or role never restores the prior view input (%s)', async identity => {
  vi.mocked(login).mockResolvedValue({ ...user, ...identity })
  render(<App />)
  fireEvent.change(await screen.findByLabelText('검증용 조회 조건'), { target: { value: 'private role filter' } })
  act(() => window.dispatchEvent(new Event('auth-expired')))
  await completeLogin()
  act(() => { window.location.hash = 'account'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
  expect(await screen.findByLabelText('검증용 조회 조건')).toHaveValue('')
  expect(screen.queryByDisplayValue('private role filter')).not.toBeInTheDocument()
})


async function openActualCase() {
  act(() => { window.location.hash = 'alerts/1'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
  await screen.findByRole('checkbox', { name: '조사 중심 계좌 b' })
}
async function fillActualCaseDrafts() {
  fireEvent.click(await screen.findByRole('checkbox', { name: '조사 중심 계좌 b' }))
  fireEvent.change(screen.getByLabelText('계좌 선택 사유'), { target: { value: 'private account scope' } })
  fireEvent.mouseDown(screen.getByRole('tab', { name: /검토 의견/ }), { button: 0, ctrlKey: false })
  fireEvent.change(screen.getByLabelText('변경 사유'), { target: { value: 'private case comment' } })
}
it('actual case drafts survive same-session 401 but explicit logout then the same account clears all three fields', async () => {
  vi.mocked(login).mockResolvedValue({ ...user, role: 'STAFF' })
  render(<App />)
  await openActualCase()
  await fillActualCaseDrafts()
  act(() => window.dispatchEvent(new Event('auth-expired')))
  await screen.findByLabelText('아이디')
  expect(screen.queryByDisplayValue('private case comment')).not.toBeInTheDocument()
  expect(screen.queryByDisplayValue('private account scope')).not.toBeInTheDocument()
  await completeLogin()
  expect(await screen.findByRole('checkbox', { name: '조사 중심 계좌 b', hidden: true })).toBeChecked()
  expect(screen.getByLabelText('계좌 선택 사유')).toHaveValue('private account scope')
  expect(screen.getByLabelText('변경 사유')).toHaveValue('private case comment')
  act(() => { window.location.hash = 'account'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
  fireEvent.click(await screen.findByRole('button', { name: '현재 세션 로그아웃' }))
  fireEvent.click(screen.getByRole('button', { name: /^로그아웃$/ }))
  await screen.findByLabelText('아이디')
  await completeLogin()
  await openActualCase()
  expect(screen.getByRole('checkbox', { name: '조사 중심 계좌 b' })).not.toBeChecked()
  expect(screen.getByLabelText('계좌 선택 사유')).toHaveValue('')
  expect(screen.getByLabelText('변경 사유')).toHaveValue('')
})
it('actual case drafts are not exposed when the same user logs in with a different role', async () => {
  vi.mocked(login).mockResolvedValue({ ...user, role: 'ADMIN' })
  render(<App />)
  await openActualCase()
  await fillActualCaseDrafts()
  act(() => window.dispatchEvent(new Event('auth-expired')))
  await completeLogin()
  expect(await screen.findByRole('checkbox', { name: '조사 중심 계좌 b' })).not.toBeChecked()
  expect(screen.getByLabelText('계좌 선택 사유')).toHaveValue('')
  expect(screen.getByLabelText('변경 사유')).toHaveValue('')
  expect(screen.queryByDisplayValue('private case comment')).not.toBeInTheDocument()
})
it('reauthentication case read 403 hides the restored draft and prior case', async () => {
  vi.mocked(login).mockResolvedValue({ ...user, role: 'STAFF' })
  render(<App />)
  await openActualCase()
  await fillActualCaseDrafts()
  act(() => window.dispatchEvent(new Event('auth-expired')))
  readFail.next = new ApiError({ type: 'about:blank', title: '조회 권한 없음', status: 403, code: 'FORBIDDEN_ROLE' })
  await completeLogin()
  expect(await screen.findByText('이 사건을 조회할 권한이 없습니다.')).toBeInTheDocument()
  expect(screen.queryByLabelText('변경 사유')).not.toBeInTheDocument()
  expect(screen.queryByDisplayValue('private case comment')).not.toBeInTheDocument()
})
