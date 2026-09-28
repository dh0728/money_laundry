import { getJson, postJson, type Page } from './common'

export type ReviewKind = 'ALERT' | 'EPISODE'
export type ReviewStatus = 'OPEN' | 'CLOSED'
export type ReviewMember = {
  txId: number
  reviewRole: 'SUBJECT' | 'CONTEXT'
  state: 'PENDING' | 'DECIDED' | 'EXCLUDED' | 'TRANSFERRED'
  decision: 'NORMAL' | 'SUSPICIOUS' | null
  transaction: {
    occurredAt: string
    fromAccountId: string
    toAccountId: string
    amountPaid: number
    paymentCurrency: string
    paymentFormat: string
    isSuspicious: boolean | null
    scores: Record<string, number> | null
  }
  sources: { alertId: number; version: number; primaryType?: string }[]
}
export type ReviewGroup = { groupId: number; label: string; revision: number; decision?: string | null; members: ReviewMember[] }
export type ReviewCase = {
  caseId: number
  kind: ReviewKind
  alertId: number | null
  status: ReviewStatus
  outcome: string | null
  revision: number
  assigneeId: number
  assigneeName: string
  createdAt: string
  assignedAt: string
  closedAt: string | null
  ageDays: number
  summary: { txCount: number; subjectCount: number; seedCount: number; riskScore: number; primaryType: string; amountsByCurrency: Record<string, number>; firstTxAt: string | null; lastTxAt: string | null }
  pendingCount: number
  sourceAlertIds: number[]
  primaryTypes: string[]
  groups?: ReviewGroup[]
  history?: { eventId: number; action: string; comment: string; businessAt: string; recordedAt: string; actor: string | null }[]
}
export type ReviewQuery = { kind: ReviewKind; assigneeId?: number; status?: ReviewStatus; from?: string; to?: string; page?: number; size?: number }
export type ReviewSelection = { caseId: number; revision: number; groupId: number; txIds: number[] }
export type ReviewAction = 'SUBJECT' | 'CONTEXT' | 'EXCLUDE' | 'DECIDE' | 'TRANSFER' | 'SPLIT' | 'MOVE' | 'RECONSIDER' | 'COMMENT' | 'REVIEW_START' | 'CLOSE'
export type ReviewCommand = { action: ReviewAction; selections: ReviewSelection[]; decision?: 'NORMAL' | 'SUSPICIOUS'; targetCaseId?: number | null; targetRevision?: number | null; targetGroupId?: number | null; comment: string }
export type ReviewMoney = {
  available: boolean
  reason?: 'EMPTY_SUBJECT_SCOPE' | 'EMPTY_ACCOUNT_SCOPE' | 'WAITING_RECEIPTS' | 'NO_CLOSED_SNAPSHOT'
  complete?: boolean
  start?: string
  endExclusive?: string
  ledgerCount?: number
  external?: { currency: string; in: number; out: number; net: number }[]
  accounts?: { accountId: string; currency: string; net: number; concentrationPercent: number | null; rapidOutflowPercent: number | null }[]
}

export const fetchReviewCases = (query: ReviewQuery) => getJson<Page<ReviewCase>>('/api/v1/review/cases', { ...query })
export const fetchReviewCase = (caseId: number) => getJson<ReviewCase>(`/api/v1/review/cases/${caseId}`)
export const fetchReviewMoney = (caseId: number, minutes = 180) => getJson<ReviewMoney>(`/api/v1/review/cases/${caseId}/money`, { minutes })
export const submitReviewCommand = (command: ReviewCommand, requestId: string = crypto.randomUUID()) => postJson<{ caseIds: number[]; targetCaseId: number | null }>('/api/v1/review/commands', { requestId, targetCaseId: null, targetRevision: null, targetGroupId: null, decision: null, ...command })
