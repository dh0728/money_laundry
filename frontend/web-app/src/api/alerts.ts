import type { AlertResolution, AlertStatus, TypeCode, TypeRef } from './codes'
import { getJson, type IsoDate, type IsoDateTime, type Page } from './common'

// API.md §3.2 GET /api/alerts 행
export type AlertRow = {
  alertId: number
  riskScore: number
  summary: string
  primaryType: TypeRef
  subjectAccount: { bank: number; account: string }
  accountCount: number
  bankCount: number
  txCount: number
  totalAmountUsd: number
  amountsByCurrency: { currency: string; total: number }[]
  scoreStats: { mean: number; max: number; aboveRatio: number }
  weightedAmountUsd: number
  typeEntropy: number
  firstTxAt: IsoDateTime
  lastTxAt: IsoDateTime
  banks: number[]
  status: AlertStatus
  resolution: AlertResolution | null
  assignee: { userId: number; name: string }
  assignedAt: IsoDateTime
  episodeId: number | null
  analysisDate: IsoDate
  createdAt: IsoDateTime
  ageDays: number
}

export type AlertSortKey =
  | 'riskScore'
  | 'createdAt'
  | 'lastTxAt'
  | 'txCount'
  | 'totalAmountUsd'
  | 'scoreMax'
  | 'weightedAmountUsd'
  | 'ageDays'

export type AlertQuery = {
  page?: number
  size?: number
  sort?: `${AlertSortKey},${'asc' | 'desc'}`
  status?: AlertStatus
  resolution?: AlertResolution
  assigneeId?: number | 'me'
  typeClass?: TypeCode
  bankId?: number
  /** lastTxAt 기준 */
  from?: IsoDate
  to?: IsoDate
  analysisDate?: IsoDate
  episodeId?: number
}

export const fetchAlerts = (query: AlertQuery = {}) => getJson<Page<AlertRow>>('/api/alerts', query)
