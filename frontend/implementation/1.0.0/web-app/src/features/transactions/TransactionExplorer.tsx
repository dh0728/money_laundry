import { useMemo, useState, type ReactNode } from 'react'
import type { DateRange } from 'react-day-picker'
import { ArrowRight, ListFilter, Search, X } from 'lucide-react'
import { hrefFor } from '@/app/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DateRangeButton } from '@/components/DateRangeButton'
import { FilterChip } from '@/components/FilterChip'
import { OrthogonalConnector, StageItem, StagePanel } from './transaction-stage'
import { formatMoney, type TransactionIndex, type TransactionTarget } from './transactionIndex'

const toggleSingleSelectedId = (current: string | null | undefined, clicked: string) => (current === clicked ? null : clicked)

type IndexedTransaction = TransactionIndex['transactions'][number]
type IndexedAccount = TransactionIndex['accounts'][number]
type IndexedOwner = TransactionIndex['owners'][number]
type TransactionFilterField = 'direction' | 'status' | 'format'
export type TransactionFilter = { field: TransactionFilterField; value: string }
type TransactionView = IndexedTransaction & { contextAccount: string; direction: '송금' | '수취'; counterpartyOwner: string; counterpartyAccount: string }

const filterLabels: Record<TransactionFilterField, string> = { direction: '방향', status: '상태', format: '결제 수단' }
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

function transactionView(transaction: IndexedTransaction, account: IndexedAccount): TransactionView {
  const outgoing = transaction.fromAccount === account.id
  return {
    ...transaction,
    contextAccount: account.id,
    direction: outgoing ? '송금' : '수취',
    counterpartyOwner: outgoing ? transaction.toOwner : transaction.fromOwner,
    counterpartyAccount: outgoing ? transaction.toAccount : transaction.fromAccount,
  }
}

function passesFilters(row: TransactionView, range: DateRange | undefined, filters: TransactionFilter[]) {
  const day = row.at.slice(0, 10)
  if (range?.from && day < dateKey(range.from)) return false
  if (range?.to && day > dateKey(range.to)) return false
  return (['direction', 'status', 'format'] as const).every(field => {
    const values = filters.filter(filter => filter.field === field)
    return values.length === 0 || values.some(filter => field === 'direction' ? row.direction === filter.value : field === 'status'
      ? (row.suspicious === null ? '미분석' : row.suspicious ? '의심' : '정상') === filter.value : row.format === filter.value)
  })
}

function targetSelection(index: TransactionIndex, target?: TransactionTarget) {
  if (target?.type === 'owner') return { owner: target.owner, account: undefined, transaction: undefined }
  if (target?.type === 'account') {
    const account = index.accounts.find(item => item.id === target.account)
    return { owner: account?.owner, account: account?.id, transaction: undefined }
  }
  if (target?.type === 'transaction') {
    const transaction = index.transactions.find(item => item.id === target.transactionId)
    return { owner: transaction?.fromOwner, account: transaction?.fromAccount, transaction: transaction?.id }
  }
  return { owner: undefined, account: undefined, transaction: undefined }
}

function TransactionMiniSankey({ transaction }: { transaction: IndexedTransaction }) {
  const amount = formatMoney(transaction.amount, transaction.currency)
  const label = `${transaction.fromAccount}에서 ${transaction.toAccount}으로 ${amount} ${transaction.format} 송금 흐름`
  const labelId = `transaction-flow-${transaction.id}`
  return <figure data-testid="transaction-mini-sankey" className="rounded-md border bg-muted/20 p-3" aria-labelledby={labelId}>
    <span id={labelId} className="sr-only">{label}</span>
    <div className="relative grid min-h-28 grid-cols-[minmax(0,1fr)_96px_minmax(0,1fr)] items-center gap-2">
      <svg viewBox="0 0 420 112" aria-hidden="true" focusable="false" className="pointer-events-none absolute inset-0 h-full w-full">
        <path d="M118 38 C176 38 244 38 302 38 L302 74 C244 74 176 74 118 74 Z" className={transaction.suspicious ? 'fill-destructive/35' : 'fill-muted-foreground/35'} />
      </svg>
      <div className="relative z-10 min-w-0 rounded-md border bg-card px-3 py-2"><p className="truncate text-[10px] text-muted-foreground">송금 소유주</p><p className="mt-1 break-words text-[11px] font-medium leading-tight" title={transaction.fromOwner}>{transaction.fromOwner}</p><p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{transaction.fromAccount}</p></div>
      <p className="relative z-10 flex min-w-0 items-center justify-center gap-1 rounded-full bg-card/90 px-1 py-1 text-center text-[10px] font-medium tabular-nums" title={amount}><span className="truncate">{amount}</span><ArrowRight data-testid="transaction-flow-direction" aria-hidden="true" className="size-3 shrink-0" /></p>
      <div className="relative z-10 min-w-0 rounded-md border bg-card px-3 py-2 text-right"><p className="truncate text-[10px] text-muted-foreground">수취 소유주</p><p className="mt-1 break-words text-[11px] font-medium leading-tight" title={transaction.toOwner}>{transaction.toOwner}</p><p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{transaction.toAccount}</p></div>
    </div>
  </figure>
}

function RecordLinks({ ids, kind, plain, onOpen }: { ids: number[]; kind: 'Alert' | 'Episode'; plain?: boolean; onOpen?: (id: number) => void }) {
  const prefix = kind === 'Alert' ? 'A' : 'E'
  if (plain) return <div className="flex flex-wrap gap-2">{ids.map(id => <Badge key={id} variant="outline">Alert · A-{id}</Badge>)}</div>
  return <div className="flex flex-wrap gap-2">{ids.map(id => <Badge key={id} asChild variant="outline" className="record-link h-8 rounded-full px-3 font-mono text-xs"><a onClick={event => { if (onOpen) { event.preventDefault(); onOpen(id) } }} href={hrefFor(kind === 'Alert' ? 'alerts' : 'episodes', id)} title={`${prefix}-${id} 상세 보기`}>{kind} · {prefix}-{id}</a></Badge>)}</div>
}

function LinkedRecordActions({ transaction, remote, onOpenEpisode }: { transaction: IndexedTransaction; remote?: boolean; onOpenEpisode?: (id: number) => void }) {
  const { alertIds: alerts, episodeIds: episodes } = transaction
  if (!alerts.length && !episodes.length) return null
  return <div data-testid="linked-record-actions" className="flex flex-wrap gap-3 border-t pt-3">
    {alerts.length > 0 && <div className="space-y-1.5"><p className="text-[var(--text-micro-size)] text-muted-foreground">연결 Alert</p><RecordLinks ids={alerts} kind="Alert" plain={remote} /></div>}
    {episodes.length > 0 && <div className="space-y-1.5"><p className="text-[var(--text-micro-size)] text-muted-foreground">연결 Episode</p><RecordLinks ids={episodes} kind="Episode" onOpen={onOpenEpisode} /></div>}
  </div>
}

function ownerMatches(owner: IndexedOwner, query: string, accounts: IndexedAccount[], transactions: IndexedTransaction[]) {
  if (!query) return true
  const q = query.toLowerCase()
  return owner.name.toLowerCase().includes(q)
    || accounts.some(account => owner.accountIds.includes(account.id) && `${account.id} ${account.bank}`.toLowerCase().includes(q))
    || transactions.some(transaction => owner.transactionIds.includes(transaction.id) && `${transaction.id} ${transaction.fromOwner} ${transaction.toOwner} ${transaction.fromAccount} ${transaction.toAccount} ${transaction.format}`.toLowerCase().includes(q))
}

function visibleAccountsForOwner(owner: IndexedOwner, accountsByOwner: ReadonlyMap<string, IndexedAccount[]>, viewsByAccount: ReadonlyMap<string, TransactionView[]>, query: string, range: DateRange | undefined, filters: TransactionFilter[]) {
  const q = query.trim().toLowerCase()
  return (accountsByOwner.get(owner.name) ?? []).filter(account => {
    const textMatch = !q || owner.name.toLowerCase().includes(q) || `${account.id} ${account.bank}`.toLowerCase().includes(q) || (viewsByAccount.get(account.id) ?? []).some(transaction => `${transaction.id} ${transaction.fromOwner} ${transaction.toOwner} ${transaction.fromAccount} ${transaction.toAccount} ${transaction.format}`.toLowerCase().includes(q))
    return textMatch && (viewsByAccount.get(account.id) ?? []).some(view => passesFilters(view, range, filters))
  })
}

export type ExplorerRemote = {
  onOpenEpisode?: (id: number) => void
  query: string; onQuery: (query: string) => void
  owner?: string; account?: string
  selectOwner: (id: string) => void; selectAccount: (id: string | undefined) => void
  range: DateRange | undefined; filters: TransactionFilter[]
  changeControls: (range: DateRange | undefined, filters: TransactionFilter[]) => void
  formats: string[]
  counts: [number | undefined, number | undefined, number | undefined]
  stages: [ReactNode, ReactNode, ReactNode]
}

// v24 TransactionsV22.tsx: 소유주 → 계좌 → 거래 3단 탐색
// target: 전역 검색에서 특정 소유주·계좌·거래로 들어올 때 처음 선택할 대상(검색 연결 시 사용)
export default function TransactionExplorer({ index, target, today, remote }: { index: TransactionIndex; target?: TransactionTarget; today: Date; remote?: ExplorerRemote }) {
  const initial = useMemo(() => targetSelection(index, target), [index, target])
  const [localQuery, setLocalQuery] = useState('')
  const query = remote ? remote.query : localQuery
  const setQuery = (value: string) => remote ? remote.onQuery(value) : setLocalQuery(value)
  const [localRange, setRange] = useState<DateRange>()
  const range = remote ? remote.range : localRange
  const [localFilters, setFilters] = useState<TransactionFilter[]>([])
  const filters = remote ? remote.filters : localFilters
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterField, setFilterField] = useState<TransactionFilterField>(remote ? 'status' : 'direction')
  const [filterValue, setFilterValue] = useState(remote ? '의심' : '송금')
  const [localOwner, setSelectedOwner] = useState(initial.owner)
  const [localAccount, setSelectedAccount] = useState(initial.account)
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null | undefined>(initial.transaction)


  const selectedOwner = remote ? remote.owner : localOwner
  const selectedAccount = remote ? remote.account : localAccount
  const transactionMap = useMemo(() => new Map(index.transactions.map(transaction => [transaction.id, transaction] as const)), [index])
  const accountsByOwner = useMemo(() => index.owners.reduce((map, owner) => {
    map.set(owner.name, index.accounts.filter(account => owner.accountIds.includes(account.id)))
    return map
  }, new Map<string, IndexedAccount[]>()), [index])
  const viewsByAccount = useMemo(() => index.accounts.reduce((map, account) => {
    map.set(account.id, account.transactionIds.flatMap(id => { const transaction = transactionMap.get(id); return transaction ? [transactionView(transaction, account)] : [] }))
    return map
  }, new Map<string, TransactionView[]>()), [index.accounts, transactionMap])
  const constrainedAccounts = (owner: IndexedOwner) => (accountsByOwner.get(owner.name) ?? []).filter(account => (viewsByAccount.get(account.id) ?? []).some(view => passesFilters(view, range, filters)))
  const visibleOwners = remote ? index.owners : index.owners.filter(owner => ownerMatches(owner, query.trim(), index.accounts, index.transactions) && (!range?.from && filters.length === 0 || constrainedAccounts(owner).length > 0))
  const owner = index.owners.find(item => (remote ? item.id ?? item.name : item.name) === selectedOwner) ?? (remote && selectedOwner ? { id: selectedOwner, name: '선택한 소유주', accountIds: [], transactionIds: [] } : undefined)
  const ownerAccounts = remote ? index.accounts.filter(account => account.owner === selectedOwner) : owner ? visibleAccountsForOwner(owner, accountsByOwner, viewsByAccount, query, range, filters) : []
  const account = ownerAccounts.find(item => item.id === selectedAccount) ?? (remote && selectedAccount ? { id: selectedAccount, bank: '', owner: selectedOwner ?? '', transactionIds: index.transactions.map(tx => tx.id) } : undefined)
  const transactionRows = account ? (remote ? index.transactions.map(tx => transactionView(tx, account)) : viewsByAccount.get(account.id) ?? []).filter(view => {
    const q = query.trim().toLowerCase()
    const textMatch = !q || owner?.name.toLowerCase().includes(q) || `${account.id} ${account.bank}`.toLowerCase().includes(q) || `${view.id} ${view.fromOwner} ${view.toOwner} ${view.fromAccount} ${view.toAccount} ${view.format}`.toLowerCase().includes(q)
    return remote ? true : textMatch && passesFilters(view, range, filters)
  }) : []
  const selected = index.transactions.find(item => item.id === selectedTransactionId)
  const filterValues = useMemo<Record<TransactionFilterField, string[]>>(() => ({ direction: ['송금', '수취'], status: ['의심', '정상', '미분석'], format: remote?.formats ?? [...new Set(index.transactions.map(item => item.format))].sort() }), [index.transactions, remote?.formats])

  const selectOwner = (next: IndexedOwner) => {
    if (remote) { remote.selectOwner(next.id ?? next.name); setSelectedTransactionId(null); return }
    setSelectedOwner(next.name)
    const first = visibleAccountsForOwner(next, accountsByOwner, viewsByAccount, query, range, filters)[0]
    setSelectedAccount(first?.id); setSelectedTransactionId(null)
  }
  const selectAccount = (next: IndexedAccount) => { if (remote) { remote.selectAccount(toggleSingleSelectedId(selectedAccount, next.id) ?? undefined); setSelectedTransactionId(null); return } setSelectedAccount(toggleSingleSelectedId(selectedAccount, next.id) ?? undefined); setSelectedTransactionId(null) }
  const selectTransaction = (next: TransactionView) => setSelectedTransactionId(toggleSingleSelectedId(selectedTransactionId, next.id))
  const applyControls = (nextQuery: string, nextRange: DateRange | undefined, nextFilters: TransactionFilter[]) => { setQuery(nextQuery); setRange(nextRange); setFilters(nextFilters); remote?.changeControls(nextRange, nextFilters); setSelectedTransactionId(null) }
  const resetControls = () => applyControls('', undefined, [])
  const addFilter = () => { const next = filters.some(item => item.field === filterField && item.value === filterValue) ? filters : [...filters, { field: filterField, value: filterValue }]; applyControls(query, range, next); setFilterOpen(false) }

  return <div className="flex flex-col gap-5" data-testid="transactions-table">
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-sm"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="거래 내역 검색" value={query} onChange={event => applyControls(event.target.value, range, filters)} placeholder="거래 ID, 소유주, 계좌 검색" className="h-9 pl-9 text-xs" /></div>
      <DateRangeButton value={range} onChange={next => applyControls(query, next, filters)} today={today} />
      <Popover open={filterOpen} onOpenChange={setFilterOpen}><PopoverTrigger asChild><Button type="button" variant="outline" size="sm" className="transaction-filter-trigger date-range-control h-9"><ListFilter className="size-3.5" />필터{filters.length > 0 && <Badge className="ml-1 h-5 min-w-5 px-1.5">{filters.length}</Badge>}</Button></PopoverTrigger><PopoverContent align="start" className="w-72 space-y-3"><Label>조건 추가</Label><Select value={filterField} onValueChange={value => { const field = value as TransactionFilterField; setFilterField(field); setFilterValue(filterValues[field][0]) }}><SelectTrigger className="w-full" aria-label="거래 내역 필터 항목"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(filterLabels).filter(([key]) => !remote || remote.account || key !== 'direction').map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select><Select value={filterValue} onValueChange={setFilterValue}><SelectTrigger className="w-full" aria-label="거래 내역 필터 값"><SelectValue /></SelectTrigger><SelectContent>{filterValues[filterField].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select><Button className="w-full" size="sm" onClick={addFilter}>조건 적용</Button></PopoverContent></Popover>
      {(query || range?.from || filters.length > 0) && <Button type="button" variant="ghost" size="sm" onClick={resetControls}><X className="size-3.5" />전체 보기</Button>}
      {/* 거래 탐색 API는 API.md에 없어 Backend에 새로 요청할 항목이다 */}
    </div>
    {filters.length > 0 && <div className="flex flex-wrap items-center gap-2">{filters.map((filter, index) => <FilterChip key={`${filter.field}-${filter.value}`} onRemove={() => applyControls(query, range, filters.filter((_, current) => current !== index))}>{filterLabels[filter.field]}: {filter.value}</FilterChip>)}</div>}
    <div data-testid="transactions-explorer" className="transactions-explorer">
      <div data-testid="transactions-flow" className="transactions-flow grid gap-3">
        <StagePanel testId="owner-section" bodyTestId="owner-stage-body" title="소유주" count={remote ? remote.counts[0] : visibleOwners.length}>{<div data-testid="selected-owner-item" aria-live="polite" className={`rounded-lg border px-3 py-3 text-sm ${owner ? 'border-foreground bg-foreground text-background' : 'border-dashed bg-muted/10 text-muted-foreground'}`}>{owner ? <><p className="font-medium">{owner.name}</p><p className="mt-1 text-[var(--text-micro-size)] text-background/70">{remote ? '가명 소유주' : `계좌 ${owner.accountIds.length}개 · 거래 ${owner.transactionIds.length}건`}</p></> : '소유주를 선택해 주세요'}</div>}<div data-testid="owner-scroll-list" className="transaction-owner-scroll mt-4 border-t-2 border-border pt-4">{visibleOwners.map(item => <StageItem key={item.id ?? item.name} testId="owner-item" active={(item.id ?? item.name) === (owner?.id ?? owner?.name)} primary={item.name} secondary={remote ? '가명 소유주' : `계좌 ${item.accountIds.length}개 · 거래 ${item.transactionIds.length}건`} onSelect={() => selectOwner(item)} />)}</div>{remote?.stages[0]}</StagePanel>
        <OrthogonalConnector id="owner-account-connector" sourceIndex={0} targetCount={ownerAccounts.length} targetOffset={110} activeTargetIndex={ownerAccounts.findIndex(item => item.id === account?.id)} />
        <StagePanel testId="account-section" title="계좌" count={remote ? remote.counts[1] : ownerAccounts.length} description={owner ? `${owner.name}의 계좌` : '소유주를 선택하세요'}>{ownerAccounts.map(item => <StageItem key={item.id} testId="account-item" active={item.id === account?.id} primary={item.id} secondary={remote ? `은행 ${item.bank}` : `은행 ${item.bank} · 거래 ${item.transactionIds.length}건`} mono onSelect={() => selectAccount(item)} />)}{remote?.stages[1]}</StagePanel>
        <OrthogonalConnector id="account-transaction-connector" sourceIndex={ownerAccounts.findIndex(item => item.id === account?.id)} targetCount={transactionRows.length} targetOffset={110} activeTargetIndex={transactionRows.findIndex(item => item.id === selectedTransactionId)} />
        <StagePanel testId="transaction-section" title="거래" count={remote ? remote.counts[2] : transactionRows.length} description={account ? `${account.id}의 거래 내역` : '계좌를 선택하세요'}><div data-testid="transaction-list">{transactionRows.map(item => <StageItem key={item.id} testId="transaction-item" active={item.id === selectedTransactionId} primary={item.id} secondary={<><Badge variant="ghost" className="bg-foreground !border-transparent !text-background font-normal">{item.direction}</Badge><Badge variant={item.suspicious ? 'destructive' : 'ghost'} className={item.suspicious ? '!border-transparent !text-destructive-foreground font-normal' : 'bg-foreground !border-transparent !text-background font-normal'}>{item.suspicious === null ? '미분석' : item.suspicious ? '의심' : '정상'}</Badge></>} mono onSelect={() => selectTransaction(item)} />)}</div>{remote?.stages[2]}</StagePanel>
        <Card className="transaction-detail self-start" data-testid="transaction-detail"><CardHeader><CardTitle className="text-sm">선택 거래 상세</CardTitle><CardDescription className={selected ? 'font-mono' : ''}>{selected?.id ?? '거래를 선택하세요'}</CardDescription>{selected && <LinkedRecordActions transaction={selected} remote={Boolean(remote)} onOpenEpisode={remote?.onOpenEpisode} />}</CardHeader>{selected && <CardContent data-testid="selected-transaction" className="grid gap-5 text-xs"><TransactionMiniSankey transaction={selected} /><div className="grid grid-cols-2 gap-4"><div><p className="text-muted-foreground">거래 시각</p><p className="mt-1 tabular-nums">{selected.at.slice(0, 16).replace('T', ' ')}</p></div><div><p className="text-muted-foreground">결제 수단</p><p className="mt-1">{selected.format}</p></div></div><div><p className="text-muted-foreground">상태</p><Badge className="mt-1" variant={selected.suspicious ? 'destructive' : 'outline'}>{selected.suspicious === null ? '미분석' : selected.suspicious ? '의심' : '정상'}</Badge></div></CardContent>}</Card>
      </div>
    </div>
  </div>
}
