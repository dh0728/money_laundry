import { useEffect, useState, type ReactNode } from 'react'
import TransactionExplorer, { type TransactionFilter } from '@/features/transactions/TransactionExplorer'
import type { TransactionIndex } from '@/features/transactions/transactionIndex'
import { isoDate } from '@/lib/format'
import { PeriodContext, WorkspaceState, useSharedPeriod, useViewState, useWorkspace, type Period } from '@/lib/workspaceState'
import { WorkspaceProvider } from '@/lib/WorkspaceProvider'
import { RefreshStatus } from '@/components/RefreshStatus'
import { fetchLedgerAccounts, fetchLedgerOwners, fetchLedgerTransactions, fetchPaymentFormats, type LedgerFilters, locateLedgerTransaction, type LedgerTransactionContext, type LocatedLedgerTransaction } from '@/api/liveLedger'
import { ErrorBlock, LoadingBlock } from '@/components/states'
import { Button } from '@/components/ui/button'
import { useAsync } from '@/lib/useAsync'
import { fetchReviewCases } from '@/api/liveReview'
import { toast } from 'sonner'

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  return <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>전체 {total.toLocaleString('ko-KR')}건 · {page + 1}쪽</span><div className="flex gap-1"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => onChange(page - 1)}>이전</Button><Button variant="outline" size="sm" disabled={(page + 1) * 20 >= total} onClick={() => onChange(page + 1)}>다음</Button></div></div>
}

type LedgerProps = { onOpen?: (kind: 'ALERT' | 'EPISODE', id: number) => void }

export default function LiveLedgerPage({ transactionId, onOpen }: LedgerProps & { transactionId?: number }) {
  return transactionId !== undefined ? <TargetLedger key={transactionId} transactionId={transactionId} onOpen={onOpen} /> : <LedgerContent onOpen={onOpen} />
}

function TargetLedger({ transactionId, onOpen }: LedgerProps & { transactionId: number }) {
  const workspace = useWorkspace()
  const { businessDate } = useSharedPeriod()
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ target: LocatedLedgerTransaction; active: () => boolean } | { error: string } | null>(null)
  useEffect(() => {
    let active = true
    const context = workspace.get<LedgerTransactionContext>(`ledger/transaction-target/${transactionId}`, {})
    void locateLedgerTransaction(transactionId, context, () => active).then(
      target => { if (active) setResult({ target, active: () => active }) },
      error => { if (active) setResult({ error: error instanceof Error ? error.message : '거래를 조회하지 못했습니다.' }) },
    )
    return () => { active = false }
  }, [workspace, transactionId, attempt])
  const retry = () => { setResult(null); setAttempt(value => value + 1) }
  if (!result) return <LoadingBlock label="거래" />
  if ('error' in result) return <ErrorBlock message={result.error} onRetry={retry} />
  return <FocusedLedger key={attempt} target={result.target} active={result.active} businessDate={businessDate} onOpen={onOpen} onRelocate={retry} />
}

function FocusedLedger({ target, active, businessDate, onOpen, onRelocate }: LedgerProps & { target: LocatedLedgerTransaction; active: () => boolean; businessDate?: string; onRelocate: () => void }) {
  const [period, setPeriod] = useState<Period>(() => ({ from: target.from ?? '', to: target.to ?? '' }))
  const [workspace] = useState(() => {
    const store = new WorkspaceState()
    const query = String(target.txId)
    const scope = JSON.stringify([target.from ?? '', target.to ?? '', [], [], query])
    store.set('ledger/search', query)
    store.set(`ledger/account/${scope}`, target.account ?? null)
    store.set(`ledger/transactionPage/${scope}`, target.page)
    store.set(`ledger/transaction/${JSON.stringify([scope, [], null, target.account ?? null, target.page])}`, query)
    return store
  })
  return <WorkspaceProvider state={workspace}><PeriodContext.Provider value={{ period, businessDate, setPeriod }}><LedgerContent onOpen={onOpen} active={active} expectedTarget={target.txId} onRelocate={onRelocate} /></PeriodContext.Provider></WorkspaceProvider>
}

function LedgerContent({ onOpen, active, expectedTarget, onRelocate }: LedgerProps & { active?: () => boolean; expectedTarget?: number; onRelocate?: () => void }) {
  const { from, to, businessDate, setPeriod } = useSharedPeriod()
  const [search, setSearch] = useViewState('ledger/search', '')
  const [directions, setDirections] = useViewState<string[]>('ledger/directions', [])
  const [judgement, setJudgement] = useViewState<LedgerFilters['judgement']>('ledger/judgement', [])
  const [payments, setPayments] = useViewState<string[]>('ledger/payments', [])
  const scope = JSON.stringify([from, to, judgement, payments, search])
  const [owner, setOwner] = useViewState<string | null>(`ledger/owner/${scope}`, null)
  const [account, setAccount] = useViewState<string | null>(`ledger/account/${scope}`, null)
  const [ownerPage, setOwnerPage] = useViewState(`ledger/ownerPage/${scope}`, 0)
  const [accountPage, setAccountPage] = useViewState(`ledger/accountPage/${scope}`, 0)
  const [transactionPage, setTransactionPage] = useViewState(`ledger/transactionPage/${scope}`, 0)
  const [transaction, setTransaction] = useViewState<string | null>(`ledger/transaction/${JSON.stringify([scope, directions, owner, account, transactionPage])}`, null)
  const base = { from: from || undefined, to: to || undefined, judgement, payments, query: search, directions }
  const formats = useAsync(active ? () => fetchPaymentFormats(active) : fetchPaymentFormats, [], { key: 'payment-formats' })
  const owners = useAsync(() => active ? fetchLedgerOwners({ ...base, page: ownerPage }, active) : fetchLedgerOwners({ ...base, page: ownerPage }), [from, to, judgement, payments, search, directions, ownerPage], { key: 'ledger/owners' })
  const accounts = useAsync(() => active ? fetchLedgerAccounts({ ...base, page: accountPage }, owner ?? undefined, active) : fetchLedgerAccounts({ ...base, page: accountPage }, owner ?? undefined), [from, to, judgement, payments, search, directions, owner, accountPage], { key: 'ledger/accounts' })
  const transactions = useAsync(() => active ? fetchLedgerTransactions({ ...base, page: transactionPage }, account ?? undefined, account ? undefined : owner ?? undefined, active) : fetchLedgerTransactions({ ...base, page: transactionPage }, account ?? undefined, account ? undefined : owner ?? undefined), [from, to, judgement, payments, search, directions, owner, account, transactionPage], { key: 'ledger/transactions' })
  const chooseOwner = (id: string | undefined) => { setOwner(id ?? null); setAccount(null); setAccountPage(0); setTransactionPage(0) }
  const chooseAccount = (id: string) => { setAccount(id); setTransactionPage(0) }
  async function openSourceAlert(alertId: number) {
    if (!onOpen) return
    try {
      let page = 0
      for (;;) {
        const result = await fetchReviewCases({ kind: 'ALERT', query: `A-${alertId}`, page, size: 100 })
        const found = result.content.find(row => row.alertId === alertId)
        if (found) { onOpen('ALERT', found.caseId); return }
        if (++page >= result.totalPages) break
      }
      toast.error('연결된 Alert를 찾을 수 없습니다.')
    } catch { toast.error('연결된 Alert를 조회하지 못했습니다. 다시 시도해 주세요.') }
  }
  const index: TransactionIndex = {
    owners: owners.state.status === 'success' ? owners.state.data.content.map(row => ({ id: row.id, name: row.name ?? '소유주 미상', accountIds: [], transactionIds: [] })) : [],
    accounts: accounts.state.status === 'success' ? accounts.state.data.content.map(row => ({ id: row.id, bank: String(row.bankId), owner: row.ownerId, transactionIds: transactions.state.status === 'success' ? transactions.state.data.content.map(tx => String(tx.txId)) : [] })) : [],
    transactions: transactions.state.status === 'success' ? transactions.state.data.content.map(row => ({
      id: String(row.txId), at: new Date(row.occurredAt).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(' ', 'T'),
      usd: row.amountUsd, amount: row.amountPaid, currency: row.paymentCurrency, format: row.paymentFormat,
      suspicious: row.isSuspicious, fromAccount: row.fromAccountId, toAccount: row.toAccountId,
      fromOwner: row.fromOwnerName ?? '소유주 미상', toOwner: row.toOwnerName ?? '소유주 미상', alertIds: row.alertIds, episodeIds: row.episodeIds,
    })) : [],
  }
  const targetMissing = expectedTarget !== undefined && transaction === String(expectedTarget) && transactions.state.status === 'success' && !transactions.state.data.content.some(row => row.txId === expectedTarget)
  const filters: TransactionFilter[] = [
    ...(judgement ?? []).map(value => ({ field: 'status' as const, value: value === 'SUSPICIOUS' ? '의심' : value === 'NORMAL' ? '정상' : '미분석' })),
    ...payments.map(value => ({ field: 'format' as const, value })),
    ...directions.map(value => ({ field: 'direction' as const, value: value === 'IN' ? '수취' : '송금' })),
  ]
  return <div className="space-y-5">
    <RefreshStatus queries={[owners, accounts, transactions, formats]} />
    <TransactionExplorer index={index} today={businessDate ? new Date(`${businessDate}T00:00:00`) : new Date()} remote={{
      onOpenEpisode: onOpen ? id => onOpen('EPISODE', id) : undefined,
      onOpenAlert: onOpen ? id => { void openSourceAlert(id) } : undefined,
      query: search, onQuery: setSearch,
      owner: owner ?? undefined, account: account ?? undefined,
      transaction, selectTransaction: setTransaction,
      selectOwner: chooseOwner, selectAccount: id => { if (id) chooseAccount(id); else { setAccount(null); setTransactionPage(0) } },
      range: from ? { from: new Date(`${from}T00:00:00`), to: to ? new Date(`${to}T00:00:00`) : undefined } : undefined,
      filters,
      changeControls: (range, next) => {
        setPeriod({ from: range?.from ? isoDate(range.from) : '', to: range?.to ? isoDate(range.to) : '' })
        setJudgement(next.filter(f => f.field === 'status').map(f => f.value === '의심' ? 'SUSPICIOUS' : f.value === '정상' ? 'NORMAL' : 'UNANALYZED'))
        setPayments(next.filter(f => f.field === 'format').map(f => f.value))
        setDirections(next.filter(f => f.field === 'direction').map(f => f.value === '수취' ? 'IN' : 'OUT'))
        setOwnerPage(0); setAccountPage(0); setTransactionPage(0)
      },
      formats: formats.state.status === 'success' ? formats.state.data : [],
      counts: [owners, accounts, transactions].map(query => query.state.status === 'success' ? query.state.data.totalElements : undefined) as [number | undefined, number | undefined, number | undefined],
      stages: [owners, accounts, transactions].map((query, i) => i === 2 && targetMissing ? <ErrorBlock key={i} message={`거래 T-${expectedTarget}의 조회 결과가 변경되었습니다. 다시 확인해 주세요.`} onRetry={onRelocate!} /> : query.state.status === 'loading' ? <LoadingBlock key={i} label="목록" /> : query.state.status === 'error' ? <ErrorBlock key={i} message={query.state.message} onRetry={query.retry} /> : <Pager key={i} page={[ownerPage, accountPage, transactionPage][i]} total={query.state.data.totalElements} onChange={[setOwnerPage, setAccountPage, setTransactionPage][i]} />) as [ReactNode, ReactNode, ReactNode],
    }} />
  </div>
}
