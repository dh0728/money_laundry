import type { ReviewCase, ReviewApiMember } from '@/api/liveReview'
import type { TimeTx, Timeline } from './timeLayout'

const numeric = (value: unknown) => value == null || value === '' ? Number.NaN : Number(value)

/** Current investigation membership; evidence scores and staff decisions stay separate. */
export function toReviewTimelineRows(item: ReviewCase): TimeTx[] {
  const members = new Map<number, { member: ReviewApiMember; alertId?: number }>()
  for (const group of item.groups ?? []) for (const member of group.members) {
    if (member.state === 'EXCLUDED' || member.state === 'TRANSFERRED' || members.has(member.txId)) continue
    members.set(member.txId, { member, alertId: group.sourceAlertId ?? member.sources[0]?.alertId ?? item.alertId ?? undefined })
  }
  const accounts = new Map((item.accounts ?? []).map(account => [account.id, account]))
  return [...members.values()].map(({ member, alertId }) => {
    const t = member.transaction, from = accounts.get(t.fromAccountId), to = accounts.get(t.toAccountId)
    const score = t.scores?.p_laundering
    return { txId: member.txId, txAt: t.occurredAt, fromAccount: t.fromAccountId, toAccount: t.toAccountId,
      fromBank: t.fromBankId, toBank: t.toBankId, amountUsd: numeric(t.amountUsd), amountPaid: numeric(t.amountPaid),
      paymentCurrency: t.paymentCurrency, launderingScore: score == null || !Number.isFinite(Number(score)) ? null : Number(score),
      alertId, fromOwnerId: from?.ownerId, toOwnerId: to?.ownerId, fromOwnerName: from?.ownerId ? from.ownerName : undefined, toOwnerName: to?.ownerId ? to.ownerName : undefined }
  })
}

/** Selecting one appearance selects that account; several accounts select their mutual transactions. */
export function selectedTimelineTxIds(g: Timeline, selection: { nodes: string[]; edges: string[] }): number[] {
  const accounts = new Set(g.apps.filter(app => selection.nodes.includes(app.id)).map(app => app.account))
  const edges = new Set(g.bundles.filter(bundle => selection.edges.includes(bundle.id)).flatMap(bundle => bundle.txs.map(tx => tx.txId)))
  return g.tx.filter(tx => edges.has(tx.txId) || (accounts.size === 1
    ? accounts.has(tx.fromAccount) || accounts.has(tx.toAccount)
    : accounts.has(tx.fromAccount) && accounts.has(tx.toAccount))).map(tx => tx.txId)
}
