import { describe, expect, it } from 'vitest'
import { cases } from '../dashboard-data'
import type { WorkspaceCase, LedgerTransaction } from '../workspace-store'
import { readInvestigationFilters, selectInvestigationCases, canBundle, selectLedger, investigationCsv, paginateInvestigationRows, indexInvestigationLedger } from './investigation-selectors'
const records: WorkspaceCase[] = cases.map(c => ({ ...c, revision: 1, alertCaseIds: [], comments: [], history: [] }))
const filters = (query = '') => readInvestigationFilters(new URL(`https://aml.test/investigate/alerts${query}`))
describe('investigation selectors', () => {
  it('combines assignment, risk, status, period and search using source records', () => {
    const chosen = records[0]
    const result = selectInvestigationCases(records, 'ALERT', filters(`?mine=1&risk=high&status=unread&q=${chosen.displayId}&start=${chosen.createdDate}&end=${chosen.createdDate}`), 7)
    expect(result.map(r => r.caseId)).toEqual([chosen.caseId])
    expect(selectInvestigationCases(records, 'ALERT', filters('?mine=1'), 7).every(r => r.assigneeId === 7)).toBe(true)
  })
  it('keeps human abnormal verdict separate from model score and supports numeric type 3', () => {
    const rows = selectInvestigationCases(records, 'EPISODE', filters('?abnormal=1'), 7)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.verdict === 'abnormal')).toBe(true)
    expect(selectInvestigationCases(records, 'ALERT', filters('?type=3'), 7).every(r => r.typeCode === 3)).toBe(true)
  })
  it('allows only owned, open and unbundled Alerts', () => {
    expect(canBundle(records[0], 7)).toBe(true)
    expect(canBundle({ ...records[0], episodeCaseId: 999 }, 7)).toBe(false)
    expect(canBundle({ ...records[0], status: 'CLOSED' }, 7)).toBe(false)
    expect(canBundle(records[1], 7)).toBe(false)
  })
  it('deduplicates owner/account aggregates and includes both directions', () => {
    const txs: LedgerTransaction[] = [
      { id: 1, displayId: 'T-1', date: '2026-11-15', occurredAt: '2026-11-15T12:00:00Z', typeCode: 3, probability: .8, suspicious: true, score: .9, amountUsd: 100, currency: 'USD', accountId: 900, ownerId: 600, fromAccountId: 900, toAccountId: 901, humanVerdict: null },
      { id: 2, displayId: 'T-2', date: '2026-11-15', occurredAt: '2026-11-15T13:00:00Z', typeCode: 4, probability: .7, suspicious: true, score: .8, amountUsd: 200, currency: 'USD', accountId: 901, ownerId: 601, fromAccountId: 901, toAccountId: 900, humanVerdict: 'abnormal' },
    ]
    const data = selectLedger(txs, filters(), 600, 900, 'all')
    expect(data.owners).toHaveLength(2)
    expect(data.accounts.map(a => a.id)).toEqual([900])
    expect(data.transactions.map(t => t.id)).toEqual([2, 1])
    expect(selectLedger(txs, filters(), 600, 900, 'outgoing').transactions.map(t => t.id)).toEqual([1])
    expect(selectLedger(txs, filters(), 600, 900, 'incoming').transactions.map(t => t.id)).toEqual([2])
  })
  it('groups each source once and reuses aggregates across account/direction selection', () => {
    let ownerReads = 0
    const txs = Array.from({length:126},(_,i) => ({ id:i, displayId:`T-${i}`, date:'2026-11-15',occurredAt:'2026-11-15T12:00:00Z', typeCode:3 as const,probability:.8,suspicious:true,score:.9,amountUsd:100,currency:'USD' as const,accountId:900+i%47,get ownerId(){ownerReads++;return 600+i%19},fromAccountId:900+i%47,toAccountId:900+(i+1)%47,humanVerdict:null }))
    const first = selectLedger(txs,filters(),null,null,'all')
    expect(first.owners.reduce((sum,o)=>sum+o.transactionCount,0)).toBe(126)
    const initialReads = ownerReads
    for (const account of first.accounts) selectLedger(txs,filters(),null,account.id,'incoming')
    expect(ownerReads).toBe(initialReads)
    expect(initialReads).toBeLessThanOrEqual(txs.length*2)
    const refreshed = indexInvestigationLedger([...txs, {...txs[0],id:1000,amountUsd:500}],filters())
    expect(refreshed.owners.reduce((sum,o)=>sum+o.amountUsd,0)).toBe(13100)
  })
  it('rejects oversized fixture sources before reading any row', () => {
    const oversized = new Proxy({length:10001} as LedgerTransaction[],{get(target,key){if (/^\d+$/.test(String(key))) throw new Error('Must not read rows');return Reflect.get(target,key)}})
    expect(selectLedger(oversized,filters(),null,null,'all')).toMatchObject({serverQueryRequired:true,owners:[],accounts:[],transactions:[]})
  })
  it('counts a self-transfer once while recording both account directions', () => {
    const t:LedgerTransaction = {id:1,displayId:'T-1',date:'2026-11-15',occurredAt:'2026-11-15T00:00:00Z',typeCode:3,probability:.8,suspicious:true,score:.9,amountUsd:100,currency:'USD',accountId:900,ownerId:600,fromAccountId:900,toAccountId:900,humanVerdict:null}
    expect(selectLedger([t],filters(),600,900,'all').accounts[0]).toMatchObject({transactionCount:1,incomingUsd:100,outgoingUsd:100})
  })
  it('caps page size, clamps stale pages and preserves the filtered total', () => {
    const rows = Array.from({length:126},(_,id)=>id)
    expect(paginateInvestigationRows(rows,'1','999')).toMatchObject({total:126,pageSize:25,start:1,end:25})
    expect(paginateInvestigationRows(rows,'999','50')).toMatchObject({page:3,pageCount:3,start:101,end:126})
    expect(paginateInvestigationRows([], '5', '25')).toMatchObject({page:1,start:0,end:0,total:0})
    expect(paginateInvestigationRows(rows,'-1','100').rows).toHaveLength(100)
  })
  it('escapes CSV and prevents spreadsheet formula execution', () => {
    expect(investigationCsv([['이름', '금액'], ['=SUM(A1)', '1,200']])).toContain("\"'=SUM(A1)\",\"1,200\"")
    for (const value of [' =SUM(A1)', '\t@cmd', '\r+1', '\n-1']) expect(investigationCsv([['입력'], [value]])).toContain(`"'${value}"`)
  })
})
