import { createContext, useContext } from 'react'
import type { TypeCode } from '@/api/codes'
import type { CaseRecord } from './dashboard-data'

export type Verdict = 'normal' | 'abnormal'
export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string; conflict?: boolean }
export type WorkspaceCase = CaseRecord & {
  revision: number; episodeCaseId?: number; alertCaseIds: number[]
  comments: { id: number; author: string; at: string; text: string }[]
  history: { at: string; actor: string; action: string; reason: string }[]
}
export type LedgerTransaction = {
  id: number; displayId: string; date: string; occurredAt: string
  typeCode: TypeCode; probability: number; suspicious: boolean; score: number
  amountUsd: number; currency: 'USD'; accountId: number; ownerId: number
  fromAccountId: number; toAccountId: number; humanVerdict: Verdict | null
}
export type RuleStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'TESTING' | 'ACTIVE' | 'STOPPED' | 'REJECTED'
export type RuleInput = { name: string; description: string; typeCode: TypeCode | null; scoreMin: number; minTransactions: number; windowHours: number }
export type RuleRecord = RuleInput & {
  id: string; version: number; status: RuleStatus; author: string; updatedAt: string
  history: { at: string; actor: string; action: string; reason: string }[]
}
export type JudgmentRecord = {
  id: string; caseIds: number[]; transactionIds: number[]; displayIds: string[]
  verdict: Verdict; reason: string; reviewer: string; at: string
  // Frozen evidence for reports; later mock state changes do not rewrite it.
  cases: WorkspaceCase[]; reportText: string
}
export type WorkspaceNotification = { id: number; title: string; body: string; at: string; href: string; read: boolean }
export type WorkspaceState = {
  records: WorkspaceCase[]; transactions: LedgerTransaction[]; rules: RuleRecord[]
  judgments: JudgmentRecord[]; notifications: WorkspaceNotification[]
  openedCaseIds?: number[]
}
export type WorkspaceValue = WorkspaceState & {
  viewerId: number
  openCase: (id: number) => void
  judgeCases: (ids: number[], verdict: Verdict, reason: string, options?: { expectedRevisions?: Record<number, number>; scenario?: 'success' | 'error' | 'conflict' }) => ActionResult<JudgmentRecord>
  bundleAlerts: (ids: number[], reason: string) => ActionResult<WorkspaceCase>
  addComment: (id: number, text: string) => ActionResult<WorkspaceCase>
  judgeTransaction: (id: number, verdict: Verdict, reason: string) => ActionResult<LedgerTransaction>
  saveRule: (input: RuleInput, existingId?: string) => ActionResult<RuleRecord>
  transitionRule: (id: string, status: RuleStatus, reason: string) => ActionResult<RuleRecord>
  markNotificationRead: (id?: number) => void
  closeCase?: (id: number) => void
  resetWorkspace?: () => void
}
export const WorkspaceContext = createContext<WorkspaceValue | null>(null)
export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('WorkspaceProvider is required')
  return value
}
export function caseHref(record: Pick<CaseRecord, 'kind' | 'caseId'>) {
  return `#/${record.kind === 'ALERT' ? 'alerts' : 'episodes'}/${record.caseId}?tab=overview`
}
