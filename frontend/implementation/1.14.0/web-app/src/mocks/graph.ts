import type { AlertAccount, AlertTransaction } from '@/api/alerts'
import type { GraphEdge, GraphNode, RelationGraph, RiskLevel } from '@/api/graph'

// API.md §3.2: riskLevel 경계는 BE 프로퍼티(기본 0.9/0.7)
const riskLevel = (score: number): RiskLevel => (score >= 0.9 ? 'HIGH' : score >= 0.7 ? 'MEDIUM' : 'LOW')

/** mock: 구성 거래와 참여 계좌로 관계 그래프를 만든다. 실제로는 BE가 alert_accounts에서 만든다. */
export function graphOf(transactions: AlertTransaction[], accounts: AlertAccount[], subject?: string): RelationGraph {
  const edges = new Map<string, GraphEdge>()
  for (const t of transactions) {
    const id = `${t.fromAccount}>${t.toAccount}`
    const prev = edges.get(id)
    edges.set(id, prev
      ? { ...prev, txCount: prev.txCount + 1, totalAmountUsd: prev.totalAmountUsd + t.amountUsd, maxScore: Math.max(prev.maxScore, t.launderingScore), firstTxAt: t.txAt < prev.firstTxAt ? t.txAt : prev.firstTxAt, lastTxAt: t.txAt > prev.lastTxAt ? t.txAt : prev.lastTxAt }
      : {
          id, from: t.fromAccount, to: t.toAccount, txCount: 1, totalAmountUsd: t.amountUsd, maxScore: t.launderingScore,
          primaryType: { code: t.typeClass, name: t.typeName },
          direction: t.fromAccount === t.toAccount ? 'SELF' : t.toAccount === subject ? 'IN' : 'OUT',
          firstTxAt: t.txAt, lastTxAt: t.txAt,
        })
  }
  const byAccount = new Map<string, AlertAccount>()
  for (const a of accounts) {
    const prev = byAccount.get(a.account)
    byAccount.set(a.account, prev ? { ...prev, inCount: prev.inCount + a.inCount, inAmountUsd: prev.inAmountUsd + a.inAmountUsd, outCount: prev.outCount + a.outCount, outAmountUsd: prev.outAmountUsd + a.outAmountUsd, maxScore: Math.max(prev.maxScore, a.maxScore), role: prev.role === 'SUBJECT' ? prev.role : a.role } : a)
  }
  // 참여 계좌는 늘 거래가 있다(API.md §3.1). mock 참여 계좌 중 거래가 없는 것은 뺀다.
  const nodes: GraphNode[] = [...byAccount.values()].filter(a => a.inCount + a.outCount > 0).map(a => ({
    id: a.account, kind: 'ACCOUNT', label: a.account, riskLevel: riskLevel(a.maxScore), role: a.role,
    inAmountUsd: a.inAmountUsd, outAmountUsd: a.outAmountUsd, txCount: a.inCount + a.outCount,
  }))
  return { nodes, edges: [...edges.values()] }
}
