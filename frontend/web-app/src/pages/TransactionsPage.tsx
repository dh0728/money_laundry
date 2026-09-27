import { useMemo } from 'react'
import { fetchTransactionExplorer } from '@/api/transactions'
import { PageHeading } from '@/components/page'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import TransactionExplorer from '@/features/transactions/TransactionExplorer'
import { buildTransactionIndex } from '@/features/transactions/transactionIndex'
import { useAsync } from '@/lib/useAsync'
import { loadMockTransactionExplorer } from '@/mocks/transactions'

const live = import.meta.env.VITE_API_MODE === 'live'
// mock 거래는 2026-09-01 ~ 09-26 사이에 있다
const today = () => (live ? new Date() : new Date(2026, 8, 26))

export default function TransactionsPage() {
  const { state, retry } = useAsync(() => (live ? fetchTransactionExplorer() : loadMockTransactionExplorer()), [])
  const index = useMemo(() => (state.status === 'success' ? buildTransactionIndex(state.data) : null), [state])
  if (state.status === 'loading') return <><PageHeading title="거래 내역" description="소유주에서 계좌와 거래로 이어지는 구조를 단계별로 확인합니다." /><LoadingBlock label="거래 내역" /></>
  if (state.status === 'error') return <><PageHeading title="거래 내역" description="소유주에서 계좌와 거래로 이어지는 구조를 단계별로 확인합니다." /><ErrorBlock message={state.message} onRetry={retry} /></>
  if (!index?.transactions.length) return <><PageHeading title="거래 내역" description="소유주에서 계좌와 거래로 이어지는 구조를 단계별로 확인합니다." /><EmptyBlock>조회된 거래가 없습니다.</EmptyBlock></>
  return <TransactionExplorer index={index} today={today()} />
}
