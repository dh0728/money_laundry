import type { AlertResolution, AlertStatus, TypeCode, TypeRef } from './codes'
import { getJson, postJson, type IsoDate, type IsoDateTime, type Page } from './common'

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

// API.md §2.4 거래 행 + Alert 상세에서 붙는 role·includedReason·direction
export type AlertTransaction = {
  txId: number
  txAt: IsoDateTime
  fromBank: number
  fromAccount: string
  toBank: number
  toAccount: string
  amountReceived: number
  receivingCurrency: string
  amountPaid: number
  paymentCurrency: string
  amountUsd: number
  paymentFormat: string
  launderingScore: number
  scorePercentile: number
  thresholdRatio: number
  isSuspicious: boolean
  typeClass: TypeCode
  typeName: string
  typeScore: number
  role: 'SEED' | 'SUPPORTING' | 'PATH' | 'PATTERN_MEMBER'
  includedReason: string
  direction: 'IN' | 'OUT' | 'SELF'
  /** FE 제안: API.md에 없음. v23 요구(송금·수취 소유주를 나눠 보기)용 */
  fromOwnerName?: string
  /** FE 제안: API.md에 없음 */
  toOwnerName?: string
}

export type AlertAccountRole = 'SUBJECT' | 'SOURCE' | 'DESTINATION' | 'INTERMEDIARY' | 'HUB'

// API.md §3.1 alert_accounts + 30일 기준선
export type AlertAccount = {
  account: string
  bank: number
  role: AlertAccountRole
  inCount: number
  inAmountUsd: number
  outCount: number
  outAmountUsd: number
  maxScore: number
  counterpartyCount: number
  firstSeenAt: IsoDateTime
}

export type LinkBasis = { basis: 'TIME' | 'ACCOUNT' | 'BANK' | 'PATH'; value: string }

// API.md §3.2 GET /api/alerts/{alertId} (graph·explanation은 자금 흐름 탭을 옮길 때 더한다)
export type AlertDetail = AlertRow & {
  transactions: AlertTransaction[]
  typeDistribution: Partial<Record<`${TypeCode}`, number>>
  accounts: AlertAccount[]
  scoreTimeline: { txAt: IsoDateTime; score: number }[]
  groupingBasis: LinkBasis[]
}

// API.md §6 감사 이력 행
// REVIEW_REQUEST는 FE 제안(API.md에 없음): 9/28 회의의 Episode 관리자 검수 넘김
export type HistoryAction = 'REVIEW_START' | 'CLOSE' | 'ESCALATE' | 'LINK' | 'UNLINK' | 'ASSIGN' | 'COMMENT' | 'EPISODE_CREATE' | 'EPISODE_CLOSE' | 'REVIEW_REQUEST'
export type HistoryRow = {
  id: number
  actor: { userId: number; name: string; role: string }
  action: HistoryAction
  targetType: 'ALERT' | 'EPISODE'
  targetId: number
  relatedIds: number[]
  from: string | null
  to: string | null
  resolution: string | null
  comment: string | null
  at: IsoDateTime
}

export const fetchAlert = (alertId: number) => getJson<AlertDetail>(`/api/alerts/${alertId}`)
export const fetchAlertHistory = (alertId: number) => getJson<HistoryRow[]>(`/api/alerts/${alertId}/history`)

// API.md §3.3 종결. resolution은 NORMAL만 쓴다(SUSPICIOUS는 FE 제안이라 실제 요청에 싣지 않는다).
export const closeAlert = (alertId: number, resolution: AlertResolution, comment: string) =>
  postJson<void>(`/api/alerts/${alertId}/close`, { resolution, comment })
