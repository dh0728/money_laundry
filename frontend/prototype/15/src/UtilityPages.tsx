import { useRef, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { useTheme } from 'next-themes'
import { Camera, Monitor, Laptop, Bell, Check, Sun, Moon, LaptopMinimal, RotateCcw, Search, ListFilter, History } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DateRangeButton, FilterChip, SectionTitle, PatternBadge } from './shared'
import type { RecordItem } from './domain'
import { useMemoryState } from './memory'

export function Account({ user, onLogout }: { user: string; onLogout: () => void }) {
  const [sessions, setSessions] = useState(['current', 'other-1', 'other-2']), [picture, setPicture] = useState('')
  const file = useRef<HTMLInputElement>(null)
  return (
    <div className="grid gap-5 @5xl:grid-cols-2">
      <Card className="shadow-none"><CardContent>
        <SectionTitle title="프로필" />
        <div className="flex items-center gap-5 mb-8">
          <Avatar className="size-18"><AvatarImage src={picture} /><AvatarFallback className="text-xl">{user[0]}</AvatarFallback></Avatar>
          <div><p className="font-semibold">{user}</p><Button variant="outline" size="sm" className="mt-2 text-xs" onClick={() => file.current?.click()}><Camera className="size-3.5" />이미지 변경</Button><input hidden ref={file} type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) setPicture(URL.createObjectURL(f)) }} /></div>
        </div>
        <dl className="grid grid-cols-2 gap-6 text-sm">
          {[['이름', user], ['소속', '금융감독원'], ['역할', user === '오검토' ? 'L1 · 1차 검토' : 'L2 · 심층 조사'], ['계정', '업무 계정'], ['이메일', 'reviewer@fss.or.kr'], ['가입일', '2026. 08. 05']].map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground mb-2">{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </CardContent></Card>
      <Card className="shadow-none"><CardContent>
        <SectionTitle title="세션 관리" description="현재 계정으로 로그인한 기기" action={<Button variant="outline" size="sm" onClick={() => setSessions(['current'])}>다른 세션 모두 로그아웃</Button>} />
        <div className="space-y-3">
          {sessions.map((id, i) => (
            <div key={id} className={`flex items-center gap-4 rounded-lg border p-4 ${id === 'current' ? 'bg-muted/50' : ''}`}>
              <div className="size-10 rounded-md border grid place-items-center">{i === 0 ? <Monitor className="size-4" /> : <Laptop className="size-4" />}</div>
              <div className="flex-1"><p className="text-sm">Chrome · macOS {id === 'current' && <Badge variant="secondary" className="ml-2">현재</Badge>}</p><p className="text-xs text-muted-foreground mt-1">대한민국 서울 · {i === 0 ? '방금 활동' : '오늘 09:14'}</p></div>
              <Button variant="ghost" size="sm" onClick={() => id === 'current' ? onLogout() : setSessions(p => p.filter(x => x !== id))}>{id === 'current' ? '현재 세션 로그아웃' : '로그아웃'}</Button>
            </div>
          ))}
        </div>
      </CardContent></Card>
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

type NotificationFilter = { field: 'read' | 'type'; value: string }
// 알림 페이지가 쓰는 알림 목록. GlobalSearch 등 다른 화면에서도 같은 목록을 참조할 수 있도록 별도 export한다.
export function buildNotifications(records: RecordItem[]): RecordItem[] {
  return records.slice(0, 7).concat(records.filter(r => r.kind === 'Episode').slice(0, 3))
}
export function Notifications({ records, onOpen }: { records: RecordItem[]; onOpen: (r: RecordItem) => void }) {
  const [read, setRead] = useMemoryState<string[]>('notifications:read', []), [query, setQuery] = useState(''), [range, setRange] = useState<DateRange>()
  const [filters, setFilters] = useState<NotificationFilter[]>([]), [filterOpen, setFilterOpen] = useState(false), [field, setField] = useState<NotificationFilter['field']>('read'), [value, setValue] = useState('읽지 않음')
  const iso = (d: Date) => d.toLocaleDateString('sv-SE')
  const typeOf = (r: RecordItem) => r.kind === 'Alert' ? 'Alert 배정' : 'Episode 배정'
  const source = buildNotifications(records)
  const visible = source
    .filter(r => `${r.id} ${r.title} ${r.owner}`.toLowerCase().includes(query.trim().toLowerCase()))
    .filter(r => (!range?.from || r.date >= iso(range.from)) && (!range?.to || r.date <= iso(range.to ?? range.from)))
    .filter(r => filters.every(f => f.field === 'read' ? (f.value === '읽지 않음') !== read.includes(r.id) : typeOf(r) === f.value))
  const options = { read: ['읽지 않음', '읽음'], type: ['Alert 배정', 'Episode 배정'] }
  const toggleRead = (id: string) => setRead(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-72"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="알림 검색" className="pl-9 h-9 text-xs" placeholder="알림 내용, Alert·Episode ID 검색" value={query} onChange={e => setQuery(e.target.value)} /></div>
        <DateRangeButton value={range} onChange={setRange} />
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild><Button variant="outline" size="sm"><ListFilter className="size-3.5" />필터{filters.length > 0 && <Badge className="ml-1 h-5 min-w-5 px-1.5">{filters.length}</Badge>}</Button></PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-3">
            <Label>조건 추가</Label>
            <Select value={field} onValueChange={v => { const f = v as NotificationFilter['field']; setField(f); setValue(options[f][0]) }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="read">읽음 상태</SelectItem><SelectItem value="type">알림 유형</SelectItem></SelectContent></Select>
            <Select value={value} onValueChange={setValue}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{options[field].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select>
            <Button className="w-full" size="sm" onClick={() => { setFilters(p => [...p.filter(x => x.field !== field), { field, value }]); setFilterOpen(false) }}>조건 적용</Button>
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setRead(source.map(r => r.id))}><Check className="size-3.5" />모두 읽음 처리</Button>
      </div>
      {filters.length > 0 && <div className="flex flex-wrap gap-2 items-center">{filters.map(f => <FilterChip key={f.field} onRemove={() => setFilters(p => p.filter(x => x !== f))}>{f.field === 'read' ? '읽음 상태' : '알림 유형'}: {f.value}</FilterChip>)}</div>}
      {/* 수정안(Figma v15c): 카드마다 좌측 rail(상태 dot + 되돌리기)과 우측 "요약" inset box를 둔 3열 구성. */}
      {visible.length === 0
        ? <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground"><Bell className="mx-auto mb-4 size-7" />조건에 맞는 알림이 없습니다.</div>
        : <div className="space-y-2.5" data-testid="notification-list">
          {visible.map(r => {
            const unread = !read.includes(r.id)
            return (
              <div key={r.id} role="button" tabIndex={0} data-unread={unread} className="notification-card grid grid-cols-[44px_1fr] gap-0 rounded-lg border bg-card cursor-pointer hover:bg-muted/50 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => { setRead(p => [...new Set([...p, r.id])]); onOpen(r) }} onKeyDown={e => { if (e.key === 'Enter') { setRead(p => [...new Set([...p, r.id])]); onOpen(r) } }}>
                {/* 좌측 rail: 상단 상태 dot(안읽음=레드), 하단 "안읽음으로 되돌리기"(안읽음 카드에서는 비활성) */}
                <div className="notification-rail flex flex-col items-center justify-between border-r py-3">
                  <span aria-label={unread ? '읽지 않음' : '읽음'} data-testid="notification-dot" className={`size-2.5 rounded-full shrink-0 ${unread ? 'bg-destructive' : 'bg-muted-foreground/40'}`} />
                  <Button variant="ghost" size="icon" className="size-7 text-foreground disabled:text-muted-foreground/40 disabled:opacity-100" disabled={unread}
                    aria-label={`${r.id} 읽지 않음으로 되돌리기`} title={`${r.id} 읽지 않음으로 되돌리기`}
                    onClick={e => { e.stopPropagation(); toggleRead(r.id) }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); toggleRead(r.id) } }}>
                    <History className="size-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-1 @5xl:grid-cols-2">
                  <div className="min-w-0 px-5 py-4">
                    <p className="text-sm font-semibold text-foreground">{r.title}</p>
                    <p className="text-xs text-muted-foreground mt-2">{r.owner}님에게 {r.kind}가 배정되었습니다.</p>
                    <div className="flex flex-wrap gap-2 mt-2 items-center text-xs text-muted-foreground"><span className="font-mono">{r.id}</span><PatternBadge pattern={r.pattern} probability={r.probability} /><span>{r.date} 13:38</span></div>
                  </div>
                  <div className="px-5 pb-4 @5xl:py-4">
                    <div className="rounded-md bg-muted/40 p-3 h-full">
                      <p className="text-xs font-medium">요약</p>
                      <p className="text-xs text-muted-foreground mt-2">위험 점수 {r.score} · 거래 {r.count}건 · 담당 {r.owner}</p>
                      <p className="text-xs text-muted-foreground mt-1">탐지 유형 {r.pattern} {r.probability}%</p>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>}
    </div>
  )
}
