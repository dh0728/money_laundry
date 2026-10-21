import type { Page } from '@/api/common'
import type { DashboardSummary } from '@/api/liveDashboard'
import type { LedgerAccount, LedgerOwner, LedgerTransaction } from '@/api/liveLedger'
import type { ReviewCase, ReviewMember, ReviewMoney } from '@/api/liveReview'

// Local FE preview only. Every identifier, person, amount and evaluation here is invented.
const businessAt = '2026-10-15T09:00:00+09:00'
const at = (day: number, hour = 10) => `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+09:00`
const page = <T,>(rows: T[], url: URL): Page<T> => {
  const number = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0)
  const size = Math.max(1, Number(url.searchParams.get('size') ?? 20) || 20)
  return { content: rows.slice(number * size, (number + 1) * size), page: number, size, totalElements: rows.length, totalPages: Math.ceil(rows.length / size) }
}
const types = ['Fan-out', 'Fan-in', 'Gather-scatter', 'Scatter-gather', 'Cycle', 'Random', 'Bipartite', 'Stack']
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
    scores: { p_laundering: role === 'SEED' ? 0.91 : 0.62, p_1: 0.72, p_2: 0.18 } },
})
const members = [member(101, 'SEED', 5_200_000, 'account-a', 'account-b', 13), member(102, 'CONNECTION', 3_000_000, 'account-b', 'account-c', 14), member(103, 'CONNECTION', 1_700_000, 'account-b', 'account-d', 14)]
const summary = { txCount: 3, subjectCount: 3, seedCount: 1, riskScore: 0.91, primaryType: 'Fan-out', typeShare: 0.72,
  totalAmountUsd: 7615, amountsByCurrency: { KRW: 9_900_000 }, firstTxAt: at(13), lastTxAt: at(14),
  paymentFormats: { WIRE: 3 }, typeDistribution: { 'Fan-out': 2, 'Fan-in': 1 },
  dailySuspiciousCount: { '2026-10-13': 1, '2026-10-14': 1 }, dailySuspiciousAmount: { '2026-10-13': 5_200_000, '2026-10-14': 3_000_000 },
  topSenders: [{ accountCurrency: 'account-b|KRW', amount: 4_700_000 }] }

const alert: ReviewCase = { caseId: 1, kind: 'ALERT', alertId: 3001, status: 'OPEN', outcome: null, revision: 1,
  assigneeId: 11, assigneeName: '오분석', createdAt: at(14, 11), assignedAt: at(14, 11), closedAt: null, ageDays: 1,
  summary, pendingCount: 3, episodeId: null, sourceAlertIds: [], primaryTypes: ['Fan-out'], accounts: accounts.slice(0, 4),
  groups: [{ groupId: 1, label: 'A-3001 조사 범위', revision: 1, evidenceVersion: 1, members }],
  history: [{ eventId: 1, action: 'ASSIGN', comment: '합성 배정 기록', businessAt: at(14, 11), recordedAt: at(14, 11), actor: '시연 시스템' }] }
const linkedAlerts: ReviewCase[] = [3002, 3003].map((alertId, index) => ({ ...alert,
  caseId: index + 2, alertId, status: 'CLOSED', outcome: 'TRANSFERRED', episodeId: 50, pendingCount: 0,
  summary: { ...summary, txCount: index ? 1 : 2, subjectCount: index ? 1 : 2 },
  groups: [{ groupId: index + 2, label: `A-${alertId} 조사 범위`, revision: 1, sourceAlertId: alertId, members: index ? [members[2]] : members.slice(0, 2) }],
}))
const episode: ReviewCase = { ...alert, caseId: 50, kind: 'EPISODE', alertId: null, revision: 2, createdAt: at(13, 11), assignedAt: at(13, 11), ageDays: 2,
  sourceAlertIds: [3002, 3003], primaryTypes: ['Fan-out', 'Fan-in'], groups: [
    { groupId: 2, label: 'Alert A-3002', revision: 1, sourceAlertId: 3002, members: members.slice(0, 2) },
    { groupId: 3, label: 'Alert A-3003', revision: 1, sourceAlertId: 3003, members: [members[2]] },
  ] }

const generatedMember = (index: number, alertId: number, type: string): ReviewMember => {
  const from = accounts[(index * 7 + 4) % accounts.length]
  const to = accounts[(index * 7 + 9) % accounts.length]
  const currency = currencies[index % currencies.length]
  const amount = currency === 'KRW' ? 750_000 + index * 126_000 : currency === 'JPY' ? 80_000 + index * 3_700 : 750 + index * 87
  const row = member(201 + index, index % 4 === 0 ? 'SEED' : 'CONNECTION', amount, from.id, to.id, 15 - index % 14, currency, type, alertId)
  row.transaction.paymentFormat = formats[index % formats.length]
  row.transaction.isSuspicious = index % 5 === 0 ? null : index % 3 === 0
  row.transaction.scores = index % 5 === 0 ? null : { p_laundering: 0.31 + index % 7 / 10, [`p_${index % 8 + 1}`]: 0.51 + index % 4 / 10 }
  return row
}
const makeAlert = (index: number, linkedEpisode?: number): ReviewCase => {
  const alertId = 3004 + index
  const type = types[index % types.length]
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
      riskScore: Number((0.31 + index % 7 / 10).toFixed(2)), primaryType: type, typeShare: Number((0.51 + index % 4 / 10).toFixed(2)), totalAmountUsd: transaction.amountUsd,
      amountsByCurrency: noMembers ? {} : { [transaction.paymentCurrency]: transaction.amountPaid }, firstTxAt: noMembers ? null : transaction.occurredAt,
      lastTxAt: noMembers ? null : transaction.occurredAt, paymentFormats: noMembers ? {} : { [transaction.paymentFormat]: 1 },
      typeDistribution: noMembers ? {} : { [type]: 1 } },
    pendingCount: transferred || index % 9 === 0 || noMembers ? 0 : 1, episodeId: linkedEpisode ?? null, sourceAlertIds: [], primaryTypes: [type],
    accounts: [ownerOf(transaction.fromAccountId), ownerOf(transaction.toAccountId)].filter((item): item is LedgerAccount => item != null),
    groups: [{ groupId: 100 + index, label: `A-${alertId} 조사 범위`, revision: 1, evidenceVersion: 1,
      members: noMembers ? [] : [{ ...member, state: transferred ? 'TRANSFERRED' : index % 9 === 0 ? 'DECIDED' : 'PENDING', decision: index % 9 === 0 && !transferred ? 'NORMAL' : null }] }],
    history: [{ eventId: 100 + index, action: 'ASSIGN', comment: '합성 배정 기록', businessAt: at(day, 12), recordedAt: at(day, 12), actor: '시연 시스템' }],
  }
}
const generatedLinked = Array.from({ length: 64 }, (_, index) => makeAlert(index, 150 + Math.floor(index / 2)))
const openAlerts = Array.from({ length: 42 }, (_, index) => makeAlert(index + 64))
const generatedEpisodes: ReviewCase[] = Array.from({ length: 32 }, (_, index) => {
  const sources = generatedLinked.slice(index * 2, index * 2 + 2)
  const first = sources[0]
  const groups = sources.flatMap(source => source.groups ?? []).map(group => ({ ...group, label: `Alert A-${group.sourceAlertId}`,
    members: group.members.map(member => ({ ...member, state: 'PENDING' as const, decision: null })) }))
  const closed = index % 7 === 6
  const amountsByCurrency = sources.reduce<Record<string, number>>((amounts, source) => {
    Object.entries(source.summary.amountsByCurrency).forEach(([currency, amount]) => { amounts[currency] = (amounts[currency] ?? 0) + amount })
    return amounts
  }, {})
  return { ...first, caseId: 150 + index, kind: 'EPISODE', alertId: null, status: closed ? 'CLOSED' : 'OPEN', outcome: closed ? 'NORMAL' : null,
    episodeId: null, sourceAlertIds: sources.map(source => source.alertId ?? 0), primaryTypes: sources.map(source => source.summary.primaryType),
    summary: { ...first.summary, txCount: 2, subjectCount: 2, amountsByCurrency,
      totalAmountUsd: sources.reduce((sum, source) => sum + Number(source.summary.totalAmountUsd ?? 0), 0),
      riskScore: Math.max(...sources.map(source => source.summary.riskScore)) },
    pendingCount: closed ? 0 : 2, groups, accounts: sources.flatMap(source => source.accounts ?? []),
    closedAt: closed ? at(15, 17) : null,
  }
})
const reviewCases = [alert, ...openAlerts, ...linkedAlerts, ...generatedLinked, episode, ...generatedEpisodes]
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
    typeClass: 1, typeName: 'Fan-out', probabilities: [0.02, 0.72, 0.18], judgement: index === 0 ? 'SUSPICIOUS' as const : 'NORMAL' as const,
    alertIds: [3001], episodeIds: index ? [50] : [] })),
  ...Array.from({ length: 120 }, (_, index): LedgerTransaction => {
    const source = generatedMember(index, 3004 + index % 106, types[index % types.length]).transaction
    const from = ownerOf(source.fromAccountId)
    const to = ownerOf(source.toAccountId)
    const judgement = source.isSuspicious == null ? 'UNANALYZED' : source.isSuspicious ? 'SUSPICIOUS' : 'NORMAL'
    return { txId: 201 + index, occurredAt: source.occurredAt, fromAccountId: source.fromAccountId, toAccountId: source.toAccountId,
      fromOwnerId: from?.ownerId ?? '', toOwnerId: to?.ownerId ?? '', fromOwnerName: from?.ownerName, toOwnerName: to?.ownerName,
      fromBankId: source.fromBankId, toBankId: source.toBankId, amountPaid: source.amountPaid, amountReceived: source.amountPaid,
      amountUsd: source.amountUsd, paymentCurrency: source.paymentCurrency, receivingCurrency: source.paymentCurrency,
      paymentFormat: source.paymentFormat, launderingScore: source.scores?.p_laundering ?? null, threshold: 0.7,
      isSuspicious: source.isSuspicious, typeClass: index % types.length + 1, typeName: types[index % types.length],
      probabilities: source.scores ? [0.02, 0.72, 0.18] : [], judgement, alertIds: [3004 + index % 106],
      episodeIds: index < 64 ? [150 + Math.floor(index / 2)] : [] }
  }),
]

const openAlertsCount = reviewCases.filter(row => row.kind === 'ALERT' && row.status === 'OPEN').length
const openEpisodesCount = reviewCases.filter(row => row.kind === 'EPISODE' && row.status === 'OPEN').length
const myCases = reviewCases.filter(row => row.assigneeId === 11)
const myOpen = myCases.filter(row => row.status === 'OPEN')
const dashboard: DashboardSummary = { businessAt, range: { from: '2026-09-16', to: '2026-10-15' },
  pipeline: { computedAt: businessAt, data: { detection: { received: 1820, analyzed: 1792, suspicious: 138, deliveryDates: ['2026-10-14', '2026-10-15'] },
    pendingReports: 6, agreements: [{ agreement: 'STRONG', count: 53 }, { agreement: 'ATYPICAL', count: 85 }, { agreement: 'PATTERN_ONLY', count: 250 }, { agreement: 'WEAK', count: 1404 }],
    // The server's type distribution includes code 0 among suspicious transactions.
    // These counts are illustrative, not inferred from the Kaggle labels or graph-block metadata.
    types: [85, 10, 9, 8, 7, 6, 5, 4, 4].map((count, type) => ({ type, count })) } },
  investigation: { computedAt: businessAt, data: { personal: { pending: myOpen.length, aged: myOpen.filter(row => row.ageDays >= 3).length, closed: myCases.filter(row => row.status === 'CLOSED').length },
    institution: { alerts: openAlertsCount, episodes: openEpisodesCount, aged: 15, today: 8, yesterday: 11 },
    openAlertsAgedOver3Days: reviewCases.filter(row => row.kind === 'ALERT' && row.status === 'OPEN' && row.ageDays > 3).length,
    daily: Array.from({ length: 14 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, '0')}`, incoming: 4 + index % 5, completed: 2 + index % 4 })),
    dailyAlertStatus: Array.from({ length: 14 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, '0')}`, pending: 9 + index % 6, inProgress: 5 + index % 4, done: 3 + index % 3 })),
    episodeWork: { current: { open: openEpisodesCount, aged: 7, unreviewed: 12, createdToday: 3, closedToday: 2 },
      firstReview: { samples: 19, averageSeconds: 2320 }, completion: { samples: 11, averageSeconds: 5290 } } } } }

const dateMatches = (iso: string, url: URL) => (!url.searchParams.get('from') || iso.slice(0, 10) >= url.searchParams.get('from')!)
  && (!url.searchParams.get('to') || iso.slice(0, 10) <= url.searchParams.get('to')!)
const riskMatches = (score: number, values: string[]) => !values.length || values.some(value => value === 'high' ? score >= 0.8
  : value === 'medium' ? score >= 0.5 && score < 0.8 : value === 'low' && score < 0.5)

/** A complete local GET boundary: unknown paths fail instead of reaching a real API. */
export function fixtureGet(path: string): unknown {
  const url = new URL(path, 'http://fixture.invalid')
  const route = url.pathname
  if (route === '/api/v1/demo/clock') return { businessAt, configured: true, revision: 1 }
  if (route === '/api/v1/dashboard/summary') return dashboard
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
  if (route === '/api/v1/notifications') return { content: [], number: 0, size: 20, totalElements: 0, totalPages: 0, unreadCount: 0 }
  throw new Error(`합성 데이터가 준비되지 않은 경로: ${route}`)
}
