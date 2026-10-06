import type { TransactionExplorerData } from '@/api/transactions'

// v24 transactionIndex.ts의 구조. API 응답(소유주·계좌·거래 목록)을 3단 탐색용 색인으로 바꾼다.
export type TransactionTarget =
  | { type: 'owner'; owner: string }
  | { type: 'account'; account: string }
  | { type: 'transaction'; transactionId: string }

export type TransactionIndex = {
  owners: Array<{ id?: string; name: string; accountIds: string[]; transactionIds: string[] }>
  accounts: Array<{ id: string; bank: string; owner: string; transactionIds: string[] }>
  transactions: Array<{ id: string; at: string; usd: number; amount: number; currency: string; format: string; suspicious: boolean | null; fromAccount: string; toAccount: string; fromOwner: string; toOwner: string; alertIds: number[]; episodeIds: number[] }>
}

const sorted = (values: Iterable<string>) => [...values].sort((a, b) => a.localeCompare(b, 'ko'))

export function buildTransactionIndex(data: TransactionExplorerData): TransactionIndex {
  const ownerName = new Map(data.owners.map(owner => [owner.ownerId, owner.name]))
  const accountOwner = new Map(data.accounts.map(account => [account.account, ownerName.get(account.ownerId) ?? '소유주 미상']))
  const transactions = data.transactions
    .map(tx => ({
      id: String(tx.txId),
      at: tx.txAt,
      usd: tx.amountUsd,
      amount: tx.amountPaid,
      currency: tx.paymentCurrency,
      format: tx.paymentFormat,
      suspicious: tx.isSuspicious,
      fromAccount: tx.fromAccount,
      toAccount: tx.toAccount,
      fromOwner: accountOwner.get(tx.fromAccount) ?? '소유주 미상',
      toOwner: accountOwner.get(tx.toAccount) ?? '소유주 미상',
      alertIds: tx.alertIds,
      episodeIds: tx.episodeIds,
    }))
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
  const txIdsFor = (account: string) => sorted(transactions.filter(tx => tx.fromAccount === account || tx.toAccount === account).map(tx => tx.id))
  const accounts = data.accounts
    .map(account => ({ id: account.account, bank: String(account.bank), owner: accountOwner.get(account.account)!, transactionIds: txIdsFor(account.account) }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const owners = data.owners
    .map(owner => {
      const own = accounts.filter(account => account.owner === owner.name)
      return { name: owner.name, accountIds: own.map(account => account.id), transactionIds: sorted(new Set(own.flatMap(account => account.transactionIds))) }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  return { owners, accounts, transactions }
}

const currencyMarkers: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', KRW: '₩', CHF: 'CHF' }

export const formatMoney = (amount: number, currency: string) =>
  `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount)}${currencyMarkers[currency] ?? currency}`

export type TransactionSearchResult = { key: string; label: string; detail: string; target: TransactionTarget }

// v24 transactionIndex.ts: 전역 검색이 소유주·계좌·거래를 찾을 때 쓴다(종류별 최대 5건)
export function searchTransactionIndex(index: TransactionIndex, query: string): TransactionSearchResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const owners = index.owners.filter(owner => owner.name.toLowerCase().includes(q)).slice(0, 5).map(owner => ({
    key: `owner-${owner.name}`, label: owner.name, detail: `${owner.accountIds.length}개 계좌 · ${owner.transactionIds.length}건 거래`, target: { type: 'owner', owner: owner.name } as const,
  }))
  const accounts = index.accounts.filter(account => `${account.id} ${account.owner} ${account.bank}`.toLowerCase().includes(q)).slice(0, 5).map(account => ({
    key: `account-${account.id}`, label: account.id, detail: `${account.owner} · 은행 ${account.bank}`, target: { type: 'account', account: account.id } as const,
  }))
  const transactions = index.transactions.filter(transaction => `${transaction.id} ${transaction.fromAccount} ${transaction.toAccount} ${transaction.fromOwner} ${transaction.toOwner}`.toLowerCase().includes(q)).slice(0, 5).map(transaction => ({
    key: `transaction-${transaction.id}`, label: transaction.id, detail: `${transaction.fromAccount} → ${transaction.toAccount}`, target: { type: 'transaction', transactionId: transaction.id } as const,
  }))
  return [...owners, ...accounts, ...transactions]
}
