import { getJson, type Page } from './common'

export type LedgerFilters = {
  from?: string
  to?: string
  judgement?: ('SUSPICIOUS' | 'NORMAL' | 'UNANALYZED')[]
  payments?: string[]
  query?: string
  directions?: string[]
  page?: number
  size?: number
}
export type LedgerOwner = { id: string; name?: string }
export type LedgerAccount = { id: string; ownerId: string; ownerName?: string; bankId: number }
export type LedgerTransaction = {
  txId: number
  occurredAt: string
  fromAccountId: string
  toAccountId: string
  fromOwnerName?: string
  toOwnerName?: string
  fromOwnerId: string
  toOwnerId: string
  fromBankId: number
  toBankId: number
  amountPaid: number
  amountReceived: number
  amountUsd: number
  alertIds: number[]
  episodeIds: number[]
  paymentCurrency: string
  receivingCurrency: string
  paymentFormat: string
  launderingScore: number | null
  threshold: number | null
  isSuspicious: boolean | null
  typeClass: number | null
  typeName?: string
  probabilities: (number | null)[]
  judgement: 'SUSPICIOUS' | 'NORMAL' | 'UNANALYZED'
}

function query(filters: LedgerFilters, selection?: { owner?: string; account?: string }) {
  const params = new URLSearchParams()
  if (filters.query) params.set('query', filters.query)
  if (selection?.account) filters.directions?.forEach(value => params.append('directions', value))
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (selection?.owner) params.set('owner', selection.owner)
  if (selection?.account) params.set('account', selection.account)
  filters.judgement?.forEach(value => params.append('judgement', value))
  filters.payments?.forEach(value => params.append('payments', value))
  params.set('page', String(filters.page ?? 0))
  params.set('size', String(filters.size ?? 20))
  return params
}

export const fetchLedgerOwners = (filters: LedgerFilters, active?: AbortSignal | (() => boolean)) => getJson<Page<LedgerOwner>>(`/api/v1/ledger/owners?${query(filters)}`, undefined, active)
export const fetchLedgerAccounts = (filters: LedgerFilters, owner?: string, active?: AbortSignal | (() => boolean)) => getJson<Page<LedgerAccount>>(`/api/v1/ledger/accounts?${query(filters, { owner })}`, undefined, active)
export const fetchLedgerTransactions = (filters: LedgerFilters, account?: string, owner?: string, active?: AbortSignal | (() => boolean)) => getJson<Page<LedgerTransaction>>(`/api/v1/ledger/transactions?${query(filters, { account, owner })}`, undefined, active)
export const fetchPaymentFormats = (active?: AbortSignal | (() => boolean)) => getJson<string[]>('/api/v1/review/payment-formats', undefined, active)


export type LedgerTransactionContext = { from?: string; to?: string; account?: string }
export type LocatedLedgerTransaction = LedgerTransactionContext & { txId: number; page: number }

/** query is substring search: select only a server row with the exact transaction ID. */
export async function locateLedgerTransaction(txId: number, context: LedgerTransactionContext = {}, active: () => boolean = () => true): Promise<LocatedLedgerTransaction> {
  if (!Number.isSafeInteger(txId) || txId <= 0) throw new Error('유효하지 않은 거래 ID입니다.')
  // Frozen case coordinates narrow the first read; current ledger facts may have changed.
  const scopes = context.from || context.to || context.account ? [context, {}] : [{}]
  for (const scope of scopes) {
    for (let page = 0; ; page++) {
      if (!active()) throw new DOMException('화면 이동으로 조회를 중단했습니다.', 'AbortError')
      const result = await fetchLedgerTransactions({ from: scope.from, to: scope.to, query: String(txId), page, size: 20 }, scope.account, undefined, active)
      if (!active()) throw new DOMException('화면 이동으로 조회를 중단했습니다.', 'AbortError')
      if (!Number.isSafeInteger(result.totalPages) || result.totalPages < 0 || result.page !== page) throw new Error('거래 목록 페이지 응답을 확인할 수 없습니다.')
      if (result.content.some(row => row.txId === txId)) return { ...scope, txId, page }
      if (!result.content.length || page + 1 >= result.totalPages) break
    }
  }
  throw new Error(`원장에서 거래 T-${txId}을 찾을 수 없습니다.`)
}
