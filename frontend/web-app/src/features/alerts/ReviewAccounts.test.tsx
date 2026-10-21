import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { ReviewApiMember, ReviewCase } from '@/api/liveReview'
import ReviewAccounts from './ReviewAccounts'

const member = (txId: number, from: string, to: string, amount: number | string | null, currency = 'USD', state: ReviewApiMember['state'] = 'PENDING'): ReviewApiMember => ({
  txId, state, reviewRole: 'SUBJECT', decision: null, sources: [],
  transaction: { occurredAt: '2023-09-01T00:00:00Z', fromAccountId: from, toAccountId: to,
    fromBankId: 1, toBankId: 2, amountPaid: amount, amountUsd: 1, paymentCurrency: currency,
    paymentFormat: 'ACH', role: 'SEED', isSuspicious: null, scores: null },
})
const item = (members: ReviewApiMember[], accounts: ReviewCase['accounts'] = []): ReviewCase => ({
  caseId: 1, kind: 'ALERT', alertId: 1, status: 'OPEN', outcome: null, revision: 1,
  assigneeId: 1, assigneeName: '', createdAt: '', assignedAt: '', closedAt: null, ageDays: 0,
  summary: { txCount: members.length, subjectCount: members.length, seedCount: 0, riskScore: 0,
    primaryType: '', amountsByCurrency: {}, firstTxAt: null, lastTxAt: null },
  pendingCount: 0, episodeId: null, sourceAlertIds: [], primaryTypes: [], accounts,
  groups: [{ groupId: 1, label: '', revision: 1, members }],
})

it('원본 금액 문자열을 계좌·방향·통화별로 정밀도 손실 없이 합산하고 원본은 유지한다', () => {
  const rows = [member(1, 'A', 'B', '9007199254740993.123456'), member(2, 'A', 'C', '0.000001'), member(3, 'A', 'B', '7.123456', 'KRW')]
  const original = structuredClone(rows)
  render(<ReviewAccounts item={item(rows)} onInvestigate={vi.fn()} />)
  const account = within(screen.getByRole('article', { name: '계좌 A' }))
  expect(account.getByText('9,007,199,254,740,993.123457 USD')).toBeInTheDocument()
  expect(account.getByText('7.123456 KRW')).toBeInTheDocument()
  expect(rows).toEqual(original)
})

it.each([null, '', ' ', 'bad'])('누락·무효 계좌 금액 %s가 있으면 부분 합계를 완전 합계로 표시하지 않는다', value => {
  render(<ReviewAccounts item={item([member(1, 'A', 'B', value), member(2, 'A', 'C', '100.123456')])} onInvestigate={vi.fn()} />)
  const account = within(screen.getByRole('article', { name: '계좌 A' }))
  expect(account.getByText('금액 확인 불가 · USD')).toBeInTheDocument()
  expect(account.queryByText('100.123456 USD')).not.toBeInTheDocument()
})

it('현재 거래를 중복 제거하고 송금·수취와 통화를 분리하여 계좌 조사로 연결한다', () => {
  const first = member(1, 'A', 'B', 100)
  const onInvestigate = vi.fn()
  render(<ReviewAccounts item={item([first, first, member(2, 'B', 'A', 25, 'KRW'),
    member(3, 'A', 'X', 900, 'USD', 'EXCLUDED'), member(4, 'Y', 'A', 500, 'USD', 'TRANSFERRED')],
    [{ id: 'A', ownerId: 'owner-a', ownerName: '가상 소유주', bankId: 7 }])} onInvestigate={onInvestigate} />)
  expect(screen.getAllByRole('article')).toHaveLength(2)
  const account = within(screen.getByRole('article', { name: '계좌 A' }))
  expect(account.getByText('가상 소유주')).toBeInTheDocument()
  expect(account.getByText('owner-a')).toBeInTheDocument()
  expect(account.getByText('은행 ID 7')).toBeInTheDocument()
  expect(account.getByText('송금 1건 · 수취 1건')).toBeInTheDocument()
  expect(account.getByText('100 USD')).toBeInTheDocument()
  expect(account.getByText('25 KRW')).toBeInTheDocument()
  expect(account.queryByText(/125/)).not.toBeInTheDocument()
  fireEvent.click(account.getByRole('button', { name: 'A 조사 거래 보기' }))
  expect(onInvestigate).toHaveBeenCalledWith([1, 2])
  expect(screen.queryByRole('article', { name: '계좌 X' })).not.toBeInTheDocument()
  expect(screen.queryByRole('article', { name: '계좌 Y' })).not.toBeInTheDocument()
})

it('자기 계좌 간 거래도 한 거래로 연결하고 메타데이터 누락을 밝힌다', () => {
  const onInvestigate = vi.fn()
  render(<ReviewAccounts item={item([member(9, 'A', 'A', 10)])} onInvestigate={onInvestigate} />)
  expect(screen.getByText('송금 1건 · 수취 1건')).toBeInTheDocument()
  expect(screen.getByText('소유주 미제공')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'A 조사 거래 보기' }))
  expect(onInvestigate).toHaveBeenCalledWith([9])
})

it('활성 거래가 없으면 메타데이터만 있는 계좌를 조사 범위로 표시하지 않는다', () => {
  render(<ReviewAccounts item={item([member(1, 'A', 'B', 100, 'USD', 'EXCLUDED')],
    [{ id: 'A', ownerId: 'owner-a', bankId: 1 }])} onInvestigate={vi.fn()} />)
  expect(screen.getByText('현재 조사 범위에 계좌가 없습니다.')).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('무효 금액을 0으로 바꾸거나 부분 합계를 완전 합계로 표시하지 않는다', () => {
  render(<ReviewAccounts item={item([member(1, 'A', 'B', Number.NaN), member(2, 'A', 'C', 100)])} onInvestigate={vi.fn()} />)
  const account = within(screen.getByRole('article', { name: '계좌 A' }))
  expect(account.getByText('금액 확인 불가 · USD')).toBeInTheDocument()
  expect(account.queryByText('100 USD')).not.toBeInTheDocument()
  expect(account.queryByText(/NaN/)).not.toBeInTheDocument()
})

it('숫자 표현 범위를 넘는 합계를 무한대 금액으로 노출하지 않는다', () => {
  render(<ReviewAccounts item={item([member(1, 'A', 'B', 1e308), member(2, 'A', 'C', 1e308)])} onInvestigate={vi.fn()} />)
  const account = within(screen.getByRole('article', { name: '계좌 A' }))
  expect(account.getByText('금액 확인 불가 · USD')).toBeInTheDocument()
  expect(account.queryByText(/∞/)).not.toBeInTheDocument()
})

it('소수 금액 합계의 부동소수점 흔적을 화면에 노출하지 않는다', () => {
  render(<ReviewAccounts item={item([member(1, 'A', 'B', 0.1), member(2, 'A', 'C', 0.2)])} onInvestigate={vi.fn()} />)
  const account = within(screen.getByRole('article', { name: '계좌 A' }))
  expect(account.getByText('0.3 USD')).toBeInTheDocument()
  expect(account.queryByText(/0\.30000000000000004/)).not.toBeInTheDocument()
})

it('큰 금액과 소수 여섯째 자리의 금액을 단위와 함께 표시한다', () => {
  render(<ReviewAccounts item={item([member(1, 'A', 'B', 12345678901234.56), member(2, 'A', 'C', 0.000001, 'CHF'), member(3, 'A', 'D', 0.000002, 'CHF')])} onInvestigate={vi.fn()} />)
  const account = within(screen.getByRole('article', { name: '계좌 A' }))
  expect(account.getByText('12,345,678,901,234.56 USD')).toBeInTheDocument()
  expect(account.getByText('0.000003 CHF')).toBeInTheDocument()
})
