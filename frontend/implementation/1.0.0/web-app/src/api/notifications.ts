import { getJson, postJson } from './common'
import { fixture } from '@/lib/apiMode'

export type WorkNotification = {
  id: string; kind: string; title: string; description: string; code: string
  at: string; read: boolean; count: number; caseId: number | null; caseKind: 'ALERT' | 'EPISODE'
}
export type NotificationPage<T> = { content: T[]; number: number; size: number; totalElements: number; totalPages: number }
export type NotificationCase = { caseId: number; kind: 'ALERT' | 'EPISODE'; alertId: number | null; status: string }
export const fetchNotifications = (from: string, to: string, query: string, page: number) =>
  getJson<NotificationPage<WorkNotification> & { unreadCount: number }>('/api/v1/notifications', { from: from || undefined, to: to || undefined, query: query || undefined, page, size: 20 })
export const setNotificationsRead = async (ids: string[], read: boolean) => {
  if (fixture) {
    // Preview interaction only: reset on reload, no server or browser storage write.
    const { setFixtureNotificationsRead } = await import('@/mocks/liveFixtureApi')
    setFixtureNotificationsRead(ids, read)
    window.dispatchEvent(new Event('notifications-changed'))
    return
  }
  return postJson('/api/v1/notifications/read', { ids, read })
}
export const fetchNotificationCases = (id: string, page: number) =>
  getJson<NotificationPage<NotificationCase>>(`/api/v1/notifications/${encodeURIComponent(id)}/cases`, { page, size: 20 })
