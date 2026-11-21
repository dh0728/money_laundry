import { expect, it } from 'vitest'
import type { ReviewGroup, ReviewMember } from '@/api/liveReview'
import { caseEvidence } from './caseEvidence'

const member = (txId: number, state: ReviewMember['state'], from: string, to: string, at: string): ReviewMember => ({
  txId, state, reviewRole: 'CONTEXT', decision: null, sources: [],
  transaction: { occurredAt: at, fromAccountId: from, toAccountId: to, fromBankId: 1, toBankId: 2,
    amountPaid: 100, amountUsd: 1, paymentCurrency: 'MXN', paymentFormat: 'ACH', role: 'CONTEXT', isSuspicious: false, scores: null },
})
const group = (members: ReviewMember[]): ReviewGroup => ({ groupId: 1, label: '', revision: 1, members })

it('현재 소속 근거를 중복 제거하고 계좌 수와 한국시간 거래 기간을 계산한다', () => {
  const first = member(1, 'PENDING', 'A', 'B', '2023-08-31T15:00:00Z')
  const result = caseEvidence([group([
    member(2, 'DECIDED', 'B', 'C', '2023-09-02T03:57:00Z'), first,
    member(3, 'EXCLUDED', 'D', 'E', '2023-08-01T00:00:00Z'),
    member(4, 'TRANSFERRED', 'F', 'G', '2023-09-30T00:00:00Z'),
  ]), group([first])])
  expect(result.members).toHaveLength(2)
  expect(result.accountCount).toBe(3)
  expect(result.period).toBe('09-01 00:00 ~ 09-02 12:57')
  expect(caseEvidence([])).toEqual({ members: [], accountCount: 0, period: '—' })
})
