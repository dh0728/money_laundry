// API는 +09:00, Z, 시각대 없는 ISO가 섞여 온다(API §0: 시각대가 없으면 서울 시각).
// 문자열 비교는 틀리므로 항상 epoch ms로 바꿔 비교한다.
const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?$/

export function parseInstant(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const match = ISO_PATTERN.exec(value.trim())
  if (!match) return null

  const [, y, mo, d, h = '0', mi = '0', s = '0', fraction = '', zone = ''] = match
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  const second = Number(s)
  const millis = Number(fraction.slice(0, 3).padEnd(3, '0'))
  if (hour > 23 || minute > 59 || second > 59) return null

  // 시각대는 직접 계산한다. 시각대 없는 문자열을 Date.parse에 넘기면 기기 시각대로 해석된다.
  let offsetMinutes = 9 * 60
  if (zone === 'Z') {
    offsetMinutes = 0
  } else if (zone !== '') {
    const digits = zone.slice(1).replace(':', '')
    const offsetHour = Number(digits.slice(0, 2))
    const offsetMinute = Number(digits.slice(2))
    if (offsetHour > 23 || offsetMinute > 59) return null
    offsetMinutes = (zone[0] === '-' ? -1 : 1) * (offsetHour * 60 + offsetMinute)
  }

  // Date.UTC는 두 자리 연도를 1900년대로 바꾸므로 setUTCFullYear를 쓴다
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, millis)
  // 2026-02-30 같은 날짜는 다음 달로 넘어가므로 되돌려 확인한다
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.getTime() - offsetMinutes * 60_000
}

const kstFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

export function formatKst(ms: number, options?: { seconds?: boolean }): string {
  const parts: Record<string, string> = {}
  for (const part of kstFormatter.formatToParts(ms)) parts[part.type] = part.value
  const base = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
  return options?.seconds ? `${base}:${parts.second}` : base
}

// 오름차순. 시각을 알 수 없는 항목(null)은 맨 뒤로 보낸다.
export function compareInstant(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}
