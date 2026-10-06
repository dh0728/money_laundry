import type { AlertDetail } from '@/api/alerts'
import { useMemoryState } from '@/lib/memory'

// 시연 상태: 서버의 EXCLUDE 결과 대신 화면 간 동일한 조사 범위를 공유한다.
export type MockExcludedTransactions = Record<number, number[]>
export const useMockExcludedTransactions = () => useMemoryState<MockExcludedTransactions>('alerts:excluded-transactions', {})

export function withoutTransactions(detail: AlertDetail, excludedIds: number[]): AlertDetail {
  if (!excludedIds.length) return detail
  const excluded = new Set(excludedIds)
  const transactions = detail.transactions.filter(row => !excluded.has(row.txId))
  const accounts = detail.accounts.map(account => {
    const incoming = transactions.filter(row => row.toAccount === account.account)
    const outgoing = transactions.filter(row => row.fromAccount === account.account)
    return {
      ...account,
      inCount: incoming.length,
      inAmountUsd: incoming.reduce((sum, row) => sum + row.amountUsd, 0),
      outCount: outgoing.length,
      outAmountUsd: outgoing.reduce((sum, row) => sum + row.amountUsd, 0),
      maxScore: Math.max(0, ...[...incoming, ...outgoing].map(row => row.launderingScore)),
      counterpartyCount: new Set([...incoming.map(row => row.fromAccount), ...outgoing.map(row => row.toAccount)]).size,
    }
  }).filter(account => account.inCount || account.outCount || account.account === detail.subjectAccount.account)
  const times = transactions.map(row => row.txAt).sort()
  const totalAmountUsd = transactions.reduce((sum, row) => sum + row.amountUsd, 0)
  return {
    ...detail,
    transactions,
    accounts,
    txCount: transactions.length,
    totalAmountUsd,
    amountsByCurrency: [{ currency: 'USD', total: totalAmountUsd }],
    accountCount: accounts.length,
    bankCount: new Set(accounts.map(account => account.bank)).size,
    firstTxAt: times[0] ?? detail.firstTxAt,
    lastTxAt: times[times.length - 1] ?? detail.lastTxAt,
    scoreTimeline: transactions.map(row => ({ txAt: row.txAt, score: row.launderingScore })),
  }
}
