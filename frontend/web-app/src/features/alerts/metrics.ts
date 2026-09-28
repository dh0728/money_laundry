import type { AlertTransaction } from '@/api/alerts'

// v23 "의심 거래 금액" 대신 쓰는 세 지표(v24 v23-domain.ts moneyMetrics).
// 투입 원금: 계좌별 (보낸 돈 − 받은 돈)의 양수 합과 가장 큰 단일 거래 중 큰 값. 경로를 따라 같은 돈이 여러 번 더해지는 것을 줄인다.
// 순유입: 대표 계좌 기준 받은 돈 − 보낸 돈(API.md §4.1 netRetainedUsd와 같은 방식).
export function moneyMetrics(rows: AlertTransaction[], representative?: string) {
  const transactions = [...new Map(rows.map(row => [row.txId, row])).values()]
  const external = transactions.filter(row => row.fromAccount !== row.toAccount)
  const accounts = new Set(external.flatMap(row => [row.fromAccount, row.toAccount]))
  const sent = (account: string) => external.filter(row => row.fromAccount === account).reduce((sum, row) => sum + row.amountUsd, 0)
  const received = (account: string) => external.filter(row => row.toAccount === account).reduce((sum, row) => sum + row.amountUsd, 0)
  const principal = Math.max(
    0,
    ...external.map(row => row.amountUsd),
    [...accounts].reduce((sum, account) => sum + Math.max(0, sent(account) - received(account)), 0),
  )
  return {
    total: transactions.reduce((sum, row) => sum + row.amountUsd, 0),
    principal,
    netInflow: representative ? received(representative) - sent(representative) : null,
  }
}

/** 이름별 합계를 큰 순서로 */
export function sumBy<T>(items: T[], key: (item: T) => string, value: (item: T) => number) {
  const map = new Map<string, number>()
  for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + value(item))
  return [...map].map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v)
}

export const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
