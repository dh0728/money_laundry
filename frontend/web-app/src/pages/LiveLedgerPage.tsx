import { useState } from 'react'
import { useSharedPeriod, useViewState } from '@/lib/workspaceState'
import { RefreshStatus } from '@/components/RefreshStatus'
import { fetchLedgerAccounts, fetchLedgerOwners, fetchLedgerTransactions, fetchPaymentFormats, type LedgerFilters, type LedgerTransaction } from '@/api/liveLedger'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import { Button } from '@/components/ui/button'
import { useAsync } from '@/lib/useAsync'
import { StageItem, StagePanel } from '@/features/transactions/transaction-stage'

const short = (id: string | undefined) => !id ? '—' : id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id
const emptyPage = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }
const amount = (row: LedgerTransaction) => `${Number(row.amountPaid).toLocaleString('ko-KR')} ${row.paymentCurrency}`

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  return <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>전체 {total.toLocaleString('ko-KR')}건 · {page + 1}쪽</span><div className="flex gap-1"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => onChange(page - 1)}>이전</Button><Button variant="outline" size="sm" disabled={(page + 1) * 20 >= total} onClick={() => onChange(page + 1)}>다음</Button></div></div>
}

export default function LiveLedgerPage({ onOpen }: { onOpen: (kind: 'ALERT' | 'EPISODE', id: number) => void }) {
  const [selectedTransaction, setSelectedTransaction] = useState<LedgerTransaction | null>(null)
  const { from, to, setFrom, setTo } = useSharedPeriod()
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
  const owners = useAsync(() => fetchLedgerOwners({ ...base, page: ownerPage }), [from, to, judgement, payments, ownerPage], { key: 'ledger/owners' })
  const accounts = useAsync(() => owner ? fetchLedgerAccounts({ ...base, page: accountPage }, owner) : Promise.resolve(emptyPage), [from, to, judgement, payments, owner, accountPage], { key: 'ledger/accounts' })
  const transactions = useAsync(() => account ? fetchLedgerTransactions({ ...base, page: transactionPage }, account) : Promise.resolve(emptyPage), [from, to, judgement, payments, account, transactionPage], { key: 'ledger/transactions' })
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

  return <div className="space-y-5" data-testid="transactions-table">
    <RefreshStatus queries={[owners, accounts, transactions, formats]} />
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <label className="rounded-md border bg-background p-2">시작일 <input type="date" className="ml-1 bg-transparent" value={from} max={to || undefined} onChange={event => { setFrom(event.target.value); setOwnerPage(0); setSelectedTransaction(null) }} /></label>
      <label className="rounded-md border bg-background p-2">종료일 <input type="date" className="ml-1 bg-transparent" value={to} min={from || undefined} onChange={event => { setTo(event.target.value); setOwnerPage(0); setSelectedTransaction(null) }} /></label>
      <fieldset className="flex flex-wrap gap-2"><legend className="sr-only">모델 판정</legend>{(['SUSPICIOUS', 'NORMAL', 'UNANALYZED'] as const).map(value => <label key={value} className="flex items-center gap-1 rounded-md border px-2 py-1"><input type="checkbox" checked={judgement?.includes(value) ?? false} onChange={() => updateJudgement(value)} />{value === 'SUSPICIOUS' ? '의심' : value === 'NORMAL' ? '정상' : '미분석'}</label>)}</fieldset>
      <fieldset className="flex flex-wrap gap-2"><legend className="sr-only">결제 수단</legend>{formats.state.status === 'success' ? formats.state.data.map(value => <label key={value} className="flex items-center gap-1 rounded-md border px-2 py-1"><input type="checkbox" checked={payments.includes(value)} onChange={() => updatePayment(value)} />{value}</label>) : formats.state.status === 'error' ? <Button variant="outline" size="sm" onClick={formats.retry}>결제 수단 다시 불러오기</Button> : <span className="text-muted-foreground">결제 수단 불러오는 중</span>}</fieldset>
    </div>
    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(150px,1fr)_minmax(160px,1fr)_minmax(160px,1fr)_minmax(280px,2fr)]">
      <StagePanel title="소유주" count={owners.state.status === 'success' ? owners.state.data.totalElements : 0} testId="ledger-owner-stage" bodyClassName="max-h-[680px] overflow-y-auto">{owners.state.status === 'loading' ? <LoadingBlock label="소유주" /> : owners.state.status === 'error' ? <ErrorBlock message={owners.state.message} onRetry={owners.retry} /> : <>{owners.state.data.content.length ? owners.state.data.content.map(row => <StageItem key={row.id} primary={short(row.id)} secondary="소유주" active={owner === row.id} mono onSelect={() => chooseOwner(row.id)} />) : <EmptyBlock>조회된 소유주가 없습니다.</EmptyBlock>}<Pager page={ownerPage} total={owners.state.data.totalElements} onChange={setOwnerPage} /></>}</StagePanel>
      <StagePanel title="계좌" count={accounts.state.status === 'success' ? accounts.state.data.totalElements : 0} description={owner ? `${short(owner)}의 계좌` : '소유주 선택'} testId="ledger-account-stage" bodyClassName="max-h-[680px] overflow-y-auto">{!owner ? <EmptyBlock>소유주를 선택해 주세요.</EmptyBlock> : accounts.state.status === 'loading' ? <LoadingBlock label="계좌" /> : accounts.state.status === 'error' ? <ErrorBlock message={accounts.state.message} onRetry={accounts.retry} /> : <>{accounts.state.data.content.length ? accounts.state.data.content.map(row => <StageItem key={row.id} primary={short(row.id)} secondary={`은행 ${row.bankId}`} active={account === row.id} mono onSelect={() => chooseAccount(row.id)} />) : <EmptyBlock>조회된 계좌가 없습니다.</EmptyBlock>}<Pager page={accountPage} total={accounts.state.data.totalElements} onChange={setAccountPage} /></>}</StagePanel>
      <StagePanel title="거래" count={transactions.state.status === 'success' ? transactions.state.data.totalElements : 0} description={account ? `${short(account)}의 거래 내역` : '계좌 선택'} testId="ledger-transaction-stage" bodyClassName="max-h-[680px] overflow-y-auto">{!account ? <EmptyBlock>계좌를 선택해 주세요.</EmptyBlock> : transactions.state.status === 'loading' ? <LoadingBlock label="거래" /> : transactions.state.status === 'error' ? <ErrorBlock message={transactions.state.message} onRetry={transactions.retry} /> : <>{transactions.state.data.content.length ? transactions.state.data.content.map(row => <StageItem key={row.txId} primary={String(row.txId)} secondary={`${row.paymentFormat} · ${row.judgement === 'UNANALYZED' ? '미분석' : row.isSuspicious ? '의심' : '정상'}`} trailing={<span className="text-xs tabular-nums">{amount(row)}</span>} active={selectedTransaction?.txId === row.txId} mono onSelect={() => setSelectedTransaction(row)} />) : <EmptyBlock>조회된 거래가 없습니다.</EmptyBlock>}<Pager page={transactionPage} total={transactions.state.data.totalElements} onChange={setTransactionPage} /></>}</StagePanel>
      <section className="min-w-0 self-start rounded-xl border bg-card p-5"><h2 className="font-semibold">선택 거래 상세</h2>{selectedTransaction ? <><p className="mt-2 font-mono text-sm text-muted-foreground">{selectedTransaction.txId}</p><div className="mt-4 border-t pt-4"><div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-lg border bg-muted/20 p-3 text-xs"><div className="min-w-0"><span className="text-muted-foreground">송금 소유주</span><p className="truncate font-semibold" title={selectedTransaction.fromOwnerId}>{short(selectedTransaction.fromOwnerId)}</p><p className="truncate font-mono">{short(selectedTransaction.fromAccountId)}</p></div><span className="rounded-full bg-destructive/20 px-2 py-1 text-center font-semibold">{amount(selectedTransaction)} →</span><div className="min-w-0 text-right"><span className="text-muted-foreground">수취 소유주</span><p className="truncate font-semibold" title={selectedTransaction.toOwnerId}>{short(selectedTransaction.toOwnerId)}</p><p className="truncate font-mono">{short(selectedTransaction.toAccountId)}</p></div></div><div className="mt-5 grid grid-cols-2 gap-4 text-xs"><div><p className="text-muted-foreground">거래 시작</p><p>{new Date(selectedTransaction.occurredAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p></div><div><p className="text-muted-foreground">결제 수단</p><p>{selectedTransaction.paymentFormat}</p></div><div><p className="text-muted-foreground">상태</p><p>{selectedTransaction.judgement === 'UNANALYZED' ? '미분석' : selectedTransaction.isSuspicious ? '의심' : '정상'}</p></div><div><p className="text-muted-foreground">위험 점수</p><p>{selectedTransaction.launderingScore?.toFixed(2) ?? '—'}</p></div></div></div><div className="mt-5 space-y-3 border-t pt-4">{selectedTransaction.alertIds.length > 0 && <div><p className="mb-2 text-xs text-muted-foreground">연결 Alert · 원본 ID</p><div className="flex flex-wrap gap-2">{selectedTransaction.alertIds.map(id => <span key={id} className="rounded-full border px-3 py-1 font-mono text-xs" title="원본 Alert ID로, 조사 사건 ID와 다를 수 있습니다">A-{id}</span>)}</div></div>}{selectedTransaction.episodeIds.length > 0 && <div><p className="mb-2 text-xs text-muted-foreground">연결 Episode</p><div className="flex flex-wrap gap-2">{selectedTransaction.episodeIds.map(id => <Button key={id} variant="outline" size="sm" onClick={() => onOpen('EPISODE', id)}>E-{id}</Button>)}</div></div>}</div></> : <p className="mt-4 text-sm text-muted-foreground">거래를 선택하면 상세 정보가 표시됩니다.</p>}</section>
    </div>
  </div>
}
