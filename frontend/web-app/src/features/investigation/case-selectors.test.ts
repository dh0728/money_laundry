import { describe, expect, it, vi } from 'vitest'
import { cases } from '@/mocks/dashboard-data'
import type { LedgerTransaction, WorkspaceCase } from '@/lib/workspace-store'
import { buildCaseGraph, canJudgeCase, caseEvidence, caseOverviewFacts, caseGraphBudget, downloadCaseCsv, indexCaseLedger, relatedCases } from './case-selectors'

const item: WorkspaceCase = { ...cases[0], revision: 1, alertCaseIds: [], comments: [], history: [] }
const tx = (id: number, from: number, to: number, amountUsd = 100): LedgerTransaction => ({ id, displayId: `T-${id}`, date: '2026-11-15', occurredAt: `2026-11-15T12:00:${String(id % 60).padStart(2, '0')}Z`, typeCode: 3, probability: .8, suspicious: true, score: .95, amountUsd, currency: 'USD', accountId: from, ownerId: from + 100, fromAccountId: from, toAccountId: to, humanVerdict: null })

describe('case detail evidence and permissions', () => {
  it('denies another assignee and closed cases', () => {
    expect(canJudgeCase(item, item.assigneeId)).toBe(true)
    expect(canJudgeCase(item, item.assigneeId + 1)).toBe(false)
    expect(canJudgeCase({ ...item, status: 'CLOSED' }, item.assigneeId)).toBe(false)
  })
  it('takes evidence by independent numeric transaction ids', () => {
    const rows = [tx(7002, 1, 2), tx(9000, 2, 3), tx(7000, 3, 1)]
    expect(caseEvidence(item, rows).map(t => t.id)).toEqual([7000, 7002])
  })
  it('finds links through explicit membership, overlapping evidence and endpoint accounts', () => {
    const rows = [tx(7000, 1, 2), tx(8000, 2, 3), tx(9000, 4, 5)]
    const overlap = { ...item, caseId: 2, transactionIds: [7000] }
    const account = { ...item, caseId: 3, transactionIds: [8000] }
    const unrelated = { ...item, caseId: 4, transactionIds: [9000] }
    const linked = { ...unrelated, caseId: 5, episodeCaseId: item.caseId }
    expect(relatedCases(item, [item, overlap, account, unrelated, linked], rows).map(r => r.item.caseId)).toEqual([2, 3, 5])
  })
  it('preserves real direction, aggregate count, amount and capped stroke width', () => {
    const graph = buildCaseGraph([tx(1, 1, 2), tx(2, 1, 2, 1e12), tx(3, 2, 1)], 'pattern')
    expect(graph.edges).toHaveLength(2)
    expect(graph.edges[0]).toMatchObject({ source: 'account:1', target: 'account:2', count: 2, amountUsd: 1e12 + 100 })
    expect(graph.edges[0].width).toBeLessThanOrEqual(8)
    expect(graph.nodes).toHaveLength(2)
  })
  it('never invents an owner for a destination absent from the ownership ledger', () => {
    const graph = buildCaseGraph([tx(1, 1, 2)], 'owner')
    expect(graph.nodes.map(node => node.id)).toEqual(['owner:101', 'account:2'])
    expect(graph.nodes[1].label).toContain('소유주 미확인')
  })
  it('caps the graph DOM budget and exposes truthful omissions', () => {
    const graph = buildCaseGraph(Array.from({ length: 250 }, (_, i) => tx(i, i, i + 1)), 'pattern')
    expect(graph.nodes).toHaveLength(200)
    expect(graph.edges.length).toBeLessThanOrEqual(400)
    expect(graph.omittedNodes).toBe(51)
    expect(graph.omittedTransactions).toBe(51)
    expect(graph.omittedEdges).toBe(51)
    const dense = buildCaseGraph(Array.from({ length: 500 }, (_, i) => tx(i, i % 20, Math.floor(i / 20) + 20)), 'pattern')
    expect(dense.edges).toHaveLength(400)
    expect(dense.omittedEdges).toBe(100)
  })
  it('rejects oversized graph input before reading or iterating any row', () => {
    const inaccessible = new Proxy(new Array<LedgerTransaction>(10_001), {
      get(target, property) {
        if (property === 'length') return target.length
        throw new Error(`Oversized input was accessed: ${String(property)}`)
      },
    })
    expect(buildCaseGraph(inaccessible, 'pattern')).toMatchObject({ status: 'server-required', inputTransactions: 10_001, nodes: [], edges: [], omittedNodes: null, omittedEdges: null })
    expect(caseGraphBudget.transactions).toBe(10_000)
    expect(buildCaseGraph([tx(1, 1, 2)], 'owner', inaccessible)).toMatchObject({ status: 'server-required', nodes: [], edges: [] })
    const boundary = buildCaseGraph(Array<LedgerTransaction>(10_000).fill(tx(1, 1, 2)), 'pattern')
    expect(boundary.status).toBe('ready')
    expect(boundary.edges[0].count).toBe(10_000)
  })
  it('explicitly rejects oversized public ledger indexing instead of returning incomplete evidence', () => {
    const inaccessible = new Proxy(new Array<LedgerTransaction>(10_001), {
      get(target, property) {
        if (property === 'length') return target.length
        throw new Error(`Oversized ledger row access: ${String(property)}`)
      },
    })
    expect(() => indexCaseLedger(inaccessible)).toThrow(RangeError)
    expect(() => caseEvidence(item, inaccessible)).toThrow(RangeError)
  })
  it('neutralizes spreadsheet formulas preceded by whitespace in CSV cells', async () => {
    let exported: Blob | undefined
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('URL', { createObjectURL: (blob: Blob) => { exported = blob; return 'blob:case-export' }, revokeObjectURL: vi.fn() })
    try {
      downloadCaseCsv('case.csv', [['  =1+1', '\t+1', ' \r@SUM(A1)', ' -1', '증빙 확인']])
      const output = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result)); reader.onerror = reject
        reader.readAsText(exported!)
      })
      expect(output).toContain('"\'  =1+1"')
      expect(output).toContain('"\'\t+1"')
      expect(output).toContain('"\' \r@SUM(A1)"')
      expect(output).toContain('"\' -1"')
      expect(output).toContain('"증빙 확인"')
      await new Promise(resolve => setTimeout(resolve, 1))
    } finally { click.mockRestore(); vi.unstubAllGlobals() }
  })
})


describe('case overview facts', () => {
  it('deduplicates evidence references before table, graph and related-case aggregates', () => {
    const record = { ...item, transactionIds: [1, 1, 2, 2] }
    const rows = [tx(1, 1, 2, 100), tx(2, 1, 2, 200)]
    const evidence = caseEvidence(record, rows)
    expect(evidence.map(row => row.id)).toEqual([1, 2])
    expect(buildCaseGraph(evidence, 'pattern').edges[0]).toMatchObject({ count: 2, amountUsd: 300 })
    const related = { ...record, caseId: item.caseId + 1 }
    expect(relatedCases(record, [record, related], rows)[0].sharedTransactions).toBe(2)
  })
  it('counts unique missing references without treating duplicates as loaded evidence', () => {
    const record = { ...item, transactionIds: [1, 1, 2, 99, 99] }
    expect(caseOverviewFacts(record, [tx(1, 1, 2), tx(2, 2, 3), tx(3, 3, 4)])).toEqual({
      referenceCount: 3, availableCount: 2, missingCount: 1, duplicateReferenceCount: 2,
      complete: false, accountCount: 3, knownOwnerCount: 3, unknownOwnerAccountCount: 0,
      period: null, invalidTimestampCount: 0,
    })
  })
  it('resolves both endpoint owners from the full snapshot and counts shared owners once', () => {
    const record = { ...item, transactionIds: [1, 1, 2] }
    const rows = [tx(1, 1, 2), { ...tx(2, 2, 3), ownerId: 101 }, { ...tx(3, 3, 4), occurredAt: '2000-01-01T00:00:00Z' }]
    expect(caseOverviewFacts(record, indexCaseLedger(rows))).toEqual({
      referenceCount: 2, availableCount: 2, missingCount: 0, duplicateReferenceCount: 1,
      complete: true, accountCount: 3, knownOwnerCount: 2, unknownOwnerAccountCount: 0,
      period: { start: '2026-11-15T12:00:01.000Z', end: '2026-11-15T12:00:02.000Z' }, invalidTimestampCount: 0,
    })
  })
  it('keeps an unobserved destination owner unknown', () => {
    expect(caseOverviewFacts({ ...item, transactionIds: [1] }, [tx(1, 1, 2)])).toMatchObject({
      accountCount: 2, knownOwnerCount: 1, unknownOwnerAccountCount: 1,
      period: { start: '2026-11-15T12:00:01.000Z', end: '2026-11-15T12:00:01.000Z' },
    })
  })
  it('counts a self-transfer account once', () => {
    expect(caseOverviewFacts({ ...item, transactionIds: [1] }, [tx(1, 1, 1)])).toMatchObject({
      accountCount: 1, knownOwnerCount: 1, unknownOwnerAccountCount: 0,
    })
  })
  it.each([false, true])('keeps conflicting ownership unknown regardless of row order (reversed=%s)', reversed => {
    const rows = [tx(1, 1, 2), tx(2, 2, 3), { ...tx(3, 1, 4), ownerId: 999 }, tx(4, 1, 5)]
    const index = indexCaseLedger(reversed ? [...rows].reverse() : rows)
    expect(index.owners.has(1)).toBe(false)
    expect(caseOverviewFacts({ ...item, transactionIds: [1] }, index)).toMatchObject({
      accountCount: 2, knownOwnerCount: 1, unknownOwnerAccountCount: 1,
    })
    expect(buildCaseGraph([rows[0]], 'owner', index.owners).nodes.map(node => node.id)).toEqual(['account:1', 'owner:102'])
  })
  it('orders period endpoints by parsed instants, not strings containing different offsets', () => {
    const rows = [
      { ...tx(1, 1, 2), occurredAt: '2026-11-15T09:00:00+09:00' },
      { ...tx(2, 2, 3), occurredAt: '2026-11-14T20:00:00-05:00' },
    ]
    expect(caseOverviewFacts({ ...item, transactionIds: [2, 1] }, rows).period).toEqual({
      start: '2026-11-15T00:00:00.000Z', end: '2026-11-15T01:00:00.000Z',
    })
  })
  it.each(['not-a-date', '', '2026-11-15T09:00:00', '2026-02-30T00:00:00Z', '2026-11-31T12:00:00+09:00', '2026-02-29T00:00:00Z', '2026-11-15T24:00:00Z'])('withholds the whole period for invalid or offset-free time %j', occurredAt => {
    const rows = [tx(1, 1, 2), { ...tx(2, 2, 3), occurredAt }]
    expect(caseOverviewFacts({ ...item, transactionIds: [1, 2, 2] }, rows)).toMatchObject({
      referenceCount: 2, availableCount: 2, complete: true, duplicateReferenceCount: 1,
      invalidTimestampCount: 1, period: null,
    })
  })
  it('accepts a real leap day with an explicit offset', () => {
    const rows = [{ ...tx(1, 1, 2), occurredAt: '2024-02-29T12:00:00.250+09:00' }]
    expect(caseOverviewFacts({ ...item, transactionIds: [1] }, rows)).toMatchObject({
      invalidTimestampCount: 0, period: { start: '2024-02-29T03:00:00.250Z', end: '2024-02-29T03:00:00.250Z' },
    })
  })
  it('returns no period for an empty case even when the ledger has other transactions', () => {
    expect(caseOverviewFacts({ ...item, transactionIds: [] }, [tx(1, 1, 2)])).toEqual({
      referenceCount: 0, availableCount: 0, missingCount: 0, duplicateReferenceCount: 0,
      complete: true, accountCount: 0, knownOwnerCount: 0, unknownOwnerAccountCount: 0,
      period: null, invalidTimestampCount: 0,
    })
  })
  it('distinguishes an entirely missing evidence set from an empty case', () => {
    expect(caseOverviewFacts({ ...item, transactionIds: [1, 2] }, [])).toMatchObject({
      referenceCount: 2, availableCount: 0, missingCount: 2, complete: false, period: null, invalidTimestampCount: 0,
    })
  })
  it('retains reference and ledger bounds before inspecting oversized rows', () => {
    const inaccessible = <T,>(length: number) => new Proxy(new Array<T>(length), {
      get(target, property) { if (property === 'length') return target.length; throw new Error('Oversized input was inspected') },
    })
    expect(() => caseOverviewFacts({ ...item, transactionIds: inaccessible<number>(10_001) }, [])).toThrow(RangeError)
    expect(() => caseOverviewFacts(item, inaccessible<LedgerTransaction>(10_001))).toThrow(RangeError)
  })
})
