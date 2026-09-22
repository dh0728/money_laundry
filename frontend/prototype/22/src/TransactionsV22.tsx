import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DateRange } from 'react-day-picker'
import { getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type ColumnDef, type RowSelectionState, type SortingState } from '@tanstack/react-table'
import { ArrowRight, ListFilter, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable, toggleSingleSelectedId } from '@/components/data-table/data-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { compactUsd, usd, type RecordItem } from './domain'
import { DateRangeButton, FilterChip, PageHeading } from './shared'
import { buildTransactionIndex, type TransactionIndex, type TransactionTarget } from './transactionIndex'

type IndexedTransaction = TransactionIndex['transactions'][number]
type IndexedAccount = TransactionIndex['accounts'][number]
type IndexedOwner = TransactionIndex['owners'][number]
type TransactionFilterField = 'direction' | 'status' | 'format'
type TransactionFilter = { field: TransactionFilterField; value: string }
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
  return filters.every(filter => filter.field === 'direction'
    ? row.direction === filter.value
    : filter.field === 'status'
      ? (row.suspicious ? '의심' : '정상') === filter.value
      : row.format === filter.value)
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
  return { owner: index.owners[0]?.name, account: index.owners[0]?.accountIds[0], transaction: undefined }
}

function RecordLinks({ ids, records, onOpenRecord }: { ids: string[]; records: Map<string, RecordItem>; onOpenRecord?: (record: RecordItem) => void }) {
  if (!ids.length) return <span className="text-xs text-muted-foreground">없음</span>
  return <div className="flex max-w-[210px] flex-wrap gap-x-2 gap-y-1">{ids.map(id => {
    const record = records.get(id)
    return <Button key={id} type="button" variant="link" size="sm" className="record-link h-auto p-0 font-mono text-[11px] !text-inherit underline" aria-label={`${id} 상세 보기`} disabled={!record || !onOpenRecord} onClick={event => { event.stopPropagation(); if (record) onOpenRecord?.(record) }}>{id}</Button>
  })}</div>
}

function SectionHeader({ title, count, description }: { title: string; count: number; description: string }) {
  return <div className="border-b px-4 py-3"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{title}</h2><Badge variant="secondary" className="font-normal">{count}</Badge></div><p className="mt-1 text-[11px] text-muted-foreground">{description}</p></div>
}

function StageConnector({ id, sourceIndex, targetCount, targetKind }: { id: string; sourceIndex: number; targetCount: number; targetKind: 'card' | 'table' }) {
  const height = 610
  const sourceY = Math.min(height - 30, 32 + Math.max(0, sourceIndex) * 64)
  const targetStart = targetKind === 'table' ? 76 : 32
  const targetStep = targetKind === 'table' ? 64 : 64
  const targetYs = Array.from({ length: Math.min(targetCount, 20) }, (_, index) => Math.min(height - 24, targetStart + index * targetStep))

  return <div data-testid={id} aria-hidden="true" className="relative mt-[69px] h-[610px] text-muted-foreground">
    <svg className="absolute inset-0 size-full overflow-visible" viewBox={`0 0 44 ${height}`} preserveAspectRatio="none">
      {targetYs.map((targetY, index) => <g key={index} data-testid={`${id}-edge-${index}`}>
        <path d={`M 0 ${sourceY} H 16 V ${targetY} H 37`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <path d={`M 36 ${targetY - 5} L 43 ${targetY} L 36 ${targetY + 5}`} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </g>)}
      <circle cx="2" cy={sourceY} r="2.5" fill="currentColor" />
    </svg>
  </div>
}

function FloatingExplorer({ children }: { children: ReactNode }) {
  return <div data-testid="transactions-explorer" className="transactions-explorer-scroll min-h-[420px] max-h-[calc(100dvh-220px)] overflow-auto">{children}</div>
}

function ownerMatches(owner: IndexedOwner, query: string, accounts: IndexedAccount[], transactions: IndexedTransaction[]) {
  if (!query) return true
  const q = query.toLowerCase()
  return owner.name.toLowerCase().includes(q)
    || accounts.some(account => owner.accountIds.includes(account.id) && `${account.id} ${account.bank}`.toLowerCase().includes(q))
    || transactions.some(transaction => owner.transactionIds.includes(transaction.id) && `${transaction.id} ${transaction.fromOwner} ${transaction.toOwner} ${transaction.fromAccount} ${transaction.toAccount} ${transaction.format}`.toLowerCase().includes(q))
}

export default function TransactionsV22({ records, target, onOpenRecord }: { records: RecordItem[]; target?: TransactionTarget; onOpenRecord?: (record: RecordItem) => void }) {
  const index = useMemo(() => buildTransactionIndex(records), [records])
  const recordMap = useMemo(() => new Map(records.map(record => [record.id, record] as const)), [records])
  const initial = useMemo(() => targetSelection(index, target), [index, target])
  const [query, setQuery] = useState('')
  const [range, setRange] = useState<DateRange>()
  const [filters, setFilters] = useState<TransactionFilter[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterField, setFilterField] = useState<TransactionFilterField>('direction')
  const [filterValue, setFilterValue] = useState('송금')
  const [selectedOwner, setSelectedOwner] = useState(initial.owner)
  const [selectedAccount, setSelectedAccount] = useState(initial.account)
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null | undefined>(initial.transaction)
  const [selection, setSelection] = useState<RowSelectionState>(initial.transaction ? { [initial.transaction]: true } : {})
  const [sorting, setSorting] = useState<SortingState>([{ id: 'at', desc: true }])
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })

  useEffect(() => {
    const next = targetSelection(index, target)
    setSelectedOwner(next.owner); setSelectedAccount(next.account); setSelectedTransactionId(next.transaction)
    setSelection(next.transaction ? { [next.transaction]: true } : {}); setPagination(current => ({ ...current, pageIndex: 0 }))
  }, [index, target])

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
  const visibleOwners = index.owners.filter(owner => ownerMatches(owner, query.trim(), index.accounts, index.transactions) && (!range?.from && filters.length === 0 || constrainedAccounts(owner).length > 0))
  const owner = visibleOwners.find(item => item.name === selectedOwner) ?? visibleOwners[0]
  const ownerAccounts = owner ? (accountsByOwner.get(owner.name) ?? []).filter(account => {
    const q = query.trim().toLowerCase()
    const textMatch = !q || owner.name.toLowerCase().includes(q) || `${account.id} ${account.bank}`.toLowerCase().includes(q) || (viewsByAccount.get(account.id) ?? []).some(transaction => `${transaction.id} ${transaction.fromOwner} ${transaction.toOwner} ${transaction.fromAccount} ${transaction.toAccount} ${transaction.format}`.toLowerCase().includes(q))
    return textMatch && (viewsByAccount.get(account.id) ?? []).some(view => passesFilters(view, range, filters))
  }) : []
  const account = ownerAccounts.find(item => item.id === selectedAccount) ?? ownerAccounts[0]
  const transactionRows = useMemo(() => account ? (viewsByAccount.get(account.id) ?? []).filter(view => {
    const q = query.trim().toLowerCase()
    const textMatch = !q || owner?.name.toLowerCase().includes(q) || `${account.id} ${account.bank}`.toLowerCase().includes(q) || `${view.id} ${view.fromOwner} ${view.toOwner} ${view.fromAccount} ${view.toAccount} ${view.format}`.toLowerCase().includes(q)
    return textMatch && passesFilters(view, range, filters)
  }) : [], [account, filters, owner?.name, query, range, viewsByAccount])
  const selected = index.transactions.find(item => item.id === selectedTransactionId)
  const filterValues = useMemo<Record<TransactionFilterField, string[]>>(() => ({ direction: ['송금', '수취'], status: ['의심', '정상'], format: [...new Set(index.transactions.map(item => item.format))].sort() }), [index.transactions])

  const columns = useMemo<ColumnDef<TransactionView>[]>(() => [
    { id: 'id', accessorKey: 'id', header: ({ column }) => <DataTableColumnHeader column={column} label="거래 ID" />, cell: ({ row }) => <div className="min-w-[165px]"><p className="font-mono text-sm">{row.original.id}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{row.original.fromAccount} → {row.original.toAccount}</p></div> },
    { id: 'at', accessorKey: 'at', header: ({ column }) => <DataTableColumnHeader column={column} label="일시" />, cell: ({ row }) => <span className="whitespace-nowrap text-xs tabular-nums">{row.original.at}</span> },
    { id: 'counterparty', accessorKey: 'counterpartyOwner', header: ({ column }) => <DataTableColumnHeader column={column} label="상대 소유주 · 계좌" />, cell: ({ row }) => <div className="min-w-[170px] text-xs"><p>{row.original.counterpartyOwner}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{row.original.counterpartyAccount}</p></div> },
    { id: 'direction', accessorKey: 'direction', header: ({ column }) => <DataTableColumnHeader column={column} label="방향" />, cell: ({ row }) => <Badge variant="outline" className="font-normal">{row.original.direction}</Badge> },
    { id: 'amount', accessorKey: 'usd', header: ({ column }) => <DataTableColumnHeader column={column} label="금액 (USD)" className="ml-auto" />, cell: ({ row }) => <div className="text-right text-sm tabular-nums">{usd(row.original.usd)}</div> },
    { id: 'format', accessorKey: 'format', header: ({ column }) => <DataTableColumnHeader column={column} label="결제 수단" />, cell: ({ row }) => <span className="text-xs">{row.original.format}</span> },
    { id: 'risk', accessorFn: row => row.suspicious ? 1 : 0, header: ({ column }) => <DataTableColumnHeader column={column} label="상태" />, cell: ({ row }) => <Badge variant={row.original.suspicious ? 'destructive' : 'outline'}>{row.original.suspicious ? '의심' : '정상'}</Badge> },
    { id: 'alerts', accessorFn: row => row.recordIds.filter(id => recordMap.get(id)?.kind === 'Alert').length, header: ({ column }) => <DataTableColumnHeader column={column} label="연결 Alert" />, cell: ({ row }) => <RecordLinks ids={row.original.recordIds.filter(id => recordMap.get(id)?.kind === 'Alert')} records={recordMap} onOpenRecord={onOpenRecord} /> },
    { id: 'episodes', accessorFn: row => row.recordIds.filter(id => recordMap.get(id)?.kind === 'Episode').length, header: ({ column }) => <DataTableColumnHeader column={column} label="연결 Episode" />, cell: ({ row }) => <RecordLinks ids={row.original.recordIds.filter(id => recordMap.get(id)?.kind === 'Episode')} records={recordMap} onOpenRecord={onOpenRecord} /> },
  ], [recordMap, onOpenRecord])

  const table = useReactTable({
    data: transactionRows, columns, getRowId: row => row.id,
    state: { rowSelection: selection, sorting, pagination }, onRowSelectionChange: setSelection, onSortingChange: setSorting, onPaginationChange: setPagination,
    enableRowSelection: true, autoResetPageIndex: true,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
  })
  const visibleTransactionCount = table.getRowModel().rows.length

  const selectOwner = (next: IndexedOwner) => { setSelectedOwner(next.name); const first = constrainedAccounts(next)[0] ?? (accountsByOwner.get(next.name) ?? [])[0]; setSelectedAccount(first?.id); setSelectedTransactionId(null); setSelection({}); setPagination(current => ({ ...current, pageIndex: 0 })) }
  const selectAccount = (next: IndexedAccount) => { setSelectedAccount(next.id); setSelectedTransactionId(null); setSelection({}); setPagination(current => ({ ...current, pageIndex: 0 })) }
  const selectTransaction = (next: TransactionView) => { const nextId = toggleSingleSelectedId(selectedTransactionId, next.id); setSelectedTransactionId(nextId); setSelection(nextId ? { [next.id]: true } : {}) }
  const applyControls = (nextQuery: string, nextRange: DateRange | undefined, nextFilters: TransactionFilter[]) => { setQuery(nextQuery); setRange(nextRange); setFilters(nextFilters); setSelectedTransactionId(null); setSelection({}); setPagination(current => ({ ...current, pageIndex: 0 })) }
  const resetControls = () => applyControls('', undefined, [])
  const addFilter = () => { const next = filters.some(item => item.field === filterField && item.value === filterValue) ? filters : [...filters, { field: filterField, value: filterValue }]; applyControls(query, range, next); setFilterOpen(false) }

  return <div className="flex flex-col gap-5" data-testid="transactions-table">
    <PageHeading title="거래 내역" description="소유주에서 계좌와 거래로 이어지는 구조를 단계별로 확인합니다." />
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-sm"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="거래 내역 검색" value={query} onChange={event => applyControls(event.target.value, range, filters)} placeholder="거래 ID, 소유주, 계좌 검색" className="h-9 pl-9 text-xs" /></div>
      <DateRangeButton value={range} onChange={next => applyControls(query, next, filters)} />
      <Popover open={filterOpen} onOpenChange={setFilterOpen}><PopoverTrigger asChild><Button type="button" variant="outline" size="sm" className="transaction-filter-trigger date-range-control h-9"><ListFilter className="size-3.5" />필터{filters.length > 0 && <Badge className="ml-1 h-5 min-w-5 px-1.5">{filters.length}</Badge>}</Button></PopoverTrigger><PopoverContent align="start" className="w-72 space-y-3"><Label>조건 추가</Label><Select value={filterField} onValueChange={value => { const field = value as TransactionFilterField; setFilterField(field); setFilterValue(filterValues[field][0]) }}><SelectTrigger className="w-full" aria-label="거래 내역 필터 항목"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(filterLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select><Select value={filterValue} onValueChange={setFilterValue}><SelectTrigger className="w-full" aria-label="거래 내역 필터 값"><SelectValue /></SelectTrigger><SelectContent>{filterValues[filterField].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select><Button className="w-full" size="sm" onClick={addFilter}>조건 적용</Button></PopoverContent></Popover>
      {(query || range?.from || filters.length > 0) && <Button type="button" variant="ghost" size="sm" onClick={resetControls}><X className="size-3.5" />전체 보기</Button>}
    </div>
    {filters.length > 0 && <div className="flex flex-wrap items-center gap-2">{filters.map((filter, index) => <FilterChip key={`${filter.field}-${filter.value}`} onRemove={() => applyControls(query, range, filters.filter((_, current) => current !== index))}>{filterLabels[filter.field]}: {filter.value}</FilterChip>)}</div>}
    <FloatingExplorer>
      <div data-testid="transactions-flow" className="grid min-w-[1700px] grid-cols-[220px_36px_240px_36px_minmax(1136px,1fr)] items-stretch gap-3">
        <section data-testid="owner-section" data-shine="off" className="glass-surface min-w-0 overflow-hidden rounded-xl border"><SectionHeader title="소유주" count={visibleOwners.length} description="소유주를 선택해 계좌 확인" /><div className="max-h-[610px] overflow-y-auto p-2">{visibleOwners.map(item => <button key={item.name} type="button" aria-pressed={item.name === owner?.name} onClick={() => selectOwner(item)} className={`transaction-stage-item w-full rounded-lg px-3 py-3 text-left transition-colors ${item.name === owner?.name ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60'}`}><span className="block truncate text-sm font-medium">{item.name}</span><span className="mt-1 block text-[11px] text-muted-foreground">계좌 {item.accountIds.length}개 · 거래 {item.transactionIds.length}건</span></button>)}</div></section>
        <StageConnector id="owner-account-connector" sourceIndex={Math.max(0, visibleOwners.findIndex(item => item.name === owner?.name))} targetCount={ownerAccounts.length} targetKind="card" />
        <section data-testid="account-section" data-shine="off" className="glass-surface min-w-0 overflow-hidden rounded-xl border"><SectionHeader title="계좌" count={ownerAccounts.length} description={owner ? `${owner.name}의 계좌` : '소유주를 선택하세요'} /><div className="max-h-[610px] overflow-y-auto p-2">{ownerAccounts.map(item => <button key={item.id} type="button" aria-pressed={item.id === account?.id} onClick={() => selectAccount(item)} className={`transaction-stage-item w-full rounded-lg px-3 py-3 text-left transition-colors ${item.id === account?.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60'}`}><span className="block font-mono text-sm">{item.id}</span><span className="mt-1 block text-[11px] text-muted-foreground">은행 {item.bank} · 거래 {item.transactionIds.length}건</span></button>)}</div></section>
        <StageConnector id="account-transaction-connector" sourceIndex={Math.max(0, ownerAccounts.findIndex(item => item.id === account?.id))} targetCount={visibleTransactionCount} targetKind="table" />
        <section data-testid="transaction-section" data-shine="off" className="transaction-section glass-surface min-w-0 overflow-hidden rounded-xl border"><SectionHeader title="거래" count={transactionRows.length} description={account ? `${account.id}의 거래 내역` : '계좌를 선택하세요'} /><div className="p-3"><DataTable table={table} tableClassName="min-w-[1156px]" onRowClick={selectTransaction} data-testid="transaction-list-table" /></div></section>
      </div>
    </FloatingExplorer>
    {selected && <Card className="border-foreground/30" data-testid="selected-transaction"><CardHeader><CardTitle className="text-sm">선택한 거래</CardTitle><CardDescription className="font-mono">{selected.id}</CardDescription></CardHeader><CardContent className="grid gap-5 text-xs @3xl:grid-cols-2 @5xl:grid-cols-4"><div><p className="text-muted-foreground">거래 시각</p><p className="mt-1 tabular-nums">{selected.at}</p></div><div><p className="text-muted-foreground">금액</p><p className="mt-1 font-medium tabular-nums">{usd(selected.usd)}</p></div><div><p className="text-muted-foreground">결제 수단</p><p className="mt-1">{selected.format}</p></div><div><p className="text-muted-foreground">연결 Alert</p><div className="mt-1"><RecordLinks ids={selected.recordIds.filter(id => recordMap.get(id)?.kind === 'Alert')} records={recordMap} onOpenRecord={onOpenRecord} /></div></div><div><p className="text-muted-foreground">연결 Episode</p><div className="mt-1"><RecordLinks ids={selected.recordIds.filter(id => recordMap.get(id)?.kind === 'Episode')} records={recordMap} onOpenRecord={onOpenRecord} /></div></div><div><p className="text-muted-foreground">송금 소유주 · 계좌</p><p className="mt-1">{selected.fromOwner}</p><p className="font-mono text-muted-foreground">{selected.fromAccount}</p></div><div className="flex items-center justify-center"><ArrowRight className="size-4 text-muted-foreground" /><span className="sr-only">{compactUsd(selected.usd)}</span></div><div><p className="text-muted-foreground">수취 소유주 · 계좌</p><p className="mt-1">{selected.toOwner}</p><p className="font-mono text-muted-foreground">{selected.toAccount}</p></div></CardContent></Card>}
  </div>
}
