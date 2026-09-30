import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { ListFilter, Search, X } from 'lucide-react'
import { useSharedPeriod, useViewState } from '@/lib/workspaceState'
import { RefreshStatus } from '@/components/RefreshStatus'
import { fetchLedgerAccounts, fetchLedgerOwners, fetchLedgerTransactions, fetchPaymentFormats, type LedgerFilters, type LedgerTransaction } from '@/api/liveLedger'
import { EmptyBlock, ErrorBlock } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAsync } from '@/lib/useAsync'
import { StageItem, StagePanel } from '@/features/transactions/transaction-stage'
import TransactionMiniSankey from '@/features/transactions/TransactionMiniSankey'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DateRangeButton } from '@/components/DateRangeButton'
import { FilterChip } from '@/components/FilterChip'
import { OrthogonalConnector } from '@/features/transactions/transaction-stage'

const short = (id: string | undefined) => !id ? '—' : id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id
const emptyPage = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  return <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>전체 {total.toLocaleString('ko-KR')}건 · {page + 1}쪽</span><div className="flex gap-1"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => onChange(page - 1)}>이전</Button><Button variant="outline" size="sm" disabled={(page + 1) * 20 >= total} onClick={() => onChange(page + 1)}>다음</Button></div></div>
}

function StageSkeleton({ label }: { label: string }) {
  return <div role="status" aria-label={`${label} 불러오는 중`} className="space-y-2">{[0, 1, 2, 3].map(index => <div key={index} className="space-y-2 rounded-lg border p-3"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>)}</div>
}

function DetailSkeleton() {
  return <CardContent role="status" aria-label="거래 상세 불러오는 중" className="grid gap-5 text-xs">
    <div className="space-y-3 rounded-lg border p-4"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-16 w-full" /><Skeleton className="h-4 w-2/3" /></div>
    <div className="grid grid-cols-2 gap-4"><div><p className="text-muted-foreground">거래 시각</p><Skeleton className="mt-1 h-4 w-4/5" /></div><div><p className="text-muted-foreground">결제 수단</p><Skeleton className="mt-1 h-4 w-2/3" /></div></div>
    <div><p className="text-muted-foreground">상태</p><Skeleton className="mt-1 h-5 w-14" /></div>
  </CardContent>
}

export default function LiveLedgerPage({ onOpen }: { onOpen: (kind: 'ALERT' | 'EPISODE', id: number) => void }) {
  const [selectedTransaction, setSelectedTransaction] = useState<LedgerTransaction | null>(null)
  const [query, setQuery] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterField, setFilterField] = useState<'judgement' | 'payment'>('judgement')
  const [filterValue, setFilterValue] = useState('SUSPICIOUS')
  const { from, to, setPeriod } = useSharedPeriod()
  const [judgement, setJudgement] = useViewState<LedgerFilters['judgement']>('ledger/judgement', [])
  const [payments, setPayments] = useViewState<string[]>('ledger/payments', [])
  const scope = JSON.stringify([from, to, judgement, payments])
  const [owner, setOwner] = useViewState<string | null>(`ledger/owner/${scope}`, null)
  const [account, setAccount] = useViewState<string | null>(`ledger/account/${scope}`, null)
  const [ownerPage, setOwnerPage] = useViewState(`ledger/ownerPage/${scope}`, 0)
  const [accountPage, setAccountPage] = useViewState(`ledger/accountPage/${scope}`, 0)
  const [transactionPage, setTransactionPage] = useViewState(`ledger/transactionPage/${scope}`, 0)
  const base = { from: from || undefined, to: to || undefined, judgement, payments }
  const formats = useAsync(fetchPaymentFormats, [], { key: 'payment-formats' })
  const owners = useAsync(() => fetchLedgerOwners({ ...base, page: ownerPage }), [from, to, judgement, payments, ownerPage], { key: 'ledger/owners', enabled: Boolean(from && to) })
  const accounts = useAsync(() => owner ? fetchLedgerAccounts({ ...base, page: accountPage }, owner) : Promise.resolve(emptyPage), [from, to, judgement, payments, owner, accountPage], { key: 'ledger/accounts', enabled: Boolean(from && to) })
  const transactions = useAsync(() => account ? fetchLedgerTransactions({ ...base, page: transactionPage }, account) : Promise.resolve(emptyPage), [from, to, judgement, payments, account, transactionPage], { key: 'ledger/transactions', enabled: Boolean(from && to) })
  const chooseOwner = (id: string) => { setOwner(id); setAccount(null); setSelectedTransaction(null); setAccountPage(0); setTransactionPage(0) }
  const chooseAccount = (id: string) => { setAccount(id); setSelectedTransaction(null); setTransactionPage(0) }
  const updateJudgement = (value: NonNullable<LedgerFilters['judgement']>[number]) => {
    setJudgement(current => current?.includes(value) ? current.filter(item => item !== value) : [...(current ?? []), value])
    setSelectedTransaction(null)
    setOwnerPage(0); setAccountPage(0); setTransactionPage(0)
  }
  const updatePayment = (value: string) => {
    setPayments(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value])
    setSelectedTransaction(null)
    setOwnerPage(0); setAccountPage(0); setTransactionPage(0)
  }
  const day = (value: Date) => value.toLocaleDateString('sv-SE')
  const range: DateRange | undefined = from && to ? { from: new Date(`${from}T12:00:00`), to: new Date(`${to}T12:00:00`) } : undefined
  const setRange = (value: DateRange | undefined) => {
    setPeriod({ from: value?.from ? day(value.from) : '', to: value?.to ? day(value.to) : '' })
    setOwner(null); setAccount(null); setSelectedTransaction(null)
    setOwnerPage(0); setAccountPage(0); setTransactionPage(0)
  }
  const resetControls = () => {
    setQuery(''); setRange(undefined); setJudgement([]); setPayments([])
  }
  const filterCount = (judgement?.length ?? 0) + payments.length
  const applyFilter = () => {
    if (filterField === 'judgement') updateJudgement(filterValue as NonNullable<LedgerFilters['judgement']>[number])
    else updatePayment(filterValue)
    setFilterOpen(false)
  }
  const searchedOwners = owners.state.status === 'success' ? owners.state.data.content.filter(row => row.id.toLowerCase().includes(query.toLowerCase())) : []
  const searchedAccounts = accounts.state.status === 'success' ? accounts.state.data.content.filter(row => `${row.id} ${row.bankId}`.toLowerCase().includes(query.toLowerCase())) : []
  const searchedTransactions = transactions.state.status === 'success' ? transactions.state.data.content.filter(row => `${row.txId} ${row.fromOwnerId} ${row.toOwnerId} ${row.fromAccountId} ${row.toAccountId} ${row.paymentFormat}`.toLowerCase().includes(query.toLowerCase())) : []
  const currentOwner = owners.state.status === 'success' ? owners.state.data.content.find(row => row.id === owner) : null

  return <div className="space-y-5" data-testid="transactions-table">
    <RefreshStatus queries={[owners, accounts, transactions, formats]} />
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-sm"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="현재 페이지 거래 검색" value={query} onChange={event => setQuery(event.target.value)} placeholder="현재 페이지 ID, 소유주, 계좌 검색" className="h-9 pl-9 text-xs" /></div>
      <DateRangeButton value={range} onChange={setRange} today={to ? new Date(`${to}T12:00:00`) : new Date()} />
      <Popover open={filterOpen} onOpenChange={setFilterOpen}><PopoverTrigger asChild><Button type="button" variant="outline" size="sm" className="transaction-filter-trigger date-range-control h-9"><ListFilter className="size-3.5" />필터{filterCount > 0 && <Badge className="ml-1 h-5 min-w-5 px-1.5">{filterCount}</Badge>}</Button></PopoverTrigger><PopoverContent align="start" className="w-72 space-y-3"><Label>조건 추가</Label><Select value={filterField} onValueChange={value => { setFilterField(value as 'judgement' | 'payment'); setFilterValue(value === 'judgement' ? 'SUSPICIOUS' : formats.state.status === 'success' ? formats.state.data[0] ?? '' : '') }}><SelectTrigger className="w-full" aria-label="거래 내역 필터 항목"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="judgement">상태</SelectItem><SelectItem value="payment">결제 수단</SelectItem></SelectContent></Select><Select value={filterValue} onValueChange={setFilterValue}><SelectTrigger className="w-full" aria-label="거래 내역 필터 값"><SelectValue /></SelectTrigger><SelectContent>{filterField === 'judgement' ? <><SelectItem value="SUSPICIOUS">의심</SelectItem><SelectItem value="NORMAL">정상</SelectItem><SelectItem value="UNANALYZED">미분석</SelectItem></> : formats.state.status === 'success' ? formats.state.data.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>) : <Skeleton role="status" aria-label="결제 수단 불러오는 중" className="h-8 w-full" />}</SelectContent></Select><Button className="w-full" size="sm" disabled={!filterValue || filterField === 'payment' && formats.state.status !== 'success'} onClick={applyFilter}>조건 적용</Button></PopoverContent></Popover>
      {(query || range?.from || filterCount > 0) && <Button type="button" variant="ghost" size="sm" onClick={resetControls}><X className="size-3.5" />전체 보기</Button>}
      {formats.state.status === 'error' && <Button variant="outline" size="sm" onClick={formats.retry}>결제 수단 다시 불러오기</Button>}
    </div>
    {filterCount > 0 && <div className="flex flex-wrap items-center gap-2">{judgement?.map(value => <FilterChip key={value} onRemove={() => updateJudgement(value)}>상태: {{ SUSPICIOUS: '의심', NORMAL: '정상', UNANALYZED: '미분석' }[value]}</FilterChip>)}{payments.map(value => <FilterChip key={value} onRemove={() => updatePayment(value)}>결제 수단: {value}</FilterChip>)}</div>}
    <div data-testid="transactions-explorer" className="transactions-explorer"><div data-testid="transactions-flow" className="transactions-flow grid gap-3">
      <div className="relative self-start"><StagePanel title="소유주" count={owners.state.status === 'success' ? owners.state.data.totalElements : 0} testId="ledger-owner-stage"><div data-testid="selected-owner-item" aria-live="polite" className={`rounded-lg border px-3 py-3 text-sm ${owner ? 'border-foreground bg-foreground text-background' : 'border-dashed bg-muted/10 text-muted-foreground'}`}>{owner ? <><p className="truncate font-medium" title={owner}>{short(owner)}</p><p className="mt-1 text-[var(--text-micro-size)] text-background/70">{currentOwner ? '선택한 소유주' : '이전 페이지에서 선택한 소유주'}</p></> : '소유주를 선택해 주세요'}</div><div className="transaction-owner-scroll mt-4 border-t-2 border-border pt-4">{owners.state.status === 'loading' ? <StageSkeleton label="소유주" /> : owners.state.status === 'error' ? <ErrorBlock message={owners.state.message} onRetry={owners.retry} /> : <>{searchedOwners.length ? searchedOwners.map(row => <StageItem key={row.id} primary={short(row.id)} secondary="계좌·거래 수 데이터 없음" active={owner === row.id} mono onSelect={() => chooseOwner(row.id)} />) : <EmptyBlock>조회된 소유주가 없습니다.</EmptyBlock>}<Pager page={ownerPage} total={owners.state.data.totalElements} onChange={setOwnerPage} /></>}</div></StagePanel>{owners.state.status === 'loading' && <Skeleton role="status" aria-label="소유주 수 불러오는 중" className="absolute right-4 top-4 h-5 w-8" />}</div>
      <OrthogonalConnector id="owner-account-connector" sourceIndex={0} targetCount={searchedAccounts.length} targetOffset={110} activeTargetIndex={searchedAccounts.findIndex(row => row.id === account)} />
      <div className="relative self-start"><StagePanel title="계좌" count={accounts.state.status === 'success' ? accounts.state.data.totalElements : 0} description={owner ? `${short(owner)}의 계좌` : '소유주를 선택하세요'} testId="ledger-account-stage" bodyClassName="max-h-[680px] overflow-y-auto">{!owner ? <EmptyBlock>소유주를 선택해 주세요.</EmptyBlock> : accounts.state.status === 'loading' ? <StageSkeleton label="계좌" /> : accounts.state.status === 'error' ? <ErrorBlock message={accounts.state.message} onRetry={accounts.retry} /> : <>{searchedAccounts.length ? searchedAccounts.map(row => <StageItem key={row.id} primary={short(row.id)} secondary={`은행 ${row.bankId} · 거래 수 데이터 없음`} active={account === row.id} mono onSelect={() => chooseAccount(row.id)} />) : <EmptyBlock>조회된 계좌가 없습니다.</EmptyBlock>}<Pager page={accountPage} total={accounts.state.data.totalElements} onChange={setAccountPage} /></>}</StagePanel>{owner && accounts.state.status === 'loading' && <Skeleton role="status" aria-label="계좌 수 불러오는 중" className="absolute right-4 top-4 h-5 w-8" />}</div>
      <OrthogonalConnector id="account-transaction-connector" sourceIndex={searchedAccounts.findIndex(row => row.id === account)} targetCount={searchedTransactions.length} targetOffset={110} activeTargetIndex={searchedTransactions.findIndex(row => row.txId === selectedTransaction?.txId)} />
      <div className="relative self-start"><StagePanel title="거래" count={transactions.state.status === 'success' ? transactions.state.data.totalElements : 0} description={account ? `${short(account)}의 거래 내역` : '계좌를 선택하세요'} testId="ledger-transaction-stage" bodyClassName="max-h-[680px] overflow-y-auto">{!account ? <EmptyBlock>계좌를 선택해 주세요.</EmptyBlock> : transactions.state.status === 'loading' ? <StageSkeleton label="거래" /> : transactions.state.status === 'error' ? <ErrorBlock message={transactions.state.message} onRetry={transactions.retry} /> : <>{searchedTransactions.length ? searchedTransactions.map(row => <StageItem key={row.txId} primary={String(row.txId)} secondary={<><Badge variant="ghost" className="bg-foreground !border-transparent !text-background font-normal">{row.fromAccountId === account ? '송금' : '수취'}</Badge><Badge variant={row.judgement === 'SUSPICIOUS' ? 'destructive' : 'ghost'} className={row.judgement === 'SUSPICIOUS' ? '!border-transparent !text-destructive-foreground font-normal' : 'bg-foreground !border-transparent !text-background font-normal'}>{row.judgement === 'UNANALYZED' ? '미분석' : row.judgement === 'SUSPICIOUS' ? '의심' : '정상'}</Badge></>} active={selectedTransaction?.txId === row.txId} mono onSelect={() => setSelectedTransaction(current => current?.txId === row.txId ? null : row)} />) : <EmptyBlock>조회된 거래가 없습니다.</EmptyBlock>}<Pager page={transactionPage} total={transactions.state.data.totalElements} onChange={setTransactionPage} /></>}</StagePanel>{account && transactions.state.status === 'loading' && <Skeleton role="status" aria-label="거래 수 불러오는 중" className="absolute right-4 top-4 h-5 w-8" />}</div>
      <Card className="transaction-detail self-start" data-testid="transaction-detail">
        <CardHeader>
          <CardTitle className="text-sm">선택 거래 상세</CardTitle>
          <CardDescription className={selectedTransaction ? 'font-mono' : ''}>{selectedTransaction?.txId ?? (account && transactions.state.status === 'loading' ? <Skeleton role="status" aria-label="거래 ID 불러오는 중" className="h-4 w-28" /> : '거래를 선택하세요')}</CardDescription>
          {selectedTransaction && (selectedTransaction.alertIds.length > 0 || selectedTransaction.episodeIds.length > 0) && <div data-testid="linked-record-actions" className="flex flex-wrap gap-3 border-t pt-3">
            {selectedTransaction.alertIds.length > 0 && <div className="space-y-1.5"><p className="text-[var(--text-micro-size)] text-muted-foreground">연결 Alert</p><div className="flex flex-wrap gap-2">{selectedTransaction.alertIds.map(id => <Badge key={`alert-${id}`} variant="outline" className="record-link h-8 rounded-full px-3 font-mono text-xs" title="원본 Alert ID로, 조사 사건 ID와 다를 수 있습니다">Alert · A-{id}</Badge>)}</div></div>}
            {selectedTransaction.episodeIds.length > 0 && <div className="space-y-1.5"><p className="text-[var(--text-micro-size)] text-muted-foreground">연결 Episode</p><div className="flex flex-wrap gap-2">{selectedTransaction.episodeIds.map(id => <Button key={`episode-${id}`} variant="outline" size="sm" className="record-link h-8 rounded-full px-3 font-mono text-xs" onClick={() => onOpen('EPISODE', id)}>Episode · E-{id}</Button>)}</div></div>}
          </div>}
        </CardHeader>
        {account && transactions.state.status === 'loading' && !selectedTransaction && <DetailSkeleton />}
        {selectedTransaction && <CardContent data-testid="selected-transaction" className="grid gap-5 text-xs">
          <TransactionMiniSankey transaction={{ id: String(selectedTransaction.txId), amount: selectedTransaction.amountPaid, currency: selectedTransaction.paymentCurrency, format: selectedTransaction.paymentFormat, fromOwner: selectedTransaction.fromOwnerId, fromAccount: selectedTransaction.fromAccountId, toOwner: selectedTransaction.toOwnerId, toAccount: selectedTransaction.toAccountId, suspicious: selectedTransaction.isSuspicious }} />
          <div className="grid grid-cols-2 gap-4"><div><p className="text-muted-foreground">거래 시각</p><p className="mt-1 tabular-nums">{new Date(selectedTransaction.occurredAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p></div><div><p className="text-muted-foreground">결제 수단</p><p className="mt-1">{selectedTransaction.paymentFormat}</p></div></div>
          <div><p className="text-muted-foreground">상태</p><Badge className="mt-1" variant={selectedTransaction.isSuspicious ? 'destructive' : 'outline'}>{selectedTransaction.judgement === 'UNANALYZED' ? '미분석' : selectedTransaction.isSuspicious ? '의심' : '정상'}</Badge></div>
        </CardContent>}
      </Card>
    </div></div>
  </div>
}
