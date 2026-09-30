import { expect, it } from 'vitest'
import type { ReviewGroup, ReviewMember } from '@/api/liveReview'
import { dailyMemberAmounts } from './activityAmounts'

function member(txId: number, overrides: Partial<ReviewMember> = {}, transaction = {}): ReviewMember {
  return {
    txId, reviewRole: 'SUBJECT', state: 'PENDING', decision: null, sources: [], ...overrides,
    transaction: {
      occurredAt: '2023-08-31T15:00:00Z', fromAccountId: 'A', toAccountId: 'B',
      fromBankId: 1, toBankId: 2, amountPaid: 100, amountUsd: 5,
      paymentCurrency: 'MXN', paymentFormat: 'ACH', role: 'SEED', isSuspicious: true, scores: null,
      ...transaction,
    },
  }
}
const group = (members: ReviewMember[]): ReviewGroup => ({ groupId: 1, label: '', revision: 1, members })

it('씨앗·연결·정상 분류·참고 맥락 거래를 모두 집계하고 중복·제외·이관을 제거한다', () => {
  const seed = member(1)
  const result = dailyMemberAmounts([group([
    seed,
    member(2, {}, { role: 'CONNECTION', isSuspicious: false, amountPaid: 200 }),
    member(3, { reviewRole: 'CONTEXT', state: 'DECIDED' }, { role: 'CONTEXT', isSuspicious: null, amountPaid: 300 }),
    member(4, { state: 'EXCLUDED' }), member(5, { state: 'TRANSFERRED' }),
  ]), group([seed])])
  expect(result.MXN.daily).toEqual([{ day: '2023-09-01', amount: 600 }])
})

it('한국시간 날짜 순서와 지급 통화를 구분하고 USD 환산값으로 섞지 않는다', () => {
  const result = dailyMemberAmounts([group([
    member(1),
    member(2, {}, { occurredAt: '2023-08-31T14:59:59Z', amountPaid: 200 }),
    member(3, {}, { paymentCurrency: 'USD', amountPaid: 7 }),
  ])])
  expect(result.MXN.daily).toEqual([{ day: '2023-08-31', amount: 200 }, { day: '2023-09-01', amount: 100 }])
  expect(result.USD.daily).toEqual([{ day: '2023-09-01', amount: 7 }])
  expect(dailyMemberAmounts([])).toEqual({})
})
