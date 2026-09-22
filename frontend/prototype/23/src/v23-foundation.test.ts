import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatMoney, moneyMetrics } from './v23-domain'

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

describe('v23 foundation', () => {
  it('deduplicates transactions and derives investigation money metrics', () => {
    expect(moneyMetrics([
      { id: 'a', from: 'A', to: 'B', usd: 100 },
      { id: 'b', from: 'B', to: 'C', usd: 100 },
      { id: 'b', from: 'B', to: 'C', usd: 100 },
    ], 'C')).toEqual({ total: 200, principal: 100, netInflow: 100 })
  })

  it.each([
    [11_667, 'US Dollar', '11,667$'],
    [2_587, 'EUR', '2,587€'],
    [42, 'Pound Sterling', '42£'],
    [1_000, 'JPY', '1,000¥'],
    [55, 'Swiss Franc', '55CHF'],
    [9, 'KRW', '9KRW'],
  ] as const)('formats %s %s with one postfix currency marker', (amount, currency, expected) => {
    expect(formatMoney(amount, currency)).toBe(expected)
  })

  it('uses theme-opposite foreground for interactive edge glow', () => {
    expect(css).toMatch(/--interactive-edge-glow:[^;]*var\(--foreground\)/)
    expect(css).not.toMatch(/--interactive-edge-glow:[^;]*var\(--destructive\)/)
  })
})
