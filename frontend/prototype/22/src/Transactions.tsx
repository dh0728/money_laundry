import { useEffect, useMemo, useRef, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import {
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ExpandedState,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowRight, ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, CornerDownRight, ListFilter, Search, X } from 'lucide-react'
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
import { DateRangeButton, FilterChip } from './shared'
import { buildTransactionIndex, type TransactionIndex, type TransactionTarget } from './transactionIndex'

type IndexedTransaction = TransactionIndex['transactions'][number]
type TransactionFilterField = 'direction' | 'status' | 'format'
type TransactionFilter = { field: TransactionFilterField; value: string }
type TreeRow = {
  key: string
  kind: 'owner' | 'account' | 'transaction'
  label: string
  description: string
  owner: string
  account?: string
  transactionId?: string
  at?: string
  counterpartyOwner?: string
  counterpartyAccount?: string
  direction?: '송금' | '수취'
  amount?: number
  format?: string
  suspicious?: boolean
  recordIds?: string[]
  children?: TreeRow[]
}

const ownerKey = (owner: string) => `owner:${owner}`
const accountKey = (account: string) => `account:${account}`
const transactionKey = (account: string, transactionId: string) => `transaction:${account}:${transactionId}`
const filterLabels: Record<TransactionFilterField, string> = { direction: '방향', status: '상태', format: '결제 수단' }
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const muted = (text: string) => <span className="text-xs text-muted-foreground">{text}</span>

function transactionRow(transaction: IndexedTransaction, account: TransactionIndex['accounts'][number]): TreeRow {
  const outgoing = transaction.fromAccount === account.id
  return {
    key: transactionKey(account.id, transaction.id), kind: 'transaction', label: transaction.id,
    description: `${transaction.fromAccount} → ${transaction.toAccount}`, owner: account.owner, account: account.id,
    transactionId: transaction.id, at: transaction.at,
    counterpartyOwner: outgoing ? transaction.toOwner : transaction.fromOwner,
    counterpartyAccount: outgoing ? transaction.toAccount : transaction.fromAccount,
    direction: outgoing ? '송금' : '수취', amount: transaction.usd, format: transaction.format,
    suspicious: transaction.suspicious, recordIds: transaction.recordIds,
  }
}

export function transactionPassesFilters(
  row: { at?: string; direction?: '송금' | '수취'; suspicious?: boolean; format?: string },
  range: DateRange | undefined,
  filters: TransactionFilter[],
) {
  if (!row.at) return false
  const day = row.at.slice(0, 10)
  if (range?.from && day < dateKey(range.from)) return false
  if (range?.to && day > dateKey(range.to)) return false
  return filters.every(filter => {
    if (filter.field === 'direction') return row.direction === filter.value
    if (filter.field === 'status') return (row.suspicious ? '의심' : '정상') === filter.value
    return row.format === filter.value
  })
}

function buildRows(index: TransactionIndex, query: string, range?: DateRange, filters: TransactionFilter[] = []): TreeRow[] {
  const q = query.trim().toLowerCase()
  const constrained = Boolean(range?.from || filters.length)
  const transactions = new Map(index.transactions.map(item => [item.id, item] as const))
  return index.owners.flatMap(owner => {
    const ownerMatches = owner.name.toLowerCase().includes(q)
    const accounts = index.accounts.filter(account => owner.accountIds.includes(account.id)).flatMap(account => {
      const accountMatches = `${account.id} ${account.bank}`.toLowerCase().includes(q)
      const children = account.transactionIds.flatMap(id => {
        const transaction = transactions.get(id)
        if (!transaction) return []
        const row = transactionRow(transaction, account)
        const transactionMatches = `${transaction.id} ${transaction.fromAccount} ${transaction.toAccount} ${transaction.fromOwner} ${transaction.toOwner} ${transaction.format}`.toLowerCase().includes(q)
        const matchesText = !q || ownerMatches || accountMatches || transactionMatches
        return matchesText && transactionPassesFilters(row, range, filters) ? [row] : []
      })
      if ((q && !ownerMatches && !accountMatches && children.length === 0) || (constrained && children.length === 0)) return []
      return [{
        key: accountKey(account.id), kind: 'account' as const, label: account.id,
        description: `은행 ${account.bank} · 거래 ${children.length}건`, owner: owner.name,
        account: account.id, recordIds: account.recordIds, children,
      }]
    })
    if ((q && !ownerMatches && accounts.length === 0) || (constrained && accounts.length === 0)) return []
    const visibleTransactions = accounts.reduce((total, account) => total + (account.children?.length ?? 0), 0)
    return [{
      key: ownerKey(owner.name), kind: 'owner' as const, label: owner.name,
      description: `계좌 ${accounts.length}개 · 거래 ${visibleTransactions}건`, owner: owner.name,
      recordIds: owner.recordIds, children: accounts,
    }]
  })
}

function targetFocus(index: TransactionIndex, target?: TransactionTarget) {
  let owner: string | undefined
  let account: string | undefined
  let transactionId: string | undefined
  if (target?.type === 'owner') owner = target.owner
  if (target?.type === 'account') {
    const found = index.accounts.find(item => item.id === target.account)
    owner = found?.owner; account = found?.id
  }
  if (target?.type === 'transaction') {
    const found = index.transactions.find(item => item.id === target.transactionId)
    owner = found?.fromOwner; account = found?.fromAccount; transactionId = found?.id
  }
  const expanded: ExpandedState = {}
  const selection: RowSelectionState = {}
  if (owner) expanded[ownerKey(owner)] = true
  if (account) expanded[accountKey(account)] = true
  if (account && transactionId) selection[transactionKey(account, transactionId)] = true
  return { owner, transactionId, expanded, selection }
}

export function transactionNavigationState(index: TransactionIndex, target?: TransactionTarget, pageSize = 20) {
  const focus = targetFocus(index, target)
  const ownerIndex = Math.max(0, index.owners.findIndex(item => item.name === focus.owner))
  return {
    query: '', sorting: [] as SortingState, expanded: focus.expanded, selection: focus.selection,
    transactionId: focus.transactionId, pagination: { pageIndex: Math.floor(ownerIndex / pageSize), pageSize },
  }
}

function searchExpansion(rows: TreeRow[]) {
  const expanded: ExpandedState = {}
  for (const owner of rows) {
    expanded[owner.key] = true
    for (const account of owner.children ?? []) expanded[account.key] = true
  }
  return expanded
}

function RecordLinks({ ids, records, onOpenRecord }: { ids: string[]; records: Map<string, RecordItem>; onOpenRecord?: (record: RecordItem) => void }) {
  if (!ids.length) return muted('없음')
  return <div className="flex max-w-[220px] flex-wrap gap-x-2 gap-y-1">
    {ids.map(id => {
      const record = records.get(id)
      return <Button key={id} type="button" variant="link" size="sm" className="record-link h-auto p-0 font-mono text-[11px] !text-inherit underline" aria-label={`${id} 상세 보기`} disabled={!record || !onOpenRecord} onClick={event => { event.stopPropagation(); if (record) onOpenRecord?.(record) }}>{id}</Button>
    })}
  </div>
}

const recordIds = (row: TreeRow, records: Map<string, RecordItem>, kind: RecordItem['kind']) => (row.recordIds ?? []).filter(id => records.get(id)?.kind === kind)
const childCount = (row: TreeRow) => row.kind === 'owner' ? (row.children ?? []).reduce((total, account) => total + (account.children?.length ?? 0), 0) : row.children?.length ?? 0
const detailHint = (row: TreeRow, ownerText: string, accountText: string) => muted(row.kind === 'owner' ? ownerText : accountText)

function createColumns(recordMap: Map<string, RecordItem>, onOpenRecord?: (record: RecordItem) => void): ColumnDef<TreeRow>[] {
  return [
    {
      id: 'hierarchy', size: 56, enableSorting: false,
      header: ({ table }) => {
        const allExpanded = table.getIsAllRowsExpanded()
        const label = allExpanded ? '전체 접기' : '전체 펼치기'
        return <Button data-testid="hierarchy-toggle-all" type="button" variant="ghost" className="h-10 w-full gap-1 rounded-none px-1 text-[11px] font-medium text-muted-foreground" aria-label={label} aria-expanded={allExpanded} title={label} onClick={() => table.toggleAllRowsExpanded(!allExpanded)}><span>계층</span>{allExpanded ? <ChevronsUp className="size-3" /> : <ChevronsDown className="size-3" />}</Button>
      },
      cell: ({ row }) => row.original.kind === 'transaction'
        ? <span data-testid="hierarchy-transaction" className="flex justify-center text-muted-foreground" aria-label="거래 하위 항목"><CornerDownRight className="size-3.5" /></span>
        : <Button data-testid={row.original.kind === 'owner' ? 'hierarchy-owner' : 'hierarchy-account'} type="button" variant="ghost" size="icon" className="mx-auto flex size-7" aria-label={`${row.original.label} ${row.getIsExpanded() ? '접기' : '펼치기'}`} onClick={event => { event.stopPropagation(); row.toggleExpanded() }}>{row.getIsExpanded() ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</Button>,
    },
    {
      id: 'owner', accessorFn: row => row.owner,
      header: ({ column }) => <DataTableColumnHeader column={column} label="소유주" />,
      cell: ({ row }) => row.original.kind === 'owner' ? <div className="min-w-[210px]">
        <span className="block truncate text-sm font-medium">{row.original.label}</span><span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{row.original.description}</span>
      </div> : <div className="min-w-[210px] text-xs text-muted-foreground">{row.original.owner}</div>,
    },
    {
      id: 'account', accessorKey: 'account',
      header: ({ column }) => <DataTableColumnHeader column={column} label="계좌" />,
      cell: ({ row }) => row.original.kind === 'account' ? <div className="min-w-[190px]">
        <span className="block truncate font-mono text-sm">{row.original.label}</span><span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{row.original.description}</span>
      </div> : row.original.kind === 'transaction' ? <div className="min-w-[190px] font-mono text-xs text-muted-foreground">{row.original.account}</div> : muted(`${row.original.children?.length ?? 0}개 계좌`),
    },
    {
      id: 'transaction', accessorKey: 'transactionId',
      header: ({ column }) => <DataTableColumnHeader column={column} label="거래 ID" />,
      cell: ({ row }) => row.original.kind === 'transaction' ? <div className="min-w-[190px]">
        <span className="block font-mono text-sm">{row.original.transactionId}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{row.original.description}</span>
      </div> : muted(`${childCount(row.original)}건 거래`),
    },
    { id: 'at', accessorKey: 'at', header: ({ column }) => <DataTableColumnHeader column={column} label="일시" />, cell: ({ row }) => row.original.kind === 'transaction' ? <span className="whitespace-nowrap text-xs tabular-nums">{row.original.at}</span> : muted(row.original.kind === 'owner' ? '소유주 기준' : '계좌 기준') },
    { id: 'counterparty', accessorFn: row => row.counterpartyOwner ?? '', header: ({ column }) => <DataTableColumnHeader column={column} label="상대 소유주 · 계좌" />, cell: ({ row }) => row.original.kind === 'transaction' ? <div className="min-w-[180px] text-xs"><p className="truncate">{row.original.counterpartyOwner}</p><p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{row.original.counterpartyAccount}</p></div> : detailHint(row.original, '계좌를 펼쳐 확인', '거래를 펼쳐 확인') },
    { id: 'direction', accessorKey: 'direction', header: ({ column }) => <DataTableColumnHeader column={column} label="방향" />, cell: ({ row }) => row.original.direction ? <Badge variant="outline" className="font-normal">{row.original.direction}</Badge> : detailHint(row.original, '계좌별 방향', '거래별 방향') },
    { id: 'amount', accessorKey: 'amount', header: ({ column }) => <DataTableColumnHeader column={column} label="금액 (USD)" className="ml-auto" />, cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.amount === undefined ? detailHint(row.original, '거래를 펼쳐 확인', '거래를 펼쳐 확인') : usd(row.original.amount)}</div> },
    { id: 'format', accessorKey: 'format', header: ({ column }) => <DataTableColumnHeader column={column} label="결제 수단" />, cell: ({ row }) => row.original.format ? <span className="text-xs">{row.original.format}</span> : detailHint(row.original, '계좌를 펼쳐 확인', '거래를 펼쳐 확인') },
    { id: 'risk', accessorFn: row => row.suspicious ? 1 : 0, header: ({ column }) => <DataTableColumnHeader column={column} label="위험 / 상태" />, cell: ({ row }) => row.original.kind === 'transaction' ? <Badge variant={row.original.suspicious ? 'destructive' : 'outline'}>{row.original.suspicious ? '의심' : '정상'}</Badge> : detailHint(row.original, '계좌를 펼쳐 확인', '거래를 펼쳐 확인') },
    { id: 'alerts', accessorFn: row => recordIds(row, recordMap, 'Alert').length, header: ({ column }) => <DataTableColumnHeader column={column} label="연결 Alert" />, cell: ({ row }) => row.original.kind === 'transaction' ? <RecordLinks ids={recordIds(row.original, recordMap, 'Alert')} records={recordMap} onOpenRecord={onOpenRecord} /> : detailHint(row.original, '거래를 펼쳐 확인', '거래를 펼쳐 확인') },
    { id: 'episodes', accessorFn: row => recordIds(row, recordMap, 'Episode').length, header: ({ column }) => <DataTableColumnHeader column={column} label="연결 Episode" />, cell: ({ row }) => row.original.kind === 'transaction' ? <RecordLinks ids={recordIds(row.original, recordMap, 'Episode')} records={recordMap} onOpenRecord={onOpenRecord} /> : detailHint(row.original, '거래를 펼쳐 확인', '거래를 펼쳐 확인') },
  ]
}

export function LegacyTransactions({ records, target, onOpenRecord }: { records: RecordItem[]; target?: TransactionTarget; onOpenRecord?: (record: RecordItem) => void }) {
  const index = useMemo(() => buildTransactionIndex(records), [records])
  const initial = useMemo(() => transactionNavigationState(index, target), [index, target])
  const recordMap = useMemo(() => new Map(records.map(record => [record.id, record] as const)), [records])
  const columns = useMemo(() => createColumns(recordMap, onOpenRecord), [recordMap, onOpenRecord])
  const [query, setQuery] = useState(initial.query)
  const [range, setRange] = useState<DateRange>()
  const [filters, setFilters] = useState<TransactionFilter[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterField, setFilterField] = useState<TransactionFilterField>('direction')
  const [filterValue, setFilterValue] = useState('송금')
  const [expanded, setExpanded] = useState<ExpandedState>(initial.expanded)
  const [selection, setSelection] = useState<RowSelectionState>(initial.selection)
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null | undefined>(initial.transactionId)
  const [sorting, setSorting] = useState<SortingState>(initial.sorting)
  const [pagination, setPagination] = useState(initial.pagination)
  const pageSizeRef = useRef(pagination.pageSize)
  pageSizeRef.current = pagination.pageSize
  const [targetActive, setTargetActive] = useState(Boolean(target))
  const rows = useMemo(() => buildRows(index, query, range, filters), [index, query, range, filters])
  const selected = index.transactions.find(item => item.id === selectedTransactionId)
  const filterValues = useMemo<Record<TransactionFilterField, string[]>>(() => ({
    direction: ['송금', '수취'], status: ['의심', '정상'], format: [...new Set(index.transactions.map(item => item.format))].sort(),
  }), [index])

  useEffect(() => {
    const next = transactionNavigationState(index, target, pageSizeRef.current)
    setQuery(next.query); setRange(undefined); setFilters([]); setSorting(next.sorting); setExpanded(next.expanded); setSelection(next.selection)
    setSelectedTransactionId(next.transactionId); setPagination(next.pagination); setTargetActive(Boolean(target))
  }, [index, target])

  const table = useReactTable({
    data: rows, columns, getSubRows: row => row.children, getRowId: row => row.key,
    state: { expanded, rowSelection: selection, sorting, pagination },
    onExpandedChange: setExpanded, onRowSelectionChange: setSelection, onSortingChange: setSorting, onPaginationChange: setPagination,
    enableRowSelection: row => row.original.kind === 'transaction', autoResetPageIndex: false,
    pageCount: Math.max(1, Math.ceil(rows.length / pagination.pageSize)), paginateExpandedRows: false,
    getCoreRowModel: getCoreRowModel(), getExpandedRowModel: getExpandedRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
  })

  const selectRow = (row: TreeRow) => {
    if (row.kind !== 'transaction' || !row.transactionId) {
      setExpanded(current => ({ ...(typeof current === 'boolean' ? {} : current), [row.key]: !(typeof current === 'boolean' ? current : current[row.key]) }))
      return
    }
    const nextId = toggleSingleSelectedId(selectedTransactionId, row.transactionId)
    setSelectedTransactionId(nextId); setSelection(nextId ? { [row.key]: true } : {})
  }

  const applyControls = (nextQuery: string, nextRange: DateRange | undefined, nextFilters: TransactionFilter[]) => {
    setQuery(nextQuery); setRange(nextRange); setFilters(nextFilters); setTargetActive(false)
    const filtered = buildRows(index, nextQuery, nextRange, nextFilters)
    setExpanded(nextQuery.trim() || nextRange?.from || nextFilters.length ? searchExpansion(filtered) : {})
    setSelection({}); setSelectedTransactionId(null); setPagination(current => ({ ...current, pageIndex: 0 }))
  }
  const resetControls = () => applyControls('', undefined, [])
  const addFilter = () => {
    const next = filters.some(item => item.field === filterField && item.value === filterValue) ? filters : [...filters, { field: filterField, value: filterValue }]
    applyControls(query, range, next); setFilterOpen(false)
  }
  const controlsActive = Boolean(query || range?.from || filters.length || targetActive)

  return (
    <div className="flex flex-col gap-5" data-testid="transactions-table">
      <div><h1 className="text-xl font-semibold tracking-tight">Transactions</h1><p className="mt-1.5 text-xs text-muted-foreground">소유주와 계좌를 펼쳐 연결 거래와 AML 업무를 확인할 수 있습니다.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Transactions 검색" value={query} onChange={event => applyControls(event.target.value, range, filters)} placeholder="거래 ID, 소유주, 계좌 검색" className="h-9 pl-9 text-xs" /></div>
        <DateRangeButton value={range} onChange={next => applyControls(query, next, filters)} />
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" className="transaction-filter-trigger date-range-control h-9"><ListFilter className="size-3.5" />필터{filters.length > 0 && <Badge className="ml-1 h-5 min-w-5 px-1.5">{filters.length}</Badge>}</Button></PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-3">
            <Label>조건 추가</Label>
            <Select value={filterField} onValueChange={value => { const field = value as TransactionFilterField; setFilterField(field); setFilterValue(filterValues[field][0]) }}><SelectTrigger className="w-full" aria-label="Transactions 필터 항목"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(filterLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select>
            <Select value={filterValue} onValueChange={setFilterValue}><SelectTrigger className="w-full" aria-label="Transactions 필터 값"><SelectValue /></SelectTrigger><SelectContent>{filterValues[filterField].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
            <Button className="w-full" size="sm" onClick={addFilter}>조건 적용</Button>
          </PopoverContent>
        </Popover>
        {controlsActive && <Button type="button" variant="ghost" size="sm" onClick={resetControls}><X className="size-3.5" />전체 보기</Button>}
      </div>
      {filters.length > 0 && <div className="flex flex-wrap items-center gap-2">{filters.map((filter, index) => <FilterChip key={`${filter.field}-${filter.value}`} onRemove={() => applyControls(query, range, filters.filter((_, current) => current !== index))}>{filterLabels[filter.field]}: {filter.value}</FilterChip>)}</div>}
      <DataTable table={table} tableClassName="min-w-[1800px]" onRowClick={selectRow} data-testid="transaction-tree-table" />
      {selected && <Card className="border-foreground/30" data-testid="selected-transaction">
        <CardHeader><CardTitle className="text-sm">선택한 거래</CardTitle><CardDescription className="font-mono">{selected.id}</CardDescription></CardHeader>
        <CardContent className="grid gap-5 text-xs @3xl:grid-cols-2 @5xl:grid-cols-4">
          <div><p className="text-muted-foreground">거래 시각</p><p className="mt-1 tabular-nums">{selected.at}</p></div><div><p className="text-muted-foreground">금액</p><p className="mt-1 font-medium tabular-nums">{usd(selected.usd)}</p></div><div><p className="text-muted-foreground">결제 수단</p><p className="mt-1">{selected.format}</p></div>
          <div><p className="text-muted-foreground">연결 Alert</p><div className="mt-1"><RecordLinks ids={selected.recordIds.filter(id => recordMap.get(id)?.kind === 'Alert')} records={recordMap} onOpenRecord={onOpenRecord} /></div></div>
          <div><p className="text-muted-foreground">연결 Episode</p><div className="mt-1"><RecordLinks ids={selected.recordIds.filter(id => recordMap.get(id)?.kind === 'Episode')} records={recordMap} onOpenRecord={onOpenRecord} /></div></div>
          <div><p className="text-muted-foreground">송금 소유주 · 계좌</p><p className="mt-1">{selected.fromOwner}</p><p className="font-mono text-muted-foreground">{selected.fromAccount}</p></div><div className="flex items-center justify-center"><ArrowRight className="size-4 text-muted-foreground" /><span className="sr-only">{compactUsd(selected.usd)}</span></div><div><p className="text-muted-foreground">수취 소유주 · 계좌</p><p className="mt-1">{selected.toOwner}</p><p className="font-mono text-muted-foreground">{selected.toAccount}</p></div>
        </CardContent>
      </Card>}
    </div>
  )
}

export { default } from './TransactionsV22'
