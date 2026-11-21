import { getJson, postJson } from './common'

export type WorkNotification = {
  id: string; kind: string; title: string; description: string; code: string
  at: string; read: boolean; count: number; caseId: number | null; caseKind: 'ALERT' | 'EPISODE'
}
export type NotificationPage<T> = { content: T[]; number: number; size: number; totalElements: number; totalPages: number }
export type NotificationCase = { caseId: number; kind: 'ALERT' | 'EPISODE'; alertId: number | null; status: string }
export const fetchNotifications = (from: string, to: string, query: string, page: number) =>
  getJson<NotificationPage<WorkNotification> & { unreadCount: number }>('/api/v1/notifications', { from: from || undefined, to: to || undefined, query: query || undefined, page, size: 20 })
export const setNotificationsRead = (ids: string[], read: boolean) => postJson('/api/v1/notifications/read', { ids, read })
export const fetchNotificationCases = (id: string, page: number) =>
  getJson<NotificationPage<NotificationCase>>(`/api/v1/notifications/${encodeURIComponent(id)}/cases`, { page, size: 20 })
