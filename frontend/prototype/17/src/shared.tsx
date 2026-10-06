import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, CalendarDays, RotateCcw, X } from 'lucide-react'
import { ko } from 'date-fns/locale'
import { subDays, startOfMonth } from 'date-fns'
import type { DateRange } from 'react-day-picker'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { TableHead } from '@/components/ui/table'
import { riskTone, topPercent, TODAY, type Risk, type SortDirection } from './domain'

export function IconButton({ label, children, onClick, disabled, className }: { label: string; children: ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* disabled button은 pointer 이벤트가 없어 tooltip이 뜨지 않으므로 span으로 감싼다 */}
        <span className="inline-flex">
          <Button variant="ghost" size="icon" aria-label={label} disabled={disabled} onClick={onClick} className={className}>{children}</Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function UnderTabs({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: { value: string; label: string }[] }) {
  return (
    <Tabs value={value} onValueChange={onChange}>
      <TabsList variant="line" className="underline-tabs">
        {items.map(i => <TabsTrigger value={i.value} key={i.value}>{i.label}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  )
}

export function RiskBadge({ score }: { risk: Risk; score: number }) {
  const tone = riskTone(score)
  // 낮은 점수(0~29)는 riskTone 채도가 거의 0이라 순수 회색에 가깝다 — 흰 글자 대비가 부족하므로 어두운 글자를 쓴다
  const low = score < 30
  return (
    <Badge className={`gap-1.5 font-normal border-0 ${low ? 'text-foreground' : 'text-white'}`} style={{ backgroundColor: tone }}>
      <span className="font-mono">{score}</span><span className={`text-[10px] ${low ? 'opacity-70' : 'opacity-80'}`}>상위 {topPercent(score)}%</span>
    </Badge>
  )
}

export function PatternBadge({ pattern, probability }: { pattern: string; probability: number }) {
  return <Badge variant="secondary" className="font-mono font-normal text-[11px]">{pattern}<span className="ml-1.5 text-muted-foreground">{probability}%</span></Badge>
}

export function FilterChip({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  return (
    <Badge variant="secondary" className="h-7 rounded-full gap-1 pl-3 pr-1 font-normal">
      {children}
      <Button variant="ghost" size="icon" className="size-5 rounded-full" aria-label={`${children} 조건 제거`} onClick={onRemove}><X className="size-3" /></Button>
    </Badge>
  )
}

export function SectionTitle({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-xs text-muted-foreground mt-1.5">{description}</p>}
      </div>
      {action}
    </div>
  )
}

/* 정렬 가능한 열 머리 — 미정렬: 두 화살표 흐림 / 내림차순: ↓ 강조 / 오름차순: ↑ 강조 */
export function SortIcon({ direction }: { direction: SortDirection }) {
  return (
    <span data-sort={direction ?? 'none'} className={`sort-icon inline-flex items-center justify-center size-5 rounded-[5px] ${direction ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`} aria-hidden>
      <ArrowDown className={`size-3 -mr-1 ${direction === 'asc' ? 'opacity-35' : ''}`} strokeWidth={2.4} />
      <ArrowUp className={`size-3 ${direction === 'desc' ? 'opacity-35' : ''}`} strokeWidth={2.4} />
    </span>
  )
}
export function SortableHead({ label, active, direction, onSort, className }: { label: string; active: boolean; direction: SortDirection; onSort: () => void; align?: 'left' | 'right'; className?: string }) {
  const state = active ? direction : null
  const spoken = state === 'desc' ? '내림차순' : state === 'asc' ? '오름차순' : '정렬 안 함'
  // 정렬 중이면 머리글 셀 전체를 반전(index.css의 [aria-sort] 규칙)한다 — 라벨은 왼쪽, 아이콘은 오른쪽 끝에 둔다
  return (
    <TableHead className={className} aria-sort={state === 'desc' ? 'descending' : state === 'asc' ? 'ascending' : 'none'}>
      <button type="button" onClick={onSort} aria-label={`${label} 정렬 · 현재 ${spoken}`} className="group inline-flex w-full items-center justify-between gap-2 text-xs font-medium">
        <span>{label}</span><SortIcon direction={state} />
      </button>
    </TableHead>
  )
}

/* ---------------------------------------------------------------- 기간 선택 */

const CALENDAR_START = new Date(2026, 0, 1)
const CALENDAR_MONTHS = 12
export const monthIndex = (date: Date) => (date.getFullYear() - CALENDAR_START.getFullYear()) * 12 + date.getMonth() - CALENDAR_START.getMonth()
const fmt = (d?: Date) => d ? d.toLocaleDateString('sv-SE') : ''
export const presets = [
  { id: 'today', label: '오늘', range: (): DateRange => ({ from: TODAY, to: TODAY }) },
  { id: '3', label: '최근 3일', range: (): DateRange => ({ from: subDays(TODAY, 2), to: TODAY }) },
  { id: '7', label: '최근 7일', range: (): DateRange => ({ from: subDays(TODAY, 6), to: TODAY }) },
  { id: '30', label: '최근 30일', range: (): DateRange => ({ from: subDays(TODAY, 29), to: TODAY }) },
  { id: 'month', label: '이번 달', range: (): DateRange => ({ from: startOfMonth(TODAY), to: TODAY }) },
]

export function DateRangeButton({ value, onChange }: { value: DateRange | undefined; onChange: (r: DateRange | undefined) => void }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<DateRange | undefined>(value), [preset, setPreset] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // 달력은 한 줄로 이어진 세로 스크롤. preset·열기 시 기준 날짜가 있는 달로 이동한다.
  const scrollToMonth = (date: Date, smooth: boolean) => window.setTimeout(() => {
    const month = scroller.current?.querySelectorAll<HTMLElement>('.rdp-month')[monthIndex(date)]
    const box = scroller.current
    // popover 등장 애니메이션(scale) 중에도 정확하도록 transform 영향이 없는 offsetTop 누적값을 쓴다
    let top = 0, el: HTMLElement | null = month ?? null
    while (el && el !== box) { top += el.offsetTop; el = el.offsetParent as HTMLElement | null }
    if (month && box) box.scrollTo({ top: top - 4, behavior: smooth && document.visibilityState === 'visible' ? 'smooth' : 'auto' })
  }, 0)
  useEffect(() => { if (open) scrollToMonth(value?.to ?? value?.from ?? TODAY, false) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const label = value?.from ? `${fmt(value.from)} → ${fmt(value.to) || '종료일'}` : '기간'
  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (o) { setDraft(value); setPreset(null) } }}>
      <div className="date-range-control inline-flex shrink-0 items-stretch h-8 rounded-md border bg-background shadow-xs overflow-hidden">
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex items-center gap-2 px-3 text-sm hover:bg-accent">
            <CalendarDays className="size-3.5 shrink-0" />
            <span className="tabular-nums whitespace-nowrap">{label}</span>
          </button>
        </PopoverTrigger>
        {value?.from && (
          <button type="button" aria-label="기간 초기화" className="grid place-items-center w-8 border-l hover:bg-accent" onClick={() => onChange(undefined)}>
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex">
          <div className="w-32 border-r p-2 flex flex-col gap-1">
            {presets.map(p => (
              <Button key={p.id} variant={preset === p.id ? 'secondary' : 'ghost'} size="sm" className="justify-start font-normal"
                onClick={() => { const r = p.range(); setDraft(r); setPreset(p.id); scrollToMonth(r.to ?? TODAY, true) }}>
                {p.label}
              </Button>
            ))}
          </div>
          <div ref={scroller} className="relative h-[336px] overflow-y-auto overscroll-contain" data-testid="calendar-scroll">
            <Calendar locale={ko} mode="range" selected={draft} onSelect={r => { setDraft(r); setPreset(null) }}
              defaultMonth={CALENDAR_START} startMonth={CALENDAR_START} numberOfMonths={CALENDAR_MONTHS} today={TODAY}
              hideNavigation showOutsideDays={false} className="continuous-calendar"
              classNames={{ months: 'relative flex flex-col gap-5 rdp-months', month_caption: 'flex h-8 items-center px-1 text-sm font-medium rdp-month_caption' }} />
          </div>
        </div>
        <div className="border-t p-3 flex items-center justify-between gap-6">
          <span className="text-xs text-muted-foreground tabular-nums">{draft?.from ? `${fmt(draft.from)} → ${fmt(draft.to) || '종료일 선택'}` : '전체 기간'}</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={!draft?.from} onClick={() => { setDraft(undefined); setPreset(null) }}><RotateCcw className="size-3.5" />초기화</Button>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>취소</Button>
            <Button size="sm" onClick={() => { onChange(draft?.from ? draft : undefined); setOpen(false) }}>적용</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
