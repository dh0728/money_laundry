import { expect, it } from 'vitest'
import type { BacktestPeriod } from '@/api/rules'
import { addDays, chosenPeriod, dayCount, isDate, lookbackFrom, periodText } from './backtest-period'

// 원장 09-01 ~ 09-16. 첫 7일은 이력으로만 쓰므로 09-08 부터 검사할 수 있다
const range: BacktestPeriod = { ledgerFrom: '2023-09-01', ledgerTo: '2023-09-16', earliest: '2023-09-08', from: '2023-09-08', to: '2023-09-16', days: 9, warmupDays: 7, maxDays: 90 }

it('날짜는 글자로 더하고 빼며 달 · 해를 넘겨도 맞다', () => {
  expect(addDays('2023-09-01', -1)).toBe('2023-08-31')
  expect(addDays('2024-02-28', 2)).toBe('2024-03-01')
  expect(addDays('2023-12-31', 1)).toBe('2024-01-01')
  expect(dayCount('2023-09-08', '2023-09-16')).toBe(9)
  expect(dayCount('2023-09-12', '2023-09-12')).toBe(1)
  expect(isDate('2023-09-12')).toBe(true)
  expect(['', '2023-9-12', '2023-02-30', '2023-13-01', 'x'].map(isDate)).toEqual([false, false, false, false, false])
})

it('타겟 날이 끝이고 검사 일수만큼 앞이 시작이다', () => {
  expect(chosenPeriod(range, '2023-09-12', 1)).toEqual({ from: '2023-09-12', to: '2023-09-12', days: 1, clipped: false, whole: false })
  expect(chosenPeriod(range, '2023-09-12', 3)).toEqual({ from: '2023-09-10', to: '2023-09-12', days: 3, clipped: false, whole: false })
  // 검사할 수 있는 가장 이른 날보다 앞으로는 가지 않는다
  expect(chosenPeriod(range, '2023-09-12', 7)).toEqual({ from: '2023-09-08', to: '2023-09-12', days: 5, clipped: true, whole: false })
  expect(chosenPeriod(range, '2023-09-08', 1)).toMatchObject({ from: '2023-09-08', to: '2023-09-08', clipped: false })
  // 전체: 타겟 날까지 검사할 수 있는 날짜 전부. 채우지 못했다고 하지 않는다
  expect(chosenPeriod(range, '2023-09-12', 'ALL')).toEqual({ from: '2023-09-08', to: '2023-09-12', days: 5, clipped: false, whole: false })
})

it('타겟 날이 원장 마지막 날이고 시작이 기본 기간의 시작이면 기간을 고르지 않은 것과 같다', () => {
  expect(chosenPeriod(range, '2023-09-16', 'ALL')).toMatchObject({ from: '2023-09-08', to: '2023-09-16', days: 9, whole: true })
  // 일수를 골랐어도 같은 날짜가 되면 같은 것이다
  expect(chosenPeriod({ ...range, earliest: '2023-09-10', from: '2023-09-10', days: 7 }, '2023-09-16', 7)).toMatchObject({ from: '2023-09-10', whole: true, clipped: false })
  expect(chosenPeriod(range, '2023-09-16', 7)).toMatchObject({ from: '2023-09-10', whole: false })
})

it('전체는 한 번에 검사하는 날짜 수의 상한까지다', () => {
  // 긴 원장: 서버의 기본 기간이 마지막 90일이다
  const long: BacktestPeriod = { ...range, ledgerFrom: '2023-01-01', earliest: '2023-01-08', from: '2023-06-19', days: 90 }
  expect(chosenPeriod(long, '2023-09-16', 'ALL')).toMatchObject({ from: '2023-06-19', to: '2023-09-16', days: 90, whole: true })
  expect(chosenPeriod(long, '2023-08-01', 'ALL')).toMatchObject({ from: '2023-05-04', to: '2023-08-01', days: 90, whole: false })
  expect(chosenPeriod(long, '2023-01-20', 'ALL')).toMatchObject({ from: '2023-01-08', days: 13, clipped: false })
})

it('타겟 날이 없거나 검사할 수 있는 날짜 밖이면 사유를 준다', () => {
  expect(chosenPeriod(range, '', 'ALL')).toEqual({ error: '타겟 날을 골라 주세요.' })
  expect(chosenPeriod(range, '2023-02-30', 1)).toEqual({ error: '타겟 날을 골라 주세요.' })
  expect(chosenPeriod(range, '2023-09-07', 1)).toEqual({ error: '타겟 날은 2023-09-08 ~ 2023-09-16 안에서 골라야 합니다.' })
  expect(chosenPeriod(range, '2023-09-17', 1)).toEqual({ error: '타겟 날은 2023-09-08 ~ 2023-09-16 안에서 골라야 합니다.' })
})

it('돌아보는 범위는 검사 첫날에서 룰의 기간을 날짜로 올린 만큼 앞이고 원장 첫날보다 앞서지 않는다', () => {
  expect(lookbackFrom('2023-09-10', 10080, '2023-09-01')).toBe('2023-09-03')
  expect(lookbackFrom('2023-09-10', 4320, '2023-09-01')).toBe('2023-09-07')
  expect(lookbackFrom('2023-09-10', 1440, '2023-09-01')).toBe('2023-09-09')
  // 1시간 · 6시간도 자정을 넘어 전날 거래를 볼 수 있다
  expect(lookbackFrom('2023-09-10', 60, '2023-09-01')).toBe('2023-09-09')
  expect(lookbackFrom('2023-09-05', 10080, '2023-09-01')).toBe('2023-09-01')
  // 기간이 없는 템플릿(단건 고액거래)
  expect(lookbackFrom('2023-09-10', undefined, '2023-09-01')).toBeNull()
  expect(lookbackFrom('2023-09-10', null, '2023-09-01')).toBeNull()
})

it('기간은 하루면 날짜 하나로 적는다', () => {
  expect(periodText({ from: '2023-09-08', to: '2023-09-16', days: 9 })).toBe('2023-09-08 ~ 2023-09-16 (9일)')
  expect(periodText({ from: '2023-09-12', to: '2023-09-12', days: 1 })).toBe('2023-09-12 (1일)')
})
