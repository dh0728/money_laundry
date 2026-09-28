import type { EpisodeRow } from '@/api/episodes'
import { typeDisplay, type TypeCode } from '@/api/codes'
import { episodeWorkStatus, workStatusLabels, type WorkStatus } from '@/lib/workStatus'

export type EpisodeFilter =
  | { field: 'status'; value: WorkStatus }
  | { field: 'type'; value: TypeCode }
  | { field: 'risk'; value: 'high' | 'medium' | 'low' }
  | { field: 'assignee'; value: number }
  | { field: 'age'; value: number }

export type EpisodeFilterField = EpisodeFilter['field']
export const episodeFilterNames: Record<EpisodeFilterField, string> = {
  status: '처리 상태', type: '탐지 유형', risk: '위험도', assignee: '담당자', age: '경과일',
}
export const riskOptions = [
  { value: 'high', label: '0.80 이상' },
  { value: 'medium', label: '0.50~0.79' },
  { value: 'low', label: '0.50 미만' },
] as const

const ymd = (date: Date) => date.toLocaleDateString('sv-SE')

export function matchesEpisode(row: EpisodeRow, filters: EpisodeFilter[], query: string, range?: { from?: Date; to?: Date }) {
  const groups = new Map<EpisodeFilterField, EpisodeFilter[]>()
  for (const filter of filters) groups.set(filter.field, [...(groups.get(filter.field) ?? []), filter])
  for (const group of groups.values()) if (!group.some(filter => matchesOne(row, filter))) return false

  const text = query.trim().toLocaleLowerCase('ko')
  if (text && ![`E-${row.episodeId}`, String(row.episodeId), row.assignee.name, ...row.primaryTypes.flatMap(t => [typeDisplay(t.code).key, typeDisplay(t.code).label])].join(' ').toLocaleLowerCase('ko').includes(text)) return false
  const created = row.createdAt.slice(0, 10)
  if (range?.from && created < ymd(range.from)) return false
  if (range?.to && created > ymd(range.to)) return false
  return true
}

function matchesOne(row: EpisodeRow, filter: EpisodeFilter) {
  switch (filter.field) {
    case 'status': return episodeWorkStatus(row.status, Boolean(row.reviewRequestedAt)) === filter.value
    case 'type': return row.primaryTypes.some(t => t.code === filter.value)
    case 'risk': return filter.value === 'high' ? row.riskScore >= 0.8 : filter.value === 'medium' ? row.riskScore >= 0.5 && row.riskScore < 0.8 : row.riskScore < 0.5
    case 'assignee': return row.assignee.userId === filter.value
    case 'age': return row.ageDays >= filter.value
  }
}

export function episodeFilterLabel(filter: EpisodeFilter, assigneeName: (id: number) => string, meId: number) {
  const name = episodeFilterNames[filter.field]
  switch (filter.field) {
    case 'status': return `${name}: ${workStatusLabels[filter.value]}`
    case 'type': return `${name}: ${typeDisplay(filter.value).label}`
    case 'risk': return `${name}: ${riskOptions.find(o => o.value === filter.value)?.label}`
    case 'assignee': return `${name}: ${filter.value === meId ? '내 담당' : assigneeName(filter.value)}`
    case 'age': return `${name}: ${filter.value}일 이상`
  }
}
