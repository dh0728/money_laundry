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

export const fetchLedgerOwners = (filters: LedgerFilters) => getJson<Page<LedgerOwner>>(`/api/v1/ledger/owners?${query(filters)}`)
export const fetchLedgerAccounts = (filters: LedgerFilters, owner: string) => getJson<Page<LedgerAccount>>(`/api/v1/ledger/accounts?${query(filters, { owner })}`)
export const fetchLedgerTransactions = (filters: LedgerFilters, account: string) => getJson<Page<LedgerTransaction>>(`/api/v1/ledger/transactions?${query(filters, { account })}`)
export const fetchPaymentFormats = () => getJson<string[]>('/api/v1/review/payment-formats')
