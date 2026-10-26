import { getJson, type IsoDate, type IsoDateTime } from './common'

// 백엔드에 새로 요청할 거래 탐색 API. 계약에 없으므로 지금은 mock으로만 채운다.
// 거래 필드 이름은 API.md §2.4 거래 행을 따르고, 소유주·계좌 목록과 연결 Alert·Episode를 더했다.
export type ExplorerOwner = { ownerId: string; name: string }
export type ExplorerAccount = { account: string; bank: number; ownerId: string }
export type ExplorerTransaction = {
  txId: number
  txAt: IsoDateTime
  fromAccount: string
  toAccount: string
  amountPaid: number
  paymentCurrency: string
  amountUsd: number
  paymentFormat: string
  isSuspicious: boolean
  alertIds: number[]
  episodeIds: number[]
}
export type TransactionExplorerData = {
  owners: ExplorerOwner[]
  accounts: ExplorerAccount[]
  transactions: ExplorerTransaction[]
}

export type TransactionExplorerRange = { from?: IsoDate; to?: IsoDate }

export const fetchTransactionExplorer = (range: TransactionExplorerRange = {}) =>
  getJson<TransactionExplorerData>('/api/v1/transactions/explorer', range)
