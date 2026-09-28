import { fetchAlerts, type AlertQuery, type AlertRow } from '@/api/alerts'
import type { Page } from '@/api/common'
import { fetchDashboardSummary, type DashboardData, type DashboardRange } from '@/api/dashboard'
import { loadMockMyAlerts } from '@/mocks/alerts'
import { loadMockDashboard } from '@/mocks/dashboard'

// 백엔드가 준비되면 .env에 VITE_API_MODE=live 를 넣어 실제 요청으로 바꾼다. 기본은 mock.
const live = import.meta.env.VITE_API_MODE === 'live'

const inRange = (date: string, { from, to }: DashboardRange) => (!from || date >= from) && (!to || date <= to)

export function loadDashboard(range: DashboardRange): Promise<DashboardData> {
  if (live) return fetchDashboardSummary(range)
  // mock은 기간 조건을 일별 추이에만 흉내 낸다
  return loadMockDashboard().then(data => ({ ...data, dailyAlerts: data.dailyAlerts?.filter(day => inRange(day.date, range)) }))
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

/** 대시보드 기준일. mock 데이터는 2026-09-26까지 있다. */
export const dashboardToday = () => (live ? new Date() : new Date(2026, 8, 26))
