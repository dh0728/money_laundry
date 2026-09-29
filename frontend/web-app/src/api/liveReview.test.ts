import { beforeEach, expect, it, vi } from 'vitest'
import { fetchReviewCase, fetchReviewCases, submitReviewCommand } from './liveReview'

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })

beforeEach(() => vi.restoreAllMocks())

it('Alert와 Episode는 종류·담당자·기간을 서버 조사 사건 목록으로 조회한다', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })))
  await fetchReviewCases({ kind: 'ALERT', assigneeId: 11, status: 'OPEN', from: '2026-09-01', to: '2026-09-28' })
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/review/cases?kind=ALERT&assigneeId=11&status=OPEN&from=2026-09-01&to=2026-09-28')
  await fetchReviewCase(800)
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/review/cases/800')
})

it('판정 명령은 서버가 준 caseId·revision·groupId와 선택 거래를 그대로 보낸다', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ headerName: 'X-CSRF-TOKEN', token: 'csrf' })).mockResolvedValueOnce(json({ caseIds: [800], targetCaseId: null }))
  await submitReviewCommand({ action: 'DECIDE', selections: [{ caseId: 800, revision: 1000001, groupId: 0, txIds: [101] }], decision: 'NORMAL', comment: '검토 완료' }, 'fixed-retry-id')
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/review/commands')
  expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'POST', headers: expect.objectContaining({ 'X-CSRF-TOKEN': 'csrf' }) })
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({ requestId: 'fixed-retry-id', action: 'DECIDE', selections: [{ caseId: 800, revision: 1000001, groupId: 0, txIds: [101] }], decision: 'NORMAL', comment: '검토 완료', targetCaseId: null })
})
