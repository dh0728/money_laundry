import { useRef, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { useTheme } from 'next-themes'
import { Camera, Monitor, Laptop, Bell, Check, Sun, Moon, LaptopMinimal, RotateCcw, Search, History } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { DateRangeButton, PatternBadge, SortIcon } from './shared'
import type { RecordItem } from './domain'
import { useMemoryState } from './memory'

export function Account({ user, onLogout }: { user: string; onLogout: () => void }) {
  const [sessions, setSessions] = useState(['current', 'other-1', 'other-2']), [picture, setPicture] = useState('')
  const file = useRef<HTMLInputElement>(null)
  // Figma v17 리뷰: Settings와 동일하게 박스 없는 section. 좌=프로필, 우=세션 관리(button은 heading 우측).
  return (
    <div className="grid gap-8 @5xl:grid-cols-2">
      <section className="space-y-6">
        <h2 className="text-lg font-bold tracking-tight">프로필</h2>
        <div className="flex items-center gap-5">
          <Avatar className="size-18"><AvatarImage src={picture} /><AvatarFallback className="text-xl">{user[0]}</AvatarFallback></Avatar>
          <div><p className="font-semibold">{user}</p><Button variant="outline" size="sm" className="mt-2 text-xs" onClick={() => file.current?.click()}><Camera className="size-3.5" />이미지 변경</Button><input hidden ref={file} type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) setPicture(URL.createObjectURL(f)) }} /></div>
        </div>
        <dl className="grid grid-cols-2 gap-6 text-sm">
          {[['이름', user], ['소속', '금융감독원'], ['역할', user === '오검토' ? 'L1' : 'L2'], ['계정', '업무 계정'], ['이메일', 'reviewer@fss.or.kr'], ['가입일', '2026. 08. 05']].map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground mb-2">{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </section>
      <section className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-lg font-bold tracking-tight">세션 관리</h2><p className="text-xs text-muted-foreground mt-1.5">현재 계정으로 로그인한 기기</p></div>
          <Button variant="outline" size="sm" onClick={() => setSessions(['current'])}>다른 세션 모두 로그아웃</Button>
        </div>
        <div className="space-y-3">
          {sessions.map((id, i) => (
            <div key={id} className="flex items-center gap-4 rounded-lg bg-muted/40 p-4">
              <div className="size-10 rounded-md bg-background grid place-items-center">{i === 0 ? <Monitor className="size-4" /> : <Laptop className="size-4" />}</div>
              <div className="flex-1"><p className="text-sm">Chrome · macOS {id === 'current' && <Badge variant="secondary" className="ml-2">현재</Badge>}</p><p className="text-xs text-muted-foreground mt-1">대한민국 서울 · {i === 0 ? '방금 활동' : '오늘 09:14'}</p></div>
              <Button variant="ghost" size="sm" onClick={() => id === 'current' ? onLogout() : setSessions(p => p.filter(x => x !== id))}>{id === 'current' ? '현재 세션 로그아웃' : '로그아웃'}</Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export function Settings({ user }: { user: string }) {
  const { theme, setTheme } = useTheme()
  const [zone, setZone] = useMemoryState('settings:zone', 'seoul'), [dateFormat, setDateFormat] = useMemoryState('settings:date', 'iso'), [rows, setRows] = useMemoryState('settings:rows', '20'), [sort, setSort] = useMemoryState('settings:sort', 'risk'), [alerts, setAlerts] = useMemoryState('settings:alerts', ['assigned', 'linked', 'comment', 'result'])
  const reset = () => { setZone('seoul'); setDateFormat('iso'); setRows('20'); setSort('risk'); setAlerts(['assigned', 'linked', 'comment', 'result']); setTheme('dark'); toast.success('설정을 초기화했습니다.') }
  const choices = user === '오검토' ? [['assigned', '내 Alert 배정'], ['linked', 'Alert의 Episode 연결'], ['comment', '새 의견'], ['result', 'Batch 결과']] : [['assigned', '내 Episode 배정'], ['linked', 'Episode에 Alert 연결'], ['comment', '새 의견'], ['result', '종결 결과']]
  // 설정은 선택 즉시 적용. section은 박스 없이 제목과 control만 둔다(Figma v14 설정 수정).
  return (
    <div className="space-y-6">
      <div className="flex justify-end"><Button size="sm" variant="outline" onClick={reset}><RotateCcw className="size-3.5" />설정 초기화</Button></div>
      <div className="settings-grid grid gap-x-10 gap-y-10" data-testid="settings-grid">
        <section className="space-y-5"><h2 className="text-lg font-bold tracking-tight">일반</h2>
          <div className="space-y-2"><Label>시간대</Label><Select value={zone} onValueChange={setZone}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="seoul">Asia/Seoul (UTC+9)</SelectItem><SelectItem value="utc">UTC</SelectItem></SelectContent></Select></div>
          <div className="space-y-2"><Label>날짜 형식</Label><Select value={dateFormat} onValueChange={setDateFormat}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="iso">YYYY-MM-DD</SelectItem><SelectItem value="dot">YYYY. MM. DD</SelectItem></SelectContent></Select></div>
        </section>
        <section className="space-y-5"><h2 className="text-lg font-bold tracking-tight">목록</h2>
          <div className="space-y-2"><Label>페이지당 행</Label><Select value={rows} onValueChange={setRows}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{['20', '50', '100'].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>기본 정렬</Label><Select value={sort} onValueChange={setSort}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="risk">위험도 높은 순</SelectItem><SelectItem value="recent">최근 탐지 순</SelectItem></SelectContent></Select></div>
        </section>
        <section className="space-y-5"><div><h2 className="text-lg font-bold tracking-tight">알림</h2><p className="text-xs text-muted-foreground mt-1">인앱 수신 항목</p></div>
          <div className="space-y-4">{choices.map(([id, label]) => <Label key={id} className="flex items-center gap-3 font-normal"><Checkbox checked={alerts.includes(id)} onCheckedChange={v => setAlerts(p => v ? [...new Set([...p, id])] : p.filter(x => x !== id))} />{label}</Label>)}</div>
        </section>
        <section className="space-y-5"><h2 className="text-lg font-bold tracking-tight">테마</h2>
          <RadioGroup value={theme ?? 'dark'} onValueChange={setTheme} className="gap-4">
            {[{ id: 'system', label: '시스템 설정', icon: LaptopMinimal }, { id: 'light', label: '라이트 모드', icon: Sun }, { id: 'dark', label: '다크 모드', icon: Moon }].map(t => (
              <Label key={t.id} htmlFor={`theme-${t.id}`} className="flex items-center gap-3 font-normal cursor-pointer"><RadioGroupItem id={`theme-${t.id}`} value={t.id} /><t.icon className="size-4 text-muted-foreground" />{t.label}</Label>
            ))}
          </RadioGroup>
        </section>
      </div>
    </div>
  )
}

// 알림 페이지가 쓰는 알림 목록. GlobalSearch 등 다른 화면에서도 같은 목록을 참조할 수 있도록 별도 export한다.
export function buildNotifications(records: RecordItem[]): RecordItem[] {
  return records.slice(0, 7).concat(records.filter(r => r.kind === 'Episode').slice(0, 3))
}

// 헤더 뱃지 등 다른 화면에서도 "안 읽음" 개수를 참조하도록, Notifications 페이지와 같은
// memory key('notifications:read')를 읽는다. 알림 목록에서 읽음 처리하면 이 값도 같은 소스를 본다.
export function useUnreadCount(records: RecordItem[]): number {
  const [read] = useMemoryState<string[]>('notifications:read', [])
  return buildNotifications(records).filter(r => !read.includes(r.id)).length
}

type SortOrder = 'desc' | 'asc'
const sortByDate = (list: RecordItem[], order: SortOrder) =>
  [...list].sort((a, b) => order === 'desc' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date))

// 열(안 읽음/읽음) 하나. 헤더에 시간정렬 토글 + 개수, 카드는 [dot] [제목·메타] [요약 inset box] [우측 되돌리기 rail].
function NotificationColumn({ label, list, order, onToggleOrder, read, onToggleRead, onOpen, onMarkRead }: {
  label: string; list: RecordItem[]; order: SortOrder; onToggleOrder: () => void
  read: string[]; onToggleRead: (id: string) => void; onOpen: (r: RecordItem) => void; onMarkRead: (id: string) => void
}) {
  return (
    <div className="notification-column min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <Button variant="ghost" size="icon" className="size-7 hover:bg-transparent" aria-label={order === 'desc' ? '최신순' : '오래된순'} title={order === 'desc' ? '최신순' : '오래된순'} onClick={onToggleOrder}>
          <SortIcon direction={order} />
        </Button>
        <h3 className="text-sm font-semibold">{label} {list.length}</h3>
      </div>
      {list.length === 0
        ? <div className="rounded-lg border py-8 text-center text-xs text-muted-foreground">표시할 알림이 없습니다.</div>
        : <div className="space-y-2.5" data-testid={`notification-column-${label}`}>
          {list.map(r => {
            const unread = !read.includes(r.id)
            return (
              <div key={r.id} role="button" tabIndex={0} data-unread={unread} className="notification-card flex items-stretch rounded-lg border bg-card cursor-pointer hover:bg-muted/50 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => { onMarkRead(r.id); onOpen(r) }} onKeyDown={e => { if (e.key === 'Enter') { onMarkRead(r.id); onOpen(r) } }}>
                <div className="flex items-start gap-3 flex-1 min-w-0 px-4 py-3">
                  <span aria-label={unread ? '읽지 않음' : '읽음'} data-testid="notification-dot" className={`mt-1 size-2.5 rounded-full shrink-0 ${unread ? 'bg-destructive' : 'bg-muted-foreground/40'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{r.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">{r.owner}님에게 {r.kind}가 배정되었습니다.</p>
                    <div className="flex flex-wrap gap-2 mt-1.5 items-center text-xs text-muted-foreground"><span className="font-mono">{r.id}</span><PatternBadge pattern={r.pattern} probability={r.probability} /><span>{r.date}</span></div>
                  </div>
                  <div className="shrink-0 self-center rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">요약 · 위험 {r.score} · {r.count}건</div>
                </div>
                <div className="notification-rail shrink-0 border-l flex items-center px-2">
                  <Button variant="ghost" size="icon" className="size-7 text-foreground disabled:text-muted-foreground/40 disabled:opacity-100" disabled={unread}
                    aria-label={`${r.id} 읽지 않음으로 되돌리기`} title={`${r.id} 읽지 않음으로 되돌리기`}
                    onClick={e => { e.stopPropagation(); onToggleRead(r.id) }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onToggleRead(r.id) } }}>
                    <History className="size-4" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>}
    </div>
  )
}

export function Notifications({ records, onOpen }: { records: RecordItem[]; onOpen: (r: RecordItem) => void }) {
  const [read, setRead] = useMemoryState<string[]>('notifications:read', []), [query, setQuery] = useState(''), [range, setRange] = useState<DateRange>()
  const [unreadOrder, setUnreadOrder] = useState<SortOrder>('desc'), [readOrder, setReadOrder] = useState<SortOrder>('desc')
  const iso = (d: Date) => d.toLocaleDateString('sv-SE')
  const source = buildNotifications(records)
  const visible = source
    .filter(r => `${r.id} ${r.title} ${r.owner}`.toLowerCase().includes(query.trim().toLowerCase()))
    .filter(r => (!range?.from || r.date >= iso(range.from)) && (!range?.to || r.date <= iso(range.to ?? range.from)))
  const unreadList = sortByDate(visible.filter(r => !read.includes(r.id)), unreadOrder)
  const readList = sortByDate(visible.filter(r => read.includes(r.id)), readOrder)
  const allRead = source.every(r => read.includes(r.id))
  const markRead = (id: string) => setRead(p => p.includes(id) ? p : [...p, id])
  const toggleRead = (id: string) => setRead(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  // Figma v17 리뷰: 안읽음/읽음 2열 분리, 필터 popover 제거(검색·기간만 유지). 카드는 [dot][제목·메타][요약 box][우측 되돌리기 rail].
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-72"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="알림 검색" className="pl-9 h-9 text-xs" placeholder="알림 내용, Alert·Episode ID 검색" value={query} onChange={e => setQuery(e.target.value)} /></div>
        <DateRangeButton value={range} onChange={setRange} />
        <Button variant="ghost" size="sm" className="ml-auto" disabled={allRead} onClick={() => setRead(source.map(r => r.id))}><Check className="size-3.5" />모두 읽음 처리</Button>
      </div>
      {visible.length === 0
        ? <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground"><Bell className="mx-auto mb-4 size-7" />조건에 맞는 알림이 없습니다.</div>
        : <div className="grid gap-6 @5xl:grid-cols-2" data-testid="notification-list">
          <NotificationColumn label="안 읽음" list={unreadList} order={unreadOrder} onToggleOrder={() => setUnreadOrder(o => o === 'desc' ? 'asc' : 'desc')} read={read} onToggleRead={toggleRead} onOpen={onOpen} onMarkRead={markRead} />
          <NotificationColumn label="읽음" list={readList} order={readOrder} onToggleOrder={() => setReadOrder(o => o === 'desc' ? 'asc' : 'desc')} read={read} onToggleRead={toggleRead} onOpen={onOpen} onMarkRead={markRead} />
        </div>}
    </div>
  )
}
