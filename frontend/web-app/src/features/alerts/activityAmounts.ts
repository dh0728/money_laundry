import type { ReviewGroup } from '@/api/liveReview'
import { kstDate } from '@/api/liveDashboard'
import type { ActivityAmounts } from './CaseActivityCharts'

/** Current case members, including context and model-normal transactions, once per txId. */
export function dailyMemberAmounts(groups: ReviewGroup[]): ActivityAmounts {
  const days = new Map<string, Map<string, number>>()
  const seen = new Set<number>()
  for (const member of groups.flatMap(group => group.members)) {
    if (member.state === 'EXCLUDED' || member.state === 'TRANSFERRED' || seen.has(member.txId)) continue
    seen.add(member.txId)
    const transaction = member.transaction
    const currency = transaction.paymentCurrency.trim()
    const day = kstDate(transaction.occurredAt)
    const amounts = days.get(currency) ?? new Map<string, number>()
    // Evidence snapshots serialize Decimal amounts as strings; never concatenate them.
    amounts.set(day, (amounts.get(day) ?? 0) + Number(transaction.amountPaid))
    days.set(currency, amounts)
  }
  return Object.fromEntries([...days].map(([currency, amounts]) => [currency, {
    daily: [...amounts].sort(([a], [b]) => a.localeCompare(b)).map(([day, amount]) => ({ day, amount })),
    senders: [],
  }]))
}
