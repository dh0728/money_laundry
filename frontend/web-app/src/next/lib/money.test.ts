import { describe, expect, it } from 'vitest'
import { formatAmount, parseAmount, sumByCurrency } from './money'

describe('parseAmount', () => {
  it('문자열과 숫자 금액을 모두 숫자로 읽는다', () => {
    expect(parseAmount(1200.5)).toBe(1200.5)
    expect(parseAmount('1200.5')).toBe(1200.5)
    expect(parseAmount('  42 ')).toBe(42)
    expect(parseAmount('0')).toBe(0)
  })

  it('음수를 허용한다', () => {
    expect(parseAmount('-15.25')).toBe(-15.25)
    expect(parseAmount(-3)).toBe(-3)
  })

  it('해석할 수 없는 값은 0이 아니라 null이다', () => {
    for (const bad of ['', '   ', 'abc', '1e5', '1,000', '1.', '.5', '+5', '--1', NaN, Infinity, -Infinity, null, undefined, {}, [], true]) {
      expect(parseAmount(bad)).toBeNull()
    }
  })

  it('너무 커서 무한대가 되는 문자열은 null이다', () => {
    expect(parseAmount('9'.repeat(400))).toBeNull()
  })
})

describe('sumByCurrency', () => {
  it('통화가 다르면 따로 합친다', () => {
    const { totals, invalidCount } = sumByCurrency([
      { amount: '100', currency: 'USD' },
      { amount: 50, currency: 'SAR' },
      { amount: '0.5', currency: 'BTC' },
      { amount: 25, currency: 'USD' },
    ])
    expect(totals).toEqual({ USD: 125, SAR: 50, BTC: 0.5 })
    expect(invalidCount).toBe(0)
  })

  it('잘못된 금액은 합치지 않고 개수만 센다', () => {
    const { totals, invalidCount } = sumByCurrency([
      { amount: '100', currency: 'USD' },
      { amount: '', currency: 'USD' },
      { amount: 'abc', currency: 'USD' },
      { amount: null, currency: 'USD' },
    ])
    expect(totals).toEqual({ USD: 100 })
    expect(invalidCount).toBe(3)
  })

  it('통화가 없으면 잘못된 항목으로 센다', () => {
    const { totals, invalidCount } = sumByCurrency([
      { amount: 10, currency: '' },
      { amount: 10, currency: '  ' },
      { amount: 10, currency: null },
      { amount: 10, currency: 840 },
    ])
    expect(totals).toEqual({})
    expect(invalidCount).toBe(4)
  })

  it('부동소수점 오차를 없앤다', () => {
    const { totals } = sumByCurrency([
      { amount: 0.1, currency: 'USD' },
      { amount: 0.2, currency: 'USD' },
    ])
    expect(totals.USD).toBe(0.3)
  })

  it('통화 코드를 대문자로 맞추고 공백을 없앤다', () => {
    const { totals } = sumByCurrency([
      { amount: 1, currency: 'usd' },
      { amount: 2, currency: ' USD ' },
      { amount: 3, currency: 'Usd' },
    ])
    expect(totals).toEqual({ USD: 6 })
  })

  it('음수와 상쇄되어도 -0이 남지 않는다', () => {
    const { totals } = sumByCurrency([
      { amount: 5, currency: 'USD' },
      { amount: -5, currency: 'USD' },
    ])
    expect(Object.is(totals.USD, 0)).toBe(true)
  })

  it('빈 목록은 빈 합계다', () => {
    expect(sumByCurrency([])).toEqual({ totals: {}, invalidCount: 0 })
  })
})

describe('formatAmount', () => {
  it('천 단위 쉼표와 통화 코드를 붙인다', () => {
    expect(formatAmount(1200.5, 'SAR')).toBe('1,200.5 SAR')
    expect(formatAmount(1234567, 'USD')).toBe('1,234,567 USD')
  })

  it('법정통화는 소수 2자리까지만 보인다', () => {
    expect(formatAmount(1.23456, 'USD')).toBe('1.23 USD')
  })

  it('BTC는 소수 8자리까지 보인다', () => {
    expect(formatAmount(0.12345678, 'BTC')).toBe('0.12345678 BTC')
    expect(formatAmount(0.123456789, 'BTC')).toBe('0.12345679 BTC')
  })

  it('음수도 그대로 보인다', () => {
    expect(formatAmount(-1500, 'USD')).toBe('-1,500 USD')
  })
})
