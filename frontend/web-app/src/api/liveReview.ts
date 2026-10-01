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
    fromBankId: number
    toBankId: number
    amountPaid: number
    amountUsd: number
    paymentCurrency: string
    paymentFormat: string
    role: string
    isSuspicious: boolean | null
    scores: Record<string, number> | null
  }
  sources: { alertId: number; version: number; primaryType?: string }[]
}
export type ReviewGroup = { groupId: number; label: string; revision: number; evidenceVersion?: number | null; decision?: string | null; sourceAlertId?: number | null; members: ReviewMember[] }
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
  summary: {
    txCount: number; subjectCount: number; seedCount: number; riskScore: number; primaryType: string; typeShare?: number | null
    totalAmountUsd?: number | string | null
    amountsByCurrency: Record<string, number>; firstTxAt: string | null; lastTxAt: string | null
    paymentFormats?: Record<string, number>; typeDistribution?: Record<string, number>
    dailySuspiciousCount?: Record<string, number>; dailySuspiciousAmount?: Record<string, number>
    topSenders?: { accountCurrency: string; amount: number }[]
  }
  pendingCount: number
  episodeId: number | null
  sourceAlertIds: number[]
  primaryTypes: string[]
  groups?: ReviewGroup[]
  detachments?: { eventId: number; action: 'UNLINK' | 'DISSOLVE'; comment: string; businessAt: string; snapshot: { selectedAlertIds?: number[]; removedAlertIds?: number[]; episodeCaseId?: number; groups: ReviewGroup[] } }[]
  history?: { eventId: number; action: string; comment: string; businessAt: string; recordedAt: string; actor: string | null }[]
}
export type ReviewQuery = { kind: ReviewKind; assigneeId?: number; status?: ReviewStatus; from?: string; to?: string; page?: number; size?: number; query?: string; types?: string[]; minAgeDays?: number; risk?: string; statuses?: string[]; assignees?: number[] }
export type ReviewSelection = { caseId: number; revision: number; groupId: number; txIds: number[] }
export type ReviewAction = 'SUBJECT' | 'CONTEXT' | 'EXCLUDE' | 'DECIDE' | 'TRANSFER' | 'UNLINK' | 'RECONSIDER' | 'COMMENT' | 'REVIEW_START' | 'CLOSE'
export type ReviewCommand = { action: ReviewAction; selections: ReviewSelection[]; decision?: 'NORMAL' | 'SUSPICIOUS' | null; targetCaseId?: number | null; targetRevision?: number | null; targetGroupId?: number | null; comment: string }
export type ReviewMoney = {
  available: boolean
  reason?: 'EMPTY_SUBJECT_SCOPE' | 'EMPTY_ACCOUNT_SCOPE' | 'WAITING_RECEIPTS' | 'NO_CLOSED_SNAPSHOT'
  selectedAccounts?: string[]
  candidateAccounts?: string[]
  customScope?: boolean
  revision?: number
  delayMinutes?: number
  requestedFrom?: string | null
  requestedTo?: string | null
  observedAt?: string
  complete?: boolean
  start?: string
  endExclusive?: string
  ledgerCount?: number
  method?: 'FIFO_ESTIMATE'
  externalUsd?: { in: number | null; out: number | null; net: number | null }
  external?: { currency: string; in: number; out: number; net: number }[]
  accounts?: {
    accountId: string; currency: string; in: number; out: number; net: number; positiveNet: number
    concentrationPercent: number | null; eligibleIn: number; excludedIn: number; matchedIn: number; rapidOutflowPercent: number | null
  }[]
}

export const fetchReviewCases = (query: ReviewQuery) => {
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach(item => params.append(key, String(item)))
    else if (value !== undefined && value !== '') params.set(key, String(value))
  })
  return getJson<Page<ReviewCase>>(`/api/v1/review/cases?${params}`)
}
export const fetchReviewUsers = () => getJson<{ id: number; name: string; role: string }[]>('/api/v1/demo/users')
export const fetchReviewCase = (caseId: number) => getJson<ReviewCase>(`/api/v1/review/cases/${caseId}`)
export const fetchReviewMoney = (caseId: number, minutes = 180) => getJson<ReviewMoney>(`/api/v1/review/cases/${caseId}/money`, { minutes })
export const setReviewMoneyScope = (caseId: number, revision: number, accounts: string[], comment: string, requestId: string) =>
  postJson<{ caseId: number; revision: number }>(`/api/v1/review/cases/${caseId}/money-scope`, { requestId, revision, accounts, comment })
export type ReviewCommandResult = { caseIds: number[]; targetCaseId: number | null; dissolved?: boolean; reopenedCaseIds?: number[] }
export const submitReviewCommand = (command: ReviewCommand, requestId: string = crypto.randomUUID()) => postJson<ReviewCommandResult>('/api/v1/review/commands', { requestId, targetCaseId: null, targetRevision: null, targetGroupId: null, decision: null, ...command })
