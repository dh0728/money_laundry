import { expect, it } from 'vitest'
import type { Page } from '@/api/common'
import type { WorkNotification, NotificationPage } from '@/api/notifications'
import type { ReviewCase, ReviewMoney } from '@/api/liveReview'
import type { LedgerTransaction } from '@/api/liveLedger'
import type { DashboardSummary } from '@/api/liveDashboard'
import { fixtureGet } from './liveFixtureApi'
const rows = <T,>(path: string) => (fixtureGet(`${path}${path.includes('?') ? '&' : '?'}size=1000`) as Page<T>).content

it('starts with read and unread synthetic notifications whose actual case IDs resolve', () => {
  const notifications = fixtureGet('/api/v1/notifications') as NotificationPage<WorkNotification>
  expect(notifications.content.length).toBeGreaterThan(0)
  expect(notifications.content.some(row => row.read)).toBe(true)
  expect(notifications.content.some(row => !row.read)).toBe(true)
  for (const item of notifications.content) {
    const target = fixtureGet(`/api/v1/review/cases/${item.caseId}`) as ReviewCase
    expect(target.kind).toBe(item.caseKind)
    expect(item.code).toBe(target.kind === 'ALERT' ? `A-${target.alertId}` : `E-${target.caseId}`)
  }
  const searched = fixtureGet('/api/v1/notifications?query=NO-SUCH-SYNTHETIC-NOTIFICATION') as NotificationPage<WorkNotification>
  expect(searched.totalElements).toBe(0)
})
it('uses the same transaction facts and exact source IDs in every case and ledger link', () => {
  const cases = rows<ReviewCase>('/api/v1/review/cases')
  const ledger = rows<LedgerTransaction>('/api/v1/ledger/transactions')
  for (const item of cases) for (const group of item.groups ?? []) for (const member of group.members) {
    const row = ledger.find(row => row.txId === member.txId)
    expect(row, `T-${member.txId} ledger exists`).toBeDefined()
    expect(row?.amountPaid).toBe(member.transaction.amountPaid)
    expect(row?.paymentCurrency).toBe(member.transaction.paymentCurrency)
    const alertId = item.kind === 'ALERT' ? item.alertId : group.sourceAlertId
    expect(member.sources.map(source => source.alertId), `case ${item.caseId} source`).toContain(alertId)
    expect(row?.alertIds).toContain(alertId)
    if (item.kind === 'EPISODE') expect(row?.episodeIds).toContain(item.caseId)
  }
  for (const row of ledger) {
    for (const id of row.alertIds) expect(cases.find(c => c.kind === 'ALERT' && c.alertId === id)?.groups?.some(g => g.members.some(m => m.txId === row.txId)), `T-${row.txId} -> A-${id}`).toBe(true)
    for (const id of row.episodeIds) expect(cases.find(c => c.kind === 'EPISODE' && c.caseId === id)?.groups?.some(g => g.members.some(m => m.txId === row.txId)), `T-${row.txId} -> E-${id}`).toBe(true)
  }
})
it('derives dashboard aggregate counts from the same synthetic ledger and cases', () => {
  const dashboard = fixtureGet('/api/v1/dashboard/summary') as DashboardSummary
  const ledger = rows<LedgerTransaction>('/api/v1/ledger/transactions')
  const cases = rows<ReviewCase>('/api/v1/review/cases')
  expect(dashboard.pipeline.data?.detection.received).toBe(ledger.length)
  expect(dashboard.pipeline.data?.detection.analyzed).toBe(ledger.filter(row => row.isSuspicious !== null).length)
  expect(dashboard.pipeline.data?.detection.suspicious).toBe(ledger.filter(row => row.isSuspicious === true).length)
  expect(dashboard.investigation.data?.institution.alerts).toBe(cases.filter(c => c.kind === 'ALERT' && c.status === 'OPEN').length)
  expect(dashboard.investigation.data?.institution.episodes).toBe(cases.filter(c => c.kind === 'EPISODE' && c.status === 'OPEN').length)
})

it('uses NON_PATTERN as the largest synthetic class independently of binary suspicion', () => {
  const ledger = rows<LedgerTransaction>('/api/v1/ledger/transactions')
  const analyzed = ledger.filter(row => row.isSuspicious !== null)
  const suspicious = analyzed.filter(row => row.isSuspicious)
  const histogram = (items: LedgerTransaction[]) => Array.from({ length: 9 }, (_, code) => items.filter(row => row.typeClass === code).length)
  for (const group of [analyzed, suspicious]) {
    const counts = histogram(group)
    expect(counts[0]).toBeGreaterThan(Math.max(...counts.slice(1)))
  }
  for (const suspicious of [true, false]) for (const nonPattern of [true, false]) {
    expect(analyzed.some(row => row.isSuspicious === suspicious && (row.typeClass === 0) === nonPattern)).toBe(true)
  }
  for (const row of analyzed) {
    expect(row.probabilities).toHaveLength(9)
    expect(row.probabilities.reduce<number>((sum, value) => sum + (value ?? 0), 0)).toBeCloseTo(1, 9)
    const probabilities = row.probabilities as number[]
    expect(probabilities.indexOf(Math.max(...probabilities))).toBe(row.typeClass)
    expect(row.typeName === 'NON_PATTERN').toBe(row.typeClass === 0)
    expect(row.isSuspicious).toBe(row.launderingScore! >= row.threshold!)
  }
  for (const row of ledger.filter(row => row.isSuspicious === null)) expect(row.typeClass).toBeNull()
})
it('keeps dashboard denominators, scoped distributions and source scores consistent', () => {
  const ledger = rows<LedgerTransaction>('/api/v1/ledger/transactions')
  for (const query of ['', '?from=2026-10-13&to=2026-10-14', '?from=2026-11-01&to=2026-11-02']) {
    const data = (fixtureGet('/api/v1/dashboard/summary' + query) as DashboardSummary).pipeline.data!
    const params = new URLSearchParams(query)
    const scoped = ledger.filter(row => row.isSuspicious !== null && (!params.get('from') || row.occurredAt.slice(0, 10) >= params.get('from')!) && (!params.get('to') || row.occurredAt.slice(0, 10) <= params.get('to')!))
    expect(data.agreements.reduce((sum, row) => sum + row.count, 0)).toBe(scoped.length)
    expect(data.types.reduce((sum, row) => sum + row.count, 0)).toBe(scoped.filter(row => row.isSuspicious).length)
    for (const bucket of data.types) expect(bucket.count).toBe(scoped.filter(row => row.isSuspicious && row.typeClass === bucket.type).length)
  }
  const cases = rows<ReviewCase>('/api/v1/review/cases')
  // Alert representative type is distinct from the transaction taxonomy code.
  const nonPatternCases = rows<ReviewCase>('/api/v1/review/cases?kind=ALERT&types=' + encodeURIComponent('패턴 미특정'))
  expect(nonPatternCases.length).toBeGreaterThan(0)
  for (const item of nonPatternCases) expect(item.summary.primaryType).toBe('패턴 미특정')
  for (const item of cases) for (const group of item.groups ?? []) for (const member of group.members) {
    const row = ledger.find(row => row.txId === member.txId)!
    if (member.transaction.scores) {
      expect(row.probabilities).toEqual(Array.from({ length: 9 }, (_, code) => member.transaction.scores![`p_${code}`]))
      for (const source of member.sources) expect(source.primaryType).toBe(cases.find(item => item.alertId === source.alertId)?.summary.primaryType)
    }
  }
})

it('preserves IDs, per-currency amounts, personal filters and unique-transaction totals', () => {
  const ledger = rows<LedgerTransaction>('/api/v1/ledger/transactions')
  expect(ledger).toHaveLength(123)
  expect(new Set(ledger.map(row => row.txId)).size).toBe(123)
  expect(ledger.reduce<Record<string, number>>((sum, row) => { sum[row.paymentCurrency] = (sum[row.paymentCurrency] ?? 0) + row.amountPaid; return sum }, {}))
    .toEqual({ KRW: 334_740_000, USD: 237_060, JPY: 12_154_000 })
  const mixed = fixtureGet('/api/v1/review/cases/150') as ReviewCase
  expect(mixed.summary.amountsByCurrency).toEqual({ KRW: 750_000, USD: 837 })
  const all = rows<ReviewCase>('/api/v1/review/cases?kind=ALERT')
  const mine = rows<ReviewCase>('/api/v1/review/cases?kind=ALERT&assignees=11')
  expect(mine.length).toBeLessThan(all.length)
  expect(mine.every(row => row.assigneeId === 11)).toBe(true)
  const range = rows<LedgerTransaction>('/api/v1/ledger/transactions?from=2026-10-13&to=2026-10-14')
  expect(range.length).toBeLessThan(ledger.length)
  expect(range.every(row => row.occurredAt.slice(0, 10) >= '2026-10-13' && row.occurredAt.slice(0, 10) <= '2026-10-14')).toBe(true)
  const dashboard = fixtureGet('/api/v1/dashboard/summary') as DashboardSummary
  expect(dashboard.pipeline.data?.agreements.reduce((sum, row) => sum + row.count, 0)).toBe(99)
  expect(dashboard.pipeline.data?.types.reduce((sum, row) => sum + row.count, 0)).toBe(42)
})

it('preserves transferred Alert evidence and uses the same active membership as summary', () => {
  const cases = rows<ReviewCase>('/api/v1/review/cases')
  for (const item of cases) {
    const active = [...new Map((item.groups ?? []).flatMap(group => group.members).filter(row => !['EXCLUDED', 'TRANSFERRED'].includes(row.state)).map(row => [row.txId, row])).values()]
    expect(item.summary.txCount, `case ${item.caseId}`).toBe(active.length)
    expect(item.summary.subjectCount).toBe(active.filter(row => row.reviewRole === 'SUBJECT').length)
  }
  const source = cases.find(row => row.alertId === 3010)!
  expect(source.outcome).toBe('TRANSFERRED')
  expect(source.groups![0].members[0].state).toBe('PENDING')
  expect(source.summary.txCount).toBe(1)
})

it('opinion notifications have a corresponding comment in the target fixture history', () => {
  const notifications = fixtureGet('/api/v1/notifications') as { content: { kind: string; caseId: number }[] }
  for (const row of notifications.content.filter(row => row.kind === 'OPINION_ADDED')) {
    const detail = fixtureGet(`/api/v1/review/cases/${row.caseId}`) as ReviewCase
    expect(detail.history?.some(event => event.action === 'COMMENT')).toBe(true)
  }
})

it('실제 사건 화면의 목록·상세·연결 Alert에 합성 데이터가 이어진다', () => {
  const alerts = fixtureGet('/api/v1/review/cases?kind=ALERT&statuses=OPEN') as Page<ReviewCase>
  expect(alerts.content[0]?.summary.riskScore).toBeGreaterThanOrEqual(alerts.content.at(-1)?.summary.riskScore ?? 0)
  expect((fixtureGet('/api/v1/review/cases?kind=ALERT&query=A-3001') as Page<ReviewCase>).content[0]?.caseId).toBe(1)
  expect(alerts.totalElements).toBeGreaterThan(20)
  expect(alerts.totalPages).toBeGreaterThan(1)
  const episode = fixtureGet('/api/v1/review/cases/50') as ReviewCase
  expect(episode.groups?.map(row => row.sourceAlertId)).toEqual([3002, 3003])
  const linked = fixtureGet('/api/v1/review/cases?kind=ALERT&query=A-3002') as Page<ReviewCase>
  expect(linked.content[0]?.caseId).toBe(2)
  const episodePage = fixtureGet('/api/v1/review/cases?kind=EPISODE&assignees=11&page=1&size=20') as Page<ReviewCase>
  expect(episodePage.content.length).toBeGreaterThan(0)
  expect(episodePage.content.every(row => row.kind === 'EPISODE' && row.assigneeId === 11)).toBe(true)
  const generatedEpisode = fixtureGet('/api/v1/review/cases/150') as ReviewCase
  expect(generatedEpisode.sourceAlertIds).toEqual([3004, 3005])
  expect((fixtureGet('/api/v1/review/cases/1000') as ReviewCase).episodeId).toBe(150)
  expect((fixtureGet('/api/v1/review/cases/1001/money') as ReviewMoney).reason).toBe('WAITING_RECEIPTS')
})

it('선택 전 거래는 전체이고 계좌 선택 후 같은 합성 거래로 좁혀진다', () => {
  const all = fixtureGet('/api/v1/ledger/transactions?page=0&size=20') as Page<{ txId: number }>
  const selected = fixtureGet('/api/v1/ledger/transactions?account=account-a&page=0&size=20') as Page<{ txId: number }>
  expect(all.content.slice(0, 3).map(row => row.txId)).toEqual([101, 102, 103])
  expect(all.totalElements).toBe(123)
  expect(all.totalPages).toBeGreaterThan(1)
  expect(selected.content[0]?.txId).toBe(101)
  expect(selected.content.length).toBeLessThan(all.content.length)
  const usd = fixtureGet('/api/v1/ledger/transactions?query=202&page=0&size=20') as Page<{ paymentCurrency: string }>
  expect(usd.content[0]?.paymentCurrency).toBe('USD')
  const filtered = fixtureGet('/api/v1/ledger/transactions?payments=ACH&judgement=UNANALYZED') as Page<{ paymentFormat: string; judgement: string }>
  expect(filtered.content.length).toBeGreaterThan(0)
  expect(filtered.content.every(row => row.paymentFormat === 'ACH' && row.judgement === 'UNANALYZED')).toBe(true)
  expect(() => fixtureGet('/api/v1/unknown')).toThrow('합성 데이터가 준비되지 않은 경로')
})

it('대시보드 유형 코드 0은 의심 거래 분포에 포함되고 분모가 맞는다', () => {
  const dashboard = fixtureGet('/api/v1/dashboard/summary') as DashboardSummary
  const data = dashboard.pipeline.data!
  expect(data.types[0].count).toBeGreaterThan(0)
  expect(data.types.reduce((sum, row) => sum + row.count, 0)).toBe(data.detection.suspicious)
  expect(data.agreements.reduce((sum, row) => sum + row.count, 0)).toBe(data.detection.analyzed)
  expect(data.agreements.find(row => row.agreement === 'ATYPICAL')?.count).toBe(data.types[0].count)
  const mine = fixtureGet('/api/v1/review/cases?assigneeId=11&statuses=OPEN&size=200') as Page<ReviewCase>
  expect(dashboard.investigation.data?.personal.pending).toBe(mine.totalElements)
  expect(dashboard.investigation.data?.personal.aged).toBe(mine.content.filter(row => row.ageDays >= 3).length)
  expect(mine.content.map(row => row.summary.riskScore)).toEqual([...mine.content.map(row => row.summary.riskScore)].sort((a, b) => b - a))
})
