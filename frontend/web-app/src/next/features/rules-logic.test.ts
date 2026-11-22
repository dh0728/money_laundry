import { describe, expect, it } from 'vitest'
import type { LedgerTransaction, RuleInput, RuleRecord } from '../workspace-store'
import { filterRules, isRuleId, ruleActionState, ruleTransitions, runBacktest, validateRule, validatePeriod, rulesPagination } from './rules-logic'

const input: RuleInput = { name: '집중 송금', description: '시간 창 안의 거래 점검', typeCode: 3, scoreMin: .7, minTransactions: 2, windowHours: 2 }
const tx = (id: number, occurredAt: string, patch: Partial<LedgerTransaction> = {}): LedgerTransaction => ({ id, displayId: `T-${id}`, date: occurredAt.slice(0, 10), occurredAt, typeCode: 3, probability: .8, suspicious: true, score: .8, amountUsd: 100, currency: 'USD', accountId: 10, ownerId: 2, fromAccountId: 10, toAccountId: 20, humanVerdict: null, ...patch })
const period = { start: '2026-11-01', end: '2026-11-02' }
describe('rule sample backtest', () => {
  it('applies period, type, inclusive threshold and per-account rolling time window without duplicates', () => {
    const transactions = [tx(1, '2026-11-01T00:00:00Z', { score: .7 }), tx(2, '2026-11-01T02:00:00Z'), tx(3, '2026-11-01T03:00:00Z'), tx(4, '2026-11-01T03:30:00Z', { accountId: 30 }), tx(5, '2026-11-01T03:30:00Z', { typeCode: 4 }), tx(6, '2026-11-01T03:30:00Z', { score: .69 }), tx(7, '2026-11-03T00:00:00Z')]
    const result = runBacktest(transactions, input, period)
    expect(result.transactions.map(item => item.id)).toEqual([1, 2, 3])
    expect(result.accountCount).toBe(1)
    expect(result.amountUsd).toBe(300)
    expect(result.scannedCount).toBe(6)
  })
  it('treats null as any type, code zero as NON_PATTERN, and empty results as zero', () => {
    const rows = [tx(1, '2026-11-01T01:00:00Z', { typeCode: 0 }), tx(2, '2026-11-01T02:00:00Z', { typeCode: 4 })]
    expect(runBacktest(rows, { ...input, typeCode: null }, period).transactions).toHaveLength(2)
    expect(runBacktest(rows, { ...input, typeCode: 0 }, period).transactions).toHaveLength(0)
    expect(runBacktest(rows, { ...input, typeCode: 0, minTransactions: 1 }, period).transactions.map(item => item.id)).toEqual([1])
  })
  it('rejects invalid dates and invalid numeric rule fields', () => {
    expect(validatePeriod({ start: '2026-02-31', end: '2026-03-01' })).toBeTruthy()
    expect(validatePeriod({ start: '2026-11-03', end: '2026-11-01' })).toBeTruthy()
    expect(validateRule({ ...input, name: ' ', scoreMin: NaN, minTransactions: 1.5, windowHours: 0 })).toHaveProperty('name')
    expect(validateRule({ ...input, scoreMin: 1.1 })).toHaveProperty('scoreMin')
    expect(validateRule(input)).toEqual({})
  })
  it('filters draft rows by status and searchable masked author or ID', () => {
    const rows = [{ ...input, id: 'RULE-001', version: 1, status: 'DRAFT', author: '김OO', updatedAt: '', history: [] }, { ...input, id: 'RULE-002', version: 1, status: 'ACTIVE', author: '이OO', updatedAt: '', history: [] }] satisfies RuleRecord[]
    expect(filterRules(rows, '김OO', 'DRAFT').map(rule => rule.id)).toEqual(['RULE-001'])
    expect(filterRules(rows, 'rule-002', '')).toHaveLength(1)
    expect(filterRules(rows, '', 'INVALID')).toHaveLength(2)
  })
  it('bounds page size, clamps removed pages and returns stable display ranges', () => {
    expect(rulesPagination(61, '3', '25')).toEqual({ page: 3, pageSize: 25, pageCount: 3, offset: 50, start: 51, end: 61 })
    expect(rulesPagination(9, '9', '500').pageSize).toBe(100)
    expect(rulesPagination(9, '9', '25').page).toBe(1)
    expect(rulesPagination(0, '-2', 'oops')).toMatchObject({ page: 1, pageSize: 25, start: 0, end: 0 })
  })
  it('keeps exact aggregates while returning a bounded result page', () => {
    const rows = Array.from({ length: 140 }, (_, index) => tx(index + 1, '2026-11-01T00:00:00Z'))
    const result = runBacktest(rows, input, period, { offset: 25, limit: 25 })
    expect(result.matchedCount).toBe(140)
    expect(result.transactions).toHaveLength(25)
    expect(result.transactions[0].id).toBe(26)
    expect(result.amountUsd).toBe(14000)
    expect(runBacktest(rows, input, period, { limit: 500 }).transactions).toHaveLength(100)
  })
  it('handles disconnected windows and caps local fixture evaluation', () => {
    const rows = [tx(1, '2026-11-01T00:00:00Z'), tx(2, '2026-11-01T01:00:00Z'), tx(3, '2026-11-01T08:00:00Z'), tx(4, '2026-11-01T15:00:00Z'), tx(5, '2026-11-01T16:00:00Z')]
    expect(runBacktest(rows, input, period).transactions.map(row => row.id)).toEqual([1, 2, 4, 5])
    expect(() => runBacktest(Array.from({ length: 10001 }, () => rows[0]), input, period)).toThrow('서버 비동기')
  })
})

describe('rule action table', () => {
  it('derives the legal transitions and permissions from one table', () => {
    expect(ruleTransitions).toEqual({ DRAFT: ['PENDING_APPROVAL'], PENDING_APPROVAL: ['TESTING', 'REJECTED'], TESTING: ['ACTIVE', 'STOPPED', 'REJECTED'], ACTIVE: ['STOPPED'], STOPPED: ['TESTING'], REJECTED: ['DRAFT'] })
    const admin = { name: '관리자', role: 'ADMIN' }
    const author = { name: '작성자', role: 'STAFF' }
    const other = { name: '다른 분석가', role: 'STAFF' }
    expect(ruleActionState({ status: 'DRAFT', author: '작성자' }, author).allowedActions).toEqual(expect.arrayContaining(['requestReview', 'edit', 'delete', 'archive']))
    expect(ruleActionState({ status: 'DRAFT', author: '작성자' }, other).blockedReasons.edit).toBe('초안·반려 상태에서는 작성자나 관리자만 수정할 수 있어요.')
    expect(ruleActionState({ status: 'ACTIVE', author: '작성자' }, author).blockedReasons.stop).toBe('관리자만 중지할 수 있어요.')
    expect(ruleActionState({ status: 'ACTIVE', author: '작성자' }, admin).allowedActions).toEqual(expect.arrayContaining(['stop', 'archive', 'duplicate', 'backtest']))
    expect(ruleActionState({ status: 'ACTIVE', author: '작성자' }, admin).blockedReasons.delete).toBe('운영 이력이 있는 룰은 삭제할 수 없어요. 보관해 주세요.')
    expect(ruleActionState({ status: 'STOPPED', author: '작성자' }, admin).allowedActions).toContain('retest')
    expect(isRuleId('RULE-1000')).toBe(true)
    expect(isRuleId('RULE-12')).toBe(false)
  })
})
