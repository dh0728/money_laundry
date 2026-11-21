import { createCsv, downloadCsv } from './report-io'
import type { TypeCode } from '@/api/codes'
import { patternName, riskBand, workStates, type WorkState } from '../dashboard-data'
import type { LedgerTransaction, WorkspaceCase } from '../workspace-store'
export type InvestigationFilters = { q: string; start: string; end: string; mine: boolean; status: WorkState | ''; risk: string; type: TypeCode | ''; abnormal: boolean; sort: string }
const validDate = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : ''
export function readInvestigationFilters(route: URL): InvestigationFilters {
  const p = route.searchParams
  const start = validDate(p.get('start')); const end = validDate(p.get('end'))
  const type = p.get('type')
  return { q: p.get('q') ?? '', start: end && start > end ? '' : start, end: start && start > end ? '' : end,
    mine: p.get('mine') === '1', status: workStates.some(s => s.key === p.get('status')) ? p.get('status') as WorkState : '',
    risk: ['high', 'medium', 'low'].includes(p.get('risk') ?? '') ? p.get('risk')! : '', type: type !== null && /^[0-8]$/.test(type) ? Number(type) as TypeCode : '',
    abnormal: p.get('abnormal') === '1', sort: ['oldest', 'score', 'amount'].includes(p.get('sort') ?? '') ? p.get('sort')! : 'newest' }
}
export function canBundle(record: WorkspaceCase, viewerId: number) {
  return record.kind === 'ALERT' && record.assigneeId === viewerId && record.status === 'OPEN' && !record.episodeCaseId && !record.verdict
}
export function selectInvestigationCases(records: WorkspaceCase[], kind: WorkspaceCase['kind'], f: InvestigationFilters, viewerId: number) {
  const q = f.q.trim().toLowerCase()
  return records.filter(r => r.kind === kind && (!f.mine || r.assigneeId === viewerId) && (!f.status || r.workState === f.status)
    && (!f.risk || riskBand(r.score) === f.risk) && (f.type === '' || r.typeCode === f.type) && (!f.abnormal || r.verdict === 'abnormal')
    && (!f.start || r.createdDate >= f.start) && (!f.end || r.createdDate <= f.end)
    && (!q || `${r.displayId} ${r.caseId} ${r.assignee} ${patternName(r.typeCode)}`.toLowerCase().includes(q)))
    .sort((a, b) => f.sort === 'score' ? b.score - a.score || b.caseId - a.caseId : f.sort === 'amount' ? (b.amountUsd ?? -1) - (a.amountUsd ?? -1) || b.caseId - a.caseId : f.sort === 'oldest' ? a.createdDate.localeCompare(b.createdDate) || a.caseId - b.caseId : b.createdDate.localeCompare(a.createdDate) || b.caseId - a.caseId)
}
export const ownerName = (id: number) => `${['김', '박', '이', '최'][Math.abs(id) % 4]}OO · ${id}`
export const accountName = (id: number) => `계좌 ${id}`
export const MAX_INVESTIGATION_FIXTURE_ROWS = 10_000
type LedgerOwner = { id:number; name:string; accountCount:number; transactionCount:number; amountUsd:number }
type LedgerAccount = { id:number; ownerId:number; transactionCount:number; incomingUsd:number; outgoingUsd:number }
type LedgerIndex = { serverQueryRequired:boolean; source:LedgerTransaction[]; owners:LedgerOwner[]; accounts:LedgerAccount[]; accountsByOwner:Map<number,LedgerAccount[]>; ownerIds:Set<number> }
const ledgerCache = new WeakMap<LedgerTransaction[], { key:string; index:LedgerIndex }>()
/** One cached filter per immutable snapshot: bounded memory, O(n) grouping, no client production data scan. */
export function indexInvestigationLedger(transactions:LedgerTransaction[], f:InvestigationFilters):LedgerIndex {
 if (transactions.length > MAX_INVESTIGATION_FIXTURE_ROWS) return {serverQueryRequired:true,source:[],owners:[],accounts:[],accountsByOwner:new Map(),ownerIds:new Set()}
 const q = f.q.trim().toLowerCase()
 const key = JSON.stringify([q,f.start,f.end,f.risk,f.type,f.abnormal])
 const cached = ledgerCache.get(transactions)
 if (cached?.key===key) return cached.index
 const source:LedgerTransaction[] = []
 const owners = new Map<number,LedgerOwner>()
 const ownedAccounts = new Map<number,Set<number>>()
 const primaryOwners = new Map<number,number>()
 const accountTotals = new Map<number,{transactionCount:number;incomingUsd:number;outgoingUsd:number}>()
 const totals = (id:number) => { let entry=accountTotals.get(id); if(!entry){entry={transactionCount:0,incomingUsd:0,outgoingUsd:0};accountTotals.set(id,entry)} return entry }
 for (const transaction of transactions) {
  const {id,displayId,date,score,typeCode,humanVerdict,ownerId,accountId,fromAccountId,toAccountId,amountUsd} = transaction
  if ((f.start && date<f.start) || (f.end && date>f.end) || (f.risk && riskBand(score)!==f.risk) || (f.type!=='' && typeCode!==f.type) || (f.abnormal && humanVerdict!=='abnormal')
    || (q && !`${displayId} ${id} ${ownerId} ${ownerName(ownerId)} ${fromAccountId} ${toAccountId} ${patternName(typeCode)}`.toLowerCase().includes(q))) continue
  source.push(transaction)
  let owner = owners.get(ownerId)
  if (!owner) { owner={id:ownerId,name:ownerName(ownerId),accountCount:0,transactionCount:0,amountUsd:0};owners.set(ownerId,owner);ownedAccounts.set(ownerId,new Set()) }
  owner.transactionCount++;owner.amountUsd+=amountUsd;ownedAccounts.get(ownerId)!.add(accountId)
  if (!primaryOwners.has(accountId)) primaryOwners.set(accountId,ownerId)
  const outgoing=totals(fromAccountId);outgoing.transactionCount++;outgoing.outgoingUsd+=amountUsd
  const incoming=totals(toAccountId);if(toAccountId!==fromAccountId) incoming.transactionCount++;incoming.incomingUsd+=amountUsd
 }
 const ownerRows=[...owners.values()].sort((a,b)=>a.id-b.id)
 for (const owner of ownerRows) owner.accountCount=ownedAccounts.get(owner.id)!.size
 const accounts=[...primaryOwners].map(([id,ownerId])=>({id,ownerId,...(accountTotals.get(id)??{transactionCount:0,incomingUsd:0,outgoingUsd:0})})).sort((a,b)=>a.id-b.id)
 const accountById=new Map(accounts.map(account=>[account.id,account]))
 const accountsByOwner=new Map([...ownedAccounts].map(([ownerId,ids])=>[ownerId,[...ids].sort((a,b)=>a-b).map(id=>accountById.get(id)!)]))
 const index={serverQueryRequired:false,source,owners:ownerRows,accounts,accountsByOwner,ownerIds:new Set(owners.keys())}
 ledgerCache.set(transactions,{key,index})
 return index
}
export function selectLedger(transactions: LedgerTransaction[], f: InvestigationFilters, ownerId: number | null, accountId: number | null, direction: string) {
 const index=indexInvestigationLedger(transactions,f)
 const accounts=ownerId===null?index.accounts:index.accountsByOwner.get(ownerId)??[]
 const ids=new Set(accounts.map(account=>account.id))
 const selected=index.source.filter(t=>accountId!==null ? direction==='outgoing'?t.fromAccountId===accountId:direction==='incoming'?t.toAccountId===accountId:t.fromAccountId===accountId||t.toAccountId===accountId : ownerId===null||ids.has(t.fromAccountId)||ids.has(t.toAccountId))
  .sort((a,b)=>f.sort==='amount'?b.amountUsd-a.amountUsd:f.sort==='score'?b.score-a.score:f.sort==='oldest'?a.occurredAt.localeCompare(b.occurredAt)||a.id-b.id:b.occurredAt.localeCompare(a.occurredAt)||b.id-a.id)
 return {serverQueryRequired:index.serverQueryRequired,owners:index.owners,accounts,transactions:selected}
}
export function investigationCsv(rows: (string | number | null)[][]) {
 const [headers=[],...data]=rows
 return createCsv(headers.map(value=>String(value??'')),data)
}
export function downloadInvestigationCsv(name: string, rows: (string | number | null)[][]) {
 const [headers=[],...data]=rows
 downloadCsv(`${name}.csv`,headers.map(value=>String(value??'')),data)
}
/** Fixture-only paging. Production queries and aggregates must be cursor-paginated by the server. */
export function paginateInvestigationRows<T>(rows: T[], requestedPage: string | null, requestedSize: string | null) {
 const pageSize = [25, 50, 100].includes(Number(requestedSize)) ? Number(requestedSize) : 25
 const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
 const parsed = Number(requestedPage)
 const page = Math.min(pageCount, Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1)
 const offset = (page - 1) * pageSize
 return { rows: rows.slice(offset, offset + pageSize), total: rows.length, page, pageSize, pageCount, start: rows.length ? offset + 1 : 0, end: Math.min(offset + pageSize, rows.length) }
}
