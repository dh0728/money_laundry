import { expect, it } from 'vitest'
import type { ReviewGroup, ReviewMember } from '@/api/liveReview'
import { dailyMemberAmounts, dailyMemberUsdByCurrency } from './activityAmounts'

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

it('실제 근거 스냅샷의 소수 금액 문자열을 숫자로 더해 일별 금액과 총액을 만든다', () => {
  const result = dailyMemberAmounts([group([
    member(1, {}, { amountPaid: '123.45' }),
    member(2, {}, { amountPaid: '6.55' }),
    member(3, {}, { amountPaid: '10.25', occurredAt: '2023-09-02T00:00:00Z' }),
  ])])
  expect(result.MXN.daily).toEqual([{ day: '2023-09-01', amount: 130 }, { day: '2023-09-02', amount: 10.25 }])
  expect(result.MXN.daily.reduce((sum, row) => sum + row.amount, 0)).toBe(140.25)
})

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

it('원통화별 저장 USD를 KST 일별 합산하고 중복·제외 거래는 제거한다', () => {
  const first = member(1, {}, { amountUsd: '1.25' })
  expect(dailyMemberUsdByCurrency([group([first,
    member(2, { reviewRole: 'CONTEXT' }, { paymentCurrency: 'CHF', amountUsd: '2.75' }),
    member(3, { state: 'EXCLUDED' }, { amountUsd: 500 }),
    member(4, { state: 'TRANSFERRED' }, { amountUsd: 500 }),
    member(5, {}, { occurredAt: '2023-08-31T14:59:59Z', amountUsd: 0 }),
  ]), group([first])])).toEqual({ MXN: [{ day: '2023-08-31', amount: 0 }, { day: '2023-09-01', amount: 1.25 }], CHF: [{ day: '2023-09-01', amount: 2.75 }] })
})
it.each([null, '', 'bad'])('USD 누락·잘못된 값 %s는 부분 합계를 반환하지 않는다', value => {
  expect(dailyMemberUsdByCurrency([group([member(1), member(2, {}, { amountUsd: value })])])).toBeNull()
})
