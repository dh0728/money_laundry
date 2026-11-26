import { typeDisplay, type AlertStatus, type EpisodeStatus, type TypeCode } from '@/api/codes'

export type Scope = 'mine' | 'all'
// Display workflow, not a proposed server status enum.
export type WorkState = 'unread' | 'pending' | 'inProgress' | 'done'
export const workStates: { key: WorkState; label: string }[] = [
  { key: 'unread', label: '열람 전' }, { key: 'pending', label: '처리 전' },
  { key: 'inProgress', label: '처리 중' }, { key: 'done', label: '처리 완료' },
]
export const snapshot = { date: '2026-11-15', at: '2026-11-15T18:00:00+09:00', userId: 7, userName: '김OO' }
export const riskSettings = { medium: 0.7, high: 0.9 }
export function riskBand(score: number, settings = riskSettings) {
  return score >= settings.high ? 'high' : score >= settings.medium ? 'medium' : 'low'
}
export function patternName(code: TypeCode) {
  if (code === 0) return 'NON_PATTERN'
  return typeDisplay(code).key.toLowerCase().replace(/(^|-)([a-z])/g, (_, prefix: string, letter: string) => prefix ? `-${letter}` : letter.toUpperCase())
}
export type CaseRecord = {
  caseId: number; sourceId: number; displayId: string; kind: 'ALERT' | 'EPISODE'
  assigneeId: number; assignee: string; createdDate: string; ageDays: number
  status: AlertStatus | EpisodeStatus; workState: WorkState
  typeCode: TypeCode; probability: number; score: number; transactionIds: number[]
  amountUsd: number | null; verdict: 'normal' | 'abnormal' | null
}
export const transactions = Array.from({ length: 126 }, (_, i) => ({
  id: 7000 + i, date: `2026-11-${String(9 + Math.floor(i / 18)).padStart(2, '0')}`,
  typeCode: (i % 9) as TypeCode, suspicious: i % 4 !== 0,
  score: [0.98, 0.94, 0.87, 0.76, 0.65, 0.42][i % 6],
  amountUsd: 1250 + i * 173, accountId: 900 + i % 47, ownerId: 600 + i % 19,
}))
export const cases: CaseRecord[] = Array.from({ length: 24 }, (_, i) => {
  const kind = i % 3 === 2 ? 'EPISODE' : 'ALERT'
  const createdDate = `2026-11-${String(9 + i % 7).padStart(2, '0')}`
  const workState = workStates[Math.floor(i / 6)].key
  const transactionIds = [7000 + i * 3, 7001 + i * 3, 7002 + i * 3]
  return {
    caseId: 8100 + i, sourceId: 5300 + i,
    displayId: `${kind === 'ALERT' ? 'A' : 'E'}-${createdDate.slice(2).replaceAll('-', '')}-${String(41 + i).padStart(6, '0')}`,
    kind, assigneeId: i % 3 === 1 ? 8 : 7, assignee: i % 3 === 1 ? '박OO' : '김OO',
    createdDate, ageDays: 15 - Number(createdDate.slice(-2)),
    status: workState === 'done' ? 'CLOSED' : 'OPEN', workState,
    typeCode: (1 + i % 8) as TypeCode, probability: [0.82, 0.91, 0.76, 0.88][i % 4],
    score: [0.96, 0.92, 0.83, 0.74, 0.65, 0.58][i % 6], transactionIds,
    amountUsd: transactions.filter(t => transactionIds.includes(t.id)).reduce((n, t) => n + t.amountUsd, 0),
    verdict: workState === 'done' ? (i % 2 === 0 ? 'normal' : 'abnormal') : null,
  }
})

const firstSeenCache = new WeakMap<typeof transactions, { accounts: Map<number, string>; owners: Map<number, string> }>()
function firstSeen(source: typeof transactions) {
  let index = firstSeenCache.get(source)
  if (!index) {
    index = { accounts: new Map(), owners: new Map() }
    for (const t of source) {
      if (!index.accounts.has(t.accountId) || t.date < index.accounts.get(t.accountId)!) index.accounts.set(t.accountId, t.date)
      if (!index.owners.has(t.ownerId) || t.date < index.owners.get(t.ownerId)!) index.owners.set(t.ownerId, t.date)
    }
    firstSeenCache.set(source, index)
  }
  return index
}
/** Bounded fixture aggregation; production consumes server aggregate DTOs. */
export function selectDashboard(scope: Scope, start: string, end: string, query: string, empty = false, sourceCases: CaseRecord[] = cases, sourceTransactions: typeof transactions = transactions) {
  const inPeriod = (date: string) => date >= start && date <= end
  const rows = empty ? [] : sourceCases.filter(c => inPeriod(c.createdDate) && (scope === 'all' || c.assigneeId === snapshot.userId)
    && `${c.displayId} ${c.assignee} ${patternName(c.typeCode)}`.toLowerCase().includes(query.trim().toLowerCase()))
  const matchingIds = new Set(rows.flatMap(c => c.transactionIds))
  const txs = empty ? [] : sourceTransactions.filter(t => inPeriod(t.date) && (!query.trim() || matchingIds.has(t.id)))
  const seen = firstSeen(sourceTransactions)
  const alerts = rows.filter(c => c.kind === 'ALERT')
  const open = rows.filter(c => c.status !== 'CLOSED')
  const suspicious = txs.filter(t => t.suspicious)
  const linkedIds = new Set(alerts.flatMap(c => c.transactionIds))
  const linkedSuspicious = suspicious.filter(t => linkedIds.has(t.id)).length
  const patterns = Array.from({ length: 8 }, (_, i) => ({ code: (i + 1) as TypeCode, count: suspicious.filter(t => t.typeCode === i + 1).length }))
  const daily = Array.from({ length: 7 }, (_, i) => {
    const date = `2026-11-${String(9 + i).padStart(2, '0')}`
    const dayCases = rows.filter(c => c.createdDate === date)
    return { date, alerts: dayCases.filter(c => c.kind === 'ALERT').length,
      total: txs.filter(t => t.date === date).length, suspicious: suspicious.filter(t => t.date === date).length,
      pending: dayCases.filter(c => c.workState === 'unread' || c.workState === 'pending').length,
      inProgress: dayCases.filter(c => c.workState === 'inProgress').length, done: dayCases.filter(c => c.workState === 'done').length }
  }).filter(day => inPeriod(day.date))
  return { cases: rows, transactions: txs, patterns, daily, suspicious,
    pendingAlerts: alerts.filter(c => c.status !== 'CLOSED').length,
    highRiskAlerts: alerts.filter(c => c.status !== 'CLOSED' && riskBand(c.score) === 'high').length,
    overdue: open.filter(c => c.ageDays >= 3).length,
    openEpisodes: open.filter(c => c.kind === 'EPISODE').length,
    closed: rows.filter(c => c.status === 'CLOSED').length,
    closureRate: rows.length ? rows.filter(c => c.status === 'CLOSED').length / rows.length : null,
    linkedRate: suspicious.length ? linkedSuspicious / suspicious.length : null,
    newAccounts: new Set(txs.filter(t => seen.accounts.get(t.accountId)! >= start).map(t => t.accountId)).size,
    newOwners: new Set(txs.filter(t => seen.owners.get(t.ownerId)! >= start).map(t => t.ownerId)).size,
  }
}
export type DashboardData = ReturnType<typeof selectDashboard>
export const number = (value: number) => value.toLocaleString('ko-KR')
export const percent = (value: number | null) => value === null ? '값 없음' : `${(value * 100).toFixed(1)}%`
