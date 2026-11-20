import type { LedgerTransaction, WorkspaceCase } from '../workspace-store'
import { caseEvidence, type indexCaseLedger, type relatedCases } from './case-selectors'
export type RelatedLedgerIndex = ReturnType<typeof indexCaseLedger>
export type RelatedCandidate = ReturnType<typeof relatedCases>[number]
export type RelatedEvidenceRow = { id: string; kind: string; target: string; content: string; strength: '미제공' }
export function mergeRelatedEvidence(item: WorkspaceCase, candidate: WorkspaceCase | null, index: RelatedLedgerIndex, scope = { current: true, candidate: true }): LedgerTransaction[] {
  const rows = [...(scope.current ? caseEvidence(item, index) : []), ...(scope.candidate && candidate ? caseEvidence(candidate, index) : [])]
  return [...new Map(rows.map(tx => [tx.id, tx])).values()].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id - b.id)
}
export function relatedEvidenceRows(item: WorkspaceCase, candidate: WorkspaceCase | null, index: RelatedLedgerIndex): RelatedEvidenceRow[] {
  if (!candidate) return []
  const current = caseEvidence(item, index), other = caseEvidence(candidate, index)
  const ids = new Set(current.map(tx => tx.id))
  const accounts = new Set(current.flatMap(tx => [tx.fromAccountId, tx.toAccountId]))
  const shared = [...new Set(other.flatMap(tx => [tx.fromAccountId, tx.toAccountId]))].filter(id => accounts.has(id)).sort((a,b) => a-b)
  const rows: RelatedEvidenceRow[] = shared.map(id => ({ id: `account-${id}`, kind: '공유 계좌', target: String(id), content: '두 업무의 확인된 거래에 포함', strength: '미제공' }))
  rows.push(...other.filter(tx => ids.has(tx.id)).map(tx => ({ id: `transaction-${tx.id}`, kind: '공통 거래', target: tx.displayId, content: '동일 거래 ID', strength: '미제공' as const })))
  if (item.kind !== candidate.kind && (item.episodeCaseId === candidate.caseId || candidate.episodeCaseId === item.caseId || item.alertCaseIds.includes(candidate.caseId) || candidate.alertCaseIds.includes(item.caseId))) rows.push({ id: 'direct-link', kind: 'Alert·Episode 연결', target: candidate.displayId, content: '업무 연결 정보', strength: '미제공' })
  return rows
}
export function focusedRelatedCandidate(rows: RelatedCandidate[], id: number | null): RelatedCandidate | null { return rows.find(row => row.item.caseId === id) ?? rows[0] ?? null }
