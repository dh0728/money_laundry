import type { AlertRow } from '@/api/alerts'
import { useMemoryState } from '@/lib/memory'

// mock 전용: 판정·Episode 연결 결과를 서버 대신 메모리에 남겨 목록과 상세가 같은 값을 보게 한다.
// 새로고침하면 사라진다. 실제 API에서는 요청 뒤 다시 조회하므로 쓰지 않는다.
export type AlertOverride = Pick<AlertRow, 'status' | 'resolution' | 'episodeId'>
export type AlertOverrides = Record<number, AlertOverride>

export const useAlertOverrides = () => useMemoryState<AlertOverrides>('alerts:overrides', {})

export const withOverride = <T extends AlertRow>(row: T, overrides: AlertOverrides): T =>
  overrides[row.alertId] ? { ...row, ...overrides[row.alertId] } : row
