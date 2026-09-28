import { useMemo } from 'react'
import { fetchTransactionExplorer } from '@/api/transactions'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import TransactionExplorer from '@/features/transactions/TransactionExplorer'
import { TransactionsHeading } from '@/features/transactions/TransactionsHeading'
import { buildTransactionIndex } from '@/features/transactions/transactionIndex'
import { useAsync } from '@/lib/useAsync'
import { loadMockTransactionExplorer } from '@/mocks/transactions'
import { live } from '@/lib/apiMode'

// mock 거래는 2026-09-01 ~ 09-26 사이에 있다
const today = () => (live ? new Date() : new Date(2026, 8, 26))

const heading = <TransactionsHeading />

export default function TransactionsPage() {
  const { state, retry } = useAsync(() => (live ? fetchTransactionExplorer() : loadMockTransactionExplorer()), [])
  const index = useMemo(() => (state.status === 'success' ? buildTransactionIndex(state.data) : null), [state])
  if (state.status === 'loading') return <>{heading}<LoadingBlock label="거래 내역" /></>
  if (state.status === 'error') return <>{heading}<ErrorBlock message={state.message} onRetry={retry} /></>
  if (!index?.transactions.length) return <>{heading}<EmptyBlock>조회된 거래가 없습니다.</EmptyBlock></>
  return <TransactionExplorer index={index} today={today()} />
}
