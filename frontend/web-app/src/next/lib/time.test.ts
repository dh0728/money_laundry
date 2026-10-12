import { describe, expect, it } from 'vitest'
import { compareInstant, formatKst, parseInstant } from './time'

// 2026-10-05T05:20:00Z
const INSTANT = Date.UTC(2026, 9, 5, 5, 20, 0)

describe('parseInstant', () => {
  it('+09:00 오프셋을 읽는다', () => {
    expect(parseInstant('2026-10-05T14:20:00+09:00')).toBe(INSTANT)
  })

  it('다른 오프셋도 읽는다', () => {
    expect(parseInstant('2026-10-05T00:20:00-05:00')).toBe(INSTANT)
  })

  it('Z를 읽는다', () => {
    expect(parseInstant('2026-10-05T05:20:00Z')).toBe(INSTANT)
  })

  it('시각대가 없으면 서울 시각으로 읽는다', () => {
    expect(parseInstant('2026-10-05T14:20:00')).toBe(INSTANT)
  })

  it('같은 시각의 세 표기는 같은 값이다', () => {
    const a = parseInstant('2026-10-05T14:20:00+09:00')
    const b = parseInstant('2026-10-05T05:20:00Z')
    const c = parseInstant('2026-10-05T14:20:00')
    expect(a).not.toBeNull()
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('날짜만 있으면 서울 자정이다', () => {
    expect(parseInstant('2026-10-05')).toBe(Date.UTC(2026, 9, 4, 15, 0, 0))
  })

  it('소수 초를 읽는다', () => {
    expect(parseInstant('2026-10-05T14:20:00.123+09:00')).toBe(INSTANT + 123)
    expect(parseInstant('2026-10-05T05:20:00.5Z')).toBe(INSTANT + 500)
    expect(parseInstant('2026-10-05T14:20:00.123456')).toBe(INSTANT + 123)
  })

  it('초를 생략한 표기를 읽는다', () => {
    expect(parseInstant('2026-10-05T14:20')).toBe(INSTANT)
  })

  it('숫자는 epoch ms로 본다', () => {
    expect(parseInstant(INSTANT)).toBe(INSTANT)
    expect(parseInstant(0)).toBe(0)
  })

  it('잘못된 값은 null이다', () => {
    for (const bad of ['2026-13-40', '2026-02-30', '2026-10-05T25:00:00', '2026-10-05T14:60:00', '2026-10-05T14:20:00+25:00', '', 'abc', '2026/10/05', '2026-10-05 14:20:00', NaN, Infinity, null, undefined, {}]) {
      expect(parseInstant(bad)).toBeNull()
    }
  })

  it('윤일을 구분한다', () => {
    expect(parseInstant('2028-02-29')).not.toBeNull()
    expect(parseInstant('2026-02-29')).toBeNull()
  })
})

describe('formatKst', () => {
  it('분까지 서울 시각으로 보인다', () => {
    expect(formatKst(INSTANT)).toBe('2026-10-05 14:20')
  })

  it('초까지 보일 수 있다', () => {
    expect(formatKst(INSTANT + 7000, { seconds: true })).toBe('2026-10-05 14:20:07')
  })

  it('UTC 기준 전날 15시 이후는 서울에서 다음 날로 넘어간다', () => {
    expect(formatKst(Date.UTC(2026, 9, 4, 15, 30, 0))).toBe('2026-10-05 00:30')
    expect(formatKst(Date.UTC(2026, 9, 4, 14, 59, 0))).toBe('2026-10-04 23:59')
  })

  it('자정을 24시로 보이지 않는다', () => {
    expect(formatKst(Date.UTC(2026, 9, 4, 15, 0, 0))).toBe('2026-10-05 00:00')
  })

  it('parseInstant와 왕복해도 같은 시각이다', () => {
    const ms = parseInstant('2026-12-31T23:59:59')
    expect(ms).not.toBeNull()
    expect(formatKst(ms as number, { seconds: true })).toBe('2026-12-31 23:59:59')
  })
})

describe('compareInstant', () => {
  it('오름차순으로 비교한다', () => {
    expect(compareInstant(1, 2)).toBeLessThan(0)
    expect(compareInstant(2, 1)).toBeGreaterThan(0)
    expect(compareInstant(5, 5)).toBe(0)
  })

  it('null은 맨 뒤로 보낸다', () => {
    expect(compareInstant(null, 1)).toBeGreaterThan(0)
    expect(compareInstant(1, null)).toBeLessThan(0)
    expect(compareInstant(null, null)).toBe(0)
    expect([3, null, 1, null, 2].sort(compareInstant)).toEqual([1, 2, 3, null, null])
  })
})
