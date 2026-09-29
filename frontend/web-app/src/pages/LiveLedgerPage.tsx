import { useSharedPeriod, useViewState } from '@/lib/workspaceState'
import { RefreshStatus } from '@/components/RefreshStatus'
import { fetchLedgerAccounts, fetchLedgerOwners, fetchLedgerTransactions, fetchPaymentFormats, type LedgerFilters, type LedgerTransaction } from '@/api/liveLedger'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import { PageHeading } from '@/components/page'
import { Button } from '@/components/ui/button'
import { useAsync } from '@/lib/useAsync'

const short = (id: string) => id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id
const emptyPage = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }
const amount = (row: LedgerTransaction) => `${Number(row.amountPaid).toLocaleString('ko-KR')} ${row.paymentCurrency}`

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  return <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>전체 {total.toLocaleString('ko-KR')}건 · {page + 1}쪽</span><div className="flex gap-1"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => onChange(page - 1)}>이전</Button><Button variant="outline" size="sm" disabled={(page + 1) * 20 >= total} onClick={() => onChange(page + 1)}>다음</Button></div></div>
}

export default function LiveLedgerPage({ onOpen }: { onOpen: (kind: 'ALERT' | 'EPISODE', id: number) => void }) {
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
  const chooseOwner = (id: string) => { setOwner(id); setAccount(null); setAccountPage(0); setTransactionPage(0) }
  const chooseAccount = (id: string) => { setAccount(id); setTransactionPage(0) }
  const updateJudgement = (value: NonNullable<LedgerFilters['judgement']>[number]) => {
    setJudgement(current => current?.includes(value) ? current.filter(item => item !== value) : [...(current ?? []), value])
    setOwnerPage(0); setAccountPage(0); setTransactionPage(0)
  }
  const updatePayment = (value: string) => {
    setPayments(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value])
    setOwnerPage(0); setAccountPage(0); setTransactionPage(0)
  }

  return <div className="space-y-5">
    <RefreshStatus queries={[owners, accounts, transactions, formats]} />
    <PageHeading title="거래 내역" description="서버 원장 · 소유주 → 계좌 → 거래 순서로 조회 · 이름과 계좌번호 대신 가명 ID 표시" />
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 text-xs">
      <label>시작일 <input type="date" className="ml-1 rounded-md border bg-background px-2 py-1" value={from} max={to || undefined} onChange={event => { setFrom(event.target.value); setOwnerPage(0) }} /></label>
      <label>종료일 <input type="date" className="ml-1 rounded-md border bg-background px-2 py-1" value={to} min={from || undefined} onChange={event => { setTo(event.target.value); setOwnerPage(0) }} /></label>
      <fieldset className="flex flex-wrap gap-2"><legend className="sr-only">모델 판정</legend>{(['SUSPICIOUS', 'NORMAL', 'UNANALYZED'] as const).map(value => <label key={value} className="flex items-center gap-1"><input type="checkbox" checked={judgement?.includes(value) ?? false} onChange={() => updateJudgement(value)} />{value === 'SUSPICIOUS' ? '의심' : value === 'NORMAL' ? '정상' : '미분석'}</label>)}</fieldset>
      <fieldset className="flex flex-wrap gap-2"><legend className="sr-only">결제 수단</legend>{formats.state.status === 'success' ? formats.state.data.map(value => <label key={value} className="flex items-center gap-1"><input type="checkbox" checked={payments.includes(value)} onChange={() => updatePayment(value)} />{value}</label>) : formats.state.status === 'error' ? <Button variant="outline" size="sm" onClick={formats.retry}>결제 수단 다시 불러오기</Button> : <span className="text-muted-foreground">결제 수단 목록 불러오는 중</span>}</fieldset>
    </div>
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
      <section className="min-w-0 rounded-xl border bg-card p-4"><h2 className="mb-3 font-semibold">소유주</h2>{owners.state.status === 'loading' ? <LoadingBlock label="소유주" /> : owners.state.status === 'error' ? <ErrorBlock message={owners.state.message} onRetry={owners.retry} /> : <>{owners.state.data.content.length ? owners.state.data.content.map(row => <button type="button" key={row.id} title={row.id} aria-pressed={owner === row.id} className={`mb-1 block w-full rounded-md border p-2 text-left text-xs ${owner === row.id ? 'bg-accent' : 'hover:bg-accent/50'}`} onClick={() => chooseOwner(row.id)}>소유주 {short(row.id)}</button>) : <EmptyBlock>조회된 소유주가 없습니다.</EmptyBlock>}<Pager page={ownerPage} total={owners.state.data.totalElements} onChange={setOwnerPage} /></>}</section>
      <section className="min-w-0 rounded-xl border bg-card p-4"><h2 className="mb-3 font-semibold">계좌</h2>{!owner ? <EmptyBlock>소유주를 선택해 주세요.</EmptyBlock> : accounts.state.status === 'loading' ? <LoadingBlock label="계좌" /> : accounts.state.status === 'error' ? <ErrorBlock message={accounts.state.message} onRetry={accounts.retry} /> : <>{accounts.state.data.content.length ? accounts.state.data.content.map(row => <button type="button" key={row.id} title={row.id} aria-pressed={account === row.id} className={`mb-1 block w-full rounded-md border p-2 text-left text-xs ${account === row.id ? 'bg-accent' : 'hover:bg-accent/50'}`} onClick={() => chooseAccount(row.id)}>계좌 {short(row.id)} <span className="text-muted-foreground">· 은행 {row.bankId}</span></button>) : <EmptyBlock>조회된 계좌가 없습니다.</EmptyBlock>}<Pager page={accountPage} total={accounts.state.data.totalElements} onChange={setAccountPage} /></>}</section>
      <section className="min-w-0 rounded-xl border bg-card p-4"><h2 className="mb-3 font-semibold">거래</h2>{!account ? <EmptyBlock>계좌를 선택해 주세요.</EmptyBlock> : transactions.state.status === 'loading' ? <LoadingBlock label="거래" /> : transactions.state.status === 'error' ? <ErrorBlock message={transactions.state.message} onRetry={transactions.retry} /> : <>{transactions.state.data.content.length ? transactions.state.data.content.map(row => <article key={row.txId} className="mb-2 rounded-lg border p-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><strong>T-{row.txId}</strong><span>{row.judgement === 'UNANALYZED' ? '미분석' : row.isSuspicious ? '의심' : '정상'}</span><strong>{amount(row)}</strong></div><p className="mt-2 text-muted-foreground">{new Date(row.occurredAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · {row.paymentFormat}</p><p className="mt-1 break-all text-muted-foreground" title={`${row.fromAccountId} → ${row.toAccountId}`}>계좌 {short(row.fromAccountId)} → {short(row.toAccountId)}</p><div className="mt-2 flex flex-wrap gap-1">{row.alertIds.map(id => <Button key={`a-${id}`} variant="outline" size="sm" title="원본 Alert ID. 조사 사건 ID와 다를 수 있습니다." disabled>A-{id}</Button>)}{row.episodeIds.map(id => <Button key={`e-${id}`} variant="outline" size="sm" onClick={() => onOpen('EPISODE', id)}>E-{id}</Button>)}</div></article>) : <EmptyBlock>조회된 거래가 없습니다.</EmptyBlock>}<Pager page={transactionPage} total={transactions.state.data.totalElements} onChange={setTransactionPage} /></>}</section>
    </div>
  </div>
}
