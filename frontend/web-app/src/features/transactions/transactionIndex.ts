import type { TransactionExplorerData } from '@/api/transactions'

// v24 transactionIndex.ts의 구조. API 응답(소유주·계좌·거래 목록)을 3단 탐색용 색인으로 바꾼다.
export type TransactionTarget =
  | { type: 'owner'; owner: string }
  | { type: 'account'; account: string }
  | { type: 'transaction'; transactionId: string }

export type TransactionIndex = {
  owners: Array<{ name: string; accountIds: string[]; transactionIds: string[] }>
  accounts: Array<{ id: string; bank: string; owner: string; transactionIds: string[] }>
  transactions: Array<{ id: string; at: string; usd: number; amount: number; currency: string; format: string; suspicious: boolean; fromAccount: string; toAccount: string; fromOwner: string; toOwner: string; alertIds: number[]; episodeIds: number[] }>
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
