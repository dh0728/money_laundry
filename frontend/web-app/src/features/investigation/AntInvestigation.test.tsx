import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi, beforeEach } from 'vitest'
import { WorkspaceState } from '@/lib/workspaceState'
import { WorkspaceProvider } from '@/lib/WorkspaceProvider'
import { AntInvestigation } from './AntInvestigation'
import type { ReviewCase } from '@/api/liveReview'
import { CurrentUserContext, MOCK_USER } from '@/app/session'
import { ConfigProvider } from 'antd'
import { ApiError } from '@/api/common'
const mocks = vi.hoisted(() => ({ detail: vi.fn(), list: vi.fn(), money: vi.fn(), command: vi.fn(), ledger: vi.fn() }))
vi.mock('@/api/liveReview', async importOriginal => ({ ...await importOriginal<typeof import('@/api/liveReview')>(), fetchReviewCase: mocks.detail, fetchReviewCases: mocks.list, fetchReviewMoney: mocks.money, submitReviewCommand: mocks.command }))
vi.mock('@/api/liveLedger', async importOriginal => ({ ...await importOriginal<typeof import('@/api/liveLedger')>(), fetchLedgerTransactions: mocks.ledger }))
const item: ReviewCase = { caseId: 1097, kind: 'ALERT', alertId: 3101, revision: 4, status: 'OPEN', outcome: null, assigneeId: 1, assigneeName: '가상 담당자', createdAt: '2026-10-02T00:00:00Z', assignedAt: '2026-10-02T00:00:00Z', closedAt: null, ageDays: 13, episodeId: null, sourceAlertIds: [3101], primaryTypes: [], pendingCount: 1, summary: { txCount: 1, subjectCount: 1, seedCount: 0, riskScore: .91, primaryType: '패턴 미특정', amountsByCurrency: { USD: 9189 }, firstTxAt: null, lastTxAt: null }, groups: [{ groupId: 7, label: '합성 조사 범위', revision: 1, members: [{ txId: 298, state: 'PENDING', decision: null, reviewRole: 'SUBJECT', sources: [{ alertId: 3101, version: 2 }], transaction: { occurredAt: '2026-10-02T00:00:00Z', fromAccountId: 'account-a', toAccountId: 'account-b', fromBankId: 1, toBankId: 2, amountPaid: 9189, amountUsd: 9189, paymentCurrency: 'USD', paymentFormat: 'Wire', role: 'CONNECTION', isSuspicious: true, scores: { p_laundering: .91, p_0: .61 } } }] }] }
function show(caseId = 1097, store = new WorkspaceState()) { return render(<ConfigProvider theme={{ token: { motion: false } }}><WorkspaceProvider state={store}><CurrentUserContext.Provider value={{ ...MOCK_USER, userId: 1 }}><AntInvestigation caseId={caseId} onOpen={vi.fn()} onBack={vi.fn()} refreshList={async () => {}} /></CurrentUserContext.Provider></WorkspaceProvider></ConfigProvider>) }
beforeEach(() => { vi.clearAllMocks(); window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }); mocks.detail.mockResolvedValue(item); mocks.list.mockResolvedValue({ content: [item], page: 0, size: 20, totalElements: 1, totalPages: 1 }); mocks.money.mockResolvedValue({ available: false, reason: 'EMPTY_ACCOUNT_SCOPE' }) })
it('판정을 미리 선택하지 않고 의견만 저장하면 원래 revision의 COMMENT만 전송한다', async () => {
  mocks.command.mockResolvedValue({ caseIds: [1097], targetCaseId: null }); show()
  await screen.findByText('A-3101')
  fireEvent.click(screen.getByRole('tab', { name: '의견과 판단' }))
  expect(screen.getByRole('radio', { name: '정상으로 종결' })).not.toBeChecked()
  expect(screen.getByRole('radio', { name: '단독 의심으로 종결' })).not.toBeChecked()
  fireEvent.change(screen.getByLabelText('조사 의견'), { target: { value: '판단은 유보하고 원거래를 추가 확인한다.' } })
  fireEvent.click(screen.getByRole('button', { name: '의견만 저장' }))
  await waitFor(() => expect(mocks.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'COMMENT', comment: '판단은 유보하고 원거래를 추가 확인한다.', selections: [{ caseId: 1097, revision: 4, groupId: 0, txIds: [] }] }), expect.any(String)))
  expect(mocks.command).toHaveBeenCalledTimes(1)
})
it('합성 저장 차단은 성공으로 표시하지 않고 의견을 보존한다', async () => {
  mocks.command.mockRejectedValue(new ApiError({ type: 'about:blank', status: 403, code: 'FIXTURE_READ_ONLY', title: '합성 검수 환경에서는 실제 저장할 수 없습니다.' })); show()
  await screen.findByText('A-3101'); fireEvent.click(screen.getByRole('tab', { name: '의견과 판단' }))
  fireEvent.change(screen.getByLabelText('조사 의견'), { target: { value: '보존할 조사 의견' } }); fireEvent.click(screen.getByRole('button', { name: '의견만 저장' }))
  await screen.findByText('합성 검수 환경에서는 실제 저장할 수 없습니다.')
  expect(screen.getByLabelText('조사 의견')).toHaveValue('보존할 조사 의견'); expect(screen.queryByText('의견을 저장했습니다.')).not.toBeInTheDocument()
})
it('같은 ID와 계좌를 확인한 원장 소유주를 보여주고 사건·의견 맥락을 유지한다', async () => {
  mocks.ledger.mockResolvedValue({ content: [{ ...item.groups![0].members[0].transaction, txId: 298, fromOwnerId: 'owner-a', toOwnerId: 'owner-b', fromOwnerName: '가상 송금인', toOwnerName: '가상 수취인', alertIds: [3101], episodeIds: [], judgement: 'SUSPICIOUS', probabilities: [.61], typeClass: 0 }], page: 0, size: 20, totalPages: 1, totalElements: 1 }); show()
  await screen.findByText('A-3101')
  const target = screen.getByText('T-298 원거래 확인').closest('button')!
  expect(target).toHaveAccessibleName('T-298 원거래 확인'); fireEvent.click(target)
  const dialog = (await screen.findByText('T-298 거래 상세')).closest<HTMLElement>('[role="dialog"]')!
  expect(dialog).toHaveAttribute('role', 'dialog'); await within(dialog).findByText('가상 송금인'); expect(dialog).toHaveTextContent('조사 출발점 A-3101 · T-298')
  const back = within(dialog).getByText('사건 조사로 돌아가기').closest('button')!
  expect(back).toHaveAccessibleName('사건 조사로 돌아가기'); fireEvent.click(back)
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(screen.getByText('가상 송금인')).toBeInTheDocument()
}, 20000)


it('다른 담당자의 사건은 의견과 판정 명령을 보낼 수 없다', async () => {
  mocks.detail.mockResolvedValue({ ...item, assigneeId: 2 }); show()
  await screen.findByText('A-3101')
  fireEvent.click(screen.getByRole('tab', { name: '의견과 판단' }))
  expect(screen.getByRole('button', { name: '의견만 저장' })).toBeDisabled()
  const review = screen.getByRole('tabpanel', { name: '의견과 판단' })
  const close = within(review).getByText('최종 종결 확인').closest('button')
  expect(close).toHaveAccessibleName('최종 종결 확인')
  expect(close).toBeDisabled()
  expect(mocks.command).not.toHaveBeenCalled()
})
it('늦은 저장 응답이 같은 사건의 후속 초안을 지우지 않는다', async () => {
  let resolve!: (value: unknown) => void
  mocks.command.mockImplementation(() => new Promise(done => { resolve = done }))
  const store = new WorkspaceState(); show(1097, store)
  await screen.findByText('A-3101'); fireEvent.click(screen.getByRole('tab', { name: '의견과 판단' }))
  fireEvent.change(screen.getByLabelText('조사 의견'), { target: { value: '제출한 의견' } })
  fireEvent.click(screen.getByRole('button', { name: '의견만 저장' }))
  await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(1))
  act(() => store.set('case/ALERT/1097/comment', '재진입 후 작성한 초안'))
  await act(async () => resolve({ caseIds: [1097], targetCaseId: null }))
  await screen.findByText('최신 사건과 이력을 다시 조회했습니다.')
  expect(screen.getByLabelText('조사 의견')).toHaveValue('재진입 후 작성한 초안')
  expect(mocks.command).toHaveBeenCalledTimes(1)
})
