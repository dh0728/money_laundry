import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { Bell, Check, ChevronDown, ChevronUp, ChevronsUpDown, Search } from 'lucide-react'
import { typeDisplay } from '@/api/codes'
import { DateRangeButton } from '@/components/DateRangeButton'
import { AgeBadge, PatternBadge, RiskBadge } from '@/components/badges'
import { PageHeading } from '@/components/page'
import { ErrorBlock, LoadingBlock } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useMemoryState } from '@/lib/memory'
import { useAsync } from '@/lib/useAsync'
import { ProvenanceBadge } from '@/components/Provenance'
import { loadMockNotifications, type NotificationItem } from '@/mocks/notifications'

type SortOrder = 'none' | 'desc' | 'asc'
const nextOrder = (order: SortOrder): SortOrder => order === 'none' ? 'desc' : order === 'desc' ? 'asc' : 'none'
const sorted = <T extends { at: string }>(items: T[], order: SortOrder) => order === 'none' ? items : [...items].sort((a, b) => order === 'desc' ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at))

export function NotificationColumn<T extends Pick<NotificationItem, 'id' | 'code' | 'title' | 'description' | 'at'> & Partial<Pick<NotificationItem, 'ageDays' | 'riskScore' | 'patternCode'>> & { count?: number }>({ label, items, order, onOrder, onOpen, read, onToggle }: {
  label: string; items: T[]; order: SortOrder; onOrder: () => void
  onOpen: (item: T) => void; read: boolean; onToggle: (id: string) => void
}) {
  const SortIcon = order === 'desc' ? ChevronDown : order === 'asc' ? ChevronUp : ChevronsUpDown
  return <section aria-label={label} className="min-w-0">
    <div className="mb-3 flex items-center gap-2">
      <Button variant="ghost" size="icon" className="size-7" aria-label={`${label} 정렬: ${order === 'desc' ? '최신순' : order === 'asc' ? '오래된순' : '기본순'}`} onClick={onOrder}><SortIcon className="size-4" /></Button>
      <h2 className="text-sm font-semibold">{label} {items.length}</h2>
    </div>
    {items.length === 0 ? <p className="rounded-lg border py-8 text-center text-xs text-muted-foreground">표시할 알림이 없습니다.</p>
      : <div className="space-y-2.5">{sorted(items, order).map(item => <article key={item.id} className="flex min-w-0 items-center gap-2.5 rounded-lg border bg-card px-3.5 py-3 transition-colors duration-150 hover:border-primary/50 hover:bg-accent/40 hover:shadow-md hover:ring-1 hover:ring-primary/30 focus-within:border-primary/50 focus-within:bg-accent/40 focus-within:shadow-md focus-within:ring-1 focus-within:ring-primary/30">
        <Button variant="ghost" size="icon" className="size-7 shrink-0 rounded-full p-0" aria-label={`${item.code} ${read ? '읽지 않음으로 표시' : '읽음으로 표시'}`} onClick={() => onToggle(item.id)}>
          <span className={`size-2.5 rounded-full ${read ? 'bg-muted-foreground/40' : 'bg-destructive'}`} aria-hidden />
        </Button>
        <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" aria-label={`${item.code} 알림 열기`} onClick={() => onOpen(item)}>
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold">{item.title}{item.count && item.count > 1 ? ` · ${item.count.toLocaleString()}건` : ''}</span>
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

export default function NotificationsPage({ onOpen }: { onOpen: (item: NotificationItem) => void }) {
  const { state, retry } = useAsync(() => loadMockNotifications(), [])
  const [read, setRead] = useMemoryState<string[]>('notifications:read', [])
  const [query, setQuery] = useState('')
  const [range, setRange] = useState<DateRange>()
  const [unreadOrder, setUnreadOrder] = useState<SortOrder>('none')
  const [readOrder, setReadOrder] = useState<SortOrder>('none')
  const items = state.status === 'success' ? state.data : []
  const text = query.trim().toLocaleLowerCase('ko')
  const visible = items.filter(item => `${item.code} ${item.title} ${item.description} ${item.patternCode === undefined ? '' : `${typeDisplay(item.patternCode).key} ${typeDisplay(item.patternCode).label}`}`.toLocaleLowerCase('ko').includes(text))
    .filter(item => (!range?.from || item.at.slice(0, 10) >= range.from.toLocaleDateString('sv-SE')) && (!range?.to || item.at.slice(0, 10) <= range.to.toLocaleDateString('sv-SE')))
  const unread = visible.filter(item => !read.includes(item.id))
  const readItems = visible.filter(item => read.includes(item.id))
  const toggle = (id: string) => setRead(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
  const open = (item: NotificationItem) => { setRead(current => current.includes(item.id) ? current : [...current, item.id]); onOpen(item) }

  return <div className="space-y-4">
    <PageHeading title="알림" description="배정과 연결, 조사 의견, 검수 결과를 확인합니다." badge={<ProvenanceBadge kind="mock" />} />
    {state.status === 'loading' ? <LoadingBlock label="알림" /> : state.status === 'error' ? <ErrorBlock message={state.message} onRetry={retry} /> : <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-72 max-w-full"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="알림 검색" className="h-9 pl-9 text-xs" placeholder="내용·Alert·Episode ID 검색" value={query} onChange={event => setQuery(event.target.value)} /></div>
        <DateRangeButton value={range} onChange={setRange} today={new Date(2026, 8, 26)} />
        <Button variant="ghost" size="sm" className="ml-auto" disabled={items.every(item => read.includes(item.id))} onClick={() => setRead(items.map(item => item.id))}><Check className="size-3.5" />모두 읽음 처리</Button>
      </div>
      {visible.length === 0 ? <p className="rounded-lg border py-16 text-center text-sm text-muted-foreground"><Bell className="mx-auto mb-4 size-7" />{items.length ? '조건에 맞는 알림이 없습니다.' : '표시할 알림이 없습니다.'}</p>
        : <div className="grid gap-6 @5xl:grid-cols-2" data-testid="notification-list">
          <NotificationColumn label="안 읽음" items={unread} order={unreadOrder} onOrder={() => setUnreadOrder(nextOrder)} onOpen={open} read={false} onToggle={toggle} />
          <NotificationColumn label="읽음" items={readItems} order={readOrder} onOrder={() => setReadOrder(nextOrder)} onOpen={open} read onToggle={toggle} />
        </div>}
    </>}
  </div>
}
