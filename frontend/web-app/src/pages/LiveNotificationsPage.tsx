import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { Check, Search } from 'lucide-react'
import { fetchNotifications, fetchNotificationCases, setNotificationsRead, type WorkNotification } from '@/api/notifications'
import { PageHeading } from '@/components/page'
import { ErrorBlock } from '@/components/states'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateRangeButton } from '@/components/DateRangeButton'
import { RefreshStatus } from '@/components/RefreshStatus'
import { useAsync } from '@/lib/useAsync'
import { useViewState } from '@/lib/workspaceState'
import { NotificationColumn } from './NotificationsPage'

type Open = (kind: 'ALERT' | 'EPISODE', id: number) => void
function NotificationColumnSkeleton({ label }: { label: string }) {
  return <section aria-label={label} className="min-w-0">
    <div className="mb-3 flex items-center gap-2"><Skeleton className="size-7" /><h2 className="text-sm font-semibold">{label}</h2><Skeleton className="h-4 w-5" /></div>
    <div className="space-y-2.5">{[0, 1, 2].map(index => <article key={index} className="flex min-w-0 items-center gap-2.5 rounded-lg border bg-card px-3.5 py-3">
      <Skeleton className="size-7 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-1/3" /></div>
    </article>)}</div>
  </section>
}

function AssignedCases({ id, onOpen, onClose }: { id: string; onOpen: Open; onClose: () => void }) {
  const [page, setPage] = useState(0)
  const cases = useAsync(() => fetchNotificationCases(id, page), [id, page], { key: 'notifications/cases' })
  return <section aria-label="배정된 Alert" className="space-y-3 rounded-lg border p-4">
    <div className="flex items-center justify-between"><h2>배정된 Alert</h2><Button variant="ghost" onClick={onClose}>목록 닫기</Button></div>
    {cases.state.status === 'loading' ? <div role="status" aria-label="배정된 Alert 불러오는 중" className="space-y-2"><Skeleton className="h-3 w-24" /><div className="flex gap-2"><Skeleton className="h-9 w-24" /><Skeleton className="h-9 w-24" /></div></div> : cases.state.status === 'error'
      ? <ErrorBlock message={cases.state.message} onRetry={cases.retry} /> : <>
        <p className="text-xs text-muted-foreground">총 {cases.state.data.totalElements.toLocaleString()}건</p>
        {cases.state.data.content.map(c => <Button key={c.caseId} variant="outline" className="mr-2 mb-2" onClick={() => onOpen(c.kind, c.caseId)}>
          {c.kind === 'ALERT' ? `A-${c.alertId}` : `E-${c.caseId}`} · {c.status === 'OPEN' ? '미종결' : '종결'}
        </Button>)}
        <div className="flex gap-2"><Button disabled={page === 0} onClick={() => setPage(page - 1)}>이전 사건</Button><Button disabled={page + 1 >= cases.state.data.totalPages} onClick={() => setPage(page + 1)}>다음 사건</Button></div>
      </>}
  </section>
}

export default function LiveNotificationsPage({ onOpen }: { onOpen: Open }) {
  const [from, setFrom] = useViewState('notifications/from', '')
  const [to, setTo] = useViewState('notifications/to', '')
  const [query, setQuery] = useViewState('notifications/query', '')
  const [search, setSearch] = useState(query)
  const [page, setPage] = useViewState(`notifications/page/${from}/${to}/${query}`, 0)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [unreadOrder, setUnreadOrder] = useState<'none' | 'desc' | 'asc'>('none')
  const [readOrder, setReadOrder] = useState<'none' | 'desc' | 'asc'>('none')
  const [error, setError] = useState('')
  const range: DateRange | undefined = from || to ? { from: from ? new Date(`${from}T00:00:00`) : undefined, to: to ? new Date(`${to}T00:00:00`) : undefined } : undefined
  const invalidDates = Boolean(from && to && from > to)
  const notifications = useAsync(() => fetchNotifications(from, to, query, page), [from, to, query, page], { key: 'notifications', enabled: !invalidDates })
  const items = notifications.state.status === 'success' ? notifications.state.data.content : []
  const mark = async (ids: string[], read: boolean) => {
    setBusy(true); setError('')
    try { await setNotificationsRead(ids, read); await notifications.refresh(); return true }
    catch { setError('읽음 상태를 변경하거나 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.'); return false }
    finally { setBusy(false) }
  }
  const open = async (item: WorkNotification) => {
    if (!item.read && !await mark([item.id], true)) return
    if (item.caseId !== null) onOpen(item.caseKind, item.caseId)
    else setSelected(item.id)
  }
  return <div className="space-y-4">
    <PageHeading title="알림" description="내 업무의 실제 배정·의견·편입·종결 이력입니다. 분석별 Alert 배정은 한 알림으로 묶어 표시합니다." />
    <RefreshStatus queries={[notifications]} />
    <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); setQuery(search.trim()); setPage(0); setSelected(null) }}>
      <div className="relative w-72 max-w-full"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="h-9 pl-9 text-xs" aria-label="알림 검색" placeholder="내용·Alert·Episode ID 검색" value={search} onChange={e => setSearch(e.target.value)} /><button type="submit" className="sr-only">검색</button></div>
      <DateRangeButton value={range} onChange={next => { setFrom(next?.from?.toLocaleDateString('sv-SE') ?? ''); setTo(next?.to?.toLocaleDateString('sv-SE') ?? ''); setPage(0); setSelected(null) }} today={new Date()} />
      <Button type="button" variant="ghost" size="sm" className="ml-auto" disabled={busy || !items.some(item => !item.read)} onClick={() => void mark(items.filter(item => !item.read).map(item => item.id), true)}><Check className="size-3.5" />현재 페이지 모두 읽음</Button>
    </form>
    {invalidDates ? <p role="alert">시작일은 종료일보다 늦을 수 없습니다.</p> : notifications.state.status === 'loading' ? <div role="status" aria-label="알림 불러오는 중" className="space-y-4"><p className="flex items-center gap-2 text-xs text-muted-foreground">조회 결과 <Skeleton className="h-3 w-8" />건 · 안 읽음 <Skeleton className="h-3 w-8" />건</p><div className="grid gap-6 @5xl:grid-cols-2" data-testid="notification-list"><NotificationColumnSkeleton label="안 읽음" /><NotificationColumnSkeleton label="읽음" /></div><div className="flex items-center gap-3"><Button disabled>이전</Button><Skeleton className="h-4 w-10" /><Button disabled>다음</Button></div></div>
      : notifications.state.status === 'error' ? <ErrorBlock message={notifications.state.message} onRetry={notifications.retry} /> : <>
        <p className="text-xs text-muted-foreground">조회 결과 {notifications.state.data.totalElements.toLocaleString()}건 · 안 읽음 {notifications.state.data.unreadCount.toLocaleString()}건</p>
        {error && <p role="alert">{error}</p>}
        {selected && <AssignedCases key={selected} id={selected} onOpen={onOpen} onClose={() => setSelected(null)} />}
        <div className="grid gap-6 @5xl:grid-cols-2" data-testid="notification-list">
          <NotificationColumn label="안 읽음" items={items.filter(item => !item.read)} order={unreadOrder} onOrder={() => setUnreadOrder(current => current === 'none' ? 'desc' : current === 'desc' ? 'asc' : 'none')} onOpen={item => void open(item)} read={false} onToggle={id => { if (!busy) void mark([id], true) }} />
          <NotificationColumn label="읽음" items={items.filter(item => item.read)} order={readOrder} onOrder={() => setReadOrder(current => current === 'none' ? 'desc' : current === 'desc' ? 'asc' : 'none')} onOpen={item => void open(item)} read onToggle={id => { if (!busy) void mark([id], false) }} />
        </div>
        <div className="flex items-center gap-3"><Button disabled={page === 0} onClick={() => { setPage(page - 1); setSelected(null) }}>이전</Button>
          <span>{page + 1} / {Math.max(1, notifications.state.data.totalPages)}</span>
          <Button disabled={page + 1 >= notifications.state.data.totalPages} onClick={() => { setPage(page + 1); setSelected(null) }}>다음</Button></div>
      </>}
  </div>
}
