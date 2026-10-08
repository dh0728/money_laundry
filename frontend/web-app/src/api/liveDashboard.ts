import { ApiError, getJson } from './common'

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
  personal: Investigation['personal']
  institution: Investigation['institution']
  openAlertsAgedOver3Days: number
  detection: Pipeline['detection']
  deliveryDate: string
  pendingReports: number
  dailyAlertStatus: Investigation['dailyAlertStatus']
  agreements: Pipeline['agreements']
  types: Pipeline['types']
  episodeWork: { current: { unreviewed: number } }
}

export async function fetchLiveDashboard(from: string, to: string, signal?: AbortSignal): Promise<LiveDashboard> {
  const summary = await getJson<DashboardSummary>('/api/v1/dashboard/summary', { from, to }, signal)
  const pipeline = summary.pipeline.data
  const investigation = summary.investigation.data
  if (!pipeline || !investigation) throw new ApiError({ type: 'about:blank', title: '대시보드 데이터가 아직 준비되지 않았습니다.', status: 503, code: 'DASHBOARD_NOT_READY' })
  return {
    businessAt: summary.businessAt,
    personal: investigation.personal,
    institution: investigation.institution,
    openAlertsAgedOver3Days: investigation.openAlertsAgedOver3Days,
    detection: pipeline.detection,
    deliveryDate: pipeline.detection.deliveryDates.join(', '),
    pendingReports: pipeline.pendingReports,
    dailyAlertStatus: investigation.dailyAlertStatus,
    agreements: pipeline.agreements,
    types: pipeline.types,
    episodeWork: { current: { unreviewed: investigation.episodeWork.current.unreviewed } },
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
