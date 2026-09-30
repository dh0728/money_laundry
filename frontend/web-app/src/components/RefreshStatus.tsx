import { Button } from '@/components/ui/button'
import { live } from '@/lib/apiMode'

type Query = { refreshing: boolean; refreshError?: string; refresh: () => Promise<unknown> }
export function RefreshStatus({ queries }: { queries: Query[] }) {
  const refreshing = queries.some(query => query.refreshing)
  const error = queries.find(query => query.refreshError)?.refreshError
  if (live) return error ? <div role="alert" className="text-right text-xs">최신 조회 실패 · 이전 데이터를 표시합니다. {error}</div> : null
  return <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
    {error && <span role="alert">최신 조회 실패 · 이전 데이터를 표시합니다. {error}</span>}
    <Button variant="outline" size="sm" disabled={refreshing} onClick={() => { void Promise.allSettled(queries.map(query => query.refresh())) }}>{refreshing ? '갱신 중…' : '새로고침'}</Button>
  </div>
}
