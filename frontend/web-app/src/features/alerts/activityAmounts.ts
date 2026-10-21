import type { ReviewApiMember, ReviewGroup } from '@/api/liveReview'
import { kstDate } from '@/api/liveDashboard'
import { caseEvidence } from './caseEvidence'
import type { ActivityAmounts } from './CaseActivityCharts'

/** Keep Decimal snapshots exact for text totals, and invalidate incomplete currency totals. */
export function memberAmountsByCurrency(members: ReviewApiMember[], field: 'amountPaid' | 'amountUsd' = 'amountPaid'): Record<string, string | null> {
  const totals = new Map<string, { units: bigint; scale: number } | null>()
  const seen = new Set<number>()
  for (const member of members) {
    if (member.state === 'EXCLUDED' || member.state === 'TRANSFERRED' || seen.has(member.txId)) continue
    seen.add(member.txId)
    const currency = member.transaction.paymentCurrency.trim() || '통화 미제공'
    const value = member.transaction[field]
    const raw = typeof value === 'number' ? value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 100 }) : typeof value === 'string' ? value.trim() : undefined
    const parts = raw?.match(/^([+-]?)(\d+)(?:\.(\d+))?$/)
    const previous = totals.get(currency)
    if (!parts || previous === null || currency === '통화 미제공') { totals.set(currency, null); continue }
    const fraction = parts[3] ?? ''
    const units = BigInt(`${parts[1]}${parts[2]}${fraction}`)
    const scale = Math.max(previous?.scale ?? 0, fraction.length)
    totals.set(currency, { scale, units: (previous?.units ?? 0n) * 10n ** BigInt(scale - (previous?.scale ?? 0)) + units * 10n ** BigInt(scale - fraction.length) })
  }
  return Object.fromEntries([...totals].map(([currency, total]) => {
    if (total == null) return [currency, null]
    const digits = (total.units < 0n ? -total.units : total.units).toString().padStart(total.scale + 1, '0')
    return [currency, `${total.units < 0n ? '-' : ''}${total.scale ? `${digits.slice(0, -total.scale)}.${digits.slice(-total.scale)}` : digits}`]
  }))
}

/** Current case members, including context and model-normal transactions, once per txId. */
export function dailyMemberAmounts(groups: ReviewGroup[]): ActivityAmounts {
  const days = new Map<string, Map<string, ReviewApiMember[]>>()
  for (const member of caseEvidence(groups).members) {
    const transaction = member.transaction
    const currency = transaction.paymentCurrency.trim()
    const day = kstDate(transaction.occurredAt)
    const amounts = days.get(currency) ?? new Map<string, ReviewApiMember[]>()
    amounts.set(day, [...(amounts.get(day) ?? []), member])
    days.set(currency, amounts)
  }
  return Object.fromEntries([...days].map(([currency, amounts]) => [currency, {
    daily: [...amounts].sort(([a], [b]) => a.localeCompare(b)).map(([day, members]) => {
      const total = memberAmountsByCurrency(members)[currency]
      return { day, amount: total == null || !Number.isFinite(Number(total)) ? null : Number(total) }
    }),
    senders: [],
  }]))
}

/** Use the stored USD value; missing conversions must not become partial totals. */
export function dailyMemberUsdByCurrency(groups: ReviewGroup[]): Record<string, { day: string; amount: number }[]> | null {
  const currencies = new Map<string, Map<string, number>>()
  for (const { transaction } of caseEvidence(groups).members) {
    const value = transaction.amountUsd
    if (value == null || String(value).trim() === '' || !Number.isFinite(Number(value))) return null
    const day = kstDate(transaction.occurredAt)
    const currency = transaction.paymentCurrency.trim()
    const days = currencies.get(currency) ?? new Map<string, number>()
    days.set(day, (days.get(day) ?? 0) + Number(value))
    currencies.set(currency, days)
  }
  return Object.fromEntries([...currencies].sort(([a], [b]) => a.localeCompare(b)).map(([currency, days]) => [currency,
    [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, amount]) => ({ day, amount })),
  ]))
}
