import { riskBand } from '../dashboard-data'
import type { LedgerTransaction, WorkspaceCase } from '../workspace-store'

export const caseDataBudget = { transactions: 10_000, records: 10_000, references: 10_000 }
function caseReferencesWithinBudget(records: WorkspaceCase[]) {
  if (records.length > caseDataBudget.records) return false
  let references = 0
  for (const record of records) {
    references += record.transactionIds.length + record.alertCaseIds.length
    if (references > caseDataBudget.references) return false
  }
  return true
}
export function caseSnapshotWithinBudget(records: WorkspaceCase[], transactions: LedgerTransaction[]) {
  // Test lengths before looking up a record or reading any transaction row.
  return transactions.length <= caseDataBudget.transactions && caseReferencesWithinBudget(records)
}
export function canJudgeCase(item: WorkspaceCase, viewerId: number) {
  return item.assigneeId === viewerId && item.status !== 'CLOSED'
}
export function indexCaseLedger(transactions: LedgerTransaction[]) {
  if (transactions.length > caseDataBudget.transactions) throw new RangeError('서버 범위 조회가 필요합니다: 거래 스냅샷 한도 초과')
  const owners = new Map<number, number>()
  const conflicts = new Set<number>()
  for (const { accountId, ownerId } of transactions) {
    if (conflicts.has(accountId)) continue
    if (owners.has(accountId) && owners.get(accountId) !== ownerId) {
      owners.delete(accountId)
      conflicts.add(accountId)
    } else owners.set(accountId, ownerId)
  }
  return { byId: new Map(transactions.map(tx => [tx.id, tx])), owners }
}
type LedgerIndex = ReturnType<typeof indexCaseLedger>
export function caseEvidence(item: WorkspaceCase, source: LedgerTransaction[] | LedgerIndex) {
  if (item.transactionIds.length > caseDataBudget.references) throw new RangeError('서버 범위 조회가 필요합니다: 근거 참조 한도 초과')
  const index = Array.isArray(source) ? indexCaseLedger(source) : source
  return [...new Set(item.transactionIds)].flatMap(id => { const tx = index.byId.get(id); return tx ? [tx] : [] }).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id - b.id)
}
function evidenceInstant(value: string) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.exec(value)
  if (!parts) return NaN
  const [, year, month, day] = parts.map(Number)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  return daysInMonth && day >= 1 && day <= daysInMonth ? Date.parse(value) : NaN
}
export type CaseOverviewFacts = {
  referenceCount: number; availableCount: number; missingCount: number; duplicateReferenceCount: number
  complete: boolean; accountCount: number; knownOwnerCount: number; unknownOwnerAccountCount: number
  period: { start: string; end: string } | null; invalidTimestampCount: number
}
export function caseOverviewFacts(item: WorkspaceCase, source: LedgerTransaction[] | LedgerIndex): CaseOverviewFacts {
  if (item.transactionIds.length > caseDataBudget.references) throw new RangeError('서버 범위 조회가 필요합니다: 근거 참조 한도 초과')
  const index = Array.isArray(source) ? indexCaseLedger(source) : source
  const evidence = caseEvidence(item, index)
  const referenceCount = new Set(item.transactionIds).size
  const missingCount = referenceCount - evidence.length
  const complete = missingCount === 0
  const accounts = new Set(evidence.flatMap(tx => [tx.fromAccountId, tx.toAccountId]))
  const owners = new Set<number>()
  let unknownOwnerAccountCount = 0
  for (const accountId of accounts) {
    const ownerId = index.owners.get(accountId)
    if (ownerId === undefined) unknownOwnerAccountCount++
    else owners.add(ownerId)
  }
  const timestamps = evidence.map(tx => evidenceInstant(tx.occurredAt))
  const invalidTimestampCount = timestamps.filter(at => !Number.isFinite(at)).length
  const period = complete && timestamps.length > 0 && invalidTimestampCount === 0
    ? { start: new Date(Math.min(...timestamps)).toISOString(), end: new Date(Math.max(...timestamps)).toISOString() }
    : null
  return {
    referenceCount, availableCount: evidence.length, missingCount,
    duplicateReferenceCount: item.transactionIds.length - referenceCount, complete,
    accountCount: accounts.size, knownOwnerCount: owners.size, unknownOwnerAccountCount, period, invalidTimestampCount,
  }
}
export function relatedCases(item: WorkspaceCase, records: WorkspaceCase[], source: LedgerTransaction[] | LedgerIndex) {
  if (!caseReferencesWithinBudget(records)) throw new RangeError('서버 범위 조회가 필요합니다: 업무 스냅샷 한도 초과')
  const index = Array.isArray(source) ? indexCaseLedger(source) : source
  const evidence = caseEvidence(item, index)
  const ids = new Set(evidence.map(tx => tx.id))
  const accounts = new Set(evidence.flatMap(tx => [tx.fromAccountId, tx.toAccountId]))
  return records.filter(record => record.caseId !== item.caseId).flatMap(record => {
    const rows = caseEvidence(record, index)
    const sharedTransactions = rows.filter(tx => ids.has(tx.id)).length
    const sharedAccounts = [...new Set(rows.flatMap(tx => [tx.fromAccountId, tx.toAccountId]))].filter(id => accounts.has(id)).length
    const linked = record.episodeCaseId === item.caseId || item.episodeCaseId === record.caseId || item.alertCaseIds.includes(record.caseId) || record.alertCaseIds.includes(item.caseId)
    return linked || sharedTransactions || sharedAccounts ? [{ item: record, sharedTransactions, sharedAccounts, linked }] : []
  })
}

export type GraphLens = 'pattern' | 'owner'
export type GraphNode = { id: string; label: string; accountIds: number[]; abnormal: boolean }
export type GraphEdge = { id: string; source: string; target: string; count: number; amountUsd: number; risk: 'high' | 'medium' | 'low'; width: number; transactionIds: number[] }
export const caseGraphBudget = { transactions: caseDataBudget.transactions, nodes: 200, edges: 400 }
type CaseGraphResult = {
  nodes: GraphNode[]; edges: GraphEdge[]; inputTransactions: number
} & ({ status: 'ready'; omittedNodes: number; omittedEdges: number; omittedTransactions: number }
  | { status: 'server-required'; omittedNodes: null; omittedEdges: null; omittedTransactions: null })
export function buildCaseGraph(transactions: LedgerTransaction[], lens: GraphLens, ownershipLedger: LedgerTransaction[] | Map<number, number> = transactions): CaseGraphResult {
  // Reject before indexing, iterating or allocating per-row collections. Large
  // cases must arrive through a bounded server neighborhood query instead.
  if (transactions.length > caseGraphBudget.transactions || (Array.isArray(ownershipLedger) && ownershipLedger.length > caseGraphBudget.transactions)) {
    return { status: 'server-required', inputTransactions: transactions.length, nodes: [], edges: [], omittedNodes: null, omittedEdges: null, omittedTransactions: null }
  }
  const owners = Array.isArray(ownershipLedger) ? indexCaseLedger(ownershipLedger).owners : ownershipLedger
  const nodes = new Map<string, GraphNode>()
  const edges = new Map<string, GraphEdge>()
  const allNodes = new Set<string>(), allEdges = new Set<string>()
  let omittedTransactions = 0
  const nodeFor = (accountId: number, abnormal: boolean) => {
    const ownerId = owners.get(accountId)
    const grouped = lens === 'owner' && ownerId !== undefined
    const id = `${grouped ? 'owner' : 'account'}:${grouped ? ownerId : accountId}`
    const label = grouped ? `소유주 ${ownerId}` : `계좌 ${accountId}${lens === 'owner' ? ' · 소유주 미확인' : ''}`
    allNodes.add(id)
    if (nodes.has(id) || nodes.size < caseGraphBudget.nodes) {
      const node = nodes.get(id) ?? { id, label, accountIds: [], abnormal: false }
      if (!node.accountIds.includes(accountId)) node.accountIds.push(accountId)
      node.abnormal ||= abnormal
      nodes.set(id, node)
    }
    return id
  }
  for (const tx of transactions) {
    const source = nodeFor(tx.fromAccountId, tx.humanVerdict === 'abnormal')
    const target = nodeFor(tx.toAccountId, tx.humanVerdict === 'abnormal')
    const id = `${source}>${target}`
    allEdges.add(id)
    if (!nodes.has(source) || !nodes.has(target) || (!edges.has(id) && edges.size >= caseGraphBudget.edges)) { omittedTransactions++; continue }
    const risk = tx.humanVerdict === 'abnormal' ? 'high' : riskBand(tx.score)
    const edge = edges.get(id) ?? { id, source, target, count: 0, amountUsd: 0, risk, width: 1, transactionIds: [] }
    edge.count++; edge.amountUsd += tx.amountUsd; edge.transactionIds.push(tx.id)
    if (risk === 'high' || (risk === 'medium' && edge.risk === 'low')) edge.risk = risk
    edges.set(id, edge)
  }
  const max = Math.max(1, ...[...edges.values()].map(edge => edge.amountUsd))
  for (const edge of edges.values()) edge.width = Math.min(8, 1 + 7 * Math.sqrt(edge.amountUsd / max))
  return { status: 'ready', inputTransactions: transactions.length, nodes: [...nodes.values()], edges: [...edges.values()], omittedNodes: allNodes.size - nodes.size, omittedEdges: allEdges.size - edges.size, omittedTransactions }
}

export function downloadCaseCsv(filename: string, rows: (string | number | null)[][]) {
  const escape = (value: string | number | null) => {
    const text = value === null ? '값 없음' : String(value)
    return `"${(/^\s*[=+@-]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`
  }
  const blob = new Blob(['\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a'); anchor.href = href; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(href), 0)
}
export function downloadTransactionsCsv(rows: LedgerTransaction[], name: string) {
  downloadCaseCsv(`${name}-transactions.csv`, [['거래 ID', '거래 시각', '출금 계좌', '입금 계좌', '금액 (USD)', '유형 코드', '모델 확률', '모델 점수', '사람 판정'], ...rows.map(tx => [tx.displayId, tx.occurredAt, tx.fromAccountId, tx.toAccountId, tx.amountUsd, tx.typeCode, tx.probability, tx.score, tx.humanVerdict === 'normal' ? '정상' : tx.humanVerdict === 'abnormal' ? '이상' : '판정 전'])])
}
