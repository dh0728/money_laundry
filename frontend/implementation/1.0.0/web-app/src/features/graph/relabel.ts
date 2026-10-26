import type { AlertTransaction } from '@/api/alerts'
import { useMemoryState } from '@/lib/memory'
import type { GraphModel, GraphTransaction } from './v24/model'

// 사람이 거래의 의심/정상 판정을 바꾼 기록(9/28 회의: 거래별 의심 표시 편집, FE 제안).
// mock에서는 메모리에 두고 새로고침하면 사라진다. 모델 판정(isSuspicious)은 그대로 두고 위에 덮어쓴다.
export type TxRelabel = { label: 0 | 1; reason: string; at: string; actor: string }
export type TxRelabels = Record<number, TxRelabel>

export const useTxRelabels = () => useMemoryState<TxRelabels>('tx:relabels', {})

export const relabelText = (label: 0 | 1) => (label === 1 ? '이상 거래' : '정상 거래')
/** 이력에 남길 문장 */
export const relabelComment = (txId: number, label: 0 | 1, reason: string) => `거래 ${txId}를 ${relabelText(label)}로 전환 · ${reason}`

/** 사람 판정을 반영한 거래. 바꾼 거래에는 relabel이 붙는다. */
export const applyRelabels = <T extends AlertTransaction>(transactions: T[], relabels: TxRelabels): (T & { relabel?: TxRelabel })[] =>
  transactions.map(t => (relabels[t.txId] ? { ...t, isSuspicious: relabels[t.txId].label === 1, relabel: relabels[t.txId] } : t))

export type PanelFocus = { kind: 'edge'; s: string; t: string } | { kind: 'node'; key: string }

/** 선택한 선(두 계좌 사이 양방향)이나 계좌에 닿은 거래 */
export function focusTransactions(model: GraphModel, focus: PanelFocus): GraphTransaction[] {
  const edges = model.edges.filter(e => focus.kind === 'edge'
    ? (e.s === focus.s && e.t === focus.t) || (e.s === focus.t && e.t === focus.s)
    : e.s === focus.key || e.t === focus.key)
  return [...new Map(edges.flatMap(e => e.transactions).map(t => [t.id, t])).values()].sort((a, b) => a.at.localeCompare(b.at))
}
