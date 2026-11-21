import { describe, expect, it } from 'vitest'
import { initialDraft } from './data'
import { addChild, conditionsOf, hasEmptyValue, moveBefore, newCondition, newGroup, readAsSentence, removeNode, updateNode, type Condition, type Group } from './model'

describe('룰 조건 트리', () => {
  it('FAN-IN 기본 조건을 시안과 같은 문장으로 읽는다', () => {
    expect(readAsSentence(initialDraft('fanIn'))).toBe(
      '거래가 생기면, 24시간 안에 서로 다른 계좌 5개 이상에서 돈을 받고 받은 총액이 20,000 USD 이상이며, 신규 계좌이거나 해외 송금이 섞여 있으면 Alert에 이 룰을 근거로 표시합니다.',
    )
  })

  it('비교 · 값 · 기간 · THEN 을 바꾸면 문장도 바뀐다', () => {
    const draft = initialDraft('fanOut')
    const first = draft.where.children[0] as Condition
    const where = updateNode(draft.where, first.id, node => ({ ...node, cmp: 'gt', value: 8, windowMinutes: 10080 }) as Condition)
    expect(readAsSentence({ where, then: 'CREATE_ALERT' })).toBe(
      '거래가 생기면, 7일 안에 서로 다른 계좌 8개 초과로 돈을 보내고 보낸 총액이 10,000 USD 이상이면 적중한 거래를 씨앗으로 Alert를 만듭니다.',
    )
  })

  it('조건이 없으면 문장 대신 안내를 준다', () => {
    const draft = initialDraft('single')
    const empty = removeNode(draft.where, draft.where.id)
    expect(empty.id).toBe(draft.where.id)
    expect(readAsSentence({ ...draft, where: addChild(empty, empty.id, newGroup('ANY')) })).toBe('조건을 하나 이상 넣어 주세요.')
  })

  it('블록을 다른 블록 앞으로 옮기고, 그룹을 자기 안으로는 옮기지 않는다', () => {
    const a = newCondition('recvTotal'), b = newCondition('newAccount'), c = newCondition('foreignMixed')
    const inner = newGroup('ANY', [b, c])
    const root = newGroup('ALL', [a, inner])
    const ids = (group: Group) => conditionsOf(group).map(node => node.id)

    expect(ids(moveBefore(root, c.id, a.id))).toEqual([c.id, a.id, b.id])
    expect(ids(moveBefore(root, a.id, c.id))).toEqual([b.id, a.id, c.id])
    expect(moveBefore(root, inner.id, b.id)).toBe(root)
    expect(moveBefore(root, root.id, a.id)).toBe(root)
  })

  it('값이 빈 숫자 조건을 찾아낸다', () => {
    const filled = newGroup('ALL', [newCondition('txAmount'), newCondition('newAccount')])
    expect(hasEmptyValue(filled)).toBe(false)
    expect(hasEmptyValue(addChild(filled, filled.id, newCondition('txCount', { value: null })))).toBe(true)
  })
})
