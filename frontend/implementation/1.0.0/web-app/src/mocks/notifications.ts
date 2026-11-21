import type { Page } from '@/app/navigation'
import type { TypeCode } from '@/api/codes'
import { usd } from '@/lib/format'
import { allAlertsNormal } from './alerts'
import { episodesNormal } from './episodes'
import { currentScenario, mockFailure, type MockScenario } from './scenario'

export type NotificationKind = 'ALERT_ASSIGNED' | 'EPISODE_LINKED' | 'OPINION_ADDED' | 'REVIEW_RESULT'
export type NotificationItem = {
  id: string
  kind: NotificationKind
  title: string
  description: string
  at: string
  target: { page: Page; id: number }
  code: string
  patternCode?: TypeCode
  riskScore?: number
  ageDays?: number
}

const alerts = allAlertsNormal.content
const episodes = episodesNormal.content

export const notificationsNormal: NotificationItem[] = [
  ...alerts.slice(0, 3).map(row => ({
    id: `assigned-${row.alertId}`, kind: 'ALERT_ASSIGNED' as const,
    title: '새 Alert 배정', description: `${row.assignee.name} 담당 · 계좌 ${row.accountCount}개 · 은행 ${row.bankCount}곳 · ${usd(row.totalAmountUsd)}`,
    at: row.assignedAt, target: { page: 'alerts' as const, id: row.alertId }, code: `A-${row.alertId}`,
    patternCode: row.primaryType.code, riskScore: row.riskScore, ageDays: row.ageDays,
  })),
  ...episodes.slice(0, 2).map(row => ({
    id: `linked-${row.episodeId}`, kind: 'EPISODE_LINKED' as const,
    title: 'Episode 연결·생성', description: `Alert ${row.alertCount}건이 Episode로 묶였습니다.`,
    at: row.createdAt, target: { page: 'episodes' as const, id: row.episodeId }, code: `E-${row.episodeId}`,
  })),
  {
    id: 'opinion-800', kind: 'OPINION_ADDED', title: '새 조사 의견',
    description: 'E-800에 새 의견이 남겨졌습니다.', at: '2026-09-26T10:20:00+09:00',
    target: { page: 'episodes', id: 800 }, code: 'E-800',
  },
  {
    id: 'review-802', kind: 'REVIEW_RESULT', title: 'Episode 검수 결과',
    description: 'E-802 검수에서 보완 의견이 도착했습니다.', at: '2026-09-26T14:30:00+09:00',
    target: { page: 'episodes', id: 802 }, code: 'E-802',
  },
]

export function loadMockNotifications(scenario: MockScenario = currentScenario()): Promise<NotificationItem[]> {
  if (scenario === 'error') return mockFailure('알림을 불러오지 못했습니다.')
  return Promise.resolve(scenario === 'empty' ? [] : notificationsNormal)
}
