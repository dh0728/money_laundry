import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import LiveCasesPage from './LiveCasesPage'
import { ApiError } from '@/api/common'

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))
vi.mock('@/features/graph/v24/Graph', () => ({ default: ({ model }: { model: { edges: unknown[] } }) => <div data-testid="live-graph">{model.edges.length} edges</div> }))
const { fetchReviewCase, fetchReviewCases, fetchReviewMoney, submitReviewCommand, setReviewMoneyScope } = vi.hoisted(() => ({
  fetchReviewCase: vi.fn(), fetchReviewCases: vi.fn(), fetchReviewMoney: vi.fn(), submitReviewCommand: vi.fn(), setReviewMoneyScope: vi.fn(),
}))
vi.mock('@/api/liveReview', () => ({ fetchReviewCase, fetchReviewCases, fetchReviewMoney, submitReviewCommand, setReviewMoneyScope }))

const page = <T,>(content: T[]) => ({ content, page: 0, size: 20, totalElements: content.length, totalPages: content.length ? 1 : 0 })
const member = (txId: number) => ({ txId, reviewRole: 'SUBJECT', state: 'PENDING', decision: null, sources: [], transaction: { occurredAt: '2023-09-10T00:00:00Z', fromAccountId: 'a', toAccountId: 'b', fromBankId: 1, toBankId: 2, amountPaid: 10, amountUsd: 8, paymentCurrency: 'USD', paymentFormat: 'WIRE', role: 'SEED', isSuspicious: true, scores: null } })
const alertCase = (caseId: number, alertId: number, extra = {}) => ({
  caseId, kind: 'ALERT', alertId, status: 'OPEN', outcome: null, revision: 1000 + caseId, assigneeId: 11, assigneeName: '오분석',
  createdAt: '', assignedAt: '', closedAt: null, ageDays: 0, pendingCount: 1, episodeId: null, sourceAlertIds: [], primaryTypes: [],
  summary: { txCount: 1, subjectCount: 1, seedCount: 1, riskScore: 0.9, primaryType: 'FAN_OUT', amountsByCurrency: {}, firstTxAt: null, lastTxAt: null },
  groups: [{ groupId: 0, label: '묶음', revision: 1, members: [member(caseId)] }], history: [], ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001))
  fetchReviewMoney.mockResolvedValue({ available: false, reason: 'EMPTY_SUBJECT_SCOPE' })
  fetchReviewCases.mockImplementation(({ kind }: { kind: string }) => Promise.resolve(kind === 'EPISODE'
    ? page([{ ...alertCase(50, 0), kind: 'EPISODE', alertId: null, revision: 7 }])
    : page([alertCase(1, 3001), alertCase(2, 3002), alertCase(3, 3003, { episodeId: 50 })])))
  submitReviewCommand.mockResolvedValue({ caseIds: [1], targetCaseId: null })
  setReviewMoneyScope.mockResolvedValue({ caseId: 1, revision: 1002 })
})

const showTab = async (label: string) => fireEvent.mouseDown(await screen.findByRole('tab', { name: new RegExp(label) }), { button: 0, ctrlKey: false })

const episodeCase = (count: number) => alertCase(50, 0, {
  kind: 'EPISODE', alertId: null, revision: 7,
  groups: Array.from({ length: count }, (_, i) => ({ groupId: i + 10, sourceAlertId: i + 3001, label: `Alert ${i + 3001}`, members: [{ ...member(i + 1), state: 'DECIDED', decision: 'NORMAL' }] })),
})

it('Episode 연결 해제는 사유와 2개 미만 해체 확인 뒤 전체 그룹 UNLINK를 보낸다', async () => {
  fetchReviewCase.mockResolvedValue(episodeCase(2))
  render(<LiveCasesPage kind="EPISODE" caseId={50} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('검토 의견')
  fireEvent.click(await screen.findByLabelText('연결 해제 Alert A-3001'))
  expect(screen.getByRole('button', { name: '선택 Alert 연결 해제' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('연결 해제 사유'), { target: { value: '별도 조사 필요' } })
  fireEvent.click(screen.getByRole('button', { name: '선택 Alert 연결 해제' }))
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Episode를 해체할까요?')
  expect(submitReviewCommand).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Episode 해체 확인' }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalledWith(expect.objectContaining({
    action: 'UNLINK', comment: '별도 조사 필요', selections: [{ caseId: 50, revision: 7, groupId: 10, txIds: [] }],
  }), expect.any(String)))
  await waitFor(() => expect(fetchReviewMoney).toHaveBeenCalledTimes(2))
})

it('3개 중 하나 해제는 해체로 안내하지 않고 판정 완료 그룹도 선택할 수 있다', async () => {
  fetchReviewCase.mockResolvedValue(episodeCase(3))
  render(<LiveCasesPage kind="EPISODE" caseId={50} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('검토 의견')
  fireEvent.click(await screen.findByLabelText('연결 해제 Alert A-3001'))
  fireEvent.change(screen.getByLabelText('연결 해제 사유'), { target: { value: '연결 없음' } })
  fireEvent.click(screen.getByRole('button', { name: '선택 Alert 연결 해제' }))
  expect(screen.getByRole('alertdialog')).toHaveTextContent('선택 Alert의 연결을 해제할까요?')
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(submitReviewCommand).not.toHaveBeenCalled()
})

it('해체 이력은 현재 소속과 구분하고 닫힌 사건에서는 해제할 수 없다', async () => {
  fetchReviewCase.mockResolvedValue({ ...episodeCase(0), status: 'CLOSED', outcome: 'DISSOLVED', detachments: [{
    eventId: 1, action: 'DISSOLVE', comment: '독립된 흐름', businessAt: '2023-09-10T09:00:00+09:00',
    snapshot: { groups: episodeCase(2).groups },
  }] })
  render(<LiveCasesPage kind="EPISODE" caseId={50} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('검토 의견')
  expect(await screen.findByText(/해체된 Episode입니다/)).toBeInTheDocument()
  expect(screen.getByRole('region', { name: '연결 해제 이력' })).toHaveTextContent('독립된 흐름')
  expect(screen.queryByRole('button', { name: '선택 Alert 연결 해제' })).not.toBeInTheDocument()
})

it('Alert의 이미 판정한 거래도 제외할 수 있다', async () => {
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { groups: [{ groupId: 4, label: '거래 묶음', members: [{ ...member(11), state: 'DECIDED', decision: 'NORMAL' }] }] }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('거래')
  fireEvent.click(await screen.findByRole('checkbox', { name: /T-11/ }))
  fireEvent.change(screen.getByLabelText('거래 제외 사유'), { target: { value: '범위 밖' } })
  fireEvent.click(screen.getByRole('button', { name: '선택 거래 제외' }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalledWith(expect.objectContaining({ action: 'EXCLUDE', selections: [{ caseId: 1, revision: 1001, groupId: 4, txIds: [11] }] }), expect.any(String)))
})

const open = async () => {
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('검토 의견')
  fireEvent.change(await screen.findByLabelText('변경 사유'), { target: { value: '검토 완료' } })
}

it('Alert 단독 의심 종결은 사건 전체 CLOSE로 보낸다', async () => {
  await open()
  fireEvent.click(screen.getByRole('button', { name: '단독 세탁 의심 종결' }))
  fireEvent.click(await screen.findByRole('button', { name: '최종 종결 확정' }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalled())
  expect(submitReviewCommand.mock.calls[0][0]).toMatchObject({ action: 'CLOSE', decision: 'SUSPICIOUS', selections: [{ caseId: 1, revision: 1001, groupId: 0, txIds: [] }] })
})

it('Alert 조사 범위의 선택 거래를 EXCLUDE 명령으로 보낸다', async () => {
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { groups: [{ groupId: 4, label: '거래 묶음', members: [member(11), { ...member(12), reviewRole: 'CONTEXT' }] }] }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('거래')
  fireEvent.click(await screen.findByRole('checkbox', { name: /T-11/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: /T-12/ }))
  fireEvent.change(screen.getByRole('textbox', { name: '거래 제외 사유' }), { target: { value: '조사와 무관한 거래' } })
  fireEvent.click(screen.getByRole('button', { name: '선택 거래 제외' }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalledWith(expect.objectContaining({
    action: 'EXCLUDE', comment: '조사와 무관한 거래', selections: [{ caseId: 1, revision: 1001, groupId: 4, txIds: [11, 12] }],
  }), expect.any(String)))
})

it('목록에서 미편입 OPEN Alert 두 개를 골라 새 Episode를 만든다', async () => {
  render(<LiveCasesPage kind="ALERT" onOpen={vi.fn()} onBack={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Episode로 묶기' }))
  expect(await screen.findByLabelText('새 Episode 선택 A-3001')).toBeInTheDocument()
  expect(screen.getByLabelText('새 Episode 선택 A-3003')).toBeDisabled()
  fireEvent.click(screen.getByLabelText('새 Episode 선택 A-3001'))
  fireEvent.click(screen.getByLabelText('새 Episode 선택 A-3002'))
  fireEvent.change(screen.getByLabelText('새 Episode 생성 사유'), { target: { value: '두 Alert 연결' } })
  fireEvent.click(screen.getByRole('button', { name: /새 Episode 생성/ }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalled())
  expect(submitReviewCommand.mock.calls[0][0]).toMatchObject({
    action: 'TRANSFER', targetCaseId: null, comment: '두 Alert 연결',
    selections: [{ caseId: 1, revision: 1001, groupId: 0, txIds: [] }, { caseId: 2, revision: 1002, groupId: 0, txIds: [] }],
  })
})

it('필터가 바뀌면 이전 선택을 제출하지 않는다', async () => {
  render(<LiveCasesPage kind="ALERT" onOpen={vi.fn()} onBack={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Episode로 묶기' }))
  fireEvent.click(await screen.findByLabelText('새 Episode 선택 A-3001'))
  fireEvent.click(screen.getByLabelText('내 담당'))
  expect(screen.getByText(/0건 선택/)).toBeInTheDocument()
})

it('상세에서 새 Episode 안내는 목록 이동으로 연결한다', async () => {
  const onBack = vi.fn()
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={onBack} />)
  await showTab('검토 의견')
  fireEvent.click(await screen.findByRole('button', { name: /목록에서 새 Episode 만들기/ }))
  expect(onBack).toHaveBeenCalledOnce()
})

it('live 상세는 조사 거래에서 그래프를 그린다', async () => {
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('그래프')
  expect(await screen.findByTestId('live-graph')).toHaveTextContent('1 edges')
})

it('Alert 상세는 실제 거래의 다른 패턴 후보를 확률 순서로 표시한다', async () => {
  const scored = { ...member(1), transaction: { ...member(1).transaction, scores: { p_laundering: 0.91, p_0: 0.02, p_1: 0.73, p_2: 0.2, p_3: 0.05 } } }
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { groups: [{ groupId: 0, label: '묶음', revision: 1, members: [scored] }] }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  const list = await screen.findByRole('list', { name: '거래 패턴 후보' })
  expect(list).toHaveTextContent('FAN-OUT')
  expect(list).toHaveTextContent('73.0%')
  expect(list).toHaveTextContent('FAN-IN')
  expect(list).toHaveTextContent('20.0%')
  expect(list.textContent?.indexOf('FAN-OUT')).toBeLessThan(list.textContent?.indexOf('FAN-IN') ?? 0)
  expect(screen.getByText(/Alert 전체 확률이 아닙니다/)).toBeInTheDocument()
})

it('거래를 바꾸면 그 거래의 점수만 표시하고 합산하지 않는다', async () => {
  const seed = { ...member(1), transaction: { ...member(1).transaction, scores: { p_1: 0.8, p_2: 0.1 } } }
  const connection = { ...member(2), transaction: { ...member(2).transaction, role: 'CONNECTION', scores: { p_1: 0.05, p_2: 0.6 } } }
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { groups: [{ groupId: 0, label: '묶음', revision: 1, members: [seed, connection] }] }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  const selector = await screen.findByLabelText('확률을 볼 거래')
  expect(screen.getByRole('list', { name: '거래 패턴 후보' })).toHaveTextContent('80.0%')
  fireEvent.change(selector, { target: { value: '2' } })
  const candidates = screen.getByRole('list', { name: '거래 패턴 후보' })
  expect(candidates).toHaveTextContent('60.0%')
  expect(candidates).not.toHaveTextContent('80.0%')
})

it('실제 사건 요약의 통화별 거래액과 대표 유형 비중을 표시한다', async () => {
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { summary: {
    txCount: 3, subjectCount: 2, seedCount: 1, riskScore: 0.91, primaryType: 'Fan-out', typeShare: 0.5,
    amountsByCurrency: { KRW: 120000, USD: 70 }, firstTxAt: '2023-09-10T00:00:00Z', lastTxAt: '2023-09-11T00:00:00Z',
    paymentFormats: { WIRE: 2, CASH: 1 }, typeDistribution: { 'Fan-out': 2 },
  } }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  const overview = await screen.findByRole('region', { name: '사건 개요' })
  expect(overview).toHaveTextContent('대표 유형 비중 50.0%')
  expect(overview).toHaveTextContent('KRW 120,000')
  expect(overview).toHaveTextContent('USD 70')
  expect(overview).toHaveTextContent('조사 대상 2건')
  expect(overview).toHaveTextContent('씨앗 거래 1건')
})

it('자금 지표의 기간을 바꿔 다시 조회하고 계좌별 비율을 표시한다', async () => {
  fetchReviewMoney.mockResolvedValue({
    available: true, selectedAccounts: ['account-a'], candidateAccounts: ['account-a'], delayMinutes: 180,
    requestedFrom: '2023-09-10', requestedTo: '2023-09-11', complete: true, ledgerCount: 12, method: 'FIFO_ESTIMATE',
    external: [{ currency: 'KRW', in: 1000, out: 400, net: 600 }],
    accounts: [{ accountId: 'account-a', currency: 'KRW', in: 1000, out: 400, net: 600, positiveNet: 600,
      concentrationPercent: 75, eligibleIn: 800, excludedIn: 200, matchedIn: 400, rapidOutflowPercent: 50 }],
  })
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  const money = await screen.findByRole('region', { name: '조사 계좌 자금 지표' })
  expect(money).toHaveTextContent('집중도 75.0%')
  expect(money).toHaveTextContent('단시간 유출 50.0%')
  expect(money).toHaveTextContent('원장 거래 12건')
  fireEvent.change(screen.getByLabelText('단시간 유출 비교 기간'), { target: { value: '60' } })
  await waitFor(() => expect(fetchReviewMoney).toHaveBeenCalledWith(1, 60))
})

it('본인 담당 OPEN 사건의 조사 중심 계좌를 revision과 의견으로 저장한다', async () => {
  fetchReviewMoney.mockResolvedValue({
    available: false, reason: 'WAITING_RECEIPTS', selectedAccounts: ['account-a'], candidateAccounts: ['account-a', 'account-b'], revision: 1001,
  })
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  fireEvent.click(await screen.findByRole('checkbox', { name: '조사 중심 계좌 account-b' }))
  fireEvent.change(screen.getByLabelText('계좌 선택 사유'), { target: { value: '연결 계좌 포함' } })
  fireEvent.click(screen.getByRole('button', { name: '조사 중심 계좌 저장' }))
  await waitFor(() => expect(setReviewMoneyScope).toHaveBeenCalledWith(1, 1001, ['account-a', 'account-b'], '연결 계좌 포함', expect.any(String)))
  await waitFor(() => expect(fetchReviewCase).toHaveBeenCalledTimes(2))
  expect(fetchReviewMoney).toHaveBeenCalledTimes(2)
})

it('계좌 선택 저장의 네트워크 오류 후 같은 UUID와 본문으로 재시도한다', async () => {
  fetchReviewMoney.mockResolvedValue({ available: false, reason: 'WAITING_RECEIPTS', selectedAccounts: ['account-a'], candidateAccounts: ['account-a'], revision: 1001 })
  setReviewMoneyScope.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce({ caseId: 1, revision: 1002 })
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('계좌 선택 사유'), { target: { value: '범위 고정' } })
  fireEvent.click(screen.getByRole('button', { name: '조사 중심 계좌 저장' }))
  fireEvent.click(await screen.findByRole('button', { name: '같은 계좌 선택 요청 재시도' }))
  await waitFor(() => expect(setReviewMoneyScope).toHaveBeenCalledTimes(2))
  expect(setReviewMoneyScope.mock.calls[1]).toEqual(setReviewMoneyScope.mock.calls[0])
})

it('계좌 선택 저장이 409면 상세와 지표를 다시 조회하고 자동 재제출하지 않는다', async () => {
  fetchReviewMoney.mockResolvedValue({ available: false, reason: 'WAITING_RECEIPTS', selectedAccounts: ['account-a'], candidateAccounts: ['account-a'], revision: 1001 })
  setReviewMoneyScope.mockRejectedValueOnce(new ApiError({ type: 'about:blank', title: 'Conflict', status: 409, code: 'INVALID_TRANSITION' }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('계좌 선택 사유'), { target: { value: '범위 조정' } })
  fireEvent.click(screen.getByRole('button', { name: '조사 중심 계좌 저장' }))
  await waitFor(() => expect(fetchReviewCase).toHaveBeenCalledTimes(2))
  expect(fetchReviewMoney).toHaveBeenCalledTimes(2)
  expect(setReviewMoneyScope).toHaveBeenCalledTimes(1)
  expect(toastError).toHaveBeenCalledWith(expect.stringContaining('최신 계좌 범위를 확인'))
})

it('미판정 거래가 있어도 정상 최종 종결을 확인하고 한 요청으로 보낸다', async () => {
  await open()
  fireEvent.click(screen.getByRole('button', { name: '정상 종결' }))
  expect(screen.getByText(/참고 맥락·제외 거래에는 판정하지 않습니다/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '최종 종결 확정' }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalledWith(expect.objectContaining({ action: 'CLOSE', decision: 'NORMAL' }), expect.any(String)))
  expect(toastSuccess).toHaveBeenCalledWith('정상 종결 완료')
})

it('조사 대상이 없으면 최종 종결을 막고 안내한다', async () => {
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { groups: [] }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('검토 의견')
  expect(await screen.findByText('조사 대상 거래가 없어 최종 종결할 수 없습니다.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '정상 종결' })).toBeDisabled()
})

it('처리 대상이 아닌 TRANSFERRED 거래만 있으면 최종 종결을 막는다', async () => {
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { groups: [{ groupId: 0, label: '묶음', revision: 1, members: [{ ...member(1), state: 'TRANSFERRED' }] }] }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('검토 의견')
  expect(await screen.findByRole('button', { name: '정상 종결' })).toBeDisabled()
})

it('V12 초기화로 이전 사건이 404이면 목록으로 이동할 수 있다', async () => {
  fetchReviewCase.mockRejectedValue(new ApiError({ type: 'about:blank', title: 'Not Found', status: 404, code: 'NOT_FOUND' }))
  const onBack = vi.fn()
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={onBack} />)
  expect(await screen.findByText(/목록에서 다시 선택해 주세요/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '목록으로' }))
  expect(onBack).toHaveBeenCalledOnce()
})

it('Episode 묶음 판정은 미판정 SUBJECT 전체를 보내고 종결 decision은 null이다', async () => {
  fetchReviewCase.mockResolvedValue({ ...alertCase(80, 0), kind: 'EPISODE', alertId: null, pendingCount: 0, groups: [{ groupId: 7, sourceAlertId: 3001, label: '연결', members: [member(1), member(2)] }] })
  render(<LiveCasesPage kind="EPISODE" caseId={80} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('검토 의견')
  fireEvent.change(await screen.findByLabelText('변경 사유'), { target: { value: '검토 근거' } })
  await showTab('거래')
  expect(screen.getByText(/Alert A-3001 · 연결/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: /T-1/ }))
  expect(screen.getByRole('checkbox', { name: /T-2/ })).toBeChecked()
  await showTab('검토 의견')
  fireEvent.click(screen.getByRole('button', { name: '선택 범위 이상 판정' }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalled())
  expect(submitReviewCommand.mock.calls[0][0]).toMatchObject({ action: 'DECIDE', selections: [{ groupId: 7, txIds: [1, 2] }] })
  await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
  fireEvent.change(screen.getByLabelText('변경 사유'), { target: { value: '종결 근거' } })
  fireEvent.click(screen.getByRole('button', { name: '사건 종결' }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalledTimes(2))
  expect(submitReviewCommand.mock.calls[1][0]).toMatchObject({ action: 'CLOSE', decision: null, selections: [{ groupId: 0, txIds: [] }] })
})

it('편입된 원본 Alert는 그래프를 유지하고 목적지로 이동한다', async () => {
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { status: 'CLOSED', outcome: 'TRANSFERRED', episodeId: 80 }))
  const onOpenEpisode = vi.fn()
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} onOpenEpisode={onOpenEpisode} />)
  await showTab('그래프')
  expect(await screen.findByTestId('live-graph')).toBeInTheDocument()
  await showTab('검토 의견')
  fireEvent.click(screen.getByRole('button', { name: 'Episode E-80 보기' }))
  expect(onOpenEpisode).toHaveBeenCalledWith(80)
  expect(screen.getByRole('button', { name: '정상 종결' })).toBeDisabled()
})

it('네트워크 실패 후 같은 UUID와 본문으로 재시도한다', async () => {
  submitReviewCommand.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ caseIds: [1], targetCaseId: 50 })
  await open()
  fireEvent.change(await screen.findByLabelText('편입할 Episode'), { target: { value: '50' } })
  fireEvent.click(screen.getByRole('button', { name: '기존 Episode에 전체 편입' }))
  fireEvent.click(await screen.findByRole('button', { name: '같은 요청 재시도' }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalledTimes(2))
  expect(submitReviewCommand.mock.calls[1]).toEqual(submitReviewCommand.mock.calls[0])
})

it('409가 나면 최신 내용을 재조회하고 자동 재제출하지 않는다', async () => {
  submitReviewCommand.mockRejectedValueOnce(new ApiError({ type: 'about:blank', title: 'Conflict', status: 409, code: 'INVALID_TRANSITION' }))
  await open()
  fireEvent.change(await screen.findByLabelText('편입할 Episode'), { target: { value: '50' } })
  fireEvent.click(screen.getByRole('button', { name: '기존 Episode에 전체 편입' }))
  await waitFor(() => expect(fetchReviewCase).toHaveBeenCalledTimes(2))
  expect(submitReviewCommand).toHaveBeenCalledTimes(1)
  expect(toastError).toHaveBeenCalledWith(expect.stringContaining('최신 내용을 확인'))
})

it('기존 Episode 편입은 목적지 revision을 함께 보낸다', async () => {
  await open()
  fireEvent.change(await screen.findByLabelText('편입할 Episode'), { target: { value: '50' } })
  fireEvent.click(screen.getByRole('button', { name: '기존 Episode에 전체 편입' }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalled())
  expect(submitReviewCommand.mock.calls[0][0]).toMatchObject({ action: 'TRANSFER', targetCaseId: 50, targetRevision: 7, selections: [{ caseId: 1, groupId: 0, txIds: [] }] })
})

it('저장은 성공하고 자금 지표 재조회만 실패하면 저장 성공을 분명히 안내한다', async () => {
  fetchReviewMoney.mockResolvedValueOnce({ available: false, reason: 'EMPTY_SUBJECT_SCOPE' }).mockRejectedValueOnce(new TypeError('offline'))
  await open()
  fireEvent.click(screen.getByRole('button', { name: '정상 종결' }))
  fireEvent.click(screen.getByRole('button', { name: '최종 종결 확정' }))
  await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('저장은 완료됐지만 최신 화면을 불러오지 못했습니다')))
  expect(submitReviewCommand).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: '같은 요청 재시도' })).not.toBeInTheDocument()
})

it('목적지 Episode를 20건씩 넘겨 다음 페이지에서 고를 수 있다', async () => {
  fetchReviewCases.mockImplementation(({ kind, page: pageNumber }: { kind: string; page?: number }) => Promise.resolve(kind === 'EPISODE'
    ? { ...page([{ ...alertCase(pageNumber ? 51 : 50, 0), kind: 'EPISODE', alertId: null, revision: 7 }]), page: pageNumber ?? 0, totalElements: 21, totalPages: 2 }
    : page([alertCase(1, 3001)])))
  await open()
  fireEvent.click(await screen.findByRole('button', { name: '다음 Episode 목적지' }))
  expect(fetchReviewCases).toHaveBeenCalledWith({ kind: 'EPISODE', status: 'OPEN', page: 1, size: 20 })
  expect(await screen.findByRole('option', { name: /E-51/ })).toBeInTheDocument()
})
