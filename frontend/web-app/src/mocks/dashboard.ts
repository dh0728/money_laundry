import type { DashboardData } from '@/api/dashboard'
import { currentScenario, mockFailure, type MockScenario } from './scenario'

const TODAY = new Date('2026-09-26T12:00:00+09:00')

const isoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

// 91일치 결정적 값(새로고침해도 같은 그림)
const dailyAlerts = Array.from({ length: 91 }, (_, i) => {
  const date = new Date(TODAY)
  date.setDate(date.getDate() - (90 - i))
  const inflow = 38 + Math.round(14 * Math.sin(i / 5) + 9 * Math.sin(i / 1.7) + i / 6)
  return { date: isoDate(date), inflow, closed: Math.max(0, inflow - 6 + Math.round(7 * Math.cos(i / 3))) }
})

export const dashboardNormal: DashboardData = {
  alertsByStatus: { OPEN: 128, ESCALATED: 21, CLOSED: 3412 },
  alertsByResolution: { NORMAL: 2870, FALSE_POSITIVE: 542 },
  alertsByType: [
    { code: 0, name: 'NORMAL', count: 612 },
    { code: 1, name: 'FAN-OUT', count: 845 },
    { code: 2, name: 'FAN-IN', count: 731 },
    { code: 3, name: 'G-SCATTER', count: 402 },
    { code: 4, name: 'S-GATHER', count: 366 },
    { code: 5, name: 'CYCLE', count: 214 },
    { code: 6, name: 'RANDOM', count: 158 },
    { code: 7, name: 'BIPARTITE', count: 131 },
    { code: 8, name: 'STACK', count: 102 },
  ],
  episodesByStatus: { OPEN: 9, CLOSED: 44 },
  episodesByResolution: { NORMAL: 17, SUSPICIOUS: 27 },
  alertsByAssignee: [
    { userId: 11, name: '오분석', open: 42, closedToday: 12, escalatedToday: 2, maxAgeDays: 5 },
    { userId: 12, name: '정분석', open: 47, closedToday: 9, escalatedToday: 1, maxAgeDays: 4 },
    { userId: 13, name: '신분석', open: 39, closedToday: 14, escalatedToday: 3, maxAgeDays: 2 },
  ],
  episodesByAssignee: [
    { userId: 21, name: '구조사', open: 4, closedLast7Days: 6, maxAgeDays: 8 },
    { userId: 22, name: '강조사', open: 3, closedLast7Days: 4, maxAgeDays: 3 },
    { userId: 23, name: '공조사', open: 2, closedLast7Days: 5, maxAgeDays: 5 },
  ],
  latestJob: {
    jobId: 57,
    analysisDate: '2026-09-25',
    status: 'COMPLETED',
    suspiciousTxCount: 1840,
    alertCount: 61,
    finishedAt: '2026-09-26T03:12:40+09:00',
  },
  reductionRate: 1 - 61 / 1840,
  dailyAlerts,
  suspiciousTxComposition: { patterned: 9120, nonPatternGrouped: 2310, nonPatternSingle: 870 },
  openAlertsAgedOver3Days: 23,
}

export const dashboardEmpty: DashboardData = {
  alertsByStatus: { OPEN: 0, ESCALATED: 0, CLOSED: 0 },
  alertsByResolution: { NORMAL: 0, FALSE_POSITIVE: 0 },
  alertsByType: [],
  episodesByStatus: { OPEN: 0, CLOSED: 0 },
  episodesByResolution: { NORMAL: 0, SUSPICIOUS: 0 },
  alertsByAssignee: [],
  episodesByAssignee: [],
  latestJob: null,
  reductionRate: null,
  dailyAlerts: [],
  suspiciousTxComposition: { patterned: 0, nonPatternGrouped: 0, nonPatternSingle: 0 },
  openAlertsAgedOver3Days: 0,
}

export function loadMockDashboard(scenario: MockScenario = currentScenario()): Promise<DashboardData> {
  if (scenario === 'error') return mockFailure()
  return Promise.resolve(scenario === 'empty' ? dashboardEmpty : dashboardNormal)
}
