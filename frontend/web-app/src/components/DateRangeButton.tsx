// v24 shared.tsx의 기간 선택을 옮김. 기준일(today)은 호출하는 쪽이 넘긴다.
import { useEffect, useRef, useState } from 'react'
import { CalendarDays, RotateCcw, X } from 'lucide-react'
import { ko } from 'date-fns/locale'
import { subDays, startOfMonth } from 'date-fns'
import type { DateRange } from 'react-day-picker'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'


const CALENDAR_START = new Date(2026, 0, 1)
const CALENDAR_MONTHS = 12
const monthIndex = (date: Date) => (date.getFullYear() - CALENDAR_START.getFullYear()) * 12 + date.getMonth() - CALENDAR_START.getMonth()
const fmt = (d?: Date) => d ? d.toLocaleDateString('sv-SE') : ''
const presetsFor = (TODAY: Date) => [
  { id: 'today', label: '오늘', range: (): DateRange => ({ from: TODAY, to: TODAY }) },
  { id: '3', label: '최근 3일', range: (): DateRange => ({ from: subDays(TODAY, 2), to: TODAY }) },
  { id: '7', label: '최근 7일', range: (): DateRange => ({ from: subDays(TODAY, 6), to: TODAY }) },
  { id: '30', label: '최근 30일', range: (): DateRange => ({ from: subDays(TODAY, 29), to: TODAY }) },
  { id: 'month', label: '이번 달', range: (): DateRange => ({ from: startOfMonth(TODAY), to: TODAY }) },
]

export function DateRangeButton({ value, onChange, today: TODAY }: { value: DateRange | undefined; onChange: (r: DateRange | undefined) => void; today: Date }) {
  const presets = presetsFor(TODAY)
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
      <div role="group" aria-label="기간 설정" data-testid="date-range-combined" className="inline-flex shrink-0">
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={`date-range-control h-9 ${value?.from ? 'rounded-r-none border-r-0' : ''}`}><CalendarDays data-icon="inline-start" /><span className="tabular-nums">{label}</span></Button>
        </PopoverTrigger>
        {value?.from && (
          <Button variant="outline" size="icon-sm" className="h-9 rounded-l-none" aria-label="기간 초기화" onClick={() => onChange(undefined)}><X /></Button>
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
