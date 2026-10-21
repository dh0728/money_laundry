import { expect, it } from 'vitest'
import type { Page } from '@/api/common'
import type { ReviewCase } from '@/api/liveReview'
import { fixtureGet } from '@/mocks/liveFixtureApi'
import { reviewCaseWorkItem } from './workItems'

const cases = (status: string) => fixtureGet(`/api/v1/review/cases?kind=ALERT&statuses=${status}&size=200`) as Page<ReviewCase>

it('OPEN Alert는 열람·착수 단계 없이 조회되며 상세 링크용 caseId와 표시용 alertId가 다르다', () => {
  const open = cases('OPEN')
  expect(open.totalElements).toBeGreaterThan(0)
  expect(open.content.every(row => row.status === 'OPEN' && row.episodeId == null)).toBe(true)
  const alert = open.content.find(row => row.caseId === 1071)
  expect(alert).toMatchObject({ caseId: 1071, alertId: 3075, status: 'OPEN', episodeId: null })
})

it('편입 Alert는 표시 상태 ESCALATED로 조회되고 완료 목록에 중복되지 않는다', () => {
  const closed = cases('CLOSED')
  const escalated = cases('ESCALATED')
  expect(closed.totalElements).toBeGreaterThan(0)
  expect(escalated.totalElements).toBeGreaterThan(0)
  expect(closed.content.every(row => row.status === 'CLOSED' && row.episodeId == null)).toBe(true)
  expect(escalated.content.every(row => row.kind === 'ALERT' && row.episodeId != null && row.outcome === 'TRANSFERRED')).toBe(true)
  expect(closed.content.some(row => row.caseId === 1000)).toBe(false)
  expect(escalated.content.some(row => row.caseId === 1000)).toBe(true)
  expect(reviewCaseWorkItem(escalated.content[0])).toBeNull()
})

it('ReviewCase를 상세 링크와 통화별 요약이 있는 업무 카드로 바꾼다', () => {
  const alert = cases('OPEN').content.find(row => row.caseId === 1071)!
  expect(reviewCaseWorkItem(alert)).toMatchObject({
    kind: 'Alert',
    id: 1071,
    code: 'A-3075',
    href: '#alerts/1071',
    status: 'UNKNOWN',
    riskScore: alert.summary.riskScore,
  })
})
