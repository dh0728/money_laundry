import { describe, expect, it } from 'vitest'
import { detailOf } from './alertDetail'
import { allAlertsNormal } from './alerts'
import { withoutTransactions } from './transactionScope'

describe('mock 거래 조사 범위', () => {
  it('제외한 거래를 상세·금액·계좌 집계에서 함께 제거한다', () => {
    const detail = detailOf(allAlertsNormal.content[0])
    const excluded = detail.transactions[0]
    const result = withoutTransactions(detail, [excluded.txId])
    expect(result.transactions).toHaveLength(detail.transactions.length - 1)
    expect(result.txCount).toBe(detail.txCount - 1)
    expect(result.totalAmountUsd).toBe(result.transactions.reduce((sum, row) => sum + row.amountUsd, 0))
    expect(result.accounts.find(row => row.account === excluded.toAccount)?.inCount)
      .toBe(detail.accounts.find(row => row.account === excluded.toAccount)!.inCount - 1)
  })
})
