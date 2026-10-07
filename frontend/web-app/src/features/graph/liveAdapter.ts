import type { ReviewCase, ReviewMember } from '@/api/liveReview'
import type { GraphEdge, GraphModel, GraphNode, GraphTransaction } from './v24/model'

const seoulMinute = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16)

export function toReviewGraphModel(item: ReviewCase): GraphModel {
  const members = new Map<number, ReviewMember>()
  for (const group of item.groups ?? []) for (const member of group.members) {
    if (member.state === 'EXCLUDED' || member.state === 'TRANSFERRED') continue
    const previous = members.get(member.txId)
    if (!previous || (!previous.decision && member.decision)) members.set(member.txId, member)
  }
  const byPair = new Map<string, GraphTransaction[]>()
  const accounts = new Map((item.accounts ?? []).map(account => [account.id, account]))
  const banks = new Map<string, number>()
  const neighbors = new Map<string, Set<string>>()
  for (const member of members.values()) {
    const t = member.transaction
    const from = t.fromAccountId, to = t.toAccountId
    banks.set(from, t.fromBankId); banks.set(to, t.toBankId)
    neighbors.set(from, (neighbors.get(from) ?? new Set()).add(to))
    neighbors.set(to, (neighbors.get(to) ?? new Set()).add(from))
    const modelLabel: 0 | 1 = t.isSuspicious ? 1 : 0
    const label: 0 | 1 = member.decision ? (member.decision === 'SUSPICIOUS' ? 1 : 0) : modelLabel
    const row: GraphTransaction = {
      id: String(member.txId), at: seoulMinute(t.occurredAt), usd: t.amountUsd, amount: t.amountPaid,
      currency: t.paymentCurrency, format: t.paymentFormat, from, to, label, modelLabel,
    }
    const key = JSON.stringify([from, to])
    byPair.set(key, [...(byPair.get(key) ?? []), row])
  }
  const edges: GraphEdge[] = [...byPair].map(([key, rows]) => {
    rows.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    const [s, t] = JSON.parse(key) as [string, string]
    return {
      key, s, t, label: rows.some(row => row.label === 1) ? 1 : 0, count: rows.length,
      usd: rows.reduce((sum, row) => sum + row.usd, 0), currency: rows[0].currency, format: rows[0].format,
      first: rows[0].at, last: rows.at(-1)!.at, bridgePath: false, synthetic: false, transactions: rows,
    }
  })
  const suspicious = new Set(edges.filter(edge => edge.label === 1).flatMap(edge => [edge.s, edge.t]))
  const nodes: GraphNode[] = [...banks].map(([key, bank], index) => ({
    key, account: key, bank: String(bank), entity: accounts.get(key)?.ownerName ?? '', entityId: accounts.get(key)?.ownerId,
    x: Math.cos(2 * Math.PI * index / banks.size) * 3, y: Math.sin(2 * Math.PI * index / banks.size) * 3,
    core: suspicious.has(key), bridge: false, hub: false, hubDegree: neighbors.get(key)?.size ?? 0, hop: 1, synthetic: false,
  }))
  return { nodes, edges, blocks: [] }
}
