import type { HistoryRow } from '@/api/alerts'
import { useMemoryState } from '@/lib/memory'

// mock 전용: 관리자 검수 넘김(FE 제안) 시각과 이 화면에서 남긴 이력을 메모리에 둔다. 새로고침하면 사라진다.
export const useReviewRequests = () => useMemoryState<Record<number, string>>('episodes:review-requested', {})
export const useEpisodeHistory = (episodeId: number) => useMemoryState<HistoryRow[]>(`episode:${episodeId}:history`, [])
