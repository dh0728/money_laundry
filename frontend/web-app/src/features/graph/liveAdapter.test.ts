import { expect, it } from 'vitest'
import type { ReviewCase, ReviewMember } from '@/api/liveReview'
import { toReviewGraphModel } from './liveAdapter'
import { groupOwners } from './v24/OwnerGraph'

const member = (txId: number, decision: ReviewMember['decision'], isSuspicious: boolean): ReviewMember => ({
  txId, reviewRole: 'SUBJECT', state: decision ? 'DECIDED' : 'PENDING', decision, sources: [],
  transaction: { occurredAt: '2023-09-10T00:00:00Z', fromAccountId: 'a', toAccountId: 'b', fromBankId: 1, toBankId: 2, amountPaid: 10, amountUsd: 8, paymentCurrency: 'USD', paymentFormat: 'WIRE', role: 'SEED', isSuspicious, scores: null },
})

it('제외 거래는 그래프에서 빠지지만 다른 묶음의 활성 동일 거래는 남는다', () => {
  const item = { groups: [{ members: [{ ...member(1, null, true), state: 'EXCLUDED' }, { ...member(2, null, true), state: 'EXCLUDED' }] }, { members: [member(2, null, true)] }] } as ReviewCase
  const graph = toReviewGraphModel(item)
  expect(graph.edges.flatMap(edge => edge.transactions.map(transaction => transaction.id))).toEqual(['2'])
  expect(graph.edges[0].count).toBe(1)
})

it('조사 사건 거래를 계좌 노드와 계좌쌍 엣지로 묶고 중복 txId는 한 번만 센다', () => {
  const item = { groups: [{ members: [member(1, null, true), member(2, 'NORMAL', true)] }, { members: [member(1, null, true)] }] } as ReviewCase
  const model = toReviewGraphModel(item)
  expect(model.nodes.map(node => node.key)).toEqual(['a', 'b'])
  expect(model.edges).toHaveLength(1)
  expect(model.edges[0]).toMatchObject({ s: 'a', t: 'b', count: 2, usd: 16, label: 1 })
  expect(model.edges[0].transactions.map(tx => [tx.id, tx.label, tx.modelLabel])).toEqual([['1', 1, 1], ['2', 0, 1]])
})

it('소유주 ID로 계좌를 묶고 표시 이름이 같아도 다른 소유주는 합치지 않는다', () => {
  const second = member(2, null, false)
  second.transaction = { ...second.transaction, fromAccountId: 'c', toAccountId: 'd' }
  const item = { groups: [{ members: [member(1, null, true), second] }], accounts: [
    { id: 'a', ownerId: 'owner-1', ownerName: '김민준#00001', bankId: 1 },
    { id: 'b', ownerId: 'owner-1', ownerName: '김민준#00001', bankId: 2 },
    { id: 'c', ownerId: 'owner-2', ownerName: '김민준#00001', bankId: 1 },
  ] } as ReviewCase
  const owners = groupOwners(toReviewGraphModel(item))
  expect(owners).toHaveLength(3)
  expect(owners.find(owner => owner.key === 'owner:owner-1')?.accounts.map(account => account.key)).toEqual(['a', 'b'])
  expect(owners.find(owner => owner.key === 'owner:owner-2')?.accounts.map(account => account.key)).toEqual(['c'])
  expect(owners.find(owner => owner.key === 'account:d')?.name).toBe('소유주 미상')
})
