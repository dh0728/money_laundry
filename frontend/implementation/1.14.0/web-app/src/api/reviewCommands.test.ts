import { expect, it } from 'vitest'
import type { ReviewCase, ReviewGroup } from './liveReview'
import { assertEditableAlert, buildAlertClose, buildAlertTransfer, episodeGroupSelection, wholeAlertSelection } from './reviewCommands'

const alert = (caseId: number, extra: Partial<ReviewCase> = {}) => ({
  caseId, kind: 'ALERT', status: 'OPEN', episodeId: null, assigneeId: 11, revision: caseId + 1000,
  ...extra,
}) as ReviewCase
const episode = (extra: Partial<ReviewCase> = {}) => ({ ...alert(80), kind: 'EPISODE', revision: 4, ...extra }) as ReviewCase

it('전체 Alert 선택은 거래 목록 없이 서버 revision을 보존한다', () => {
  expect(wholeAlertSelection(alert(1))).toEqual({ caseId: 1, revision: 1001, groupId: 0, txIds: [] })
})

it('Alert 최종 판정과 종결을 한 CLOSE로 만든다', () => {
  expect(buildAlertClose(alert(1), 'SUSPICIOUS', '  근거  ')).toMatchObject({
    action: 'CLOSE', decision: 'SUSPICIOUS', comment: '근거',
    selections: [{ caseId: 1, revision: 1001, groupId: 0, txIds: [] }],
    targetCaseId: null, targetRevision: null, targetGroupId: null,
  })
})

it('새 Episode는 서로 다른 Alert 두 개 이상을 한 요청에 담는다', () => {
  expect(() => buildAlertTransfer([alert(1)], null, '근거')).toThrow('2개 이상')
  expect(() => buildAlertTransfer([alert(1), alert(1)], null, '근거')).toThrow('중복')
  expect(buildAlertTransfer([alert(1), alert(2)], null, ' 근거 ')).toMatchObject({
    action: 'TRANSFER', targetCaseId: null, targetRevision: null, targetGroupId: null, decision: null,
    selections: [{ caseId: 1, groupId: 0, txIds: [] }, { caseId: 2, groupId: 0, txIds: [] }], comment: '근거',
  })
})

it('기존 Episode는 OPEN 목적지의 caseId와 revision을 보낸다', () => {
  expect(() => buildAlertTransfer([alert(1)], episode({ status: 'CLOSED' }), '근거')).toThrow('진행 중인 Episode')
  expect(buildAlertTransfer([alert(1)], episode(), '근거')).toMatchObject({ targetCaseId: 80, targetRevision: 4 })
})

it('본인 담당 OPEN 미편입 Alert가 아니면 변경하지 않는다', () => {
  expect(() => assertEditableAlert(alert(1), { userId: 11, role: 'STAFF' })).not.toThrow()
  expect(() => assertEditableAlert(alert(1), { userId: 11, role: 'ADMIN' })).toThrow()
  expect(() => assertEditableAlert(alert(1, { episodeId: 80 }), { userId: 11, role: 'STAFF' })).toThrow()
  expect(() => assertEditableAlert(alert(1, { assigneeId: 12 }), { userId: 11, role: 'STAFF' })).toThrow()
  expect(() => assertEditableAlert(alert(1, { status: 'CLOSED' }), { userId: 11, role: 'STAFF' })).toThrow()
})

it('Episode 묶음은 미판정 SUBJECT의 실제 txId 전체만 고른다', () => {
  const group = { groupId: 3, members: [
    { txId: 10, state: 'PENDING', reviewRole: 'SUBJECT' },
    { txId: 11, state: 'DECIDED', reviewRole: 'SUBJECT' },
    { txId: 12, state: 'PENDING', reviewRole: 'CONTEXT' },
    { txId: 13, state: 'PENDING', reviewRole: 'SUBJECT' },
  ] } as ReviewGroup
  expect(episodeGroupSelection(episode(), group)).toEqual({ caseId: 80, revision: 4, groupId: 3, txIds: [10, 13] })
})
