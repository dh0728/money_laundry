import type { AlertRow } from '@/api/alerts'
import { alertWorkStatus, workStatusLabels } from '@/lib/workStatus'
import { typeDisplay, type AlertStatus, type TypeCode } from '@/api/codes'

// v24 Lists.tsx의 목록 필터. mock은 전체 행을 가지고 있어 브라우저에서 거른다.
// 실제 API로 바꿀 때는 같은 조건을 AlertQuery(status·typeClass·assigneeId·from/to)로 넘긴다.
export type AlertFilter =
  | { field: 'status'; value: AlertStatus }
  | { field: 'type'; value: TypeCode | '패턴 미특정' | '혼합' }
  | { field: 'assignee'; value: number }
  | { field: 'age'; value: number }

export type AlertFilterField = AlertFilter['field']

export const filterFieldNames: Record<AlertFilterField, string> = {
  status: '처리 상태',
  type: '탐지 유형',
  assignee: '담당자',
  age: '경과일',
}

export const ageOptions = [1, 3, 5]

const dateOf = (iso: string) => iso.slice(0, 10)
const ymd = (date: Date) => date.toLocaleDateString('sv-SE')

export function matchesAlert(
  row: Pick<AlertRow, 'alertId' | 'assignee' | 'status' | 'ageDays'> & Partial<Pick<AlertRow, 'summary' | 'subjectAccount' | 'lastTxAt'>> & { primaryType: { code: TypeCode | null; name: string } },
  filters: AlertFilter[],
  query: string,
  range?: { from?: Date; to?: Date },
) {
  const byField = new Map<AlertFilterField, AlertFilter[]>()
  for (const filter of filters) byField.set(filter.field, [...(byField.get(filter.field) ?? []), filter])
  // 같은 항목끼리는 또는, 다른 항목끼리는 그리고
  for (const group of byField.values()) {
    if (!group.some(filter => matchesOne(row, filter))) return false
  }
  const text = query.trim().toLocaleLowerCase('ko')
  if (text) {
    const haystack = [
      String(row.alertId),
      `A-${row.alertId}`,
      row.summary,
      row.assignee.name,
      row.primaryType.name,
      row.primaryType.code == null ? row.primaryType.name : typeDisplay(row.primaryType.code).label,
      row.subjectAccount?.account,
    ].join(' ').toLocaleLowerCase('ko')
    if (!haystack.includes(text)) return false
  }
  const last = dateOf(row.lastTxAt ?? '')
  if (range?.from && last < ymd(range.from)) return false
  if (range?.to && last > ymd(range.to)) return false
  return true
}

function matchesOne(row: Pick<AlertRow, 'alertId' | 'assignee' | 'status' | 'ageDays'> & Partial<Pick<AlertRow, 'summary' | 'subjectAccount' | 'lastTxAt'>> & { primaryType: { code: TypeCode | null; name: string } }, filter: AlertFilter) {
  switch (filter.field) {
    case 'status': return row.status === filter.value
    case 'type': return typeof filter.value === 'string' ? row.primaryType.name === filter.value : row.primaryType.code === filter.value
    case 'assignee': return row.assignee.userId === filter.value
    case 'age': return row.ageDays >= filter.value
  }
}

export function filterLabel(filter: AlertFilter, assigneeName: (userId: number) => string, meId: number) {
  const name = filterFieldNames[filter.field]
  switch (filter.field) {
    case 'status': return `${name}: ${workStatusLabels[alertWorkStatus(filter.value)]}`
    case 'type': return `${name}: ${typeof filter.value === 'string' ? filter.value : typeDisplay(filter.value).label}`
    case 'assignee': return `${name}: ${filter.value === meId ? '내 담당' : assigneeName(filter.value)}`
    case 'age': return `${name}: ${filter.value}일 이상`
  }
}

export const alertCode = (alertId: number) => `A-${alertId}`
export const episodeCode = (episodeId: number) => `E-${episodeId}`
