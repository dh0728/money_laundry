import { expect, it } from 'vitest'
import type { ReviewCase, ReviewMember } from '@/api/liveReview'
import { toReviewGraphModel } from './liveAdapter'

const member = (txId: number, decision: ReviewMember['decision'], isSuspicious: boolean): ReviewMember => ({
  txId, reviewRole: 'SUBJECT', state: decision ? 'DECIDED' : 'PENDING', decision, sources: [],
  transaction: { occurredAt: '2023-09-10T00:00:00Z', fromAccountId: 'a', toAccountId: 'b', fromBankId: 1, toBankId: 2, amountPaid: 10, amountUsd: 8, paymentCurrency: 'USD', paymentFormat: 'WIRE', role: 'SEED', isSuspicious, scores: null },
})

it('조사 사건 거래를 계좌 노드와 계좌쌍 엣지로 묶고 중복 txId는 한 번만 센다', () => {
  const item = { groups: [{ members: [member(1, null, true), member(2, 'NORMAL', true)] }, { members: [member(1, null, true)] }] } as ReviewCase
  const model = toReviewGraphModel(item)
  expect(model.nodes.map(node => node.key)).toEqual(['a', 'b'])
  expect(model.edges).toHaveLength(1)
  expect(model.edges[0]).toMatchObject({ s: 'a', t: 'b', count: 2, usd: 16, label: 1 })
  expect(model.edges[0].transactions.map(tx => [tx.id, tx.label, tx.modelLabel])).toEqual([['1', 1, 1], ['2', 0, 1]])
})
