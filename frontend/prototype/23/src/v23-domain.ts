export type GraphViewMode = 'account' | 'owner'

export type MetricTx = {
  id: string
  from: string
  to: string
  usd: number
}

export function moneyMetrics(rows: MetricTx[], representative?: string) {
  const transactions = [...new Map(rows.map(row => [row.id, row])).values()]
  const external = transactions.filter(row => row.from !== row.to)
  const accounts = new Set(external.flatMap(row => [row.from, row.to]))
  const principal = Math.max(
    ...external.map(row => row.usd),
    [...accounts].reduce((sum, account) => sum + Math.max(0,
      external.filter(row => row.from === account).reduce((value, row) => value + row.usd, 0)
      - external.filter(row => row.to === account).reduce((value, row) => value + row.usd, 0),
    ), 0),
    0,
  )
  const netInflow = representative
    ? external.reduce((sum, row) => sum + (row.to === representative ? row.usd : 0) - (row.from === representative ? row.usd : 0), 0)
    : null

  return {
    total: transactions.reduce((sum, row) => sum + row.usd, 0),
    principal,
    netInflow,
  }
}

const currencyMarkers: Record<string, string> = {
  'US Dollar': '$',
  USD: '$',
  Euro: '€',
  EUR: '€',
  'Pound Sterling': '£',
  GBP: '£',
  'Japanese Yen': '¥',
  JPY: '¥',
  'Swiss Franc': 'CHF',
  CHF: 'CHF',
}

export function formatMoney(amount: number, currency: string) {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount)}${currencyMarkers[currency] ?? currency}`
}
