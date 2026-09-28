import type { ExplorerAccount, ExplorerOwner, ExplorerTransaction, TransactionExplorerData } from '@/api/transactions'
import { myAlertsNormal } from './alerts'
import { currentScenario, mockFailure, type MockScenario } from './scenario'

// 소유주 이름은 예시다(실제 소유주 정보는 백엔드 private 영역).
const ownerNames = ['해오름무역', '김세탁', '바다물류', '박환전', '새벽상사', '이송금', '한강홀딩스', '최분산']
const formats = ['Wire', 'ACH', 'Cheque', 'Credit Card', 'Cash', 'Bitcoin']
const currencies: [string, number][] = [['USD', 1], ['EUR', 1.08], ['KRW', 0.00075], ['JPY', 0.0067]]

const owners: ExplorerOwner[] = ownerNames.map((name, i) => ({ ownerId: `own-${i + 1}`, name }))

const accounts: ExplorerAccount[] = owners.flatMap((owner, i) =>
  Array.from({ length: 1 + (i % 3) }, (_, j) => ({ account: `acc-${(0x4a10 + i * 16 + j).toString(16)}`, bank: 10 + ((i + j) % 5), ownerId: owner.ownerId })),
)

const transactions: ExplorerTransaction[] = Array.from({ length: 72 }, (_, i) => {
  const from = accounts[(i * 5) % accounts.length]
  let to = accounts[(i * 7 + 3) % accounts.length]
  if (to.ownerId === from.ownerId) to = accounts[(i * 7 + 4) % accounts.length]
  const [currency, rate] = currencies[i % currencies.length]
  const amountUsd = 800 + ((i * 7919) % 48_000)
  const day = 1 + (i % 26)
  const suspicious = i % 3 === 0
  return {
    txId: 900_100 + i,
    txAt: `2026-09-${String(day).padStart(2, '0')}T${String(8 + (i % 12)).padStart(2, '0')}:${String((i * 13) % 60).padStart(2, '0')}:00+09:00`,
    fromAccount: from.account,
    toAccount: to.account,
    amountPaid: Math.round((amountUsd / rate) * 100) / 100,
    paymentCurrency: currency,
    amountUsd,
    paymentFormat: formats[i % formats.length],
    isSuspicious: suspicious,
    alertIds: suspicious ? [3000 + (i % 24)] : [],
    // 연결 Alert가 Episode에 들어가 있으면 그 Episode
    episodeIds: suspicious && myAlertsNormal.content[i % 24].episodeId != null ? [myAlertsNormal.content[i % 24].episodeId!] : [],
  }
})

export const transactionExplorerNormal: TransactionExplorerData = { owners, accounts, transactions }
export const transactionExplorerEmpty: TransactionExplorerData = { owners: [], accounts: [], transactions: [] }

export function loadMockTransactionExplorer(scenario: MockScenario = currentScenario()): Promise<TransactionExplorerData> {
  if (scenario === 'error') return mockFailure()
  return Promise.resolve(scenario === 'empty' ? transactionExplorerEmpty : transactionExplorerNormal)
}
