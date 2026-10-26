import type { AlertTransaction } from '@/api/alerts'
import type { RelationGraph } from '@/api/graph'
import { isSuspiciousEdge, isSuspiciousNode } from './graphStyle'
import type { TxRelabels } from './relabel'
import type { GraphEdge, GraphModel, GraphNode, GraphTransaction } from './v24/model'

// API.md §3.2 graph(nodes·edges)와 구성 거래를 v24 그래프 모양(GraphModel)으로 바꾼다.
// v24는 엣지 안에 개별 거래를 들고 있어야 시간순 재생·상세 패널이 동작한다.
// 소유주 이름(entity)은 FE 제안 필드(fromOwnerName·toOwnerName)에서 온다. 없으면 소유주별 보기는 계좌별로 나뉜다.
// 색은 거래 판정(사람이 바꾼 것 포함)을 따른다. 거래 하나만 이상이어도 그 선과 양쪽 계좌가 빨갛다.

/** 서울 시각 'YYYY-MM-DD HH:mm' */
const seoulMinute = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16)

export function toGraphModel(graph: RelationGraph, transactions: AlertTransaction[], relabels: TxRelabels = {}): GraphModel {
  const owners = new Map<string, string>()
  const banks = new Map<string, number>()
  for (const t of transactions) {
    if (t.fromOwnerName) owners.set(t.fromAccount, t.fromOwnerName)
    if (t.toOwnerName) owners.set(t.toAccount, t.toOwnerName)
    banks.set(t.fromAccount, t.fromBank)
    banks.set(t.toAccount, t.toBank)
  }
  const txByEdge = new Map<string, GraphTransaction[]>()
  for (const t of transactions) {
    const key = `${t.fromAccount}>${t.toAccount}`
    const modelLabel: 0 | 1 = t.isSuspicious ? 1 : 0
    const human = relabels[t.txId]
    const row: GraphTransaction = {
      id: String(t.txId), at: seoulMinute(t.txAt), usd: t.amountUsd, amount: t.amountPaid, currency: t.paymentCurrency,
      format: t.paymentFormat, from: t.fromAccount, to: t.toAccount, label: human ? human.label : modelLabel, modelLabel,
      relabel: human && { reason: human.reason, at: human.at, actor: human.actor },
    }
    txByEdge.set(key, [...(txByEdge.get(key) ?? []), row])
  }
  const counterparts = new Map<string, Set<string>>()
  for (const e of graph.edges) {
    counterparts.set(e.from, (counterparts.get(e.from) ?? new Set()).add(e.to))
    counterparts.set(e.to, (counterparts.get(e.to) ?? new Set()).add(e.from))
  }

  const suspiciousAccounts = new Set([...txByEdge.values()].flat().filter(t => t.label === 1).flatMap(t => [t.from, t.to]))
  const hasTransactions = txByEdge.size > 0
  const nodes: GraphNode[] = graph.nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, graph.nodes.length)
    return {
      key: n.id, account: n.label, bank: String(banks.get(n.id) ?? ''), entity: owners.get(n.id) ?? '',
      x: Math.cos(angle) * 3, y: Math.sin(angle) * 3,
      core: hasTransactions ? suspiciousAccounts.has(n.id) : isSuspiciousNode(n), bridge: n.role === 'INTERMEDIARY', hub: n.role === 'HUB' || n.role === 'SUBJECT',
      // v24는 주변 계좌를 'N단계'로 부른다. Alert 안 계좌는 1단계, Alert 밖 이웃(hops=1)은 2단계
      hubDegree: counterparts.get(n.id)?.size ?? 0, hop: n.outside ? 2 : 1, synthetic: false,
    }
  })

  const edges: GraphEdge[] = graph.edges.map(e => {
    const rows = (txByEdge.get(`${e.from}>${e.to}`) ?? []).sort((a, b) => a.at.localeCompare(b.at))
    return {
      key: e.id, s: e.from, t: e.to, label: rows.length ? (rows.some(t => t.label === 1) ? 1 : 0) : isSuspiciousEdge(e) ? 1 : 0, count: e.txCount, usd: e.totalAmountUsd,
      currency: rows[0]?.currency ?? 'USD', format: rows[0]?.format ?? '',
      first: rows[0]?.at ?? seoulMinute(e.firstTxAt), last: rows.at(-1)?.at ?? seoulMinute(e.lastTxAt),
      bridgePath: Boolean(e.outside), synthetic: false, transactions: rows,
    }
  })
  return { nodes, edges, blocks: [] }
}
