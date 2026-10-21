import { NuqsAdapter } from 'nuqs/adapters/react'
import type { ReactElement } from 'react'
import { fireEvent, render as testingRender, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import LiveCasesPage from './LiveCasesPage'
import { ApiError } from '@/api/common'
import { WorkspaceContext, WorkspaceState } from '@/lib/workspaceState'
import { writeMemory } from '@/lib/memory'
import { CurrentUserContext, MOCK_USER } from '@/app/session'

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))
vi.mock('@/features/graph/v24/Graph', () => ({ default: ({ model, panelExtra }: { model: { edges: { s: string; t: string }[] }; panelExtra?: (focus: { kind: 'edge'; s: string; t: string }) => ReactElement }) => <div data-testid="live-graph">{model.edges.length} edges{model.edges[0] && panelExtra?.({ kind: 'edge', s: model.edges[0].s, t: model.edges[0].t })}</div> }))
vi.mock('@/features/graph/timeline/TimeGraph', () => ({ default: ({ rows, live }: { rows: { txId: number }[]; live?: { onInvestigate: (ids: number[]) => void } }) => <div data-testid="live-timegraph"><div data-testid="live-graph">{rows.length} edges<ButtonForTest ids={rows.map(row => row.txId)} onInvestigate={live?.onInvestigate} /></div></div> }))
function ButtonForTest({ ids, onInvestigate }: { ids: number[]; onInvestigate?: (ids: number[]) => void }) { return <button onClick={() => onInvestigate?.(ids)}>선택한 조사 거래 보기</button> }
const { fetchAlertEvidence, fetchReviewCase, fetchReviewCases, fetchReviewMoney, submitReviewCommand, setReviewMoneyScope } = vi.hoisted(() => ({
  fetchAlertEvidence: vi.fn(), fetchReviewCase: vi.fn(), fetchReviewCases: vi.fn(), fetchReviewMoney: vi.fn(), submitReviewCommand: vi.fn(), setReviewMoneyScope: vi.fn(),
}))
vi.mock('@/api/liveReview', () => ({ fetchAlertEvidence, fetchReviewCase, fetchReviewCases, fetchReviewMoney, submitReviewCommand, setReviewMoneyScope, fetchReviewUsers: async () => [{ id: 11, name: '오분석' }] }))

const render = (element: ReactElement) => testingRender(<NuqsAdapter>{element}</NuqsAdapter>)
const page = <T,>(content: T[]) => ({ content, page: 0, size: 20, totalElements: content.length, totalPages: content.length ? 1 : 0 })
const member = (txId: number) => ({ txId, reviewRole: 'SUBJECT', state: 'PENDING', decision: null, sources: [], transaction: { occurredAt: '2023-09-10T00:00:00Z', fromAccountId: 'a', toAccountId: 'b', fromBankId: 1, toBankId: 2, amountPaid: 10, amountUsd: 8, paymentCurrency: 'USD', paymentFormat: 'WIRE', role: 'SEED', isSuspicious: true, scores: null } })
const alertCase = (caseId: number, alertId: number, extra = {}) => ({
  caseId, kind: 'ALERT', alertId, status: 'OPEN', outcome: null, revision: 1000 + caseId, assigneeId: 11, assigneeName: '오분석',
  createdAt: '', assignedAt: '', closedAt: null, ageDays: 0, pendingCount: 1, episodeId: null, sourceAlertIds: [], primaryTypes: [],
  summary: { txCount: 1, subjectCount: 1, seedCount: 1, riskScore: 0.9, primaryType: 'FAN_OUT', amountsByCurrency: {}, firstTxAt: null, lastTxAt: null },
  groups: [{ groupId: 0, label: '묶음', revision: 1, members: [member(caseId)] }], history: [], ...extra,
})

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.clearAllMocks()
  for (const kind of ['ALERT', 'EPISODE']) for (const id of [1, 2, 3, 50]) writeMemory(`case-draft/11/${kind}/${id}`, '')
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001))
  fetchAlertEvidence.mockResolvedValue({ coverage: [] })
  fetchReviewMoney.mockResolvedValue({ available: false, reason: 'EMPTY_SUBJECT_SCOPE' })
  fetchReviewCases.mockImplementation(({ kind }: { kind: string }) => Promise.resolve(kind === 'EPISODE'
    ? page([{ ...alertCase(50, 0), kind: 'EPISODE', alertId: null, revision: 7 }])
    : page([alertCase(1, 3001), alertCase(2, 3002), alertCase(3, 3003, { episodeId: 50 })])))
  submitReviewCommand.mockResolvedValue({ caseIds: [1], targetCaseId: null })
  setReviewMoneyScope.mockResolvedValue({ caseId: 1, revision: 1002 })
})

const choose = async (label: string, option: string) => {
  fireEvent.keyDown(await screen.findByRole('combobox', { name: label }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: option }))
}
const showTab = async (label: string) => fireEvent.mouseDown(await screen.findByRole('tab', { name: new RegExp(label) }), { button: 0, ctrlKey: false })

const episodeCase = (count: number) => alertCase(50, 0, {
  kind: 'EPISODE', alertId: null, revision: 7,
  groups: Array.from({ length: count }, (_, i) => ({ groupId: i + 10, sourceAlertId: i + 3001, label: `Alert ${i + 3001}`, members: [{ ...member(i + 1), state: 'DECIDED', decision: 'NORMAL' }] })),
})

it.each(['ALERT', 'EPISODE'] as const)('%s 목록 조회 실패는 빈 검색 결과로 표시하지 않고 재시도한다', async kind => {
  fetchReviewCases.mockRejectedValueOnce(new TypeError('offline'))
  render(<LiveCasesPage kind={kind} onOpen={vi.fn()} onBack={vi.fn()} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('데이터를 불러오지 못했습니다')
  expect(screen.queryByText(`조건에 맞는 ${kind === 'ALERT' ? 'Alert' : 'Episode'}가 없습니다.`)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(screen.getByRole('textbox', { name: `${kind === 'ALERT' ? 'Alert' : 'Episode'} 검색` })).toBeInTheDocument()
})

it.each(['ALERT', 'EPISODE'] as const)('%s 목록 조회 중에는 빈 결과를 표시하지 않는다', async kind => {
  let finish!: (value: ReturnType<typeof page>) => void
  const pending = new Promise<ReturnType<typeof page>>(resolve => { finish = resolve })
  fetchReviewCases.mockImplementation(({ kind: requested }: { kind: string }) => requested === kind ? pending : Promise.resolve(page([])))
  render(<LiveCasesPage kind={kind} onOpen={vi.fn()} onBack={vi.fn()} />)
  expect(screen.getByText('사건 목록 불러오는 중…')).toBeInTheDocument()
  expect(screen.queryByText(`조건에 맞는 ${kind === 'ALERT' ? 'Alert' : 'Episode'}가 없습니다.`)).not.toBeInTheDocument()
  finish(page([]))
  expect(await screen.findByText(`조건에 맞는 ${kind === 'ALERT' ? 'Alert' : 'Episode'}가 없습니다.`)).toBeInTheDocument()
})

it('Alert 목록을 다시 조회하는 동안 기존 행과 선택을 유지한다', async () => {
  let finish!: (value: ReturnType<typeof page>) => void
  const pending = new Promise<ReturnType<typeof page>>(resolve => { finish = resolve })
  let alertCalls = 0
  fetchReviewCases.mockImplementation(({ kind }: { kind: string }) => kind === 'ALERT' && ++alertCalls > 1 ? pending
    : Promise.resolve(kind === 'ALERT' ? page([alertCase(1, 3001), alertCase(2, 3002)]) : page([])))
  render(<LiveCasesPage kind="ALERT" onOpen={vi.fn()} onBack={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Episode로 묶기' }))
  fireEvent.click(await screen.findByLabelText('A-3001 선택'))
  fireEvent.click(screen.getByRole('button', { name: '새로고침' }))
  expect(screen.getByText(/1건 선택/)).toBeInTheDocument()
  expect(screen.getByLabelText('A-3001 선택')).toBeChecked()
  finish(page([alertCase(1, 3001), alertCase(2, 3002)]))
  await waitFor(() => expect(screen.getByRole('button', { name: '새로고침' })).toBeEnabled())
})

it.each(['ALERT', 'EPISODE'] as const)('%s 목록의 금액은 표와 narrow 카드에서 긴 USD 값을 자르지 않는다', async kind => {
  const item = kind === 'ALERT' ? alertCase(1, 3001) : episodeCase(2)
  fetchReviewCases.mockImplementation(({ kind: requested }: { kind: string }) => Promise.resolve(page(requested === kind ? [{ ...item, summary: { ...item.summary, totalAmountUsd: 1234567890123.45 } }] : [])))
  render(<LiveCasesPage kind={kind} onOpen={vi.fn()} onBack={vi.fn()} />)
  const mobile = await screen.findByTestId(kind === 'ALERT' ? 'alert-mobile-card' : 'episode-mobile-card')
  expect(mobile).toHaveTextContent('1,234,567,890,123.45 USD')
  expect(screen.getByRole('columnheader', { name: '거래 총액 (USD)' })).toBeInTheDocument()
})

it('Alert narrow 카드 체크박스로 두 건을 Episode 묶기 선택에 넣는다', async () => {
  fetchReviewCases.mockImplementation(({ kind }: { kind: string }) => Promise.resolve(page(kind === 'ALERT' ? [alertCase(1, 3001), alertCase(2, 3002)] : [])))
  render(<LiveCasesPage kind="ALERT" onOpen={vi.fn()} onBack={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Episode로 묶기' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'A-3001 모바일 선택' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'A-3002 모바일 선택' }))
  expect(screen.getByText(/2건 선택/)).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'A-3001 모바일 선택' })).toBeChecked()
})

it.each(['ALERT', 'EPISODE'] as const)('%s 상세 403은 권한 안내를 제공한다', async kind => {
  fetchReviewCase.mockRejectedValue(new ApiError({ type: 'about:blank', title: 'Forbidden', status: 403, code: 'FORBIDDEN_ROLE' }))
  render(<LiveCasesPage kind={kind} caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  expect(await screen.findByText('이 사건을 조회할 권한이 없습니다.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '목록으로' })).not.toBeInTheDocument()
})

it.each(['ALERT', 'EPISODE'] as const)('%s 상세 첫 조회 중에도 영역 제목을 표시한다', async kind => {
  fetchReviewCase.mockImplementation(() => new Promise(() => undefined))
  render(<LiveCasesPage kind={kind} caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  expect(screen.getByRole('heading', { name: kind === 'ALERT' ? '돈의 흐름' : '연결 Alert와 연결 근거' })).toBeInTheDocument()
  expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  expect(screen.queryByRole('button', { name: '목록으로' })).not.toBeInTheDocument()
})

it.each(['ALERT', 'EPISODE'] as const)('%s 목록 403은 빈 결과 대신 권한 이유를 표시한다', async kind => {
  fetchReviewCases.mockRejectedValueOnce(new ApiError({ type: 'about:blank', title: 'Forbidden', status: 403, code: 'FORBIDDEN_ROLE' }))
  render(<LiveCasesPage kind={kind} onOpen={vi.fn()} onBack={vi.fn()} />)
  expect(await screen.findByText('이 사건 목록을 조회할 권한이 없습니다.')).toBeInTheDocument()
  expect(screen.queryByText(`조건에 맞는 ${kind === 'ALERT' ? 'Alert' : 'Episode'}가 없습니다.`)).not.toBeInTheDocument()
})

it('Episode 미판정 거래가 남으면 종결 비활성 이유를 표시한다', async () => {
  fetchReviewCase.mockResolvedValue(episodeCase(2))
  render(<LiveCasesPage kind="EPISODE" caseId={50} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('검토 의견')
  expect(screen.getByRole('button', { name: '사건 종결' })).toBeDisabled()
  expect(screen.getByText('미판정 조사 대상 1건을 먼저 판정해야 사건을 종결할 수 있습니다.')).toBeInTheDocument()
})

it.each([
  ['다른 담당자', { assigneeId: 99 }, '본인 담당 사건만 변경할 수 있습니다.'],
  ['종결', { status: 'CLOSED' }, '종결된 사건은 변경할 수 없습니다.'],
] as const)('Episode %s 상태는 검토 제어를 비활성화하고 이유를 표시한다', async (_label, extra, reason) => {
  fetchReviewCase.mockResolvedValue({ ...episodeCase(2), ...extra })
  render(<LiveCasesPage kind="EPISODE" caseId={50} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('검토 의견')
  expect(screen.getByRole('button', { name: '의견 저장' })).toBeDisabled()
  expect(screen.getByText(reason)).toBeInTheDocument()
})

it('그래프에서 고른 연결선의 조사 거래로 이동한다', async () => {
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('그래프')
  fireEvent.click(await screen.findByRole('button', { name: '선택한 조사 거래 보기' }))
  expect(screen.getByRole('tab', { name: /거래/ })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('region', { name: '선택 근거 거래' })).toHaveTextContent('T-1')
})

it('Episode 연결 Alert는 조사 거래 첫 시각으로 정렬하고 간격을 근거로만 보여 준다', async () => {
  const episode = episodeCase(2)
  fetchReviewCase.mockResolvedValue({ ...episode, groups: [
    { ...episode.groups[0], members: [{ ...member(1), transaction: { ...member(1).transaction, occurredAt: '2023-09-10T11:30:00Z' } }] },
    { ...episode.groups[1], members: [{ ...member(2), transaction: { ...member(2).transaction, occurredAt: '2023-09-10T09:00:00Z' } }] },
  ] })
  const { container } = render(<LiveCasesPage kind="EPISODE" caseId={50} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('개요')
  expect(await screen.findByText('직전 Alert 첫 거래에서 2시간 30분 뒤')).toBeInTheDocument()
  const rows = [...container.querySelectorAll('[data-wiring-id^="case.overview.connections.alert."]')]
  expect(rows.map(row => row.getAttribute('data-wiring-id'))).toEqual([
    'case.overview.connections.alert.3002', 'case.overview.connections.alert.3001',
  ])
  expect(rows[0]).toHaveTextContent('첫 거래 시각 기준 첫 Alert')
  expect(screen.getByText(/편입 사유나 연결 강도를 뜻하지 않습니다/)).toBeInTheDocument()
})

it('Episode 원래 담당자는 원본 Alert 목록을 정확히 찾아 요청 시 표시한다', async () => {
  fetchReviewCase.mockResolvedValue(episodeCase(2))
  render(<LiveCasesPage kind="EPISODE" caseId={50} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('개요')
  fireEvent.click(await screen.findByRole('button', { name: '원래 담당자 조회 A-3001' }))
  const row = document.querySelector('[data-wiring-id="case.overview.connections.alert.3001"]')
  await waitFor(() => expect(row).toHaveTextContent('원래 담당자: 오분석'))
  expect(fetchReviewCases).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ALERT', query: 'A-3001' }))
})

it('Episode 연결 목록과 Alert별 비교는 원본 소수 금액을 정확히 더하고 통화를 분리한다', async () => {
  const rows = ['9007199254740993.123456', '0.000001'].map((amountPaid, index) => ({ ...member(index + 1), transaction: { ...member(index + 1).transaction, amountPaid } }))
  const episode = episodeCase(2)
  fetchReviewCase.mockResolvedValue({ ...episode, groups: [
    { ...episode.groups[0], members: [...rows, { ...member(3), transaction: { ...member(3).transaction, amountPaid: '7.123456', paymentCurrency: 'KRW' } }] },
    episode.groups[1],
  ] })
  render(<LiveCasesPage kind="EPISODE" caseId={50} onOpen={vi.fn()} onBack={vi.fn()} onOpenAlert={vi.fn()} />)
  const linked = await screen.findByRole('button', { name: 'A-3001 상세 보기' })
  expect(linked).toHaveTextContent('9,007,199,254,740,993.123457 USD')
  expect(linked).toHaveTextContent('7.123456 KRW')
  const comparison = document.querySelector('[data-wiring-id="case.overview.connections.alert.3001"]')
  expect(comparison).toHaveTextContent('9,007,199,254,740,993.123457 USD')
  expect(comparison).toHaveTextContent('7.123456 KRW')
})

it.each([null, '', ' ', 'bad', 'Infinity'])('Episode 통화 합계의 무효 금액 %s는 부분 합계를 완전 합계로 만들지 않는다', async amountPaid => {
  const episode = episodeCase(2)
  const unknown = { ...member(3), transaction: { ...member(3).transaction, amountPaid } }
  fetchReviewCase.mockResolvedValue({ ...episode, groups: [{ ...episode.groups[0], members: [member(1), unknown] }, episode.groups[1]] })
  render(<LiveCasesPage kind="EPISODE" caseId={50} onOpen={vi.fn()} onBack={vi.fn()} onOpenAlert={vi.fn()} />)
  const linked = await screen.findByRole('button', { name: 'A-3001 상세 보기' })
  expect(linked).toHaveTextContent('금액 확인 불가 USD')
  const comparison = document.querySelector('[data-wiring-id="case.overview.connections.alert.3001"]')
  expect(comparison).toHaveTextContent('금액 확인 불가 USD')
  expect(comparison).not.toHaveTextContent('10 USD')
})

it('Alert 근거와 거래 표는 null 금액을 0으로 바꾸지 않는다', async () => {
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { groups: [{ groupId: 0, label: '묶음', members: [{ ...member(1), transaction: { ...member(1).transaction, amountPaid: null } }] }] }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '이 거래 보기' }))
  expect(screen.getByRole('region', { name: '선택 근거 거래' })).toHaveTextContent('금액 확인 불가 USD')
  expect(screen.getByTestId('tx-table')).toHaveTextContent('금액 확인 불가')
  expect(screen.getByText('금액 확인 불가인 날짜가 있습니다. 누락된 금액은 0으로 표시하지 않습니다.')).toBeInTheDocument()
})

it('Episode 연결 해제는 사유와 2개 미만 해체 확인 뒤 전체 그룹 UNLINK를 보낸다', async () => {
  fetchReviewCase.mockResolvedValue(episodeCase(2))
  render(<LiveCasesPage kind="EPISODE" caseId={50} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('개요')
  fireEvent.click(await screen.findByRole('button', { name: '연결 Alert 선택' }))
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
  await showTab('개요')
  fireEvent.click(await screen.findByRole('button', { name: '연결 Alert 선택' }))
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
  await choose('판정', '이상거래 · Alert 단독')
  fireEvent.click(screen.getByRole('button', { name: '판정 확인' }))
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
  await waitFor(() => expect(screen.getByRole('button', { name: 'Episode로 묶기' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Episode로 묶기' }))
  expect(await screen.findByLabelText('A-3001 선택')).toBeInTheDocument()
  expect(screen.getByLabelText('A-3003 선택')).toBeDisabled()
  fireEvent.click(screen.getByLabelText('A-3001 선택'))
  fireEvent.click(screen.getByLabelText('A-3002 선택'))
  fireEvent.change(screen.getByLabelText('연결 의견'), { target: { value: '두 Alert 연결' } })
  fireEvent.click(screen.getByRole('button', { name: '연결 완료' }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalled())
  expect(submitReviewCommand.mock.calls[0][0]).toMatchObject({
    action: 'TRANSFER', targetCaseId: null, comment: '두 Alert 연결',
    selections: [{ caseId: 1, revision: 1001, groupId: 0, txIds: [] }, { caseId: 2, revision: 1002, groupId: 0, txIds: [] }],
  })
})

it('목록 편입 저장 후 재조회가 실패해도 저장 결과와 재조회 실패를 구분한다', async () => {
  let alertCalls = 0
  fetchReviewCases.mockImplementation(({ kind }: { kind: string }) => kind === 'ALERT' && ++alertCalls > 1
    ? Promise.reject(new TypeError('offline'))
    : Promise.resolve(kind === 'ALERT' ? page([alertCase(1, 3001), alertCase(2, 3002)]) : page([])))
  render(<LiveCasesPage kind="ALERT" onOpen={vi.fn()} onBack={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Episode로 묶기' }))
  fireEvent.click(await screen.findByLabelText('A-3001 선택'))
  fireEvent.click(screen.getByLabelText('A-3002 선택'))
  fireEvent.change(screen.getByLabelText('연결 의견'), { target: { value: '두 Alert 연결' } })
  fireEvent.click(screen.getByRole('button', { name: '연결 완료' }))
  await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('저장은 완료됐지만 최신 화면을 불러오지 못했습니다')))
  expect(submitReviewCommand).toHaveBeenCalledTimes(1)
  expect(toastError).not.toHaveBeenCalled()
})

it('필터가 바뀌면 이전 선택을 제출하지 않는다', async () => {
  render(<LiveCasesPage kind="ALERT" onOpen={vi.fn()} onBack={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Episode로 묶기' }))
  fireEvent.click(await screen.findByLabelText('A-3001 선택'))
  fireEvent.click(screen.getByRole('button', { name: /담당자: 내 담당.*제거/ }))
  expect(await screen.findByText(/0건 선택/)).toBeInTheDocument()
})

it('상세에서 새 Episode 안내는 목록 이동으로 연결한다', async () => {
  const onBack = vi.fn()
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={onBack} />)
  await showTab('검토 의견')
  await choose('판정', '이상거래 · 새 Episode 생성')
  fireEvent.change(screen.getByLabelText('변경 사유'), { target: { value: '함께 조사' } })
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
  expect(screen.getByText(/사건 전체 확률이 아닙니다/)).toBeInTheDocument()
})

it('Alert 근거의 포함 이유 코드와 날짜별 수신 범위를 원본 값 그대로 표시한다', async () => {
  const seed = { ...member(1), transaction: { ...member(1).transaction, includedReasons: ['PATH', 'SEED'] } }
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { publishedVersion: 3, groups: [{ groupId: 0, label: '묶음', members: [seed] }] }))
  fetchAlertEvidence.mockResolvedValue({ coverage: [{ businessDate: '2023-09-10', complete: false, expectedBanks: 3, completeBanks: 2 }],
    dataAsOf: '2023-09-10T12:00:00Z', lastCheckedAt: '2023-09-10T13:00:00Z' })
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  const coverage = await screen.findByText(/2023-09-10 · 수신 은행 2\/3개 · 미완료/)
  expect(coverage).toBeInTheDocument()
  expect(fetchAlertEvidence).toHaveBeenCalledWith(3001, 3)
  expect(screen.getByText(/포함 이유 코드 PATH, SEED/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '이 거래 보기' }))
  expect(await screen.findByText(/포함 이유 코드: PATH, SEED/)).toBeInTheDocument()
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

it('대표 유형 비중은 판단 요약에, 거래 차트는 거래 탭에 표시한다', async () => {
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { summary: {
    txCount: 3, subjectCount: 2, seedCount: 1, riskScore: 0.91, primaryType: 'Fan-out', typeShare: 0.5,
    amountsByCurrency: { KRW: 120000, USD: 70 }, firstTxAt: '2023-09-10T00:00:00Z', lastTxAt: '2023-09-11T00:00:00Z',
    paymentFormats: { WIRE: 2, CASH: 1 }, typeDistribution: { 'Fan-out': 2 },
  } }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  const overview = await screen.findByRole('region', { name: '판단 요약' })
  expect(overview).toHaveTextContent('대표 유형 비중 50.0%')
  expect(within(screen.getByRole('region', { name: '돈의 흐름' })).queryByText('일별 거래 금액')).not.toBeInTheDocument()
  expect(overview).toHaveTextContent('조사 대상 2건')
  expect(overview).toHaveTextContent('씨앗 거래 1건')
  fireEvent.click(screen.getByRole('tab', { name: /거래/ }))
  expect(screen.getByText('일별 거래 금액')).toBeInTheDocument()
})

it('Episode 거래 탭에도 사건 전체의 거래 차트를 표시한다', async () => {
  fetchReviewCase.mockResolvedValue(episodeCase(2))
  render(<LiveCasesPage kind="EPISODE" caseId={50} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('거래')
  expect(screen.getByText('일별 거래 금액')).toBeInTheDocument()
  expect(screen.getByText('상위 송금 계좌')).toBeInTheDocument()
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
  const accounts = await screen.findByRole('region', { name: '핵심 계좌' })
  const money = screen.getByRole('region', { name: '돈의 흐름' })
  expect(accounts).toHaveTextContent('집중도 75.0%')
  expect(accounts).toHaveTextContent('단시간 유출 50.0%')
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
  fireEvent.click(screen.getByRole('button', { name: '종결 확인' }))
  expect(screen.getByText(/참고 맥락·제외 거래에는 판정하지 않습니다/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '최종 종결 확정' }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalledWith(expect.objectContaining({ action: 'CLOSE', decision: 'NORMAL' }), expect.any(String)))
  expect(toastSuccess).toHaveBeenCalledWith('정상 종결 완료')
})

it('원장 수신이 미완이면 머리에 판단 경고를 보이고 정상 종결을 한 번 더 확인해 이력에 남긴다', async () => {
  fetchReviewMoney.mockResolvedValue({ available: true, complete: false, selectedAccounts: ['a'], external: [] })
  await open()
  expect(await screen.findByText(/원장 수신이 완료되지 않아 돈의 흐름은 현재 관측 범위까지만/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '종결 확인' }))
  fireEvent.click(screen.getByRole('button', { name: '최종 종결 확정' }))
  expect(await screen.findByText('수신이 덜 된 상태입니다. 그래도 종결하시겠어요?')).toBeInTheDocument()
  expect(submitReviewCommand).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '수신 미완 상태에서 정상 종결' }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalledWith(expect.objectContaining({
    action: 'CLOSE', decision: 'NORMAL', comment: '검토 완료\n수신 미완 상태에서 종결',
  }), expect.any(String)))
})

it('Alert 원본 수신 범위가 미완이면 money 계산이 완료돼도 정상 종결을 다시 확인한다', async () => {
  fetchReviewMoney.mockResolvedValue({ available: true, complete: true, selectedAccounts: ['a'], external: [] })
  fetchAlertEvidence.mockResolvedValue({ coverage: [{ businessDate: '2023-09-10', complete: false, expectedBanks: 3, completeBanks: 2 }] })
  await open()
  expect(await screen.findByText(/2023-09-10 · 수신 은행 2\/3개 · 미완료/)).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('정상 종결은 데이터가 완결된 뒤를 권장합니다.')
  fireEvent.click(screen.getByRole('button', { name: '수신 범위 보기' }))
  await waitFor(() => expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled())
  await showTab('검토 의견')
  fireEvent.click(screen.getByRole('button', { name: '종결 확인' }))
  fireEvent.click(screen.getByRole('button', { name: '최종 종결 확정' }))
  expect(await screen.findByText('수신이 덜 된 상태입니다. 그래도 종결하시겠어요?')).toBeInTheDocument()
  expect(submitReviewCommand).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '수신 미완 상태에서 정상 종결' }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalledWith(expect.objectContaining({
    action: 'CLOSE', decision: 'NORMAL', comment: '검토 완료\n수신 미완 상태에서 종결',
  }), expect.any(String)))
})

it('원장 수신 대기 중에는 산출 불가를 머리에서 알리고 의심 종결에는 추가 확인을 요구하지 않는다', async () => {
  fetchReviewMoney.mockResolvedValue({ available: false, reason: 'WAITING_RECEIPTS' })
  await open()
  expect(await screen.findByText(/원장 수신 완료를 기다리는 중이라 돈의 흐름을 산출할 수 없습니다/)).toBeInTheDocument()
  await choose('판정', '이상거래 · Alert 단독')
  fireEvent.click(screen.getByRole('button', { name: '판정 확인' }))
  fireEvent.click(screen.getByRole('button', { name: '최종 종결 확정' }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalledWith(expect.objectContaining({
    action: 'CLOSE', decision: 'SUSPICIOUS', comment: '검토 완료',
  }), expect.any(String)))
  expect(screen.queryByText('수신이 덜 된 상태입니다. 그래도 종결하시겠어요?')).not.toBeInTheDocument()
})

it('조사 대상이 없으면 최종 종결을 막고 안내한다', async () => {
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { groups: [] }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('검토 의견')
  expect(await screen.findByText('조사 대상 거래가 없어 최종 종결할 수 없습니다.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '종결 확인' })).toBeDisabled()
})

it('처리 대상이 아닌 TRANSFERRED 거래만 있으면 최종 종결을 막는다', async () => {
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { groups: [{ groupId: 0, label: '묶음', revision: 1, members: [{ ...member(1), state: 'TRANSFERRED' }] }] }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('검토 의견')
  expect(await screen.findByRole('button', { name: '종결 확인' })).toBeDisabled()
})

it('V12 초기화로 이전 사건이 404이면 목록 재선택을 안내한다', async () => {
  fetchReviewCase.mockRejectedValue(new ApiError({ type: 'about:blank', title: 'Not Found', status: 404, code: 'NOT_FOUND' }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  expect(await screen.findByText(/목록에서 다시 선택해 주세요/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '목록으로' })).not.toBeInTheDocument()
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
  expect(screen.getByRole('button', { name: '종결 확인' })).toBeDisabled()
})

it('네트워크 실패 후 같은 UUID와 본문으로 재시도한다', async () => {
  submitReviewCommand.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ caseIds: [1], targetCaseId: 50 })
  await open()
  await choose('판정', '이상거래 · 기존 Episode 연결')
  await choose('연결할 Episode', 'E-50')
  fireEvent.click(screen.getByRole('button', { name: 'Episode 연결 확인' }))
  fireEvent.click(await screen.findByRole('button', { name: '같은 요청 재시도' }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalledTimes(2))
  expect(submitReviewCommand.mock.calls[1]).toEqual(submitReviewCommand.mock.calls[0])
})

it('409가 나면 최신 내용을 재조회하고 자동 재제출하지 않는다', async () => {
  submitReviewCommand.mockRejectedValueOnce(new ApiError({ type: 'about:blank', title: 'Conflict', status: 409, code: 'INVALID_TRANSITION' }))
  await open()
  await choose('판정', '이상거래 · 기존 Episode 연결')
  await choose('연결할 Episode', 'E-50')
  fireEvent.click(screen.getByRole('button', { name: 'Episode 연결 확인' }))
  await waitFor(() => expect(fetchReviewCase).toHaveBeenCalledTimes(2))
  expect(submitReviewCommand).toHaveBeenCalledTimes(1)
  expect(toastError).toHaveBeenCalledWith(expect.stringContaining('최신 내용을 확인'))
})

it('기존 Episode 편입은 목적지 revision을 함께 보낸다', async () => {
  await open()
  await choose('판정', '이상거래 · 기존 Episode 연결')
  await choose('연결할 Episode', 'E-50')
  fireEvent.click(screen.getByRole('button', { name: 'Episode 연결 확인' }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalled())
  expect(submitReviewCommand.mock.calls[0][0]).toMatchObject({ action: 'TRANSFER', targetCaseId: 50, targetRevision: 7, selections: [{ caseId: 1, groupId: 0, txIds: [] }] })
})

it('저장은 성공하고 자금 지표 재조회만 실패하면 저장 성공을 분명히 안내한다', async () => {
  fetchReviewMoney.mockResolvedValueOnce({ available: false, reason: 'EMPTY_SUBJECT_SCOPE' }).mockRejectedValueOnce(new TypeError('offline'))
  await open()
  fireEvent.click(screen.getByRole('button', { name: '종결 확인' }))
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
  await choose('판정', '이상거래 · 기존 Episode 연결')
  fireEvent.click(await screen.findByRole('button', { name: '다음 Episode 목적지' }))
  expect(fetchReviewCases).toHaveBeenCalledWith({ kind: 'EPISODE', status: 'OPEN', page: 1, size: 20 })
  fireEvent.keyDown(await screen.findByRole('combobox', { name: '연결할 Episode' }), { key: 'ArrowDown' })
  expect(await screen.findByRole('option', { name: /E-51/ })).toBeInTheDocument()
})


it('Episode 연결 목록의 원본 Alert ID를 조사 caseId로 조회해 이동한다', async () => {
  fetchReviewCase.mockResolvedValue(episodeCase(2))
  const onOpenAlert = vi.fn()
  render(<LiveCasesPage kind="EPISODE" caseId={50} onOpen={vi.fn()} onBack={vi.fn()} onOpenAlert={onOpenAlert} />)
  fireEvent.click(await screen.findByRole('button', { name: 'A-3001 상세 보기' }))
  await waitFor(() => expect(onOpenAlert).toHaveBeenCalledWith(1))
  expect(fetchReviewCases).toHaveBeenCalledWith({ kind: 'ALERT', query: 'A-3001', page: 0, size: 100 })
})


it.each(['ALERT', 'EPISODE'] as const)('%s 개요는 실제 자금 API와 조사 범위 집계를 구분해 표시한다', async kind => {
  const seed = { ...member(1), transaction: { ...member(1).transaction, amountPaid: '10.00' } }
  const context = { ...member(2), reviewRole: 'CONTEXT', transaction: { ...member(2).transaction, fromAccountId: 'b', toAccountId: 'c', role: 'CONTEXT', isSuspicious: false, amountPaid: '25.00', paymentCurrency: 'MXN', occurredAt: '2023-09-11T03:57:00Z' } }
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, {
    kind,
    groups: [
      { groupId: 1, members: [seed, context, { ...member(3), state: 'EXCLUDED' }] },
      { groupId: 2, members: [seed, { ...member(4), state: 'TRANSFERRED' }] },
    ],
  }))
  fetchReviewMoney.mockResolvedValue({ available: true, external: [{ currency: 'MXN', in: 200, out: 50, net: 150 }], externalUsd: { in: 10, out: 2.5, net: 7.5 } })
  render(<LiveCasesPage kind={kind} caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  const money = await screen.findByRole('region', { name: '돈의 흐름' })
  await waitFor(() => expect(money).toHaveTextContent('외부 유입 · MXN200'))
  expect(money).toHaveTextContent('순유입 150')
  expect(money).toHaveTextContent('외부 유출 · MXN50')
  expect(money).toHaveTextContent('USD 환산: 유입 10 USD · 순유입 7.5 USD')
  expect(money).toHaveTextContent('거래 기간 09-10 09:00 ~ 09-11 12:57')
  expect(money.querySelector('[data-wiring-id="case.overview.money.flow"]')).toBeInTheDocument()
  expect(money).not.toHaveTextContent('위험도')
})

it('자금 지표 산출 불가를 0원으로 표시하지 않는다', async () => {
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  const money = await screen.findByRole('region', { name: '돈의 흐름' })
  await waitFor(() => expect(money).toHaveTextContent('조사 거래 범위가 없습니다.'))
  expect(money).not.toHaveTextContent('외부 순유입 0')
})

it('Alert 개요의 씨앗 거래 수에서 같은 사건의 근거 거래로 이동한다', async () => {
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '씨앗 1건 거래 보기' }))
  const selected = screen.getByRole('region', { name: '선택 근거 거래' })
  expect(selected).toHaveTextContent('T-1')
  expect(selected).toHaveTextContent('a → b')
  expect(screen.getByRole('tab', { name: /거래/ })).toHaveAttribute('aria-selected', 'true')
})

it('Episode 개요는 연결 Alert와 관측된 공유 계좌를 먼저 보이고 조회 전 원 담당자를 추정하지 않는다', async () => {
  const episode = episodeCase(2)
  fetchReviewCase.mockResolvedValue({ ...episode,
    accounts: [{ id: 'a', ownerId: 'owner-a', ownerName: '가상 소유주 A', bankId: 1 }],
    groups: episode.groups.map((group, index) => ({ ...group, decision: index ? null : 'NORMAL' })),
    history: [{ eventId: 9, action: 'TRANSFER', comment: '함께 조사', businessAt: '2023-09-10T00:00:00Z', recordedAt: '2023-09-10T00:00:00Z', actor: '조사자' }],
  })
  render(<LiveCasesPage kind="EPISODE" caseId={50} onOpen={vi.fn()} onBack={vi.fn()} />)
  const panels = (await screen.findByTestId('overview-all')).children
  expect(panels[0]).toHaveTextContent('1 연결 Alert와 편입 근거')
  expect(panels[1]).toHaveTextContent('2 공유 계좌와 소유주')
  expect(panels[0]).toHaveTextContent('묶음 판정 1/2')
  expect(panels[0]).toHaveTextContent('함께 조사')
  expect(panels[0]).toHaveTextContent('원래 담당자: 확인 전')
  expect(panels[1]).toHaveTextContent('A-3001 · 송금 1건')
  expect(panels[1]).toHaveTextContent('A-3002 · 송금 1건')
})

it('USD 환산값이 없으면 0이나 NaN 대신 미제공을 표시한다', async () => {
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { groups: [{ groupId: 1, members: [{ ...member(1), transaction: { ...member(1).transaction, amountUsd: null } }] }] }))
  fetchReviewMoney.mockResolvedValue({ available: true, external: [{ currency: 'SAR', in: 10, out: 20, net: -10 }] })
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  const money = await screen.findByRole('region', { name: '돈의 흐름' })
  await waitFor(() => expect(money).toHaveTextContent('USD 환산액 미제공'))
  expect(money).toHaveTextContent('순유입 -10')
  expect(money).not.toHaveTextContent('NaN')
})

it('USD 보조 금액 문자열은 Number 변환 없이 원본 소수 정밀도를 표시한다', async () => {
  fetchReviewMoney.mockResolvedValue({ available: true, external: [{ currency: 'SAR', in: 10, out: 20, net: -10 }], externalUsd: { in: '9007199254740993.123456', net: '0.123456' } })
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  const money = await screen.findByRole('region', { name: '돈의 흐름' })
  await waitFor(() => expect(money).toHaveTextContent('USD 환산: 유입 9,007,199,254,740,993.123456 USD · 순유입 0.123456 USD'))
})

it('개요 패널 1·2는 전폭이고 패널별 보기의 근거 설명과 버튼은 같은 행에 있다', async () => {
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  const overview = await screen.findByRole('region', { name: 'Alert 개요' })
  const panels = screen.getByTestId('overview-all').children
  expect(panels).toHaveLength(5)
  expect(panels[0]).toHaveClass('xl:col-span-12')
  expect(panels[1]).toHaveClass('xl:col-span-12')
  expect(overview).toHaveTextContent('룰 평가 결과 API 미연동')
  expect(screen.getByRole('button', { name: '근거 보기' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '패널별 보기' }))
  const row = screen.getByTestId('rule-evidence-row')
  expect(row).toHaveClass('lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]')
  expect(row.querySelector('[data-wiring-id="case.overview.rules.explanation"]')).toContainElement(screen.getByRole('button', { name: '근거 보기' }))
  expect(screen.getByTestId('overview-focus')).toHaveTextContent('1/5')
  fireEvent.click(screen.getByRole('button', { name: '다음 패널' }))
  expect(screen.getByTestId('overview-focus')).toHaveTextContent('2/5')
  expect(screen.getByTestId('overview-focus').querySelector('[data-wiring-id="case.overview.money.chart"]')).toBeInTheDocument()
  expect(screen.getByTestId('overview-focus').querySelector('[data-wiring-id="case.overview.money.explanation"]')).toBeInTheDocument()
})

it('패널별 보기 방향키는 패널 안에서 이동하고 입력·보조키와 양 끝은 보호한다', async () => {
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  await screen.findByRole('region', { name: 'Alert 개요' })
  fireEvent.click(screen.getByRole('button', { name: '패널별 보기' }))
  const focus = screen.getByTestId('overview-focus')
  const heading = () => focus.querySelector('[data-focus-heading]')!
  fireEvent.keyDown(heading(), { key: 'ArrowRight' })
  expect(focus).toHaveTextContent('2/5')
  fireEvent.keyDown(screen.getByRole('button', { name: '다음 패널' }), { key: 'ArrowRight' })
  expect(focus).toHaveTextContent('3/5')
  const editor = document.createElement('input')
  focus.querySelector('[data-focus-panel]')!.append(editor)
  fireEvent.keyDown(editor, { key: 'ArrowLeft' })
  fireEvent.keyDown(heading(), { key: 'ArrowRight', ctrlKey: true })
  expect(focus).toHaveTextContent('3/5')
  fireEvent.keyDown(heading(), { key: 'ArrowLeft' })
  expect(focus).toHaveTextContent('2/5')
  fireEvent.click(screen.getByRole('button', { name: '마지막 패널' }))
  expect(focus).toHaveTextContent('5/5')
  expect(screen.getByRole('button', { name: '다음 패널' })).toBeDisabled()
  fireEvent.keyDown(heading(), { key: 'ArrowRight' })
  expect(focus).toHaveTextContent('5/5')
  fireEvent.click(screen.getByRole('button', { name: '전체 보기' }))
  fireEvent.click(screen.getByRole('button', { name: '패널별 보기' }))
  expect(focus).toHaveTextContent('5/5')
})

it.each([
  { kind: 'ALERT', status: 'OPEN', episodeId: null, label: '진행 중 · 단독 Alert', tone: 'pending' },
  { kind: 'ALERT', status: 'CLOSED', episodeId: 50, label: '진행 중 · Episode', tone: 'working' },
  { kind: 'ALERT', status: 'CLOSED', episodeId: null, label: '종결', tone: 'closed' },
  { kind: 'EPISODE', status: 'OPEN', episodeId: null, label: '진행 중 · Episode', tone: 'working' },
  { kind: 'EPISODE', status: 'CLOSED', episodeId: null, label: '종결', tone: 'closed' },
] as const)('$kind 상세는 목록 기준 $label 배지를 사용한다 ($status, $episodeId)', async ({ kind, status, episodeId, label, tone }) => {
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { kind, status, episodeId }))
  render(<LiveCasesPage kind={kind} caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  const tags = await screen.findByTestId('detail-tags')
  expect(within(tags).getByText(label)).toHaveAttribute('data-tone', tone)
})


it('Alert 연결 근거의 현재 대표 사건으로 이동하고 조회된 거래와 미제공을 구분한다', async () => {
  const onOpen = vi.fn()
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { relatedFlows: [
    { kind: 'BOUNDARY_CAP', txIds: [1, 2], relatedAlertIds: [3002] },
  ] }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={onOpen} onBack={vi.fn()} />)
  const relations = await screen.findByRole('region', { name: '다른 Alert와의 연결 근거' })
  expect(relations).toHaveTextContent('T-1 · T-2')
  expect(relations).toHaveTextContent('거래 건수 한도')
  fireEvent.click(within(relations).getByRole('button', { name: 'Alert A-3002 보기' }))
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith(2))
  expect(submitReviewCommand).not.toHaveBeenCalled()
})

it.each([undefined, []])('연결 근거 %s를 검색 결과 전체 0건으로 바꾸지 않는다', async relatedFlows => {
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { relatedFlows }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  const relations = await screen.findByRole('region', { name: '다른 Alert와의 연결 근거' })
  expect(relations).toHaveTextContent(relatedFlows ? '현재 근거에 기록된 Alert 연결이 없습니다.' : 'Alert 연결 근거가 제공되지 않았습니다.')
  expect(relations).toHaveTextContent('전체 관련 사건 검색 결과가 아닙니다.')
})

it('제외 거래 수는 현재 조사 거래에서 빠진 거래도 중복 없이 센다', async () => {
  const excluded = { ...member(2), state: 'EXCLUDED' }
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { groups: [
    { groupId: 0, label: '현재', revision: 1, members: [member(1), excluded] },
    { groupId: 1, label: '중복', revision: 1, members: [excluded] },
  ] }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '패널별 보기' }))
  fireEvent.click(screen.getByRole('button', { name: '마지막 패널' }))
  const visual = screen.getByTestId('focus-visual')
  const label = within(visual).getByText('제외')
  expect(label.parentElement).toHaveTextContent('1')
  expect(label.parentElement).not.toHaveTextContent('0')
})


it('사건을 나갔다 돌아와도 미저장 의견을 복원하고 다른 사건에는 섞지 않는다', async () => {
  fetchReviewCase.mockImplementation(async (id: number) => alertCase(id, 3000 + id))
  const store = new WorkspaceState()
  const open = (id: number) => <WorkspaceContext.Provider value={store}><LiveCasesPage kind="ALERT" caseId={id} onOpen={vi.fn()} onBack={vi.fn()} /></WorkspaceContext.Provider>
  const first = render(open(1))
  await showTab('검토 의견')
  fireEvent.change(screen.getByLabelText('변경 사유'), { target: { value: '거래 확인 중인 미저장 의견' } })
  first.unmount()
  const other = render(open(2))
  await showTab('검토 의견')
  expect(screen.getByLabelText('변경 사유')).toHaveValue('')
  other.unmount()
  render(open(1))
  await showTab('검토 의견')
  expect(screen.getByLabelText('변경 사유')).toHaveValue('거래 확인 중인 미저장 의견')
  expect(submitReviewCommand).not.toHaveBeenCalled()
})

it('실제 응답 계좌의 송금·수취 소유주를 거래 표에 표시하고 mock 이동을 만들지 않는다', async () => {
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { accounts: [
    { id: 'a', ownerId: 'owner-a', ownerName: '가상 송금 소유주', bankId: 1 },
    { id: 'b', ownerId: 'owner-b', ownerName: '가상 수취 소유주', bankId: 2 },
  ] }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('거래')
  const table = screen.getByTestId('tx-table')
  expect(table).toHaveTextContent('가상 송금 소유주')
  expect(table).toHaveTextContent('가상 수취 소유주')
  expect(within(table).queryByRole('button', { name: /가상.*거래 내역에서 보기/ })).not.toBeInTheDocument()
})


it('실제 상세 그래프는 시간순 그래프와 실제 거래 조사 callback을 사용한다', async () => {
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('그래프')
  expect(await screen.findByTestId('live-timegraph')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '선택한 조사 거래 보기' }))
  expect(screen.getByRole('region', { name: '선택 근거 거래' })).toHaveTextContent('T-1')
})


it('사건 근거 버전은 표시하지만 미제공 모델 버전을 현재 모델로 추정하지 않는다', async () => {
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { publishedVersion: 3 }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  expect(await screen.findByText('근거 v3')).toBeInTheDocument()
  expect(screen.getByText('이 사건 모델 버전 미확인')).toBeInTheDocument()
  expect(screen.getByTestId('pattern-candidates')).toHaveTextContent('현재 서버 계약의 유형 모델은 시연용입니다. 이 거래의 실행·버전은 미확인입니다.')
  expect(screen.queryByText('gnn-binary-v10')).not.toBeInTheDocument()
})

it('Episode 판정 재검토는 사유와 확인 뒤 해당 묶음을 미판정으로 되돌린다', async () => {
  const item = episodeCase(2)
  const group = item.groups[0]
  fetchReviewCase.mockResolvedValue({ ...item, groups: [
    { ...group, decision: 'NORMAL', members: group.members.map(row => ({ ...row, state: 'DECIDED', decision: 'NORMAL' })) },
    item.groups[1],
  ] })
  render(<LiveCasesPage kind="EPISODE" caseId={50} onOpen={vi.fn()} onBack={vi.fn()} />)
  await showTab('검토 의견')
  const button = screen.getByRole('button', { name: 'Alert A-3001 판정 다시 검토' })
  expect(button).toBeDisabled()
  fireEvent.change(screen.getByLabelText('변경 사유'), { target: { value: '추가 근거 재검토' } })
  fireEvent.click(button)
  expect(screen.getByRole('alertdialog')).toHaveTextContent('기존 판정은 이력에 보존')
  expect(submitReviewCommand).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '판정 재검토 확정' }))
  await waitFor(() => expect(submitReviewCommand).toHaveBeenCalledWith(expect.objectContaining({
    action: 'RECONSIDER', selections: [{ caseId: 50, revision: 7, groupId: group.groupId, txIds: group.members.map(row => row.txId) }],
    decision: null, targetCaseId: null, targetRevision: null, targetGroupId: null, comment: '추가 근거 재검토',
  }), expect.any(String)))
})


it('개요에서 전체 조사 계좌를 열고 계좌 거래를 고르면 거래 보기로 이어진다', async () => {
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '전체 조사 계좌 보기' }))
  expect(screen.getByRole('button', { name: '계좌 보기' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'a 조사 거래 보기' }))
  expect(screen.getByRole('button', { name: '거래 보기' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('region', { name: '선택 근거 거래' })).toHaveTextContent('T-1')
  expect(submitReviewCommand).not.toHaveBeenCalled()
})


it('401로 작업 공간이 사라진 뒤 같은 직원이 로그인해도 의견 초안을 복원한다', async () => {
  const mount = () => render(<WorkspaceContext.Provider value={new WorkspaceState()}><LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} /></WorkspaceContext.Provider>)
  const original = mount()
  await showTab('검토 의견')
  fireEvent.change(screen.getByLabelText('변경 사유'), { target: { value: '세션 만료 전 입력한 검토 근거' } })
  original.unmount()
  mount()
  await showTab('검토 의견')
  expect(screen.getByLabelText('변경 사유')).toHaveValue('세션 만료 전 입력한 검토 근거')
  expect(submitReviewCommand).not.toHaveBeenCalled()
})


it('Episode 판정 필드가 미제공이면 마지막 패널에서 미판정으로 바꾸지 않는다', async () => {
  const item = episodeCase(2)
  fetchReviewCase.mockResolvedValue({ ...item, groups: item.groups.map(group => ({ ...group, decision: undefined })) })
  render(<LiveCasesPage kind="EPISODE" caseId={50} onOpen={vi.fn()} onBack={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '패널별 보기' }))
  fireEvent.click(screen.getByRole('button', { name: '마지막 패널' }))
  expect(within(screen.getByTestId('focus-visual')).getAllByText('판정 상태 미제공')).toHaveLength(2)
})


it('다른 직원 로그인과 로그아웃 화면에는 이전 직원 의견을 노출하지 않는다', async () => {
  writeMemory('case-draft/11/ALERT/1', '직원11만 보는 미저장 초안')
  writeMemory('case-draft/12/ALERT/1', '')
  const first = render(<CurrentUserContext.Provider value={{ ...MOCK_USER, userId: 12, name: '합성 다른 직원' }}><LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} /></CurrentUserContext.Provider>)
  await showTab('검토 의견')
  expect(screen.getByLabelText('변경 사유')).toHaveValue('')
  expect(screen.queryByDisplayValue('직원11만 보는 미저장 초안')).not.toBeInTheDocument()
  first.unmount()
  const loggedOut = render(<div>직원 로그인 화면</div>)
  expect(screen.queryByLabelText('변경 사유')).not.toBeInTheDocument()
  loggedOut.unmount()
  render(<CurrentUserContext.Provider value={MOCK_USER}><LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} /></CurrentUserContext.Provider>)
  await showTab('검토 의견')
  expect(screen.getByLabelText('변경 사유')).toHaveValue('직원11만 보는 미저장 초안')
})

it('사건 응답 ID가 다르면 해당 사건의 초안과 제어를 렌더하지 않는다', async () => {
  writeMemory('case-draft/11/ALERT/2', '두 번째 사건만의 초안')
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001))
  render(<LiveCasesPage kind="ALERT" caseId={2} onOpen={vi.fn()} onBack={vi.fn()} />)
  expect(await screen.findByText('요청한 사건과 조회된 정보가 다릅니다. 다시 조회해 주세요.')).toBeInTheDocument()
  expect(screen.queryByLabelText('변경 사유')).not.toBeInTheDocument()
  expect(screen.queryByDisplayValue('두 번째 사건만의 초안')).not.toBeInTheDocument()
})


it('개요의 다른 사건 보존 판정에서 정확한 Episode 조사로 이동한다', async () => {
  const onOpenEpisode = vi.fn()
  fetchReviewCase.mockResolvedValue(alertCase(1, 3001, { relatedDecisions: [
    { caseId: 50, kind: 'EPISODE', status: 'CLOSED', groupId: 2, txId: '1', decision: 'SUSPICIOUS' },
  ], withdrawnMembers: [], pendingProposalIds: [], relations: [], canonicalAlertId: 3001 }))
  render(<LiveCasesPage kind="ALERT" caseId={1} onOpen={vi.fn()} onBack={vi.fn()} onOpenEpisode={onOpenEpisode} />)
  const records = await screen.findByRole('region', { name: '사건 연결·보존 판정' })
  const summary = within(records).getByText('다른 사건의 판정 · 1건')
  summary.parentElement!.setAttribute('open', '')
  fireEvent.click(within(records).getByRole('button', { name: 'Episode E-50 보기' }))
  expect(onOpenEpisode).toHaveBeenCalledWith(50)
  expect(submitReviewCommand).not.toHaveBeenCalled()
})
