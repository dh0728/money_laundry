import type { TypeRef } from './codes'
import { getJson, type IsoDate, type IsoDateTime } from './common'

// API.md §6.5 GET /api/dashboard/summary (백엔드 미구현, 계약만 있음)
export type DashboardSummary = {
  alertsByStatus: { OPEN: number; ESCALATED: number; CLOSED: number }
  alertsByResolution: { NORMAL: number; FALSE_POSITIVE: number }
  alertsByType: (TypeRef & { count: number })[]
  episodesByStatus: { OPEN: number; CLOSED: number }
  episodesByResolution: { NORMAL: number; SUSPICIOUS: number }
  alertsByAssignee: { userId: number; name: string; open: number; closedToday: number; escalatedToday: number; maxAgeDays: number }[]
  episodesByAssignee: { userId: number; name: string; open: number; closedLast7Days: number; maxAgeDays: number }[]
  latestJob: { jobId: number; analysisDate: IsoDate; status: string; suspiciousTxCount: number; alertCount: number; finishedAt: IsoDateTime | null } | null
  reductionRate: number | null
}

// 백엔드에 추가를 요청할 항목. 계약에 없으므로 지금은 mock으로만 채운다.
export type DashboardRequested = {
  /** 기간 조건(from/to) 적용 시 일별 유입·종결 Alert 수 */
  dailyAlerts: { date: IsoDate; inflow: number; closed: number }[]
  /** 기간 안 의심 거래 구성: 패턴 소속 / 패턴 없음·Alert 묶음 / 패턴 없음·단일 거래 */
  suspiciousTxComposition: { patterned: number; nonPatternGrouped: number; nonPatternSingle: number }
  /** 3일 이상 경과한 OPEN Alert 수 */
  openAlertsAgedOver3Days: number
}

export type DashboardData = DashboardSummary & Partial<DashboardRequested>

export type DashboardRange = { from?: IsoDate; to?: IsoDate }

export const fetchDashboardSummary = (range: DashboardRange = {}) =>
  getJson<DashboardData>('/api/dashboard/summary', range)
