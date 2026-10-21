import { getJson } from './common'

// API.md §7. Wire DTOs stay separate from the existing presentation shape.
type Pipeline = {
  detection: { received: number; analyzed: number; suspicious: number; deliveryDates: string[] }
  pendingReports: number
  agreements: { agreement: string; count: number }[]
  types: { type: number; count: number }[]
}
type Investigation = {
  personal: { pending: number; aged: number; closed: number }
  institution: { alerts: number; episodes: number; aged: number; today: number; yesterday: number }
  openAlertsAgedOver3Days: number
  daily: { date: string; incoming: number; completed: number }[]
  dailyAlertStatus: { date: string; pending: number; inProgress: number; done: number }[]
  episodeWork: {
    current: { open: number; aged: number; unreviewed: number; createdToday: number; closedToday: number }
    firstReview: { samples: number; averageSeconds: number | null }
    completion: { samples: number; averageSeconds: number | null }
  }
}
export type DashboardSummary = {
  businessAt: string
  range: { from: string; to: string }
  pipeline: { computedAt: string | null; data: Pipeline | null }
  investigation: { computedAt: string | null; data: Investigation | null }
}
export type LiveDashboard = {
  businessAt: string
  pipelineComputedAt: string | null
  investigationComputedAt: string | null
  pipeline: Pipeline | null
  investigation: Investigation | null
}

export async function fetchLiveDashboard(from: string, to: string, signal?: AbortSignal): Promise<LiveDashboard> {
  const summary = await getJson<DashboardSummary>('/api/v1/dashboard/summary', { from, to }, signal)
  return {
    businessAt: summary.businessAt,
    pipelineComputedAt: summary.pipeline.computedAt,
    investigationComputedAt: summary.investigation.computedAt,
    pipeline: summary.pipeline.data,
    investigation: summary.investigation.data,
  }
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
