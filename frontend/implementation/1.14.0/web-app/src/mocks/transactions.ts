import type { ExplorerAccount, ExplorerOwner, ExplorerTransaction, TransactionExplorerData } from '@/api/transactions'
import { detailOf } from './alertDetail'
import { allAlertsNormal } from './alerts'
import { seoulIso } from './time'
import { currentScenario, mockFailure, type MockScenario } from './scenario'

// 거래 내역 mock은 Alert 상세 mock의 거래로 만든다. 그래야 Alert·Episode 화면에서 거래·계좌·소유주를 눌러
// 거래 내역으로 넘어왔을 때 같은 항목이 있다. 소유주 이름은 예시다(FE 제안 필드).
const details = allAlertsNormal.content.map(detailOf)

const transactions: ExplorerTransaction[] = details.flatMap(detail => {
  const alertTx = detail.transactions.map(t => ({
    txId: t.txId, txAt: t.txAt, fromAccount: t.fromAccount, toAccount: t.toAccount,
    amountPaid: t.amountPaid, paymentCurrency: t.paymentCurrency, amountUsd: t.amountUsd, paymentFormat: t.paymentFormat,
    isSuspicious: t.isSuspicious, alertIds: [detail.alertId], episodeIds: detail.episodeId != null ? [detail.episodeId] : [],
  }))
  // Alert 밖의 평범한 거래 한 건(대표 계좌가 받은 소액 입금). 거래 내역에는 의심 거래만 있지 않다.
  const first = detail.transactions[0]
  const amount = 1_200 + (detail.alertId % 7) * 150
  const outside: ExplorerTransaction = {
    txId: detail.alertId * 100 + 99,
    txAt: seoulIso(new Date(first.txAt).getTime() - 5 * 86_400_000),
    fromAccount: detail.transactions.find(t => t.toAccount === detail.subjectAccount.account)?.fromAccount ?? first.fromAccount,
    toAccount: detail.subjectAccount.account,
    amountPaid: amount, paymentCurrency: 'USD', amountUsd: amount, paymentFormat: 'ACH', isSuspicious: false, alertIds: [], episodeIds: [],
  }
  return [...alertTx, outside]
})

const ownerByAccount = new Map<string, string>()
const bankByAccount = new Map<string, number>()
for (const t of details.flatMap(d => d.transactions)) {
  if (t.fromOwnerName) ownerByAccount.set(t.fromAccount, t.fromOwnerName)
  if (t.toOwnerName) ownerByAccount.set(t.toAccount, t.toOwnerName)
  bankByAccount.set(t.fromAccount, t.fromBank)
  bankByAccount.set(t.toAccount, t.toBank)
}
const ownerId = (name: string) => `own-${name}`
const owners: ExplorerOwner[] = [...new Set(ownerByAccount.values())].map(name => ({ ownerId: ownerId(name), name }))
const accounts: ExplorerAccount[] = [...ownerByAccount].map(([account, name]) => ({ account, bank: bankByAccount.get(account) ?? 0, ownerId: ownerId(name) }))

export const transactionExplorerNormal: TransactionExplorerData = { owners, accounts, transactions }
export const transactionExplorerEmpty: TransactionExplorerData = { owners: [], accounts: [], transactions: [] }

export function loadMockTransactionExplorer(scenario: MockScenario = currentScenario()): Promise<TransactionExplorerData> {
  if (scenario === 'error') return mockFailure('거래 내역을 불러오지 못했습니다.')
  return Promise.resolve(scenario === 'empty' ? transactionExplorerEmpty : transactionExplorerNormal)
}
