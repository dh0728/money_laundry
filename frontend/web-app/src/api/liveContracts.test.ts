import { beforeEach, expect, it, vi } from 'vitest'
import { fetchLedgerAccounts, fetchLedgerOwners, fetchLedgerTransactions } from './liveLedger'

beforeEach(() => vi.restoreAllMocks())

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
