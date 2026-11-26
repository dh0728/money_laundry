import type { BacktestPeriod } from '@/api/rules'

// 백테스트의 검사 기간. 화면에서는 타겟 날(검사하는 마지막 날)과 검사 일수를 고르고, 서버에는 시작 · 끝 날짜로 보낸다.
// 날짜는 YYYY-MM-DD 글자로만 다룬다. 시간대가 끼지 않게 UTC 로 더하고 뺀다.

const DAY_MS = 86_400_000
const time = (date: string) => Date.parse(`${date}T00:00:00Z`)

/** YYYY-MM-DD 꼴이고 실제로 있는 날짜인가. */
export const isDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(time(date))
  && new Date(time(date)).toISOString().slice(0, 10) === date

export const addDays = (date: string, days: number) => new Date(time(date) + days * DAY_MS).toISOString().slice(0, 10)

/** from 과 to 를 모두 포함한 날짜 수. */
export const dayCount = (from: string, to: string) => Math.round((time(to) - time(from)) / DAY_MS) + 1

/** 검사 일수 선택지. 'ALL' 은 타겟 날까지 검사할 수 있는 날짜 전부다. */
export type PeriodSpan = number | 'ALL'

export type ChosenPeriod =
  | { error: string }
  | {
    error?: undefined
    from: string
    to: string
    days: number
    /** 고른 일수만큼 채우지 못했다. 원장 첫 며칠은 검사하지 않기 때문이다 */
    clipped: boolean
    /** 기간을 따로 고르지 않았을 때 서버가 검사하는 날짜와 같다 */
    whole: boolean
  }

/**
 * 타겟 날과 검사 일수로 검사하는 날짜를 정한다. 타겟 날이 끝이고 거기서 일수만큼 앞이 시작이다.
 * 검사할 수 있는 가장 이른 날(range.earliest)보다 앞으로는 가지 않고, 한 번에 range.maxDays 일까지다.
 */
export function chosenPeriod(range: BacktestPeriod, target: string, span: PeriodSpan): ChosenPeriod {
  if (!isDate(target)) return { error: '타겟 날을 골라 주세요.' }
  if (target < range.earliest || target > range.ledgerTo)
    return { error: `타겟 날은 ${range.earliest} ~ ${range.ledgerTo} 안에서 골라야 합니다.` }
  const wanted = span === 'ALL' ? range.maxDays : Math.min(span, range.maxDays)
  const start = addDays(target, -(wanted - 1))
  const from = start < range.earliest ? range.earliest : start
  const days = dayCount(from, target)
  return { from, to: target, days, clipped: span !== 'ALL' && days < span, whole: from === range.from && target === range.to }
}

/**
 * 룰의 기간만큼 돌아볼 때 읽는 가장 이른 날짜. 검사 첫날에서 룰의 기간(날짜로 올림)만큼 앞이고 원장 첫날보다 앞서지 않는다.
 * 서버(BacktestRunner.lookback)와 같은 계산이다. 기간이 없는 템플릿은 돌아보지 않으므로 null 이다.
 */
export function lookbackFrom(from: string, windowMinutes: number | null | undefined, ledgerFrom: string): string | null {
  if (!windowMinutes) return null
  const start = addDays(from, -Math.ceil(windowMinutes / 1440))
  return start < ledgerFrom ? ledgerFrom : start
}

/** "2023-09-08 ~ 2023-09-16 (9일)". 하루면 "2023-09-12 (1일)". */
export const periodText = (period: { from: string; to: string; days: number }) =>
  `${period.from === period.to ? period.to : `${period.from} ~ ${period.to}`} (${period.days}일)`
