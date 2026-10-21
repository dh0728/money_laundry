import { expect, it } from 'vitest'
import type { Page } from '@/api/common'
import type { ReviewCase, ReviewMoney } from '@/api/liveReview'
import type { DashboardSummary } from '@/api/liveDashboard'
import { fixtureGet } from './liveFixtureApi'

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
  expect(data.types[0]).toEqual({ type: 0, count: 85 })
  expect(data.types.reduce((sum, row) => sum + row.count, 0)).toBe(data.detection.suspicious)
  expect(data.agreements.reduce((sum, row) => sum + row.count, 0)).toBe(data.detection.analyzed)
  expect(data.agreements.find(row => row.agreement === 'ATYPICAL')?.count).toBe(85)
  const mine = fixtureGet('/api/v1/review/cases?assigneeId=11&statuses=OPEN&size=200') as Page<ReviewCase>
  expect(dashboard.investigation.data?.personal.pending).toBe(mine.totalElements)
  expect(dashboard.investigation.data?.personal.aged).toBe(mine.content.filter(row => row.ageDays >= 3).length)
  expect(mine.content.map(row => row.summary.riskScore)).toEqual([...mine.content.map(row => row.summary.riskScore)].sort((a, b) => b - a))
})
