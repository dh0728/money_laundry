import { describe, expect, it } from 'vitest'
import type { JudgmentRecord } from '../workspace-store'
import { filterJudgments, paginateJudgments, selectedJudgments, validReportDate } from './report-model'

const rows: JudgmentRecord[] = [
  { id: 'J-261115-000001', caseIds: [8100], transactionIds: [7000], displayIds: ['A-261109-000041'], verdict: 'normal', reason: '반복 거래 확인', reviewer: '김OO', at: '2026-11-15T10:00:00+09:00', cases: [], reportText: '첫 번째 고정 보고서' },
  { id: 'J-261114-000002', caseIds: [8101], transactionIds: [7001], displayIds: ['E-261110-000042'], verdict: 'abnormal', reason: '출처 확인 필요', reviewer: '박OO', at: '2026-11-14T11:00:00+09:00', cases: [], reportText: '두 번째 고정 보고서' },
]

describe('report filtering and selection', () => {
  it('matches IDs, masked reviewer, reason, date and verdict from the same judgment records', () => {
    expect(filterJudgments(rows, { query: 'e-261110', verdict: 'abnormal', start: '2026-11-14', end: '2026-11-14' })).toEqual([rows[1]])
    expect(filterJudgments(rows, { query: '김OO' })).toEqual([rows[0]])
    expect(filterJudgments(rows, { query: '출처' })).toEqual([rows[1]])
    expect(filterJudgments(rows, { start: '2026-11-15', verdict: 'abnormal' })).toEqual([])
  })
  it('excludes hidden, unknown and duplicate selections and preserves visible row order', () => {
    expect(selectedJudgments(rows, `${rows[1].id},${rows[0].id},${rows[0].id},unknown`)).toEqual(rows)
    expect(selectedJudgments([rows[0]], `${rows[1].id},${rows[0].id}`)).toEqual([rows[0]])
    expect(selectedJudgments(rows, '')).toEqual([])
  })
  it('rejects impossible dates', () => {
    expect(validReportDate('2026-02-31')).toBe(false)
    expect(validReportDate('2026-11-15')).toBe(true)
  })
  it('bounds page sizes, clamps invalid pages and scopes selection to the page', () => {
    const records = Array.from({ length: 126 }, (_, index) => ({ ...rows[0], id: `J-261115-${String(index + 1).padStart(6, '0')}` }))
    const page = paginateJudgments(records, 2)
    expect(page.rows).toHaveLength(25)
    expect([page.start, page.end, page.total, page.pageCount]).toEqual([26, 50, 126, 6])
    expect(selectedJudgments(page.rows, `${records[0].id},${records[25].id}`)).toEqual([records[25]])
    expect(paginateJudgments(records, 999, 100).rows).toHaveLength(26)
    expect(paginateJudgments(records, -1, 10000).pageSize).toBe(25)
    expect(paginateJudgments([], 3).start).toBe(0)
    expect(paginateJudgments(records, null, 25, records[25].id).page).toBe(2)
    expect(paginateJudgments(records, 1, 25, records[25].id).page).toBe(1)
    expect(paginateJudgments(records, null, 25, 'missing').page).toBe(1)
  })
})
