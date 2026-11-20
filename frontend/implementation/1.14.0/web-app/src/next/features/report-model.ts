import type { JudgmentRecord, Verdict } from '../workspace-store'

export type ReportFilters = { query?: string; start?: string; end?: string; verdict?: Verdict | '' }
export const verdictLabel = (verdict: Verdict) => verdict === 'normal' ? '정상' : '이상'
export function validReportDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}
export function filterJudgments(rows: JudgmentRecord[], filters: ReportFilters) {
  const query = filters.query?.trim().toLocaleLowerCase() ?? ''
  return rows.filter(row => (!filters.start || row.at.slice(0, 10) >= filters.start)
    && (!filters.end || row.at.slice(0, 10) <= filters.end)
    && (!filters.verdict || row.verdict === filters.verdict)
    && `${row.id} ${row.displayIds.join(' ')} ${row.reviewer} ${row.reason} ${row.reportText}`.toLocaleLowerCase().includes(query))
}
export function selectedJudgments(visible: JudgmentRecord[], selected: string) {
  const ids = new Set(selected.split(','))
  return visible.filter(row => ids.has(row.id))
}
export function paginateJudgments(rows: JudgmentRecord[], requestedPage: number | null = 1, requestedSize = 25, selected = '') {
  const pageSize = [25, 50, 100].includes(requestedSize) ? requestedSize : 25
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  let targetPage = requestedPage ?? 1
  // A verdict/notification link has an ID but no page; explicit pagination wins.
  if (requestedPage === null && selected) {
    const ids = new Set(selected.split(','))
    const index = rows.findIndex(row => ids.has(row.id))
    if (index >= 0) targetPage = Math.floor(index / pageSize) + 1
  }
  const page = Math.min(pageCount, Math.max(1, Number.isFinite(targetPage) ? Math.floor(targetPage) : 1))
  const offset = (page - 1) * pageSize
  return { rows: rows.slice(offset, offset + pageSize), total: rows.length, page, pageSize, pageCount, start: rows.length ? offset + 1 : 0, end: Math.min(offset + pageSize, rows.length) }
}
