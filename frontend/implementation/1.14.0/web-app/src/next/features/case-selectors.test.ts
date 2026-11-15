import { describe, expect, it, vi } from 'vitest'
import { cases } from '../dashboard-data'
import type { LedgerTransaction, WorkspaceCase } from '../workspace-store'
import { buildCaseGraph, canJudgeCase, caseEvidence, caseGraphBudget, downloadCaseCsv, indexCaseLedger, relatedCases } from './case-selectors'

const item: WorkspaceCase = { ...cases[0], revision: 1, alertCaseIds: [], comments: [], history: [] }
const tx = (id: number, from: number, to: number, amountUsd = 100): LedgerTransaction => ({ id, displayId: `T-${id}`, date: '2026-11-15', occurredAt: `2026-11-15T12:00:${id % 60}Z`, typeCode: 3, probability: .8, suspicious: true, score: .95, amountUsd, currency: 'USD', accountId: from, ownerId: from + 100, fromAccountId: from, toAccountId: to, humanVerdict: null })

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
