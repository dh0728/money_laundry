import { z } from 'zod'
import { ApiError, getJson } from './common'

const count = z.number().int().nonnegative()
// Validate only the fields rendered by the legacy dashboard. Never fill missing counts with zero.
const dashboardSchema = z.object({
  businessAt: z.string().min(1),
  personal: z.object({ pending: count, aged: count, closed: count }),
  institution: z.object({ alerts: count, episodes: count, aged: count, today: count, yesterday: count }),
  openAlertsAgedOver3Days: count,
  detection: z.object({ received: count, analyzed: count, suspicious: count }),
  deliveryDate: z.string(),
  pendingReports: count,
  dailyAlertStatus: z.array(z.object({ date: z.string(), pending: count, inProgress: count, done: count })),
  agreements: z.array(z.object({ agreement: z.string(), count })),
  types: z.array(z.object({ type: z.number().int(), count })),
  episodeWork: z.object({ current: z.object({ unreviewed: count }) }),
})

export type LiveDashboard = z.infer<typeof dashboardSchema>

// backend/api-server/API.md §7 and DashboardService.view: no summary/snapshot wrappers.
export type DashboardResponse = Omit<LiveDashboard, 'episodeWork'> & {
  daily: { day: string; incoming: number; completed: number }[]
  episodeWork: {
    asOf: string
    current: { open: number; aged: number; unreviewed: number; created_today: number; closed_today: number }
    firstReview: { samples: number; average_seconds: number | null }
    completion: { samples: number; average_seconds: number | null }
    oldestOpen: { caseId: number; assignee: string; age_seconds: number; awaiting_review: boolean }[]
  }
  activities: { event_id: number; case_id: number; action: string; comment: string | null; business_at: string }[]
  priority: { case_id: number; kind: 'ALERT' | 'EPISODE'; alert_id: number | null; created_at: string; risk: number }[]
}

export async function fetchLiveDashboard(from: string, to: string): Promise<LiveDashboard> {
  const response = await getJson<unknown>('/api/v1/dashboard', { from, to })
  const parsed = dashboardSchema.safeParse(response)
  if (!parsed.success) throw new ApiError({
    type: 'about:blank', title: '대시보드 응답 형식을 확인할 수 없습니다.',
    status: 502, code: 'INVALID_DASHBOARD_RESPONSE',
  })
  return parsed.data
}

export const fetchDemoClock = () => getJson<{ businessAt: string; configured: boolean; revision: number }>('/api/v1/demo/clock')

export function kstDate(instant: string) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant))
}

export function daysBefore(date: string, days: number) {
  const start = new Date(`${date}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - days)
  return start.toISOString().slice(0, 10)
}
