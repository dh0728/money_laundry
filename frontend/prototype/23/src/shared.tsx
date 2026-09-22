import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowDownWideNarrow, ArrowUpNarrowWide, CalendarDays, Link2, RotateCcw, X } from 'lucide-react'
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
import { riskTone, topPercent, TODAY, type RecordItem, type Risk, type SortDirection } from './domain'

export function PageHeading({ title, description }: { title: string; description: string }) {
  return (
    <header data-testid="page-heading" className="page-heading min-h-[58px]">
      <h1 className="type-title font-semibold tracking-tight">{title}</h1>
      <p className="mt-1.5 type-caption text-muted-foreground">{description}</p>
    </header>
  )
}

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

type IndicatorGeometry = { x: number; y: number; width: number; height: number; clipTop?: number; clipBottom?: number }

export function indicatorGeometry(root: HTMLElement, target: HTMLElement | null): IndicatorGeometry | null {
  if (!target) return null
  const bounds = root.getBoundingClientRect(), rect = target.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  const viewport = target.closest<HTMLElement>('[data-slot=sidebar-content]')?.getBoundingClientRect()
  const clipping = viewport ? { clipTop: Math.max(0, viewport.top - rect.top), clipBottom: Math.max(0, rect.bottom - viewport.bottom) } : {}
  if ((clipping.clipTop ?? 0) + (clipping.clipBottom ?? 0) >= rect.height) return null
  return { x: rect.left - bounds.left - root.clientLeft + root.scrollLeft, y: rect.top - bounds.top - root.clientTop + root.scrollTop, width: rect.width, height: rect.height, ...clipping }
}

type IndicatorState = { geometry: IndicatorGeometry | null; animate: boolean }

export function updateIndicator(previous: IndicatorState, geometry: IndicatorGeometry | null, reason: 'selection' | 'layout'): IndicatorState {
  const old = previous.geometry
  if (old?.x === geometry?.x && old?.y === geometry?.y && old?.width === geometry?.width && old?.height === geometry?.height && old?.clipTop === geometry?.clipTop && old?.clipBottom === geometry?.clipBottom) return previous
  // Clipped endpoints cannot interpolate safely against a stationary scroll viewport.
  // Mount, reentry, and layout tracking must attach immediately to their real target.
  const animate = reason === 'selection' && !!old && !!geometry && !old.clipTop && !old.clipBottom && !geometry.clipTop && !geometry.clipBottom
  return { geometry, animate }
}

function useSelectionIndicator(value: string, targets: string, active: string, layoutKey = '') {
  const root = useRef<HTMLDivElement>(null)
  const selectedValue = useRef(value)
  const [state, setState] = useState<IndicatorState>({ geometry: null, animate: false })
  useLayoutEffect(() => {
    const surface = root.current
    if (!surface) return
    let disposed = false
    const measure = (reason: 'selection' | 'layout') => {
      if (disposed) return
      const next = indicatorGeometry(surface, surface.querySelector<HTMLElement>(active))
      setState(previous => updateIndicator(previous, next, reason))
    }
    measure(selectedValue.current === value ? 'layout' : 'selection')
    selectedValue.current = value
    const trackLayout = () => measure('layout')
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(trackLayout)
    observer?.observe(surface)
    surface.querySelectorAll<HTMLElement>(targets).forEach(target => observer?.observe(target))
    // Capturing scroll also tracks the independently scrolling sidebar content.
    surface.addEventListener('scroll', trackLayout, true)
    window.addEventListener('resize', trackLayout)
    document.fonts?.addEventListener('loadingdone', trackLayout)
    document.fonts?.ready.then(trackLayout)
    return () => {
      disposed = true
      observer?.disconnect()
      surface.removeEventListener('scroll', trackLayout, true)
      window.removeEventListener('resize', trackLayout)
      document.fonts?.removeEventListener('loadingdone', trackLayout)
    }
  }, [value, targets, active, layoutKey])
  return { root, ...state }
}

export function SidebarSelection({ value, children }: { value: string; children: ReactNode }) {
  // This positioned surface is shared by desktop and the mobile Sheet portal.
  const { root, geometry, animate } = useSelectionIndicator(value, '[data-nav-id]', '[data-nav-id][data-active=true]')
  return <div ref={root} className="app-sidebar-surface">
    <span aria-hidden="true" data-slot="sidebar-indicator" data-animate={animate} className="sidebar-indicator" style={{ visibility: geometry ? 'visible' : 'hidden', transform: `translate(${geometry?.x ?? 0}px, ${geometry?.y ?? 0}px)`, width: geometry?.width ?? 0, height: geometry?.height ?? 0, clipPath: `inset(${geometry?.clipTop ?? 0}px 0 ${geometry?.clipBottom ?? 0}px 0)` }} />
    {children}
  </div>
}

export function UnderTabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  const { root, geometry, animate } = useSelectionIndicator(value, '[data-slot=tabs-trigger]', '[data-slot=tabs-trigger][data-state=active]', JSON.stringify(items))
  return (
    <Tabs value={value} onValueChange={next => onChange(next as T)}>
      <TabsList ref={root} variant="line" className="underline-tabs">
        <span aria-hidden="true" data-slot="tab-indicator" data-animate={animate} className="tab-indicator" style={{ visibility: geometry ? 'visible' : 'hidden', transform: `translateX(${geometry?.x ?? 0}px)`, width: geometry?.width ?? 0 }} />
        {items.map(i => <TabsTrigger value={i.value} key={i.value}>{i.label}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  )
}

export function RiskBadge({ score }: { risk: Risk; score: number }) {
  // v20 B4: 채움을 투명하게 낮춰 위험 단계와 관계없이 흰 글씨 대비를 확보한다.
  return (
    <Badge className="gap-1.5 border-0 font-normal text-selection-destructive-foreground" style={{ backgroundColor: `color-mix(in oklch, ${riskTone(score)} 70%, transparent)` }}>
      <span className="font-mono">{score}</span><span className="text-[10px] opacity-70">상위 {topPercent(score)}%</span>
    </Badge>
  )
}
export function PatternBadge({ pattern, probability }: { pattern: string; probability: number }) {
  // 9/18: 정답처럼 보이지 않게 모델 판별 확률로 표현한다 (예: FAN_OUT 의심 87%)
  return <Badge variant="secondary" className="font-mono font-normal text-xs" title={`모델 판별 · ${pattern} 의심 ${probability}%`}>{pattern}<span className="ml-1.5 font-sans text-muted-foreground">의심 {probability}%</span></Badge>
}

export function DetailHeading({ record, linkedRecords, onOpen }: { record: RecordItem; linkedRecords: RecordItem[]; onOpen: (record: RecordItem) => void }) {
  const linkedLabel = record.kind === 'Alert' ? 'Episode' : 'Alert'
  return (
    <header data-testid="detail-header">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{record.title}</h1>
          <span className="font-mono text-xs text-muted-foreground">{record.id}</span>
          <Badge variant="outline" className="text-[10px] font-normal">{record.status}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-2.5" data-testid="detail-row2">
          <RiskBadge risk={record.risk} score={record.score} />
          {record.kind === 'Alert' && <PatternBadge pattern={record.pattern} probability={record.probability} />}
          {linkedRecords.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-xs font-normal"><Link2 className="size-3.5" />연결된 {linkedLabel} {linkedRecords.length}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-1.5" align="start">
                <div className="space-y-1">
                  {linkedRecords.map(linked => (
                    <button type="button" key={linked.id} onClick={() => onOpen(linked)} className="w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="min-w-0"><span className="block font-mono">{linked.id}</span><span className="block text-muted-foreground truncate mt-0.5">{linked.title}</span></span>
                      <RiskBadge risk={linked.risk} score={linked.score} />
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </header>
  )
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

/* 정렬 아이콘 — 활성(desc/asc): 알림과 같은 WideNarrow 세트 + 색 반전 / 미정렬: 기존 비활성 이중 화살표 유지 */
export function SortIcon({ direction }: { direction: SortDirection }) {
  if (!direction) {
    return (
      <span data-sort="none" className="sort-icon inline-flex items-center justify-center size-5 rounded-[5px] bg-muted text-muted-foreground" aria-hidden>
        <ArrowDown className="size-3 -mr-1" strokeWidth={2.4} />
        <ArrowUp className="size-3" strokeWidth={2.4} />
      </span>
    )
  }
  const Icon = direction === 'desc' ? ArrowDownWideNarrow : ArrowUpNarrowWide
  return (
    <span data-sort={direction} className="sort-icon inline-flex items-center justify-center size-5 rounded-[5px] bg-foreground text-background" aria-hidden>
      <Icon className="size-3.5" strokeWidth={2.4} />
    </span>
  )
}
export function SortableHead({ label, active, direction, onSort, className }: { label: string; active: boolean; direction: SortDirection; onSort: () => void; align?: 'left' | 'right'; className?: string }) {
  const state = active ? direction : null
  const spoken = state === 'desc' ? '내림차순' : state === 'asc' ? '오름차순' : '정렬 안 함'
  // 정렬 중이면 머리글 셀을 은은하게 밝히고 아이콘만 반전한다 — 라벨은 왼쪽, 아이콘은 오른쪽 끝에 둔다
  // T3: 머리글 높이·글자를 한 단계 키움(unlayered table-head 규칙을 ! 로 덮음). 패널 높이는 고정하지 않는다.
  return (
    <TableHead className={`!h-12 !text-xs ${className ?? ''}`} aria-sort={state === 'desc' ? 'descending' : state === 'asc' ? 'ascending' : 'none'}>
      <button type="button" onClick={onSort} aria-label={`${label} 정렬 · 현재 ${spoken}`} className="group inline-flex w-full items-center justify-between gap-2 text-sm font-medium">
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
