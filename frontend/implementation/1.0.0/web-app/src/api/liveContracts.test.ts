import { beforeEach, expect, it, vi } from 'vitest'
import { fetchLiveDashboard } from './liveDashboard'
import { fetchLedgerAccounts, fetchLedgerOwners, fetchLedgerTransactions } from './liveLedger'

beforeEach(() => vi.restoreAllMocks())

it('선택이 없으면 owner/account를 생략하고 소유주만 선택하면 거래 owner 필터만 전달한다', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response('{}')))
  await fetchLedgerAccounts({ page: 0 })
  await fetchLedgerTransactions({ page: 0 })
  await fetchLedgerTransactions({ page: 0 }, undefined, 'owner-uuid')
  const urls = fetcher.mock.calls.map(([url]) => new URL(String(url), 'http://local'))
  for (const url of urls.slice(0, 2)) { expect(url.searchParams.has('owner')).toBe(false); expect(url.searchParams.has('account')).toBe(false) }
  expect(urls[2].searchParams.get('owner')).toBe('owner-uuid'); expect(urls[2].searchParams.has('account')).toBe(false)
})

it('대시보드는 필수 기간을 최신 경로로 보낸다', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    businessAt: '2026-09-28T00:00:00+09:00', range: { from: '2026-09-01', to: '2026-09-28' },
    pipeline: { computedAt: '2026-09-28T00:00:00+09:00', data: { detection: { received: 0, analyzed: 0, suspicious: 0, deliveryDates: [] }, pendingReports: 0, agreements: [], types: [] } },
    investigation: { computedAt: '2026-09-28T00:00:00+09:00', data: { personal: { pending: 0, aged: 0, closed: 0 }, institution: { alerts: 0, episodes: 0, aged: 0, today: 0, yesterday: 0 }, openAlertsAgedOver3Days: 0, daily: [], dailyAlertStatus: [], episodeWork: { current: { unreviewed: 0 }, firstReview: { samples: 0, averageSeconds: null }, completion: { samples: 0, averageSeconds: null } } } },
  })))
  await fetchLiveDashboard('2026-09-01', '2026-09-28')
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/dashboard/summary?from=2026-09-01&to=2026-09-28')
})

it('거래 탐색은 선택된 가명 ID와 반복 필터를 세 단계에 전달한다', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response('{}')))
  const filters = { from: '2026-09-01', to: '2026-09-28', judgement: ['SUSPICIOUS', 'NORMAL'] as const, payments: ['WIRE', 'CASH'], size: 20 }
  const accepted = { ...filters, judgement: [...filters.judgement] }
  await fetchLedgerOwners(accepted)
  await fetchLedgerAccounts(accepted, 'owner-uuid')
  await fetchLedgerTransactions(accepted, 'account-uuid')
  for (const [url] of fetcher.mock.calls) {
    const parsed = new URL(String(url), 'http://local')
    expect(parsed.searchParams.getAll('judgement')).toEqual(['SUSPICIOUS', 'NORMAL'])
    expect(parsed.searchParams.getAll('payments')).toEqual(['WIRE', 'CASH'])
    expect(parsed.searchParams.get('from')).toBe('2026-09-01')
  }
  expect(String(fetcher.mock.calls[1][0])).toContain('owner=owner-uuid')
  expect(String(fetcher.mock.calls[2][0])).toContain('account=account-uuid')
})
