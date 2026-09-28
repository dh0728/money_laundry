import { fetchAlerts, type AlertQuery, type AlertRow } from '@/api/alerts'
import type { Page } from '@/api/common'
import { fetchDashboardSummary, type DashboardData, type DashboardRange } from '@/api/dashboard'
import { allAlertsNormal, loadMockMyAlerts } from '@/mocks/alerts'
import { fetchEpisodes, type EpisodeRow } from '@/api/episodes'
import { loadMockEpisodes } from '@/mocks/episodes'
import { withOverride, type AlertOverrides } from '@/features/alerts/alertOverrides'
import { loadMockDashboard } from '@/mocks/dashboard'
import { live } from '@/lib/apiMode'

// 백엔드가 준비되면 .env에 VITE_API_MODE=live 를 넣어 실제 요청으로 바꾼다. 기본은 mock.

const inRange = (date: string, { from, to }: DashboardRange) => (!from || date >= from) && (!to || date <= to)

export function loadDashboard(range: DashboardRange): Promise<DashboardData> {
  if (live) return fetchDashboardSummary(range)
  // mock은 기간 조건을 일별 추이에만 흉내 낸다
  return loadMockDashboard().then(data => ({ ...data, dailyAlerts: data.dailyAlerts?.filter(day => inRange(day.date, range)), dailyAlertStatus: data.dailyAlertStatus?.filter(day => inRange(day.date, range)) }))
}

export function loadAlerts(query: AlertQuery): Promise<Page<AlertRow>> {
  if (live) return fetchAlerts(query)
  return loadMockMyAlerts().then(page => {
    let content = page.content.filter(row => !query.status || row.status === query.status)
    if (query.sort === 'createdAt,desc') content = content.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.riskScore - a.riskScore)
    content = content.slice(0, query.size ?? content.length)
    return { ...page, content, totalElements: content.length }
  })
}

/**
 * 내 담당 Episode. mock은 Alert 화면에서 방금 연결·생성한 결과(overrides)와 검수 넘김(reviews)을 반영해 다시 묶는다.
 */
export function loadMyEpisodes(userId: number, overrides: AlertOverrides, reviews: Record<number, string>): Promise<EpisodeRow[]> {
  if (live) return fetchEpisodes({ assigneeId: 'me', size: 200 }).then(page => page.content)
  const alerts = allAlertsNormal.content.map(row => withOverride(row, overrides))
  return loadMockEpisodes(alerts).then(page => page.content
    .filter(row => row.assignee.userId === userId)
    .map(row => (reviews[row.episodeId] ? { ...row, reviewRequestedAt: reviews[row.episodeId] } : row)))
}

/** 대시보드 기준일. mock 데이터는 2026-09-26까지 있다. */
export const dashboardToday = () => (live ? new Date() : new Date(2026, 8, 26))
