import { useMemoryState } from '@/lib/memory'
import type { TransactionTarget } from './transactionIndex'

// 다른 화면(전역 검색·거래 표)에서 거래 내역을 열 때 처음 선택할 소유주·계좌·거래.
// 받는 쪽이 한 번 쓰면 지운다(다시 메뉴로 들어오면 처음 상태).
export const useTransactionTarget = () => useMemoryState<TransactionTarget | null>('transactions:target', null)
