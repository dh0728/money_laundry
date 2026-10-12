// 근거 거래 금액은 응답마다 문자열과 숫자가 섞여 온다. 해석할 수 없는 값은 0이 아니라 null로 남긴다.
const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/

export function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!PLAIN_DECIMAL.test(text)) return null
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) return null
  // "-0"이 -0으로 남지 않게 한다
  return parsed === 0 ? 0 : parsed
}

function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return code === '' ? null : code
}

export interface CurrencyTotals {
  totals: Record<string, number>
  invalidCount: number
}

// 통화가 다른 금액은 절대 합치지 않는다. 금액·통화가 잘못된 항목은 합계에서 빼고 개수만 센다.
export function sumByCurrency(items: Array<{ amount: unknown; currency: unknown }>): CurrencyTotals {
  const sums = new Map<string, number>()
  let invalidCount = 0
  for (const item of items) {
    const amount = parseAmount(item.amount)
    const currency = normalizeCurrency(item.currency)
    if (amount === null || currency === null) {
      invalidCount += 1
      continue
    }
    sums.set(currency, (sums.get(currency) ?? 0) + amount)
  }
  // 0.1 + 0.2 같은 부동소수점 오차는 통화별 합계를 소수 6자리로 맞춰 없앤다
  const totals = Object.fromEntries(
    [...sums].map(([currency, total]) => [currency, Number(total.toFixed(6)) + 0]),
  )
  return { totals, invalidCount }
}

export function formatAmount(value: number, currency: string): string {
  const maximumFractionDigits = currency.trim().toUpperCase() === 'BTC' ? 8 : 2
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits }).format(value)} ${currency}`
}
