import type { ReactNode } from 'react'
import TransactionExplorer, { type TransactionFilter } from '@/features/transactions/TransactionExplorer'
import type { TransactionIndex } from '@/features/transactions/transactionIndex'
import { isoDate } from '@/lib/format'
import { useSharedPeriod, useViewState } from '@/lib/workspaceState'
import { RefreshStatus } from '@/components/RefreshStatus'
import { fetchLedgerAccounts, fetchLedgerOwners, fetchLedgerTransactions, fetchPaymentFormats, type LedgerFilters } from '@/api/liveLedger'
import { ErrorBlock, LoadingBlock } from '@/components/states'
import { Button } from '@/components/ui/button'
import { useAsync } from '@/lib/useAsync'

const emptyPage = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  return <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>전체 {total.toLocaleString('ko-KR')}건 · {page + 1}쪽</span><div className="flex gap-1"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => onChange(page - 1)}>이전</Button><Button variant="outline" size="sm" disabled={(page + 1) * 20 >= total} onClick={() => onChange(page + 1)}>다음</Button></div></div>
}

export default function LiveLedgerPage({ onOpen }: { onOpen?: (kind: 'ALERT' | 'EPISODE', id: number) => void }) {
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
  const base = { from: from || undefined, to: to || undefined, judgement, payments, query: search, directions }
  const formats = useAsync(fetchPaymentFormats, [], { key: 'payment-formats' })
  const owners = useAsync(() => fetchLedgerOwners({ ...base, page: ownerPage }), [from, to, judgement, payments, search, directions, ownerPage], { key: 'ledger/owners' })
  const accounts = useAsync(() => owner ? fetchLedgerAccounts({ ...base, page: accountPage }, owner) : Promise.resolve(emptyPage), [from, to, judgement, payments, search, directions, owner, accountPage], { key: 'ledger/accounts' })
  const transactions = useAsync(() => account ? fetchLedgerTransactions({ ...base, page: transactionPage }, account) : Promise.resolve(emptyPage), [from, to, judgement, payments, search, directions, account, transactionPage], { key: 'ledger/transactions' })
  const chooseOwner = (id: string) => { setOwner(id); setAccount(null); setAccountPage(0); setTransactionPage(0) }
  const chooseAccount = (id: string) => { setAccount(id); setTransactionPage(0) }
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
  const filters: TransactionFilter[] = [
    ...(judgement ?? []).map(value => ({ field: 'status' as const, value: value === 'SUSPICIOUS' ? '의심' : value === 'NORMAL' ? '정상' : '미분석' })),
    ...payments.map(value => ({ field: 'format' as const, value })),
    ...directions.map(value => ({ field: 'direction' as const, value: value === 'IN' ? '수취' : '송금' })),
  ]
  return <div className="space-y-5">
    <RefreshStatus queries={[owners, accounts, transactions, formats]} />
    <TransactionExplorer index={index} today={businessDate ? new Date(`${businessDate}T00:00:00`) : new Date()} remote={{
      onOpenEpisode: onOpen ? id => onOpen('EPISODE', id) : undefined,
      query: search, onQuery: setSearch,
      owner: owner ?? undefined, account: account ?? undefined,
      selectOwner: chooseOwner, selectAccount: id => { if (id) chooseAccount(id); else setAccount(null) },
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
      stages: [owners, accounts, transactions].map((query, i) => query.state.status === 'loading' ? <LoadingBlock key={i} label="목록" /> : query.state.status === 'error' ? <ErrorBlock key={i} message={query.state.message} onRetry={query.retry} /> : <Pager key={i} page={[ownerPage, accountPage, transactionPage][i]} total={query.state.data.totalElements} onChange={[setOwnerPage, setAccountPage, setTransactionPage][i]} />) as [ReactNode, ReactNode, ReactNode],
    }} />
  </div>
}
