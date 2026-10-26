import { useEffect, useMemo, useState } from 'react'
import { fetchTransactionExplorer } from '@/api/transactions'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/states'
import TransactionExplorer from '@/features/transactions/TransactionExplorer'
import { buildTransactionIndex } from '@/features/transactions/transactionIndex'
import { useTransactionTarget } from '@/features/transactions/transactionTarget'
import { useAsync } from '@/lib/useAsync'
import { loadMockTransactionExplorer } from '@/mocks/transactions'
import { live } from '@/lib/apiMode'

// mock 거래는 2026-09-01 ~ 09-26 사이에 있다
const today = () => (live ? new Date() : new Date(2026, 8, 26))

export default function TransactionsPage() {
  const { state, retry } = useAsync(() => (live ? fetchTransactionExplorer() : loadMockTransactionExplorer()), [])
  const index = useMemo(() => (state.status === 'success' ? buildTransactionIndex(state.data) : null), [state])
  // 전역 검색·거래 표에서 넘어온 대상을 한 번 받아 두고 저장소는 비운다
  const [pendingTarget, setPendingTarget] = useTransactionTarget()
  const [target, setTarget] = useState(pendingTarget)
  // 이 화면에 있는 동안 새 대상이 오면 바로 반영하고(렌더 중 자기 상태 맞추기), 화면을 떠날 때 저장소를 비운다
  if (pendingTarget && pendingTarget !== target) setTarget(pendingTarget)
  useEffect(() => () => setPendingTarget(null), [setPendingTarget])
  if (state.status === 'loading') return <LoadingBlock label="거래 내역" />
  if (state.status === 'error') return <ErrorBlock message={state.message} onRetry={retry} />
  if (!index?.transactions.length) return <EmptyBlock>조회된 거래가 없습니다.</EmptyBlock>
  // 대상이 바뀌면 탐색 화면을 새로 열어 그 대상을 처음 선택 상태로 둔다
  return <TransactionExplorer key={JSON.stringify(target)} index={index} target={target ?? undefined} today={today()} />
}
