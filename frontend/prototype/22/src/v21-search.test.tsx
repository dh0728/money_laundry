import { describe, expect, it } from 'vitest'
import { records } from './domain'
import { buildTransactionIndex, searchTransactionIndex } from './transactionIndex'

describe('v21 exact global-search targets', () => {
  it('returns the matching owner as an owner destination', () => {
    const index = buildTransactionIndex(records)
    const owner = index.owners[0]
    expect(searchTransactionIndex(index, owner.name).some(result => result.target.type === 'owner' && result.target.owner === owner.name)).toBe(true)
  })

  it('returns the matching account as an account destination', () => {
    const index = buildTransactionIndex(records)
    const account = index.accounts[0]
    expect(searchTransactionIndex(index, account.id).some(result => result.target.type === 'account' && result.target.account === account.id)).toBe(true)
  })

  it('returns the matching transaction as a transaction destination', () => {
    const index = buildTransactionIndex(records)
    const transaction = index.transactions[0]
    expect(searchTransactionIndex(index, transaction.id)).toContainEqual(expect.objectContaining({ target: { type: 'transaction', transactionId: transaction.id } }))
  })
})
