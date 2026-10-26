import type { Route } from '@/app/navigation'
import { typeDisplay } from '@/api/codes'
import { allAlertsNormal } from '@/mocks/alerts'
import { episodesNormal } from '@/mocks/episodes'

export type AgentRecord = {
  id: string
  pattern: string
  count: number
  amount: number
  score: number
  status: string
  age: number
}

export const mockAgentRecords: AgentRecord[] = [
  ...allAlertsNormal.content.map(row => ({
    id: `A-${row.alertId}`, pattern: typeDisplay(row.primaryType.code).label,
    count: row.txCount,
    amount: row.totalAmountUsd, score: row.riskScore, status: row.status, age: row.ageDays,
  })),
  ...episodesNormal.content.map(row => ({
    id: `E-${row.episodeId}`, pattern: row.primaryTypes.map(type => typeDisplay(type.code).label).join(' · '),
    count: row.txCount,
    amount: row.totalAmountUsd, score: row.riskScore, status: row.status, age: row.ageDays,
  })),
]

export function recordForRoute(route: Route, records: AgentRecord[]): AgentRecord | undefined {
  if (!route.id) return undefined
  const prefix = route.page === 'alerts' ? 'A' : route.page === 'episodes' ? 'E' : null
  return records.find(record => record.id === `${prefix}-${route.id}`)
}
