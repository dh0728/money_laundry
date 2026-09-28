import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { ChevronLeft, ChevronRight, Download, ListFilter, RefreshCw, Search, TriangleAlert, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ageOptions, ageTone, matches, nextSort, patternOptions, sortRows, usd, type RecordItem, type Filter, type FilterField, type Kind, type SortDirection } from './domain'
import { PatternBadge, RiskBadge, DateRangeButton, FilterChip, SortableHead } from './shared'
import { useMemoryState } from './memory'

export type DataState = 'normal' | 'loading' | 'empty' | 'error' | 'stale'
type SortKey = 'id' | 'score' | 'pattern' | 'amount' | 'count' | 'owner' | 'status' | 'date'

// 정렬 상태 hook: Alert·Episode 목록과 상세 거래 표가 같은 순환 규칙을 쓴다
export function useSort<K extends string>(initialKey: K | null, initialDirection: SortDirection) {
  const [key, setKey] = useState<K | null>(initialKey), [direction, setDirection] = useState<SortDirection>(initialDirection)
  const toggle = (next: K) => {
    if (next === key) { const d = nextSort(direction); setDirection(d); if (!d) setKey(null) }
    else { setKey(next); setDirection('desc') }
  }
  return { key, direction, toggle }
}

export function RecordTable({ rows, onOpen, page = 0, pageSize = rows.length || 1 }: { rows: RecordItem[]; onOpen: (r: RecordItem) => void; page?: number; pageSize?: number }) {
  const sort = useSort<SortKey>('score', 'desc')
  const head = (label: string, value: SortKey, align: 'left' | 'right' = 'left', className = '') =>
    <SortableHead label={label} active={sort.key === value} direction={sort.direction} onSort={() => sort.toggle(value)} align={align} className={className} />
  return (
    <Table className="record-table table-fixed min-w-[980px]">
      <colgroup><col className="w-[24%]" /><col className="w-[11%]" /><col className="w-[15%]" /><col className="w-[13%]" /><col className="w-[8%]" /><col className="w-[9%]" /><col className="w-[9%]" /><col className="w-[11%]" /></colgroup>
      <TableHeader>
        <TableRow>
          {head('ID / 탐지 내용', 'id')}{head('위험도', 'score')}{head('탐지 유형 · 확률', 'pattern')}
          {head('거래 금액 (USD)', 'amount', 'right')}{head('거래', 'count', 'right')}
          {head('담당자', 'owner')}{head('상태', 'status')}{head('탐지일', 'date')}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortRows(rows, sort.key, sort.direction).slice(page * pageSize, (page + 1) * pageSize).map(r => {
          // 정렬 중인 열의 셀에만 옅은 배경을 준다 — 데이터 속성 + index.css의 공통 규칙 조합(다른 표에도 그대로 적용 가능)
          const sorted = (k: SortKey) => sort.key === k || undefined
          return (
          <TableRow key={r.id} className="cursor-pointer" tabIndex={0} onClick={() => onOpen(r)} onKeyDown={e => { if (e.key === 'Enter') onOpen(r) }}>
            <TableCell data-sorted={sorted('id')}><p className="text-xs font-mono">{r.id}</p><p className="text-[11px] text-muted-foreground mt-1 truncate">{r.title}</p></TableCell>
            <TableCell data-sorted={sorted('score')}><RiskBadge risk={r.risk} score={r.score} /></TableCell>
            <TableCell data-sorted={sorted('pattern')}><PatternBadge pattern={r.pattern} probability={r.probability} /></TableCell>
            <TableCell data-sorted={sorted('amount')} className="text-right tabular-nums text-xs">{usd(r.amount)}</TableCell>
            <TableCell data-sorted={sorted('count')} className="text-right tabular-nums text-xs">{r.count}건</TableCell>
            <TableCell data-sorted={sorted('owner')} className="text-xs">{r.owner}</TableCell>
            <TableCell data-sorted={sorted('status')}><Badge variant={r.status === '신규' ? 'secondary' : 'outline'} className="font-normal text-[11px]">{r.status}</Badge></TableCell>
            <TableCell data-sorted={sorted('date')} className="text-xs text-muted-foreground tabular-nums">{r.date.slice(5)}<p className={`mt-1 ${r.age >= 3 ? 'font-medium' : ''}`} style={{ color: ageTone(r.age) }}>{r.age === 0 ? '오늘' : `${r.age}일 경과`}</p></TableCell>
          </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export const fieldNames: Record<FilterField, string> = { risk: '위험도', owner: '담당자', status: '처리 상태', pattern: '탐지 유형', age: '경과일' }

export default function Lists({ kind, records, user, onOpen, state, setState }: { kind: Kind; records: RecordItem[]; user: string; onOpen: (r: RecordItem) => void; state: DataState; setState: (s: DataState) => void }) {
  const [query, setQuery] = useState(''), [filters, setFilters] = useState<Filter[]>([]), [field, setField] = useState<FilterField>('owner'), [value, setValue] = useState('내 담당'), [filterOpen, setFilterOpen] = useState(false)
  const [range, setRange] = useState<DateRange>(), [page, setPage] = useState(0)
  const [rowsPerPage] = useMemoryState('settings:rows', '20') // 설정 > 페이지당 행(20/50/100)을 그대로 따른다
  const base = records.filter(r => r.kind === kind), result = state === 'empty' ? [] : base.filter(r => matches(r, filters, query, range?.from, range?.to))
  const count = Number(rowsPerPage) || 20, pages = Math.max(1, Math.ceil(result.length / count)), current = Math.min(page, pages - 1)
  const fields: Record<FilterField, string[]> = {
    risk: ['고위험', '중위험', '저위험'], owner: ['내 담당', ...new Set(base.map(r => r.owner).filter(x => x !== user))],
    status: ['신규', kind === 'Alert' ? '검토 중' : '조사 중', '종결'], pattern: [...patternOptions], age: ageOptions,
  }
  const normalized = (f: Filter): Filter => f.field === 'owner' && f.value === '내 담당' ? { field: 'owner', value: user } : f
  const chipLabel = (f: Filter) => f.field === 'owner' && f.value === user ? '담당자: 내 담당' : f.field === 'age' ? `경과일: ${f.value}일 이상` : `${fieldNames[f.field]}: ${f.value}`
  const reset = () => { setQuery(''); setFilters([]); setRange(undefined); setPage(0); setState('normal') }
  function download() {
    const csv = '﻿' + ['ID,위험도,점수,탐지 유형,확률,금액(USD),거래,상태', ...result.map(r => `${r.id},${r.risk},${r.score},${r.pattern},${r.probability}%,${r.amount.toFixed(2)},${r.count},${r.status}`)].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })), a = document.createElement('a')
    a.href = url; a.download = `${kind}-목록.csv`; a.click(); URL.revokeObjectURL(url)
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64 mr-1">
          <Search className="size-4 absolute left-3 top-2.5 text-muted-foreground" />
          <Input aria-label={`${kind} 검색`} placeholder="ID, 탐지 내용, 담당자 검색" value={query} onChange={e => { setQuery(e.target.value); setPage(0) }} className="pl-9 h-9 text-xs" />
        </div>
        <DateRangeButton value={range} onChange={r => { setRange(r); setPage(0) }} />
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm"><ListFilter className="size-3.5" />필터{filters.length > 0 && <Badge className="ml-1 h-5 min-w-5 px-1.5">{filters.length}</Badge>}</Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-3">
            <Label>조건 추가</Label>
            <Select value={field} onValueChange={v => { setField(v as FilterField); setValue(fields[v as FilterField][0]) }}>
              <SelectTrigger className="w-full" aria-label="필터 항목"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(fieldNames).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger className="w-full" aria-label="필터 값"><SelectValue /></SelectTrigger>
              <SelectContent>{fields[field].map(v => <SelectItem key={v} value={v}>{field === 'age' ? `${v}일 이상` : v}</SelectItem>)}</SelectContent>
            </Select>
            <Button className="w-full" size="sm" onClick={() => { const f = normalized({ field, value }); setFilters(p => p.some(x => x.field === f.field && x.value === f.value) ? p : [...p, f]); setPage(0); setFilterOpen(false) }}>조건 적용</Button>
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={download}><Download className="size-3.5" />다운로드</Button>
      </div>
      {filters.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          {filters.map((f, i) => <FilterChip key={`${f.field}-${f.value}`} onRemove={() => setFilters(p => p.filter((_, j) => j !== i))}>{chipLabel(f)}</FilterChip>)}
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={reset}>모든 조건 지우기</Button>
        </div>
      )}
      {state === 'stale' && (
        <div role="alert" className="flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
          <TriangleAlert className="size-4 text-destructive shrink-0" />
          <div className="text-xs flex-1">재조회 실패 · 마지막 정상 결과를 유지합니다<span className="block text-[10px] text-muted-foreground mt-0.5">마지막 성공 14:32 · 요청 REQ-DEMO-016</span></div>
          <Button size="sm" variant="outline" onClick={() => setState('normal')}><RefreshCw className="size-3" />다시 시도</Button>
        </div>
      )}
      <div className="border rounded-lg overflow-x-auto">
        {state === 'loading'
          ? <div className="p-4 space-y-6" aria-label="목록 불러오는 중">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          : state === 'error'
            ? <div className="py-20 text-center"><TriangleAlert className="size-6 mx-auto mb-4 text-muted-foreground" /><p className="text-sm">목록을 불러오지 못했습니다.</p><p className="text-xs text-muted-foreground mt-2 mb-4">잠시 후 다시 시도해 주세요.</p><Button size="sm" variant="outline" onClick={() => setState('normal')}>다시 시도</Button></div>
            : result.length
              ? <RecordTable rows={result} onOpen={onOpen} page={current} pageSize={count} />
              : <div className="py-20 text-center"><Inbox className="size-7 mx-auto mb-4 text-muted-foreground" /><p className="text-sm">조건에 맞는 {kind}가 없습니다.</p><p className="text-xs text-muted-foreground mt-2 mb-4">검색어와 필터를 확인하세요.</p><Button size="sm" variant="outline" onClick={reset}>전체 목록 보기</Button></div>}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span data-testid="result-count">{state === 'loading' || state === 'error' ? '—' : `${result.length ? `${current * count + 1}–${Math.min((current + 1) * count, result.length)}` : '0'} / ${result.length}건`}</span>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" className="size-7" disabled={current === 0} aria-label="이전 페이지" onClick={() => setPage(current - 1)}><ChevronLeft className="size-3.5" /></Button>
          <span>{state === 'loading' || state === 'error' ? '—' : `${current + 1} / ${pages}`}</span>
          <Button variant="outline" size="icon" className="size-7" disabled={current >= pages - 1} aria-label="다음 페이지" onClick={() => setPage(current + 1)}><ChevronRight className="size-3.5" /></Button>
        </div>
      </div>
    </div>
  )
}
