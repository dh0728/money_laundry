import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { DateRange } from 'react-day-picker'
import { useTheme } from 'next-themes'
import { Camera, Monitor, Laptop, Bell, Check, Sun, Moon, LaptopMinimal, RotateCcw, Search, ChevronDown, ChevronsUpDown, ChevronUp, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { DateRangeButton, PatternBadge } from './shared'
import type { RecordItem } from './domain'
import { useMemoryState } from './memory'

// v20 R11: 역할별 권한(예시). 역할 표기는 L1/L2만(v17 확정), 의미는 권한 목록이 설명한다. L1 = Alert 검토, L2 = Episode 조사·보고 판단. 담당자 재배정·설정 관리는 관리자.
const ROLES = {
  L1: { name: 'L1', can: ['담당 Alert 검토 · 의견 저장', '담당 Alert 종결(정상 · 오탐)', '의심 거래를 기존 · 새 Episode로 연결'], cannot: ['다른 담당자의 건 종결', 'Episode 조사 종결 · 보고 대상 확정(L2)', '담당자 재배정(관리자)'] },
  L2: { name: 'L2', can: ['담당 Episode 조사 · 종결', '의심 거래 보고 대상 확정', '상위 검토 요청'], cannot: ['다른 담당자의 건 처리', '담당자 재배정(관리자)'] },
}

export function Account({ user, onLogout }: { user: string; onLogout: () => void }) {
  const role = ROLES[user === '오검토' ? 'L1' : 'L2']
  const [sessions, setSessions] = useState(['current', 'other-1', 'other-2']), [picture, setPicture] = useState('')
  const file = useRef<HTMLInputElement>(null)
  // 넓은 화면은 프로필·권한·세션 3열, 세로 화면은 자연스럽게 3행이다.
  return (
    <div className="account-grid grid gap-8" data-testid="account-grid">
      <section className="space-y-6">
        <h2 className="text-lg font-bold tracking-tight">프로필</h2>
        <div className="flex items-center gap-5">
          <Avatar className="size-18"><AvatarImage src={picture} /><AvatarFallback className="text-xl">{user[0]}</AvatarFallback></Avatar>
          <div><p className="font-semibold">{user}</p><Button variant="outline" size="sm" className="mt-2 text-xs" onClick={() => file.current?.click()}><Camera className="size-3.5" />이미지 변경</Button><input hidden ref={file} type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) setPicture(URL.createObjectURL(f)) }} /></div>
        </div>
        {/* v20 R11: 이름은 위 프로필에 이미 있어 표에서 뺐다. '계정 종류' 대신 권한(할 수 있는 일/없는 일)을 보인다 */}
        <dl className="grid grid-cols-2 gap-6 text-sm">
          {[['소속', '금융감독원'], ['이메일', 'reviewer@fss.or.kr'], ['역할', role.name], ['가입일', '2026. 08. 05']].map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground mb-2">{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </section>
      <section className="space-y-6">
        <h2 className="text-lg font-bold tracking-tight">권한</h2>
        <div className="space-y-5 text-sm">
          <ul className="space-y-3" aria-label="할 수 있는 일">{role.can.map(x => <li key={x} className="flex gap-2"><Check className="size-4 shrink-0 mt-0.5" />{x}</li>)}</ul>
          <ul className="space-y-3 text-muted-foreground" aria-label="할 수 없는 일">{role.cannot.map(x => <li key={x} className="flex gap-2"><X className="size-4 shrink-0 mt-0.5" />{x}</li>)}</ul>
        </div>
      </section>
      <section className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-lg font-bold tracking-tight">세션 관리</h2><p className="text-xs text-muted-foreground mt-1.5">현재 계정으로 로그인한 기기</p></div>
          <Button variant="outline" size="sm" onClick={() => setSessions(['current'])}>다른 세션 모두 로그아웃</Button>
        </div>
        <div className="space-y-3">
          {sessions.map((id, i) => (
            <div key={id} className="shine flex items-center gap-4 rounded-lg bg-muted/40 p-4">
              <div className="size-10 rounded-md bg-background grid place-items-center">{i === 0 ? <Monitor className="size-4" /> : <Laptop className="size-4" />}</div>
              <div className="flex-1"><p className="text-sm">{i === 0 ? 'Chrome · Windows 11' : i === 1 ? 'Edge · Windows 11' : 'Chrome · Windows 10'} {id === 'current' && <Badge variant="secondary" className="ml-2">현재</Badge>}</p><p className="text-xs text-muted-foreground mt-1">대한민국 서울 · {i === 0 ? '방금 활동' : '오늘 09:14'}</p></div>
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

type SortOrder = 'desc' | 'asc' | null
const sortByDate = (list: RecordItem[], order: SortOrder) =>
  order ? [...list].sort((a, b) => order === 'desc' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) : list

// 열(안 읽음/읽음) 하나. 헤더는 목록 표와 같은 정렬 아이콘을 쓰고, 카드는 점 버튼으로 읽음 상태를 바꾼다.
function NotificationColumn({ label, list, order, onToggleOrder, read, onToggleRead, onOpen, onMarkRead }: {
  label: string; list: RecordItem[]; order: SortOrder; onToggleOrder: () => void
  read: string[]; onToggleRead: (id: string) => void; onOpen: (r: RecordItem) => void; onMarkRead: (id: string) => void
}) {
  return (
    <div className="notification-column min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <Button variant="ghost" size="icon" className="size-7 hover:bg-transparent" aria-label={order === 'desc' ? '최신순' : order === 'asc' ? '오래된순' : '정렬 안 함'} title={order === 'desc' ? '최신순' : order === 'asc' ? '오래된순' : '정렬 안 함'} onClick={onToggleOrder}>
          {order === 'desc' ? <ChevronDown /> : order === 'asc' ? <ChevronUp /> : <ChevronsUpDown />}
        </Button>
        <h3 className="text-sm font-semibold">{label} {list.length}</h3>
      </div>
      {list.length === 0
        ? <div className="glass-surface rounded-lg border py-8 text-center text-xs text-muted-foreground">표시할 알림이 없습니다.</div>
        : <div className="space-y-2.5" data-testid={`notification-column-${label}`}>
          {list.map(r => {
            const unread = !read.includes(r.id)
            return (
              <div key={r.id} data-unread={unread} className="notification-card flex items-center gap-2.5 rounded-lg border px-3.5 py-3 glass-surface">
                <Button variant="ghost" size="icon" className="size-7 rounded-full bg-transparent shrink-0 p-0 hover:bg-muted/70 focus-visible:bg-muted/70" aria-label={`${r.id} ${unread ? '읽음으로 표시' : '읽지 않음으로 표시'}`} title={unread ? '읽음으로 표시' : '읽지 않음으로 표시'} data-testid="notification-dot" onClick={e => { e.stopPropagation(); onToggleRead(r.id) }}>
                  <span aria-hidden className={`size-2.5 rounded-full ${unread ? 'bg-destructive' : 'bg-muted-foreground/40'}`} />
                </Button>
                <Button variant="ghost" data-shine="off" className="notification-card-action h-auto min-w-0 flex-1 justify-start rounded-none p-0 text-left whitespace-normal hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0" aria-label={`${r.id} 알림 열기`} onClick={() => { onMarkRead(r.id); onOpen(r) }}>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-foreground truncate">{r.title}</p>
                    <p className="text-sm text-muted-foreground mt-1.5">{r.owner}님에게 {r.kind}가 배정되었습니다.</p>
                    <div className="flex flex-wrap gap-2 mt-3 items-center text-xs text-muted-foreground"><span className="font-mono">{r.id}</span><PatternBadge pattern={r.pattern} probability={r.probability} /><span>{r.date}</span><span>{r.count}건</span></div>
                  </div>
                </Button>
              </div>
            )
          })}
        </div>}
    </div>
  )
}

export function Notifications({ records, onOpen }: { records: RecordItem[]; onOpen: (r: RecordItem) => void }) {
  const [read, setRead] = useMemoryState<string[]>('notifications:read', []), [query, setQuery] = useState(''), [range, setRange] = useState<DateRange>()
  const [unreadOrder, setUnreadOrder] = useState<SortOrder>(null), [readOrder, setReadOrder] = useState<SortOrder>(null)
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
  const toggleOrder = (setOrder: Dispatch<SetStateAction<SortOrder>>) => setOrder(order => order === null ? 'desc' : order === 'desc' ? 'asc' : null)
  // Figma v20: 안읽음/읽음 2열 분리. 카드는 [점 버튼][제목·메타]로 읽음 상태를 전환한다.
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-72"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="알림 검색" className="pl-9 h-9 text-xs" placeholder="알림 내용, Alert·Episode ID 검색" value={query} onChange={e => setQuery(e.target.value)} /></div>
        <DateRangeButton value={range} onChange={setRange} />
        <Button variant="ghost" size="sm" className="ml-auto" disabled={allRead} onClick={() => setRead(source.map(r => r.id))}><Check className="size-3.5" />모두 읽음 처리</Button>
      </div>
      {visible.length === 0
        ? <div className="glass-surface rounded-lg border py-16 text-center text-sm text-muted-foreground"><Bell className="mx-auto mb-4 size-7" />조건에 맞는 알림이 없습니다.</div>
        : <div className="grid gap-6 @5xl:grid-cols-2" data-testid="notification-list">
          <NotificationColumn label="안 읽음" list={unreadList} order={unreadOrder} onToggleOrder={() => toggleOrder(setUnreadOrder)} read={read} onToggleRead={toggleRead} onOpen={onOpen} onMarkRead={markRead} />
          <NotificationColumn label="읽음" list={readList} order={readOrder} onToggleOrder={() => toggleOrder(setReadOrder)} read={read} onToggleRead={toggleRead} onOpen={onOpen} onMarkRead={markRead} />
        </div>}
    </div>
  )
}
