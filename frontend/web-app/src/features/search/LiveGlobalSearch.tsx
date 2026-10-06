import { useState } from 'react'
import { Search } from 'lucide-react'
import { fetchReviewCases } from '@/api/liveReview'
import { fetchNotifications } from '@/api/notifications'
import type { Page } from '@/app/navigation'
import { Input } from '@/components/ui/input'
import { useAsync } from '@/lib/useAsync'

export default function LiveGlobalSearch({ onNavigate }: { onNavigate: (page: Page, id?: number) => void }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const alerts = useAsync(() => fetchReviewCases({ kind: 'ALERT', size: 100 }), [], { key: 'search/alerts', enabled: open })
  const episodes = useAsync(() => fetchReviewCases({ kind: 'EPISODE', size: 100 }), [], { key: 'search/episodes', enabled: open })
  const notifications = useAsync(() => fetchNotifications('', '', '', 0), ['', '', '', 0], { key: 'notifications', enabled: open })
  const q = query.trim().toLowerCase()
  const results = [
    ...(alerts.state.status === 'success' ? alerts.state.data.content.map(row => ({ key: `a-${row.caseId}`, label: `A-${row.alertId ?? row.caseId} · ${row.assigneeName}`, page: 'alerts' as const, id: row.caseId })) : []),
    ...(episodes.state.status === 'success' ? episodes.state.data.content.map(row => ({ key: `e-${row.caseId}`, label: `E-${row.caseId} · ${row.assigneeName}`, page: 'episodes' as const, id: row.caseId })) : []),
    ...(notifications.state.status === 'success' ? notifications.state.data.content.filter(row => row.caseId != null).map(row => ({ key: `n-${row.id}`, label: `${row.title} · ${row.code}`, page: row.caseKind === 'ALERT' ? 'alerts' as const : 'episodes' as const, id: row.caseId ?? undefined })) : []),
  ].filter(row => row.label.toLowerCase().includes(q)).slice(0, 8)
  const navigate = (page: Page, id?: number) => { onNavigate(page, id); setQuery(''); setOpen(false) }
  return <div className="relative min-w-0 w-full"><Search className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-muted-foreground" /><Input aria-label="전역 검색" placeholder="상위 100건의 조사 사건 빠른 찾기" className="h-9 rounded-full bg-muted/40 pl-9" value={query} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={event => { setQuery(event.target.value); setOpen(true) }} />{open && q && <div role="listbox" aria-label="검색 결과" className="absolute z-50 mt-2 max-h-72 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-lg">{results.length ? results.map(row => <button role="option" aria-selected={false} type="button" key={row.key} className="block w-full rounded-md p-2 text-left text-xs hover:bg-accent" onMouseDown={event => event.preventDefault()} onClick={() => navigate(row.page, row.id)}>{row.label}</button>) : <p className="p-3 text-xs text-muted-foreground">{alerts.state.status === 'loading' || episodes.state.status === 'loading' ? '불러오는 중…' : '상위 100건에서 일치하는 사건이 없습니다.'}</p>}<div className="border-t p-2 text-xs text-muted-foreground">전체 조회는 각 목록, 소유주·계좌·거래는 거래 내역에서 확인</div></div>}</div>
}
