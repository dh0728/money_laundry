import { graphFor, type RecordItem } from './domain'

export type TransactionTarget =
  | { type: 'owner'; owner: string }
  | { type: 'account'; account: string }
  | { type: 'transaction'; transactionId: string }

export type TransactionIndex = {
  owners: Array<{ name: string; accountIds: string[]; transactionIds: string[]; recordIds: string[] }>
  accounts: Array<{ id: string; bank: string; owner: string; transactionIds: string[]; recordIds: string[] }>
  transactions: Array<{ id: string; at: string; usd: number; amount: number; currency: string; format: string; suspicious: boolean; fromAccount: string; toAccount: string; fromOwner: string; toOwner: string; recordIds: string[] }>
}

export type TransactionSearchResult = { key: string; label: string; detail: string; target: TransactionTarget }

const sorted = (values: Set<string>) => [...values].sort((a, b) => a.localeCompare(b, 'ko'))

export function buildTransactionIndex(records: RecordItem[]): TransactionIndex {
  const ownerMap = new Map<string, { name: string; accountIds: Set<string>; transactionIds: Set<string>; recordIds: Set<string> }>()
  const accountMap = new Map<string, { id: string; bank: string; owner: string; transactionIds: Set<string>; recordIds: Set<string> }>()
  const transactionMap = new Map<string, TransactionIndex['transactions'][number]>()

  for (const record of records) {
    const model = graphFor(record, records)
    const nodes = new Map(model.nodes.map(node => [node.key, node]))
    for (const node of model.nodes) {
      const account = accountMap.get(node.account) ?? { id: node.account, bank: node.bank, owner: node.entity, transactionIds: new Set<string>(), recordIds: new Set<string>() }
      account.recordIds.add(record.id)
      accountMap.set(node.account, account)
      const owner = ownerMap.get(node.entity) ?? { name: node.entity, accountIds: new Set<string>(), transactionIds: new Set<string>(), recordIds: new Set<string>() }
      owner.accountIds.add(node.account)
      owner.recordIds.add(record.id)
      ownerMap.set(node.entity, owner)
    }
    for (const edge of model.edges) {
      for (const transaction of edge.transactions) {
        const from = nodes.get(transaction.from), to = nodes.get(transaction.to)
        if (!from || !to) continue
        const existing = transactionMap.get(transaction.id)
        if (existing) {
          if (!existing.recordIds.includes(record.id)) existing.recordIds.push(record.id)
        } else {
          transactionMap.set(transaction.id, {
            id: transaction.id, at: transaction.at, usd: transaction.usd, amount: transaction.amount,
            currency: transaction.currency, format: transaction.format, suspicious: transaction.label === 1,
            fromAccount: from.account, toAccount: to.account, fromOwner: from.entity, toOwner: to.entity, recordIds: [record.id],
          })
        }
        for (const accountId of new Set([from.account, to.account])) accountMap.get(accountId)?.transactionIds.add(transaction.id)
        for (const ownerName of new Set([from.entity, to.entity])) ownerMap.get(ownerName)?.transactionIds.add(transaction.id)
      }
    }
  }

  const owners = [...ownerMap.values()].map(owner => ({ ...owner, accountIds: sorted(owner.accountIds), transactionIds: sorted(owner.transactionIds), recordIds: sorted(owner.recordIds) })).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  const accounts = [...accountMap.values()].map(account => ({ ...account, transactionIds: sorted(account.transactionIds), recordIds: sorted(account.recordIds) })).sort((a, b) => a.id.localeCompare(b.id))
  const transactions = [...transactionMap.values()].map(transaction => ({ ...transaction, recordIds: transaction.recordIds.slice().sort() })).sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
  return { owners, accounts, transactions }
}

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
