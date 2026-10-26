import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import LiveNotificationsPage from './LiveNotificationsPage'
import { fetchNotifications, fetchNotificationCases, setNotificationsRead, type WorkNotification } from '@/api/notifications'

vi.mock('@/api/notifications', () => ({ fetchNotifications: vi.fn(), fetchNotificationCases: vi.fn(), setNotificationsRead: vi.fn() }))
vi.mock('@/components/DateRangeButton', () => ({ DateRangeButton: ({ onChange }: { onChange: (value: { from: Date; to: Date }) => void }) => <button onClick={() => onChange({ from: new Date(2023, 8, 1), to: new Date(2023, 8, 3) })}>테스트 기간 적용</button> }))
const batch: WorkNotification = { id: 'batch:run', kind: 'ALERT_ASSIGNED', title: '새 Alert 배정', description: '2건 배정', code: 'ANALYSIS-52', at: '2023-09-02T09:00:00+09:00', read: false, count: 2, caseId: null, caseKind: 'ALERT' }
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(fetchNotifications).mockResolvedValue({ content: [batch], number: 0, size: 20, totalElements: 1, totalPages: 1, unreadCount: 1 })
  vi.mocked(setNotificationsRead).mockResolvedValue({ updated: 1 })
  vi.mocked(fetchNotificationCases).mockResolvedValue({ content: [{ caseId: 99, alertId: 42, kind: 'ALERT', status: 'OPEN' }], number: 0, size: 20, totalElements: 1, totalPages: 1 })
})
it('배정 묶음을 읽음 처리하고 실제 사건 ID로 상세 이동한다', async () => {
  const open = vi.fn()
  render(<LiveNotificationsPage onOpen={open} />)
  fireEvent.click(await screen.findByText('새 Alert 배정 · 2건'))
  fireEvent.click(await screen.findByRole('button', { name: 'A-42 · 미종결' }))
  expect(setNotificationsRead).toHaveBeenCalledWith(['batch:run'], true)
  expect(fetchNotificationCases).toHaveBeenCalledWith('batch:run', 0)
  expect(open).toHaveBeenCalledWith('ALERT', 99)
})
it('읽음 실패는 성공으로 표시하거나 사건 이동하지 않는다', async () => {
  vi.mocked(setNotificationsRead).mockRejectedValue(new Error('offline'))
  const open = vi.fn()
  render(<LiveNotificationsPage onOpen={open} />)
  fireEvent.click(await screen.findByText('새 Alert 배정 · 2건'))
  expect(await screen.findByRole('alert')).toHaveTextContent('읽음 상태를 변경하거나 확인하지 못했습니다')
  expect(open).not.toHaveBeenCalled()
  expect(fetchNotificationCases).not.toHaveBeenCalled()
})
it('검색과 기간을 서버에 전달하고 현재 페이지의 미확인 알림만 읽음 처리한다', async () => {
  render(<LiveNotificationsPage onOpen={vi.fn()} />)
  await screen.findByText('새 Alert 배정 · 2건')
  fireEvent.click(screen.getByRole('button', { name: '테스트 기간 적용' }))
  fireEvent.change(screen.getByLabelText('알림 검색'), { target: { value: '배정' } })
  await waitFor(() => expect(fetchNotifications).toHaveBeenLastCalledWith('2023-09-01', '2023-09-03', '배정', 0))
  fireEvent.click(await screen.findByRole('button', { name: '현재 페이지 모두 읽음' }))
  await waitFor(() => expect(setNotificationsRead).toHaveBeenCalledWith(['batch:run'], true))
})
it('기존 읽음 상태를 서버에서 복원하고 단건 Episode를 연다', async () => {
  vi.mocked(fetchNotifications).mockResolvedValue({ content: [{ ...batch, id: 'event:4', title: '사건 종결', read: true, count: 1, caseId: 81, caseKind: 'EPISODE' }], number: 0, size: 20, totalElements: 1, totalPages: 1, unreadCount: 0 })
  const open = vi.fn()
  render(<LiveNotificationsPage onOpen={open} />)
  fireEvent.click(await screen.findByText('사건 종결'))
  expect(open).toHaveBeenCalledWith('EPISODE', 81)
  expect(setNotificationsRead).not.toHaveBeenCalled()
})
