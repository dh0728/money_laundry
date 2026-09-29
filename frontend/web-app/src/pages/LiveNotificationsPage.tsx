import { useState } from 'react'
import { fetchNotifications, fetchNotificationCases, setNotificationsRead, type WorkNotification } from '@/api/notifications'
import { PageHeading } from '@/components/page'
import { ErrorBlock, LoadingBlock } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RefreshStatus } from '@/components/RefreshStatus'
import { useAsync } from '@/lib/useAsync'
import { useViewState } from '@/lib/workspaceState'

type Open = (kind: 'ALERT' | 'EPISODE', id: number) => void
function AssignedCases({ id, onOpen, onClose }: { id: string; onOpen: Open; onClose: () => void }) {
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

export default function LiveNotificationsPage({ onOpen }: { onOpen: Open }) {
  const [from, setFrom] = useViewState('notifications/from', '')
  const [to, setTo] = useViewState('notifications/to', '')
  const [query, setQuery] = useViewState('notifications/query', '')
  const [search, setSearch] = useState(query)
  const [page, setPage] = useViewState(`notifications/page/${from}/${to}/${query}`, 0)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); setQuery(search.trim()); setPage(0); setSelected(null) }}>
      <label className="text-xs">시작일<Input aria-label="알림 시작일" type="date" value={from} onChange={e => { setFrom(e.target.value); setSelected(null) }} /></label>
      <label className="text-xs">종료일<Input aria-label="알림 종료일" type="date" value={to} onChange={e => { setTo(e.target.value); setSelected(null) }} /></label>
      <Input className="w-64" aria-label="알림 검색" placeholder="내용·Alert·Episode ID 검색" value={search} onChange={e => setSearch(e.target.value)} />
      <Button type="submit">검색</Button>
      <Button type="button" variant="outline" disabled={busy || !items.some(item => !item.read)} onClick={() => void mark(items.filter(item => !item.read).map(item => item.id), true)}>현재 페이지 모두 읽음</Button>
    </form>
    {invalidDates ? <p role="alert">시작일은 종료일보다 늦을 수 없습니다.</p> : notifications.state.status === 'loading' ? <LoadingBlock label="알림" />
      : notifications.state.status === 'error' ? <ErrorBlock message={notifications.state.message} onRetry={notifications.retry} /> : <>
        <p className="text-xs text-muted-foreground">조회 결과 {notifications.state.data.totalElements.toLocaleString()}건 · 안 읽음 {notifications.state.data.unreadCount.toLocaleString()}건</p>
        {error && <p role="alert">{error}</p>}
        {selected && <AssignedCases key={selected} id={selected} onOpen={onOpen} onClose={() => setSelected(null)} />}
        {items.length === 0 ? <p className="py-12 text-center">표시할 알림이 없습니다.</p> : <div className="grid gap-6 @5xl:grid-cols-2">
          {[false, true].map(read => <section key={String(read)} aria-label={read ? '읽음' : '안 읽음'} className="space-y-3">
            <h2>{read ? '읽음' : '안 읽음'}</h2>
            {items.filter(item => item.read === read).map(item => <article key={item.id} className="flex gap-3 rounded-lg border p-4">
              <Button variant="ghost" disabled={busy} aria-label={`${item.code} ${read ? '읽지 않음으로 표시' : '읽음으로 표시'}`} onClick={() => void mark([item.id], !read)}>{read ? '○' : '●'}</Button>
              <button type="button" disabled={busy} className="min-w-0 flex-1 text-left" onClick={() => void open(item)}>
                <h3 className="font-semibold">{item.title}{item.count > 1 ? ` · ${item.count.toLocaleString()}건` : ''}</h3>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{item.description}</p>
                <p className="mt-2 text-xs text-muted-foreground">{item.code} · {item.at.replace('T', ' ').slice(0, 19)} KST</p>
              </button>
            </article>)}
          </section>)}
        </div>}
        <div className="flex items-center gap-3"><Button disabled={page === 0} onClick={() => { setPage(page - 1); setSelected(null) }}>이전</Button>
          <span>{page + 1} / {Math.max(1, notifications.state.data.totalPages)}</span>
          <Button disabled={page + 1 >= notifications.state.data.totalPages} onClick={() => { setPage(page + 1); setSelected(null) }}>다음</Button></div>
      </>}
  </div>
}
