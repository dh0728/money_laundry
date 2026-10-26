import { useState } from 'react'
import { live } from '@/lib/apiMode'
import { fetchNotifications, setNotificationsRead } from '@/api/notifications'
import { AssignedCases } from '@/features/notifications/AssignedCases'
import { RefreshStatus } from '@/components/RefreshStatus'
import { useMemoryState } from '@/lib/memory'
import { useSharedPeriod, useViewState } from '@/lib/workspaceState'
import type { DateRange } from 'react-day-picker'
import { Bell, Check, ChevronDown, ChevronUp, ChevronsUpDown, Search } from 'lucide-react'
import { typeDisplay } from '@/api/codes'
import { DateRangeButton } from '@/components/DateRangeButton'
import { AgeBadge, PatternBadge, RiskBadge } from '@/components/badges'
import { PageHeading } from '@/components/page'
import { ErrorBlock, LoadingBlock } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAsync } from '@/lib/useAsync'
import { ProvenanceBadge } from '@/components/Provenance'
import { loadMockNotifications, type NotificationItem } from '@/mocks/notifications'

type DisplayNotification = Omit<NotificationItem, 'kind'> & { read?: boolean; batchId?: string }
type SortOrder = 'none' | 'desc' | 'asc'
const nextOrder = (order: SortOrder): SortOrder => order === 'none' ? 'desc' : order === 'desc' ? 'asc' : 'none'
const sorted = (items: DisplayNotification[], order: SortOrder) => order === 'none' ? items : [...items].sort((a, b) => order === 'desc' ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at))

function NotificationColumn({ label, items, order, onOrder, onOpen, read, onToggle, busy }: {
  label: string; items: DisplayNotification[]; order: SortOrder; onOrder: () => void
  onOpen: (item: DisplayNotification) => void; read: boolean; onToggle: (id: string) => void; busy?: boolean
}) {
  const SortIcon = order === 'desc' ? ChevronDown : order === 'asc' ? ChevronUp : ChevronsUpDown
  return <section aria-label={label} className="min-w-0">
    <div className="mb-3 flex items-center gap-2">
      <Button variant="ghost" size="icon" className="size-7" aria-label={`${label} 정렬: ${order === 'desc' ? '최신순' : order === 'asc' ? '오래된순' : '기본순'}`} onClick={onOrder}><SortIcon className="size-4" /></Button>
      <h2 className="text-sm font-semibold">{label} {items.length}</h2>
    </div>
    {items.length === 0 ? <p className="rounded-lg border py-8 text-center text-xs text-muted-foreground">표시할 알림이 없습니다.</p>
      : <div className="space-y-2.5">{sorted(items, order).map(item => <article key={item.id} className="flex min-w-0 items-center gap-2.5 rounded-lg border bg-card px-3.5 py-3">
        <Button variant="ghost" size="icon" className="size-7 shrink-0 rounded-full p-0" aria-label={`${item.code} ${read ? '읽지 않음으로 표시' : '읽음으로 표시'}`} disabled={busy} onClick={() => onToggle(item.id)}>
          <span className={`size-2.5 rounded-full ${read ? 'bg-muted-foreground/40' : 'bg-destructive'}`} aria-hidden />
        </Button>
        <button type="button" className="min-w-0 flex-1 text-left" aria-label={`${item.code} 알림 열기`} disabled={busy} onClick={() => onOpen(item)}>
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold">{item.title}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              {item.ageDays !== undefined && <AgeBadge days={item.ageDays} />}
              {item.riskScore !== undefined && <RiskBadge score={item.riskScore} />}
            </span>
          </span>
          <p className="mt-1.5 text-xs text-muted-foreground">{item.description}</p>
          {item.patternCode !== undefined && <span className="mt-2.5 flex flex-wrap items-center gap-1.5"><PatternBadge code={item.patternCode} /></span>}
          <p className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground"><span className="font-mono">{item.code}</span><span>{item.at.slice(0, 10)}</span></p>
        </button>
      </article>)}</div>}
  </section>
}

export default function NotificationsPage({ onOpen, remote = live }: { onOpen: (item: DisplayNotification) => void; remote?: boolean }) {
  const [read, setRead] = useMemoryState<string[]>('notifications:read', [])
  const { businessDate } = useSharedPeriod()
  const [query, setQuery] = useViewState('notifications/query', '')
  const [range, setRange] = useViewState<DateRange | undefined>('notifications/range', undefined)
  const [page, setPage] = useViewState(`notifications/page/${query}/${range?.from}/${range?.to}`, 0)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const from = range?.from?.toLocaleDateString('sv-SE') ?? ''
  const to = range?.to?.toLocaleDateString('sv-SE') ?? ''
  const notifications = useAsync(async () => {
    if (!remote) {
      const content = await loadMockNotifications()
      return { content: content as DisplayNotification[], totalElements: content.length, totalPages: 1 }
    }
    const result = await fetchNotifications(from, to, query, page)
    return { ...result, content: result.content.map(item => ({
      id: item.id, title: item.title + (item.count > 1 ? ` · ${item.count.toLocaleString()}건` : ''),
      description: item.description, code: item.code, at: item.at, read: item.read,
      target: { page: item.caseKind === 'ALERT' ? 'alerts' as const : 'episodes' as const, id: item.caseId ?? 0 },
      batchId: item.caseId === null ? item.id : undefined,
    })) as DisplayNotification[] }
  }, [remote, from, to, query, page], { key: 'notifications' })
  const { state, retry } = notifications
  const [unreadOrder, setUnreadOrder] = useState<SortOrder>('none')
  const [readOrder, setReadOrder] = useState<SortOrder>('none')
  const items = state.status === 'success' ? state.data.content : []
  const text = query.trim().toLocaleLowerCase('ko')
  const visible = remote ? items : items.filter(item => `${item.code} ${item.title} ${item.description} ${item.patternCode === undefined ? '' : typeDisplay(item.patternCode).label}`.toLocaleLowerCase('ko').includes(text))
    .filter(item => (!from || item.at.slice(0, 10) >= from) && (!to || item.at.slice(0, 10) <= to))
  const isRead = (item: DisplayNotification) => remote ? item.read : read.includes(item.id)
  const unread = visible.filter(item => !isRead(item))
  const readItems = visible.filter(isRead)
  const mark = async (ids: string[], value: boolean) => {
    if (busy) return false
    setBusy(true); setError('')
    try {
      if (remote) { await setNotificationsRead(ids, value); await notifications.refresh() }
      else setRead(current => value ? [...new Set([...current, ...ids])] : current.filter(id => !ids.includes(id)))
      return true
    } catch { setError('읽음 상태를 변경하거나 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.'); return false }
    finally { setBusy(false) }
  }
  const toggle = (id: string) => { const item = items.find(item => item.id === id); if (item) void mark([id], !isRead(item)) }
  const open = async (item: DisplayNotification) => {
    if (!isRead(item) && !await mark([item.id], true)) return
    if (item.batchId) setSelected(item.batchId)
    else onOpen(item)
  }

  return <div className="space-y-4">
    <PageHeading title="알림" description="배정과 연결, 조사 의견, 검수 결과를 확인합니다." badge={remote ? undefined : <ProvenanceBadge kind="mock" />} />
    <RefreshStatus queries={[notifications]} />
    {error && <p role="alert">{error}</p>}
    {selected && <AssignedCases id={selected} onClose={() => setSelected(null)} onOpen={(kind, id) => onOpen({ id: String(id), code: String(id), title: '', description: '', at: '', target: { page: kind === 'ALERT' ? 'alerts' : 'episodes', id } })} />}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-72 max-w-full"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="알림 검색" className="h-9 pl-9 text-xs" placeholder="내용·Alert·Episode ID 검색" value={query} onChange={event => setQuery(event.target.value)} /></div>
        <DateRangeButton value={range} onChange={setRange} today={remote ? (businessDate ? new Date(`${businessDate}T00:00:00`) : new Date()) : new Date(2026, 8, 26)} />
        <Button variant="ghost" size="sm" className="ml-auto" disabled={busy || !unread.length} onClick={() => void mark(unread.map(item => item.id), true)}><Check className="size-3.5" />{remote ? '현재 페이지 모두 읽음' : '모두 읽음 처리'}</Button>
      </div>
      {state.status === 'loading' ? <LoadingBlock label="알림" /> : state.status === 'error' ? <ErrorBlock message={state.message} onRetry={retry} /> : <>
      {visible.length === 0 ? <p className="rounded-lg border py-16 text-center text-sm text-muted-foreground"><Bell className="mx-auto mb-4 size-7" />{items.length ? '조건에 맞는 알림이 없습니다.' : '표시할 알림이 없습니다.'}</p>
        : <div className="grid gap-6 @5xl:grid-cols-2" data-testid="notification-list">
          <NotificationColumn label="안 읽음" items={unread} order={unreadOrder} onOrder={() => setUnreadOrder(nextOrder)} onOpen={open} read={false} onToggle={toggle} busy={busy} />
          <NotificationColumn label="읽음" items={readItems} order={readOrder} onOrder={() => setReadOrder(nextOrder)} onOpen={open} read onToggle={toggle} busy={busy} />
        </div>}
      {remote && <div className="flex items-center gap-3 text-xs"><span>전체 {state.data.totalElements.toLocaleString()}건</span><Button disabled={page === 0} onClick={() => { setPage(page - 1); setSelected(null) }}>이전</Button><span>{page + 1} / {Math.max(1, state.data.totalPages)}</span><Button disabled={page + 1 >= state.data.totalPages} onClick={() => { setPage(page + 1); setSelected(null) }}>다음</Button></div>}
    </>}
  </div>
}
