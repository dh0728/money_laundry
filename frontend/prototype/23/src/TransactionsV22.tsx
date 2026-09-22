import { useEffect, useMemo, useRef, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { ArrowRight, ListFilter, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toggleSingleSelectedId } from '@/components/data-table/data-table'
import { OrthogonalConnector, StageItem, StagePanel } from '@/components/transaction-stage'
import { type RecordItem } from './domain'
import { DateRangeButton, FilterChip, PageHeading } from './shared'
import { buildTransactionIndex, type TransactionIndex, type TransactionTarget } from './transactionIndex'
import { formatMoney } from './v23-domain'

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

export function passesFilters(row: TransactionView, range: DateRange | undefined, filters: TransactionFilter[]) {
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

function RecordLinks({ ids, kind, records, onOpenRecord }: { ids: string[]; kind: 'Alert' | 'Episode'; records: Map<string, RecordItem>; onOpenRecord?: (record: RecordItem) => void }) {
  return <div className="flex flex-wrap gap-2">{ids.map(id => {
    const record = records.get(id)
    return <Button key={id} type="button" variant="outline" size="sm" className="record-link h-8 rounded-full px-3 font-mono text-xs" aria-label={`${id} 상세 보기`} disabled={!record || !onOpenRecord} onClick={event => { event.stopPropagation(); if (record) onOpenRecord?.(record) }}>{kind} · {id}</Button>
  })}</div>
}

function LinkedRecordActions({ transaction, records, onOpenRecord }: { transaction: IndexedTransaction; records: Map<string, RecordItem>; onOpenRecord?: (record: RecordItem) => void }) {
  const alerts = transaction.recordIds.filter(id => records.get(id)?.kind === 'Alert')
  const episodes = transaction.recordIds.filter(id => records.get(id)?.kind === 'Episode')
  if (!alerts.length && !episodes.length) return null
  return <div data-testid="linked-record-actions" className="flex flex-wrap gap-3 border-t pt-3">
    {alerts.length > 0 && <div className="space-y-1.5"><p className="text-[var(--text-micro-size)] text-muted-foreground">연결 Alert</p><RecordLinks ids={alerts} kind="Alert" records={records} onOpenRecord={onOpenRecord} /></div>}
    {episodes.length > 0 && <div className="space-y-1.5"><p className="text-[var(--text-micro-size)] text-muted-foreground">연결 Episode</p><RecordLinks ids={episodes} kind="Episode" records={records} onOpenRecord={onOpenRecord} /></div>}
  </div>
}

function ownerMatches(owner: IndexedOwner, query: string, accounts: IndexedAccount[], transactions: IndexedTransaction[]) {
  if (!query) return true
  const q = query.toLowerCase()
  return owner.name.toLowerCase().includes(q)
    || accounts.some(account => owner.accountIds.includes(account.id) && `${account.id} ${account.bank}`.toLowerCase().includes(q))
    || transactions.some(transaction => owner.transactionIds.includes(transaction.id) && `${transaction.id} ${transaction.fromOwner} ${transaction.toOwner} ${transaction.fromAccount} ${transaction.toAccount} ${transaction.format}`.toLowerCase().includes(q))
}

export function selectedOwnerFirst<T extends { name: string }>(owners: readonly T[], selected?: string | null) {
  const current = owners.find(owner => owner.name === selected)
  return current ? [current, ...owners.filter(owner => owner !== current)] : owners
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
  const selectedOwnerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const next = targetSelection(index, target)
    setSelectedOwner(next.owner); setSelectedAccount(next.account); setSelectedTransactionId(next.transaction)
  }, [index, target])

  useEffect(() => {
    selectedOwnerRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedOwner])

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
  const displayedOwners = selectedOwnerFirst(visibleOwners, selectedOwner)
  const owner = visibleOwners.find(item => item.name === selectedOwner)
  const ownerAccounts = owner ? (accountsByOwner.get(owner.name) ?? []).filter(account => {
    const q = query.trim().toLowerCase()
    const textMatch = !q || owner.name.toLowerCase().includes(q) || `${account.id} ${account.bank}`.toLowerCase().includes(q) || (viewsByAccount.get(account.id) ?? []).some(transaction => `${transaction.id} ${transaction.fromOwner} ${transaction.toOwner} ${transaction.fromAccount} ${transaction.toAccount} ${transaction.format}`.toLowerCase().includes(q))
    return textMatch && (viewsByAccount.get(account.id) ?? []).some(view => passesFilters(view, range, filters))
  }) : []
  const account = ownerAccounts.find(item => item.id === selectedAccount)
  const transactionRows = useMemo(() => account ? (viewsByAccount.get(account.id) ?? []).filter(view => {
    const q = query.trim().toLowerCase()
    const textMatch = !q || owner?.name.toLowerCase().includes(q) || `${account.id} ${account.bank}`.toLowerCase().includes(q) || `${view.id} ${view.fromOwner} ${view.toOwner} ${view.fromAccount} ${view.toAccount} ${view.format}`.toLowerCase().includes(q)
    return textMatch && passesFilters(view, range, filters)
  }) : [], [account, filters, owner?.name, query, range, viewsByAccount])
  const selected = index.transactions.find(item => item.id === selectedTransactionId)
  const filterValues = useMemo<Record<TransactionFilterField, string[]>>(() => ({ direction: ['송금', '수취'], status: ['의심', '정상'], format: [...new Set(index.transactions.map(item => item.format))].sort() }), [index.transactions])

  const selectOwner = (next: IndexedOwner) => {
    const nextName = toggleSingleSelectedId(selectedOwner, next.name) ?? undefined
    setSelectedOwner(nextName)
    const first = nextName ? constrainedAccounts(next)[0] ?? (accountsByOwner.get(next.name) ?? [])[0] : undefined
    setSelectedAccount(first?.id); setSelectedTransactionId(null)
  }
  const selectAccount = (next: IndexedAccount) => { setSelectedAccount(toggleSingleSelectedId(selectedAccount, next.id) ?? undefined); setSelectedTransactionId(null) }
  const selectTransaction = (next: TransactionView) => setSelectedTransactionId(toggleSingleSelectedId(selectedTransactionId, next.id))
  const applyControls = (nextQuery: string, nextRange: DateRange | undefined, nextFilters: TransactionFilter[]) => { setQuery(nextQuery); setRange(nextRange); setFilters(nextFilters); setSelectedTransactionId(null) }
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
    <div data-testid="transactions-explorer" className="transactions-explorer">
      <div data-testid="transactions-flow" className="transactions-flow grid gap-3">
        <StagePanel testId="owner-section" bodyTestId="owner-scroll-list" bodyClassName="transaction-owner-scroll" title="소유주" count={visibleOwners.length} description="소유주를 선택해 계좌 확인">{displayedOwners.map(item => <StageItem key={item.name} testId="owner-item" itemRef={item.name === owner?.name ? selectedOwnerRef : undefined} active={item.name === owner?.name} primary={item.name} secondary={`계좌 ${item.accountIds.length}개 · 거래 ${item.transactionIds.length}건`} onSelect={() => selectOwner(item)} />)}</StagePanel>
        <OrthogonalConnector id="owner-account-connector" sourceIndex={displayedOwners.findIndex(item => item.name === owner?.name)} targetCount={ownerAccounts.length} targetOffset={110} activeTargetIndex={ownerAccounts.findIndex(item => item.id === account?.id)} />
        <StagePanel testId="account-section" title="계좌" count={ownerAccounts.length} description={owner ? `${owner.name}의 계좌` : '소유주를 선택하세요'}>{ownerAccounts.map(item => <StageItem key={item.id} testId="account-item" active={item.id === account?.id} primary={item.id} secondary={`은행 ${item.bank} · 거래 ${item.transactionIds.length}건`} mono onSelect={() => selectAccount(item)} />)}</StagePanel>
        <OrthogonalConnector id="account-transaction-connector" sourceIndex={ownerAccounts.findIndex(item => item.id === account?.id)} targetCount={transactionRows.length} targetOffset={110} activeTargetIndex={transactionRows.findIndex(item => item.id === selectedTransactionId)} />
        <StagePanel testId="transaction-section" title="거래" count={transactionRows.length} description={account ? `${account.id}의 거래 내역` : '계좌를 선택하세요'}><div data-testid="transaction-list">{transactionRows.map(item => <StageItem key={item.id} testId="transaction-item" active={item.id === selectedTransactionId} primary={item.id} secondary={`${item.at} · ${formatMoney(item.amount, item.currency)}`} trailing={<Badge aria-label={item.direction} variant="outline" className="font-normal text-inherit">{item.direction}</Badge>} mono onSelect={() => selectTransaction(item)} />)}</div></StagePanel>
        <Card className="transaction-detail self-start" data-testid="transaction-detail"><CardHeader><CardTitle className="text-sm">선택 거래 상세</CardTitle><CardDescription className={selected ? 'font-mono' : ''}>{selected?.id ?? '거래를 선택하세요'}</CardDescription>{selected && <LinkedRecordActions transaction={selected} records={recordMap} onOpenRecord={onOpenRecord} />}</CardHeader>{selected && <CardContent data-testid="selected-transaction" className="grid gap-5 text-xs"><div><p className="text-muted-foreground">거래 시각</p><p className="mt-1 tabular-nums">{selected.at}</p></div><div><p className="text-muted-foreground">금액</p><p className="mt-1 font-medium tabular-nums">{formatMoney(selected.amount, selected.currency)}</p></div><div><p className="text-muted-foreground">송금 소유주 · 계좌</p><p className="mt-1">{selected.fromOwner}</p><p className="font-mono text-muted-foreground">{selected.fromAccount}</p></div><div className="flex items-center gap-2"><ArrowRight className="size-4 text-muted-foreground" /><span className="sr-only">{formatMoney(selected.amount, selected.currency)}</span></div><div><p className="text-muted-foreground">수취 소유주 · 계좌</p><p className="mt-1">{selected.toOwner}</p><p className="font-mono text-muted-foreground">{selected.toAccount}</p></div><div><p className="text-muted-foreground">결제 수단</p><p className="mt-1">{selected.format}</p></div><div><p className="text-muted-foreground">상태</p><Badge className="mt-1" variant={selected.suspicious ? 'destructive' : 'outline'}>{selected.suspicious ? '의심' : '정상'}</Badge></div></CardContent>}</Card>
      </div>
    </div>
  </div>
}
