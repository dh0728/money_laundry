import { getJson } from './common'

// API.md §6.5. 서버 업무 시각을 기준으로 표시한다.
export type LiveDashboard = {
  businessAt: string
  personal: { pending: number; aged: number; closed: number }
  institution: { alerts: number; episodes: number; aged: number; today: number; yesterday: number }
  openAlertsAgedOver3Days: number
  detection: { received: number; analyzed: number; suspicious: number }
  deliveryDate: string
  pendingReports: number
  daily: { day: string; incoming: number; completed: number }[]
  dailyAlertStatus: { date: string; pending: number; inProgress: number; done: number }[]
  agreements: { agreement: string; count: number }[]
  types: { type: number; count: number }[]
  activities: { event_id: number; case_id: number; action: string; comment: string; business_at: string }[]
  priority: { case_id: number; kind: 'ALERT' | 'EPISODE'; alert_id: number | null; created_at: string; risk: number }[]
  episodeWork: {
    asOf: string
    current: { open: number; aged: number; unreviewed: number; created_today: number; closed_today: number }
    firstReview: { samples: number; average_seconds: number | null }
    completion: { samples: number; average_seconds: number | null }
    oldestOpen: { caseId: number; assignee: string; age_seconds: number; awaiting_review: boolean }[]
  }
}

export const fetchLiveDashboard = (from: string, to: string) => getJson<LiveDashboard>('/api/v1/dashboard', { from, to })

export const fetchDemoClock = () => getJson<{ businessAt: string; configured: boolean; revision: number }>('/api/v1/demo/clock')

export function kstDate(instant: string) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant))
}

export function daysBefore(date: string, days: number) {
  const start = new Date(`${date}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - days)
  return start.toISOString().slice(0, 10)
}
