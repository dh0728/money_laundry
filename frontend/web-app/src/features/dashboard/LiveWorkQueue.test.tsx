import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { LiveWorkQueue, QueueItems } from './LiveWorkQueue'
import { PeriodContext, WorkspaceContext, WorkspaceState, type Period } from '@/lib/workspaceState'

const { fetchReviewCases } = vi.hoisted(() => ({ fetchReviewCases: vi.fn() }))
vi.mock('@/api/liveReview', () => ({ fetchReviewCases }))
vi.mock('@/app/session', () => ({ useCurrentUser: () => ({ userId: 11 }) }))

it.each([true, false])('선택 기간은 personal=%s의 완료 업무에만 전달한다', async personal => {
  fetchReviewCases.mockReset().mockResolvedValue({ content: [], totalElements: 0, totalPages: 0 })
  render(<PeriodContext.Provider value={{ period: { from: '2026-10-01', to: '2026-10-21' }, setPeriod: vi.fn() }}><LiveWorkQueue personal={personal} /></PeriodContext.Provider>)
  await waitFor(() => expect(fetchReviewCases).toHaveBeenCalledTimes(4))
  for (const kind of ['ALERT', 'EPISODE']) {
    expect(fetchReviewCases).toHaveBeenCalledWith({ kind, statuses: ['CLOSED'], assigneeId: personal ? 11 : undefined, page: 0, size: personal ? 5 : 20, from: '2026-10-01', to: '2026-10-21' })
    expect(fetchReviewCases).toHaveBeenCalledWith({ kind, statuses: ['OPEN'], assigneeId: personal ? 11 : undefined, page: 0, size: personal ? 5 : 20 })
  }
})

it('완료 업무는 기간 변경 시 첫 페이지를 조회하고 기존 기간으로 돌아오면 페이지를 복원한다', async () => {
  const store = new WorkspaceState()
  fetchReviewCases.mockReset().mockResolvedValue({ content: [], totalElements: 60, totalPages: 3 })
  const queue = (period: Period) => <WorkspaceContext.Provider value={store}><PeriodContext.Provider value={{ period, setPeriod: vi.fn() }}><QueueItems kind="ALERT" status="CLOSED" /></PeriodContext.Provider></WorkspaceContext.Provider>
  const view = render(queue({ from: '2026-10-01', to: '2026-10-21' }))
  fireEvent.click(await screen.findByRole('button', { name: '다음' }))
  await waitFor(() => expect(fetchReviewCases).toHaveBeenLastCalledWith({ kind: 'ALERT', statuses: ['CLOSED'], assigneeId: 11, page: 1, size: 20, from: '2026-10-01', to: '2026-10-21' }))
  expect(await screen.findByText('2/3')).toBeInTheDocument()
  view.rerender(queue({ from: '2026-09-01', to: '2026-09-30' }))
  await waitFor(() => expect(fetchReviewCases).toHaveBeenLastCalledWith({ kind: 'ALERT', statuses: ['CLOSED'], assigneeId: 11, page: 0, size: 20, from: '2026-09-01', to: '2026-09-30' }))
  expect(await screen.findByText('1/3')).toBeInTheDocument()
  view.rerender(queue({ from: '2026-10-01', to: '2026-10-21' }))
  expect(await screen.findByText('2/3')).toBeInTheDocument()
})

it('대기 업무는 기간 변경에도 전체 기간 조회와 현재 페이지를 유지한다', async () => {
  const store = new WorkspaceState()
  fetchReviewCases.mockReset().mockResolvedValue({ content: [], totalElements: 60, totalPages: 3 })
  const queue = (period: Period) => <WorkspaceContext.Provider value={store}><PeriodContext.Provider value={{ period, setPeriod: vi.fn() }}><QueueItems kind="ALERT" status="OPEN" /></PeriodContext.Provider></WorkspaceContext.Provider>
  const view = render(queue({ from: '2026-10-01', to: '2026-10-21' }))
  fireEvent.click(await screen.findByRole('button', { name: '다음' }))
  await waitFor(() => expect(fetchReviewCases).toHaveBeenLastCalledWith({ kind: 'ALERT', statuses: ['OPEN'], assigneeId: 11, page: 1, size: 20 }))
  expect(await screen.findByText('2/3')).toBeInTheDocument()
  const count = fetchReviewCases.mock.calls.length
  view.rerender(queue({ from: '2026-09-01', to: '2026-09-30' }))
  expect(screen.getByText('2/3')).toBeInTheDocument()
  expect(fetchReviewCases).toHaveBeenCalledTimes(count)
})

it.each([true, false])('업무 현황의 personal=%s 범위를 네 상태 조회에 적용한다', async personal => {
  fetchReviewCases.mockReset().mockResolvedValue({ content: [], totalElements: 0, totalPages: 0 })
  render(<LiveWorkQueue personal={personal} />)
  await waitFor(() => expect(fetchReviewCases).toHaveBeenCalledTimes(4))
  for (const [kind, status] of [['ALERT', 'OPEN'], ['EPISODE', 'OPEN'], ['ALERT', 'CLOSED'], ['EPISODE', 'CLOSED']]) {
    expect(fetchReviewCases).toHaveBeenCalledWith({ kind, statuses: [status], assigneeId: personal ? 11 : undefined, page: 0, size: personal ? 5 : 20 })
  }
  expect(screen.getAllByTestId('work-status-column')).toHaveLength(personal ? 4 : 3)
})

it('개인 보드의 열린 Alert는 단계 확인 불가에 놓고 원본 ID가 아닌 사건 ID로 상세에 연결한다', async () => {
  const openAlert = {
    caseId: 42, kind: 'ALERT', alertId: 3000, status: 'OPEN', outcome: null,
    summary: { riskScore: 0.8, txCount: 3, amountsByCurrency: { KRW: 1000 }, primaryType: 'Fan-out' },
    ageDays: 1,
  }
  fetchReviewCases.mockReset().mockImplementation(async query => ({
    content: query.kind === 'ALERT' && query.statuses?.[0] === 'OPEN' ? [openAlert] : [],
    totalElements: query.kind === 'ALERT' && query.statuses?.[0] === 'OPEN' ? 1 : 0,
    totalPages: 1,
  }))
  render(<LiveWorkQueue personal />)
  const unclassified = screen.getByText('열린 사건 · 단계 확인 불가').closest('section')!
  const card = await within(unclassified).findByRole('link', { name: 'A-3000 상세 보기' })
  expect(card).toHaveAttribute('href', '#alerts/42')
  expect(card).toHaveTextContent('1,000 KRW')
  for (const column of screen.getAllByTestId('work-status-column').slice(0, 3)) {
    expect(within(column).queryByTestId('work-card')).toBeNull()
  }
})
