import { expect, it } from 'vitest'
import type { ReviewCase } from '@/api/liveReview'
import { alertListRow, episodeListRow } from './reviewListAdapter'
const item = (value: ReviewCase['summary']['totalAmountUsd']): ReviewCase => ({
  kind: 'ALERT', outcome: null, revision: 1, assigneeId: 1, assigneeName: '직원', createdAt: '', assignedAt: '', closedAt: null, ageDays: 0, pendingCount: 0,
  alertId: 1, caseId: 2, status: 'OPEN', episodeId: null, sourceAlertIds: [1, 3], primaryTypes: [],
  summary: { subjectCount: 2, seedCount: 1, riskScore: 0.9, firstTxAt: null, lastTxAt: null, totalAmountUsd: value, amountsByCurrency: { CHF: 999, EUR: 888 }, primaryType: 'Fan-out', txCount: 2 },
})
it.each([alertListRow, episodeListRow])('목록에서 원통화 대신 서버 USD 합계를 표시한다', adapt => {
  expect(adapt(item('1234.567')).amountLabel).toBe('1,234.57 USD')
  expect(adapt(item(0)).amountLabel).toBe('0 USD')
  for (const value of [undefined, null, '', 'bad']) expect(adapt(item(value)).amountLabel).toBe('USD 환산액 미제공')
})
