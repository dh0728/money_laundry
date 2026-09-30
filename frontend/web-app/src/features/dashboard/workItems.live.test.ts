import { expect, it } from 'vitest'
import type { ReviewCase } from '@/api/liveReview'
import { reviewCaseWorkItem } from './workItems'

const sample: ReviewCase = {
  caseId: 42, kind: 'ALERT', alertId: 3000, status: 'OPEN', outcome: null, revision: 1,
  assigneeId: 11, assigneeName: '담당자', createdAt: '2026-09-30T00:00:00Z', assignedAt: '2026-09-30T00:00:00Z',
  closedAt: null, ageDays: 1, summary: { txCount: 3, subjectCount: 2, seedCount: 1, riskScore: 0.8,
    primaryType: 'FAN-OUT', amountsByCurrency: { KRW: 1000 }, firstTxAt: null, lastTxAt: null },
  pendingCount: 3, episodeId: null, sourceAlertIds: [3000], primaryTypes: ['FAN-OUT'],
}

it('OPEN 단독 Alert를 미열람으로 추정하지 않고 사건 ID로 연결한다', () => {
  const item = reviewCaseWorkItem(sample)
  expect(item).toMatchObject({ code: 'A-3000', href: '#alerts/42', status: 'UNKNOWN', totalAmountUsd: null })
  expect(item?.summary).toContain('1,000 KRW')
})

it('Episode 진행과 종결을 구분하고 편입된 Alert는 중복 카드로 만들지 않는다', () => {
  expect(reviewCaseWorkItem({ ...sample, kind: 'EPISODE', alertId: null, sourceAlertIds: [3000, 3001] })?.status).toBe('IN_PROGRESS')
  expect(reviewCaseWorkItem({ ...sample, status: 'CLOSED' })?.status).toBe('DONE')
  expect(reviewCaseWorkItem({ ...sample, status: 'CLOSED', episodeId: 99, outcome: 'TRANSFERRED' })).toBeNull()
})
