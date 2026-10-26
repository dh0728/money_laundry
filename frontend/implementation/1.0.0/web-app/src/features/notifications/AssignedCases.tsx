import { useState } from 'react'
import { fetchNotificationCases } from '@/api/notifications'
import { useAsync } from '@/lib/useAsync'
import { Button } from '@/components/ui/button'
import { ErrorBlock, LoadingBlock } from '@/components/states'
type Open = (kind: 'ALERT' | 'EPISODE', id: number) => void
export function AssignedCases({ id, onOpen, onClose }: { id: string; onOpen: Open; onClose: () => void }) {
  const [page, setPage] = useState(0)
  const cases = useAsync(() => fetchNotificationCases(id, page), [id, page], { key: 'notifications/cases' })
  return <section aria-label="배정된 Alert" className="space-y-3 rounded-lg border p-4">
    <div className="flex items-center justify-between"><h2>배정된 Alert</h2><Button variant="ghost" onClick={onClose}>목록 닫기</Button></div>
    {cases.state.status === 'loading' ? <LoadingBlock label="배정된 Alert" /> : cases.state.status === 'error'
      ? <ErrorBlock message={cases.state.message} onRetry={cases.retry} /> : <>
        <p className="text-xs text-muted-foreground">총 {cases.state.data.totalElements.toLocaleString()}건</p>
        {cases.state.data.content.map(c => <Button key={c.caseId} variant="outline" className="mr-2 mb-2" onClick={() => onOpen(c.kind, c.caseId)}>
          {c.kind === 'ALERT' ? `A-${c.alertId}` : `E-${c.caseId}`} · {c.status === 'OPEN' ? '미종결' : '종결'}
        </Button>)}
        <div className="flex gap-2"><Button disabled={page === 0} onClick={() => setPage(page - 1)}>이전 사건</Button><Button disabled={page + 1 >= cases.state.data.totalPages} onClick={() => setPage(page + 1)}>다음 사건</Button></div>
      </>}
  </section>
}

