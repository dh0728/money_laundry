import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import LiveGlobalSearch from './LiveGlobalSearch'

const { cases, notifications } = vi.hoisted(() => ({ cases: vi.fn(), notifications: vi.fn() }))
vi.mock('@/api/liveReview', () => ({ fetchReviewCases: cases }))
vi.mock('@/api/notifications', () => ({ fetchNotifications: notifications }))
vi.mock('@/mocks/notifications', () => ({ loadMockNotifications: () => { throw new Error('live에서 mock 호출 금지') } }))
beforeEach(() => {
  vi.clearAllMocks()
  cases.mockImplementation(({ kind }: { kind: string }) => Promise.resolve({ content: kind === 'ALERT' ? [{ caseId: 99, alertId: 777, assigneeName: '직원' }] : [] }))
  notifications.mockResolvedValue({ content: [{ id: 'n1', title: '실제 알림', code: 'E-9' }] })
})
it('공통 검색 UI에서 전체 서버 검색을 하고 표시 Alert ID와 이동 caseId를 구분한다', async () => {
  const navigate = vi.fn()
  render(<LiveGlobalSearch onNavigate={navigate} />)
  const input = screen.getByRole('combobox', { name: '전역 검색' })
  fireEvent.focus(input)
  expect(cases).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: '777' } })
  fireEvent.click(await screen.findByRole('option', { name: /A-777/ }))
  expect(cases).toHaveBeenCalledWith({ kind: 'ALERT', query: '777', size: 5 })
  expect(notifications).toHaveBeenCalledWith('', '', '777', 0)
  expect(navigate).toHaveBeenCalledWith('alerts', 99)
})
it('서버 오류를 mock 결과로 대체하지 않고 오류를 표시한다', async () => {
  cases.mockRejectedValue(new Error('연결 실패'))
  render(<LiveGlobalSearch onNavigate={vi.fn()} />)
  const input = screen.getByRole('combobox', { name: '전역 검색' })
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '오류' } })
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  expect(screen.queryByText('실제 알림')).not.toBeInTheDocument()
})
