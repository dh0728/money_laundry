import type { Page } from '@/api/common'
import type { DashboardSummary } from '@/api/liveDashboard'
import type { LedgerAccount, LedgerOwner, LedgerTransaction } from '@/api/liveLedger'
import type { ReviewCase, ReviewMember, ReviewMoney } from '@/api/liveReview'
import type { WorkNotification } from '@/api/notifications'

// Local FE preview only. Every identifier, person, amount and evaluation here is invented.
const businessAt = '2026-10-15T18:00:00+09:00'
const at = (day: number, hour = 10) => `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+09:00`
const page = <T,>(rows: T[], url: URL): Page<T> => {
  const number = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0)
  const size = Math.max(1, Number(url.searchParams.get('size') ?? 20) || 20)
  return { content: rows.slice(number * size, (number + 1) * size), page: number, size, totalElements: rows.length, totalPages: Math.ceil(rows.length / size) }
}
const types = ['NON_PATTERN', 'Fan-out', 'Fan-in', 'Gather-scatter', 'Scatter-gather', 'Cycle', 'Random', 'Bipartite', 'Stack']
// User-required synthetic majority, not an observed team prevalence. Binary scores are independent.
const generatedType = (index: number) => index % 5 < 4 ? 0 : index % 8 + 1
const probabilitiesFor = (code: number, top = 0.72) => Array.from({ length: 9 }, (_, index) => index === code ? top : (1 - top) / 8)
const typeScores = (code: number, top?: number) => Object.fromEntries(probabilitiesFor(code, top).map((score, index) => [`p_${index}`, score]))
const currencies = ['KRW', 'USD', 'JPY']
const formats = ['WIRE', 'ACH', 'CARD']
const staff = [{ id: 11, name: '오분석', role: 'STAFF' }, { id: 12, name: '김검토', role: 'STAFF' }, { id: 13, name: '박조사', role: 'STAFF' }]

const accounts: LedgerAccount[] = [
  { id: 'account-a', ownerId: 'owner-a', ownerName: '가상 소유주 A', bankId: 1 },
  { id: 'account-b', ownerId: 'owner-b', ownerName: '가상 소유주 B', bankId: 2 },
  { id: 'account-c', ownerId: 'owner-c', ownerName: '가상 소유주 C', bankId: 2 },
  { id: 'account-d', ownerId: 'owner-c', ownerName: '가상 소유주 C', bankId: 2 },
  ...Array.from({ length: 28 }, (_, index) => ({
    id: `demo-${String(index + 1).padStart(3, '0')}`,
    ownerId: `owner-${String(index % 14 + 1).padStart(2, '0')}`,
    ownerName: `가상 소유주 ${String(index % 14 + 1).padStart(2, '0')}`,
    bankId: index % 6 + 1,
  })),
]
const accountById = new Map(accounts.map(account => [account.id, account]))
const ownerOf = (id: string) => accountById.get(id)

const member = (txId: number, role: string, amount: number, from: string, to: string, day: number, currency = 'KRW', type = 'Fan-out', sourceAlertId = 3001): ReviewMember => ({
  txId, reviewRole: 'SUBJECT', state: 'PENDING', decision: null, sources: [{ alertId: sourceAlertId, version: 1, primaryType: type }],
  transaction: { occurredAt: at(day, 10), fromAccountId: from, toAccountId: to, fromBankId: ownerOf(from)?.bankId ?? 1, toBankId: ownerOf(to)?.bankId ?? 2,
    amountPaid: amount, amountUsd: currency === 'KRW' ? Math.round(amount / 1300) : currency === 'JPY' ? Math.round(amount / 145) : amount,
    paymentCurrency: currency, paymentFormat: 'WIRE', role, isSuspicious: role === 'SEED',
    scores: { p_laundering: role === 'SEED' ? 0.91 : 0.62, ...typeScores(types.indexOf(type)) } },
})
const members = [member(101, 'SEED', 5_200_000, 'account-a', 'account-b', 13), member(102, 'CONNECTION', 3_000_000, 'account-b', 'account-c', 14), member(103, 'CONNECTION', 1_700_000, 'account-b', 'account-d', 14)]
const summary = { txCount: 3, subjectCount: 3, seedCount: 1, riskScore: 0.91, primaryType: 'Fan-out', typeShare: 0.72,
  totalAmountUsd: members.reduce((sum, row) => sum + row.transaction.amountUsd, 0), amountsByCurrency: { KRW: 9_900_000 }, firstTxAt: at(13), lastTxAt: at(14),
  paymentFormats: { WIRE: 3 }, typeDistribution: { 'Fan-out': 2, 'Fan-in': 1 },
  dailySuspiciousCount: { '2026-10-13': 1, '2026-10-14': 1 }, dailySuspiciousAmount: { '2026-10-13': 5_200_000, '2026-10-14': 3_000_000 },
  topSenders: [{ accountCurrency: 'account-b|KRW', amount: 4_700_000 }] }

const alert: ReviewCase = { caseId: 1, kind: 'ALERT', alertId: 3001, status: 'OPEN', outcome: null, revision: 1,
  assigneeId: 11, assigneeName: '오분석', createdAt: at(14, 11), assignedAt: at(14, 11), closedAt: null, ageDays: 1,
  summary, pendingCount: 3, episodeId: null, sourceAlertIds: [], primaryTypes: ['Fan-out'], accounts: accounts.slice(0, 4),
  groups: [{ groupId: 1, label: 'A-3001 조사 범위', revision: 1, evidenceVersion: 1, members }],
  history: [{ eventId: 1, action: 'ASSIGN', comment: '합성 배정 기록', businessAt: at(14, 11), recordedAt: at(14, 11), actor: '시연 시스템' },
    { eventId: 2, action: 'COMMENT', comment: '합성 예시: account-b 수취 후 account-c·account-d로 분산되는 T-102·T-103의 거래 목적을 확인할 필요가 있습니다.', businessAt: at(14, 12), recordedAt: at(14, 12), actor: '가상 분석자' }] }
const withSource = (rows: ReviewMember[], alertId: number) => rows.map(row => ({ ...row, sources: [{ alertId, version: 1, primaryType: 'Fan-out' }] }))
const linkedAlerts: ReviewCase[] = [3002, 3003].map((alertId, index) => ({ ...alert,
  caseId: index + 2, alertId, status: 'CLOSED', outcome: 'TRANSFERRED', episodeId: 50, pendingCount: 0,
  summary: { ...summary, txCount: index ? 1 : 2, subjectCount: index ? 1 : 2 },
  groups: [{ groupId: index + 2, label: `A-${alertId} 조사 범위`, revision: 1, sourceAlertId: alertId, members: withSource(index ? [members[2]] : members.slice(0, 2), alertId) }],
}))
const episode: ReviewCase = { ...alert, caseId: 50, kind: 'EPISODE', alertId: null, revision: 2, createdAt: at(13, 11), assignedAt: at(13, 11), ageDays: 2,
  sourceAlertIds: [3002, 3003], primaryTypes: ['Fan-out'], groups: linkedAlerts.flatMap(row => row.groups ?? []).map(group => ({ ...group, members: group.members.map(row => ({ ...row, state: 'PENDING' as const })) })),
  history: [{ eventId: 3, action: 'TRANSFER', comment: '합성 예시: 동일한 account-b를 거치는 A-3002·A-3003을 묶어 조사합니다.', businessAt: at(14, 12), recordedAt: at(14, 12), actor: '가상 분석자' }] }

const generatedMember = (index: number, alertId: number, type: string): ReviewMember => {
  const from = accounts[(index * 7 + 4) % accounts.length]
  const to = accounts[(index * 7 + 9) % accounts.length]
  const currency = currencies[index % currencies.length]
  const amount = currency === 'KRW' ? 750_000 + index * 126_000 : currency === 'JPY' ? 80_000 + index * 3_700 : 750 + index * 87
  const row = member(201 + index, index % 4 === 0 ? 'SEED' : 'CONNECTION', amount, from.id, to.id, 15 - index % 14, currency, type, alertId)
  row.transaction.paymentFormat = formats[index % formats.length]
  row.transaction.isSuspicious = index % 5 === 0 ? null : index % 3 === 0
  row.transaction.scores = index % 5 === 0 ? null : { p_laundering: 0.31 + index % 7 / 10, ...typeScores(generatedType(index), 0.51 + index % 4 / 10) }
  row.transaction.isSuspicious = row.transaction.scores === null ? null : row.transaction.scores.p_laundering >= 0.7
  // CaseSummary does not make code 0 a named representative pattern for an Alert.
  if (generatedType(index) === 0) row.sources = row.sources.map(source => ({ ...source, primaryType: '패턴 미특정' }))
  return row
}
const makeAlert = (index: number, linkedEpisode?: number): ReviewCase => {
  const alertId = 3004 + index
  const type = types[generatedType(index)]
  const primaryType = generatedType(index) === 0 ? '패턴 미특정' : type
  const member = generatedMember(index, alertId, type)
  const { transaction } = member
  const day = 15 - index % 14
  const assignee = staff[index % 5 === 4 ? 1 + index % 2 : 0]
  const transferred = linkedEpisode != null
  const noMembers = index === 105
  return { caseId: 1000 + index, kind: 'ALERT', alertId, status: transferred ? 'CLOSED' : index % 9 === 0 ? 'CLOSED' : 'OPEN',
    outcome: transferred ? 'TRANSFERRED' : index % 9 === 0 ? 'NORMAL' : null, revision: 1, assigneeId: assignee.id, assigneeName: assignee.name,
    createdAt: at(day, 11), assignedAt: at(day, 12), closedAt: transferred || index % 9 === 0 ? at(day, 16) : null, ageDays: 15 - day,
    summary: { txCount: noMembers ? 0 : 1, subjectCount: noMembers ? 0 : 1, seedCount: member.transaction.role === 'SEED' ? 1 : 0,
      riskScore: Number((0.31 + index % 7 / 10).toFixed(2)), primaryType, typeShare: generatedType(index) === 0 ? 0 : Number((0.51 + index % 4 / 10).toFixed(2)), totalAmountUsd: transaction.amountUsd,
      amountsByCurrency: noMembers ? {} : { [transaction.paymentCurrency]: transaction.amountPaid }, firstTxAt: noMembers ? null : transaction.occurredAt,
      lastTxAt: noMembers ? null : transaction.occurredAt, paymentFormats: noMembers ? {} : { [transaction.paymentFormat]: 1 },
      typeDistribution: noMembers ? {} : { [type]: 1 } },
    pendingCount: transferred || index % 9 === 0 || noMembers ? 0 : 1, episodeId: linkedEpisode ?? null, sourceAlertIds: [], primaryTypes: [primaryType],
    accounts: [ownerOf(transaction.fromAccountId), ownerOf(transaction.toAccountId)].filter((item): item is LedgerAccount => item != null),
    groups: [{ groupId: 100 + index, label: `A-${alertId} 조사 범위`, revision: 1, evidenceVersion: 1, sourceAlertId: alertId,
      members: noMembers ? [] : [{ ...member, state: index % 9 === 0 && !transferred ? 'DECIDED' : 'PENDING', decision: index % 9 === 0 && !transferred ? 'NORMAL' : null }] }],
    history: [{ eventId: 100 + index, action: 'ASSIGN', comment: '합성 배정 기록', businessAt: at(day, 12), recordedAt: at(day, 12), actor: '시연 시스템' }],
  }
}
const generatedLinked = Array.from({ length: 64 }, (_, index) => makeAlert(index, 150 + Math.floor(index / 2)))
const openAlerts = Array.from({ length: 42 }, (_, index) => makeAlert(index + 64))
const generatedEpisodes: ReviewCase[] = Array.from({ length: 32 }, (_, index) => {
  const sources = generatedLinked.slice(index * 2, index * 2 + 2)
  const first = sources[0]
  const closed = index % 7 === 6
  const groups = sources.flatMap(source => source.groups ?? []).map(group => ({ ...group, label: `Alert A-${group.sourceAlertId}`,
    members: group.members.map(member => ({ ...member, state: closed ? 'DECIDED' as const : 'PENDING' as const, decision: closed ? 'NORMAL' as const : null })) }))
  const amountsByCurrency = sources.reduce<Record<string, number>>((amounts, source) => {
    Object.entries(source.summary.amountsByCurrency).forEach(([currency, amount]) => { amounts[currency] = (amounts[currency] ?? 0) + amount })
    return amounts
  }, {})
  return { ...first, caseId: 150 + index, kind: 'EPISODE', alertId: null, status: closed ? 'CLOSED' : 'OPEN', outcome: closed ? 'NORMAL' : null,
    episodeId: null, sourceAlertIds: sources.map(source => source.alertId ?? 0), primaryTypes: [...new Set(sources.map(source => source.summary.primaryType))],
    summary: { ...first.summary, txCount: 2, subjectCount: 2, amountsByCurrency,
      totalAmountUsd: sources.reduce((sum, source) => sum + Number(source.summary.totalAmountUsd ?? 0), 0),
      riskScore: Math.max(...sources.map(source => source.summary.riskScore)) },
    pendingCount: closed ? 0 : 2, groups, accounts: sources.flatMap(source => source.accounts ?? []),
    closedAt: closed ? at(15, 17) : null,
  }
})
const reviewCases = [alert, ...openAlerts, ...linkedAlerts, ...generatedLinked, episode, ...generatedEpisodes]
// Summary cards, tables and source details describe the same unique evidence rows.
for (const item of reviewCases) {
  const evidence = [...new Map((item.groups ?? []).flatMap(group => group.members).filter(row => !['EXCLUDED', 'TRANSFERRED'].includes(row.state)).map(row => [row.txId, row])).values()]
  const dates = evidence.map(row => row.transaction.occurredAt).sort()
  const amounts: Record<string, number> = {}
  const payments: Record<string, number> = {}
  for (const row of evidence) {
    const tx = row.transaction
    amounts[tx.paymentCurrency] = (amounts[tx.paymentCurrency] ?? 0) + tx.amountPaid
    payments[tx.paymentFormat] = (payments[tx.paymentFormat] ?? 0) + 1
  }
  Object.assign(item.summary, { txCount: evidence.length, subjectCount: evidence.filter(row => row.reviewRole === 'SUBJECT').length,
    seedCount: evidence.filter(row => row.transaction.role === 'SEED').length,
    totalAmountUsd: evidence.reduce((sum, row) => sum + row.transaction.amountUsd, 0), amountsByCurrency: amounts,
    firstTxAt: dates[0] ?? null, lastTxAt: dates.at(-1) ?? null, paymentFormats: payments })
}

// The list's statuses filter uses the displayed Alert state. A linked Alert is ESCALATED
// even though its review case is CLOSED / TRANSFERRED (API.md §9.8).
const reviewListStatus = (row: ReviewCase) => row.kind === 'ALERT' && row.episodeId != null ? 'ESCALATED' : row.status

const money: ReviewMoney = { available: true, complete: true, method: 'FIFO_ESTIMATE', revision: 1, selectedAccounts: ['account-b'],
  candidateAccounts: ['account-a', 'account-b', 'account-c', 'account-d'], observedAt: businessAt,
  externalUsd: { in: 4000, out: 3615, net: 385 }, external: [{ currency: 'KRW', in: 5_200_000, out: 4_700_000, net: 500_000 }],
  accounts: [{ accountId: 'account-b', currency: 'KRW', in: 5_200_000, out: 4_700_000, net: 500_000, positiveNet: 500_000,
    concentrationPercent: 90.4, eligibleIn: 5_200_000, excludedIn: 0, matchedIn: 4_700_000, rapidOutflowPercent: 90.4 }] }
const moneyFor = (item: ReviewCase): ReviewMoney => {
  if (item.caseId === 1 || item.caseId === 50 || item.caseId === 2 || item.caseId === 3) return money
  if (!item.summary.subjectCount) return { available: false, reason: 'EMPTY_SUBJECT_SCOPE' }
  if (item.caseId % 7 === 0) return { available: false, reason: 'WAITING_RECEIPTS', delayMinutes: 180 }
  const account = item.accounts?.[0]?.id ?? 'demo-001'
  const currency = Object.keys(item.summary.amountsByCurrency)[0] ?? 'KRW'
  const amount = item.summary.amountsByCurrency[currency] ?? 0
  const sent = Math.round(amount * 0.61)
  return { available: true, complete: item.caseId % 9 !== 0, method: 'FIFO_ESTIMATE', revision: 1, selectedAccounts: [account],
    candidateAccounts: item.accounts?.map(row => row.id) ?? [account], observedAt: businessAt,
    externalUsd: { in: Number(item.summary.totalAmountUsd ?? 0), out: Math.round(Number(item.summary.totalAmountUsd ?? 0) * 0.61), net: Math.round(Number(item.summary.totalAmountUsd ?? 0) * 0.39) },
    external: [{ currency, in: amount, out: sent, net: amount - sent }],
    accounts: [{ accountId: account, currency, in: amount, out: sent, net: amount - sent, positiveNet: amount - sent,
      concentrationPercent: 61, eligibleIn: amount, excludedIn: 0, matchedIn: sent, rapidOutflowPercent: 61 }] }
}

const transactions: LedgerTransaction[] = [
  ...members.map(({ txId, transaction }, index) => ({ txId, occurredAt: transaction.occurredAt, fromAccountId: transaction.fromAccountId, toAccountId: transaction.toAccountId,
    fromOwnerId: ownerOf(transaction.fromAccountId)?.ownerId ?? '', toOwnerId: ownerOf(transaction.toAccountId)?.ownerId ?? '',
    fromOwnerName: ownerOf(transaction.fromAccountId)?.ownerName, toOwnerName: ownerOf(transaction.toAccountId)?.ownerName,
    fromBankId: transaction.fromBankId, toBankId: transaction.toBankId, amountPaid: transaction.amountPaid, amountReceived: transaction.amountPaid,
    amountUsd: transaction.amountUsd, paymentCurrency: 'KRW', receivingCurrency: 'KRW', paymentFormat: 'WIRE',
    launderingScore: transaction.scores?.p_laundering ?? null, threshold: 0.7, isSuspicious: transaction.isSuspicious,
    typeClass: 1, typeName: 'Fan-out', probabilities: probabilitiesFor(1), judgement: index === 0 ? 'SUSPICIOUS' as const : 'NORMAL' as const,
    alertIds: [3001], episodeIds: index ? [50] : [] })),
  ...Array.from({ length: 120 }, (_, index): LedgerTransaction => {
    const source = generatedMember(index, 3004 + index % 106, types[generatedType(index)]).transaction
    const from = ownerOf(source.fromAccountId)
    const to = ownerOf(source.toAccountId)
    const judgement = source.isSuspicious == null ? 'UNANALYZED' : source.isSuspicious ? 'SUSPICIOUS' : 'NORMAL'
    return { txId: 201 + index, occurredAt: source.occurredAt, fromAccountId: source.fromAccountId, toAccountId: source.toAccountId,
      fromOwnerId: from?.ownerId ?? '', toOwnerId: to?.ownerId ?? '', fromOwnerName: from?.ownerName, toOwnerName: to?.ownerName,
      fromBankId: source.fromBankId, toBankId: source.toBankId, amountPaid: source.amountPaid, amountReceived: source.amountPaid,
      amountUsd: source.amountUsd, paymentCurrency: source.paymentCurrency, receivingCurrency: source.paymentCurrency,
      paymentFormat: source.paymentFormat, launderingScore: source.scores?.p_laundering ?? null, threshold: 0.7,
      isSuspicious: source.isSuspicious, typeClass: source.scores ? generatedType(index) : null, typeName: source.scores ? types[generatedType(index)] : undefined,
      probabilities: source.scores ? Array.from({ length: 9 }, (_, code) => source.scores![`p_${code}`]) : [], judgement, alertIds: [3004 + index % 106],
      episodeIds: index < 64 ? [150 + Math.floor(index / 2)] : [] }
  }),
]

// Derive navigation links from actual membership, including repeated evidence in an Episode.
// Context-only ledger rows deliberately have no case links rather than invented targets.
for (const row of transactions) {
  const containing = reviewCases.filter(item => item.groups?.some(group => group.members.some(member => member.txId === row.txId)))
  row.alertIds = containing.filter(item => item.kind === 'ALERT').map(item => item.alertId!)
  row.episodeIds = containing.filter(item => item.kind === 'EPISODE').map(item => item.caseId)
}

const notificationTargets = [alert, episode, openAlerts[0], generatedEpisodes[0],
  openAlerts.find(item => item.outcome === 'NORMAL')!, generatedEpisodes.find(item => item.status === 'CLOSED')!]
const notifications: WorkNotification[] = notificationTargets.map((item, index) => ({
  id: `fixture-notification-${index + 1}`, kind: index < 2 ? item.kind === 'ALERT' ? 'ALERT_ASSIGNED' : 'EPISODE_LINKED' : item.status === 'CLOSED' ? 'REVIEW_RESULT' : 'OPINION_ADDED',
  title: item.status === 'CLOSED' ? '종결된 사건 검토' : index < 2 ? item.kind === 'ALERT' ? '새 Alert 배정' : 'Episode 연결·생성' : '새 조사 의견',
  description: `합성 예시 · ${item.assigneeName} 담당 · 거래 ${item.summary.txCount}건 · ${item.status === 'CLOSED' ? '종결 결과 확인' : '근거 거래와 조사 의견 확인'}`,
  code: item.kind === 'ALERT' ? `A-${item.alertId}` : `E-${item.caseId}`, at: at(15 - index % 2, 8),
  read: index >= 3, count: 1, caseId: item.caseId, caseKind: item.kind,
}))
// Opinion notifications point to an explicit synthetic history event, never an implied server write.
for (const notification of notifications.filter(row => row.kind === 'OPINION_ADDED')) {
  const target = reviewCases.find(row => row.caseId === notification.caseId)!
  target.history = [...(target.history ?? []), { eventId: 10000 + target.caseId, action: 'COMMENT',
    comment: '합성 검수 의견: 원거래와 거래 목적을 추가 확인합니다. 최종 판정은 유보합니다.',
    businessAt: notification.at, recordedAt: notification.at, actor: '가상 분석자' }]
}
// Only this benign preview interaction changes memory; review/auth/other HTTP writes remain blocked.
const notificationRead = new Map(notifications.map(item => [item.id, item.read]))
export function setFixtureNotificationsRead(ids: string[], read: boolean) {
  if (!ids.every(id => notificationRead.has(id))) throw new Error('존재하지 않는 합성 알림입니다.')
  ids.forEach(id => notificationRead.set(id, read))
}

const openAlertsCount = reviewCases.filter(row => row.kind === 'ALERT' && row.status === 'OPEN').length
const openEpisodesCount = reviewCases.filter(row => row.kind === 'EPISODE' && row.status === 'OPEN').length
const myCases = reviewCases.filter(row => row.assigneeId === 11)
const myOpen = myCases.filter(row => row.status === 'OPEN')
const fixtureDate = businessAt.slice(0, 10)
const alertCases = reviewCases.filter(item => item.kind === 'ALERT')
const openEpisodeCases = reviewCases.filter(item => item.kind === 'EPISODE' && item.status === 'OPEN')
const analyzed = transactions.filter(row => row.isSuspicious !== null)
const suspicious = analyzed.filter(row => row.isSuspicious)
const modelComposition = (rows: LedgerTransaction[]) => ({
  agreements: ['STRONG', 'ATYPICAL', 'PATTERN_ONLY', 'WEAK'].map(agreement => ({ agreement, count: rows.filter(row =>
    (row.isSuspicious ? row.typeClass ? 'STRONG' : 'ATYPICAL' : row.typeClass ? 'PATTERN_ONLY' : 'WEAK') === agreement).length })),
  types: Array.from({ length: 9 }, (_, type) => ({ type, count: rows.filter(row => row.isSuspicious && row.typeClass === type).length })),
})
const displayState = (item: ReviewCase) => item.episodeId != null
  ? reviewCases.find(row => row.caseId === item.episodeId)?.status === 'CLOSED' ? 'done' : 'inProgress'
  : item.status === 'CLOSED' ? 'done' : 'pending'
const dailyAlertStatus = Array.from({ length: 14 }, (_, index) => {
  const date = `2026-10-${String(index + 2).padStart(2, '0')}`
  const cohort = alertCases.filter(row => row.createdAt.slice(0, 10) === date)
  return { date, pending: cohort.filter(row => displayState(row) === 'pending').length,
    inProgress: cohort.filter(row => displayState(row) === 'inProgress').length, done: cohort.filter(row => displayState(row) === 'done').length }
})
const dashboard: DashboardSummary = { businessAt, range: { from: '2026-09-16', to: fixtureDate },
  pipeline: { computedAt: businessAt, data: { detection: { received: transactions.length, analyzed: analyzed.length, suspicious: suspicious.length, deliveryDates: [fixtureDate] },
    pendingReports: 0,
    // Synthetic binary/type combinations only, never a model evaluation result.
    ...modelComposition(analyzed) } },
  investigation: { computedAt: businessAt, data: { personal: { pending: myOpen.length, aged: myOpen.filter(row => row.ageDays >= 3).length, closed: myCases.filter(row => row.status === 'CLOSED').length },
    institution: { alerts: openAlertsCount, episodes: openEpisodesCount, aged: myOpen.filter(row => row.ageDays >= 3).length,
      today: alertCases.filter(row => row.createdAt.slice(0, 10) === fixtureDate).length,
      yesterday: alertCases.filter(row => row.createdAt.slice(0, 10) === '2026-10-14').length },
    openAlertsAgedOver3Days: alertCases.filter(row => row.status === 'OPEN' && row.ageDays > 3).length,
    daily: dailyAlertStatus.map(row => ({ date: row.date, incoming: row.pending + row.inProgress + row.done, completed: alertCases.filter(item => item.closedAt?.slice(0, 10) === row.date).length })),
    dailyAlertStatus,
    episodeWork: { current: { open: openEpisodeCases.length, aged: openEpisodeCases.filter(row => row.ageDays >= 3).length,
      unreviewed: openEpisodeCases.filter(row => !row.history?.some(event => event.action === 'REVIEW_START')).length,
      createdToday: reviewCases.filter(row => row.kind === 'EPISODE' && row.createdAt.slice(0, 10) === fixtureDate).length,
      closedToday: reviewCases.filter(row => row.kind === 'EPISODE' && row.closedAt?.slice(0, 10) === fixtureDate).length },
      firstReview: { samples: 0, averageSeconds: null }, completion: { samples: 0, averageSeconds: null } } } } }

const dateMatches = (iso: string, url: URL) => (!url.searchParams.get('from') || iso.slice(0, 10) >= url.searchParams.get('from')!)
  && (!url.searchParams.get('to') || iso.slice(0, 10) <= url.searchParams.get('to')!)
const riskMatches = (score: number, values: string[]) => !values.length || values.some(value => value === 'high' ? score >= 0.8
  : value === 'medium' ? score >= 0.5 && score < 0.8 : value === 'low' && score < 0.5)

/** A complete local GET boundary: unknown paths fail instead of reaching a real API. */
export function fixtureGet(path: string): unknown {
  const url = new URL(path, 'http://fixture.invalid')
  const route = url.pathname
  if (route === '/api/me') return { id: 11, username: 'fixture-staff', name: '가상 분석자', role: 'STAFF' }
  if (route === '/api/v1/demo/clock') return { businessAt, configured: true, revision: 1 }
  if (route === '/api/v1/dashboard/summary') {
    // Synthetic detected-at dates equal transaction dates in this fixture only.
    // The actual API scopes these charts by model detected_at, not ledger occurredAt.
    const scoped = analyzed.filter(row => dateMatches(row.occurredAt, url))
    return { ...dashboard, range: { from: url.searchParams.get('from') || dashboard.range.from, to: url.searchParams.get('to') || dashboard.range.to },
      pipeline: { ...dashboard.pipeline, data: { ...dashboard.pipeline.data!, ...modelComposition(scoped) } },
      investigation: { ...dashboard.investigation, data: { ...dashboard.investigation.data!,
        daily: dashboard.investigation.data!.daily.filter(row => dateMatches(row.date, url)),
        dailyAlertStatus: dashboard.investigation.data!.dailyAlertStatus.filter(row => dateMatches(row.date, url)) } } }
  }
  if (route === '/api/v1/demo/users') return staff
  if (route === '/api/v1/review/payment-formats') return formats
  if (route === '/api/v1/review/cases') {
    const kind = url.searchParams.get('kind')
    const status = url.searchParams.get('status')
    const statuses = url.searchParams.getAll('statuses')
    const assignees = url.searchParams.getAll('assignees')
    const assigneeId = url.searchParams.get('assigneeId')
    const types = url.searchParams.getAll('types')
    const risk = (url.searchParams.get('risk') ?? '').split(',').filter(Boolean)
    const minAgeDays = Number(url.searchParams.get('minAgeDays') ?? 0)
    const search = (url.searchParams.get('query') ?? '').toLowerCase()
    return page(reviewCases.filter(row => (!kind || row.kind === kind) && (!status || row.status === status)
      && (!statuses.length || statuses.includes(reviewListStatus(row))) && (!assignees.length || assignees.includes(String(row.assigneeId)))
      && (!assigneeId || String(row.assigneeId) === assigneeId) && (!types.length || types.some(type => row.primaryTypes.includes(type)))
      && row.ageDays >= minAgeDays && riskMatches(row.summary.riskScore, risk) && dateMatches(row.createdAt, url)
      && (!search || `${row.alertId ?? ''} A-${row.alertId ?? ''} ${row.caseId} E-${row.caseId} ${row.assigneeName} ${row.primaryTypes.join(' ')}`.toLowerCase().includes(search)))
      .sort((a, b) => b.summary.riskScore - a.summary.riskScore || a.createdAt.localeCompare(b.createdAt) || a.caseId - b.caseId), url)
  }
  const match = /^\/api\/v1\/review\/cases\/(\d+)(\/money)?$/.exec(route)
  if (match) {
    const found = reviewCases.find(row => row.caseId === Number(match[1]))
    if (!found) throw new Error('합성 사건이 없습니다.')
    return match[2] ? moneyFor(found) : found
  }
  if (route === '/api/v1/ledger/owners' || route === '/api/v1/ledger/accounts' || route === '/api/v1/ledger/transactions') {
    const owner = url.searchParams.get('owner')
    const account = url.searchParams.get('account')
    const judgements = url.searchParams.getAll('judgement')
    const payments = url.searchParams.getAll('payments')
    const directions = url.searchParams.getAll('directions')
    const search = (url.searchParams.get('query') ?? '').toLowerCase()
    const matching = transactions.filter(row => (!owner || row.fromOwnerId === owner || row.toOwnerId === owner)
      && (!account || row.fromAccountId === account || row.toAccountId === account)
      && (!judgements.length || judgements.includes(row.judgement)) && (!payments.length || payments.includes(row.paymentFormat))
      && (!directions.length || !account || directions.includes(row.fromAccountId === account ? 'OUT' : 'IN'))
      && dateMatches(row.occurredAt, url)
      && (!search || `${row.txId} ${row.fromOwnerName} ${row.toOwnerName} ${row.fromAccountId} ${row.toAccountId} ${row.paymentFormat}`.toLowerCase().includes(search)))
    if (route.endsWith('/transactions')) return page(matching, url)
    const accountIds = new Set(matching.flatMap(row => [row.fromAccountId, row.toAccountId]))
    const matchingAccounts = accounts.filter(row => accountIds.has(row.id) && (!owner || row.ownerId === owner))
    if (route.endsWith('/accounts')) return page(matchingAccounts, url)
    const owners = [...new Map(matchingAccounts.map(row => [row.ownerId, { id: row.ownerId, name: row.ownerName } satisfies LedgerOwner])).values()]
    return page(owners, url)
  }
  if (route === '/api/v1/notifications') {
    const query = (url.searchParams.get('query') ?? '').trim().toLowerCase()
    const content = notifications.map(item => ({ ...item, read: notificationRead.get(item.id)! }))
      .filter(item => dateMatches(item.at, url) && (!query || `${item.code} ${item.title} ${item.description}`.toLowerCase().includes(query)))
      .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
    const result = page(content, url)
    return { ...result, number: result.page, unreadCount: [...notificationRead.values()].filter(read => !read).length }
  }
  throw new Error(`합성 데이터가 준비되지 않은 경로: ${route}`)
}
