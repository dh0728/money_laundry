// v20: 목록 툴바는 v18 UI(검색 · 기간 · 필터 팝오버 · 조건 칩)로 되돌렸다(명기 R2).
// 표 본문·열 머리글 정렬 메뉴·페이지는 커뮤니티 표준 data-table(Dice UI · TanStack Table)을 유지한다. 열 숨기기는 되돌릴 경로가 안 보여 뺐다.
import { useMemo, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import type { ColumnDef } from '@tanstack/react-table'
import { Download, Inbox, ListFilter, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { DataTableSkeleton } from '@/components/data-table/data-table-skeleton'
import { useDataTable } from '@/hooks/use-data-table'
import { ageOptions, ageTone, matches, nextSort, patternOptions, usd, type Filter, type FilterField, type Kind, type RecordItem, type SortDirection } from './domain'
import { DateRangeButton, FilterChip, PatternBadge, RiskBadge } from './shared'
import { useMemoryState } from './memory'

export type DataState = 'normal' | 'loading' | 'empty' | 'error' | 'stale'

// 정렬 상태 hook: 상세 거래 표가 쓴다
export function useSort<K extends string>(initialKey: K | null, initialDirection: SortDirection) {
  const [key, setKey] = useState<K | null>(initialKey), [direction, setDirection] = useState<SortDirection>(initialDirection)
  const toggle = (next: K) => {
    if (next === key) { const d = nextSort(direction); setDirection(d); if (!d) setKey(null) }
    else { setKey(next); setDirection('desc') }
  }
  return { key, direction, toggle }
}

export const fieldNames: Record<FilterField, string> = { risk: '위험도', owner: '담당자', status: '처리 상태', pattern: '탐지 유형', age: '경과일' }

const columns: ColumnDef<RecordItem>[] = [
  { id: 'id', accessorKey: 'id', header: ({ column }) => <DataTableColumnHeader column={column} label="ID / 탐지 내용" />,
    cell: ({ row }) => <div className="min-w-0 max-w-[340px]"><p className="text-sm font-mono" translate="no">{row.original.id}</p><p className="text-xs text-muted-foreground mt-1 truncate">{row.original.title}</p></div> },
  { id: 'score', accessorKey: 'score', header: ({ column }) => <DataTableColumnHeader column={column} label="위험도" />,
    cell: ({ row }) => <RiskBadge risk={row.original.risk} score={row.original.score} /> },
  { id: 'pattern', accessorKey: 'pattern', header: ({ column }) => <DataTableColumnHeader column={column} label="탐지 유형 · 확률" />,
    cell: ({ row }) => <PatternBadge pattern={row.original.pattern} probability={row.original.probability} /> },
  { id: 'amount', accessorKey: 'amount', header: ({ column }) => <DataTableColumnHeader column={column} label="거래 금액 (USD)" className="ml-auto" />,
    cell: ({ row }) => <div className="text-right tabular-nums text-sm">{usd(row.original.amount)}</div> },
  { id: 'count', accessorKey: 'count', header: ({ column }) => <DataTableColumnHeader column={column} label="거래" className="ml-auto" />,
    cell: ({ row }) => <div className="text-right tabular-nums text-sm">{row.original.count}건</div> },
  { id: 'owner', accessorKey: 'owner', header: ({ column }) => <DataTableColumnHeader column={column} label="담당자" /> },
  { id: 'status', accessorKey: 'status', header: ({ column }) => <DataTableColumnHeader column={column} label="상태" />,
    cell: ({ row }) => <Badge variant={row.original.status === '신규' ? 'secondary' : 'outline'} className="font-normal text-xs">{row.original.status}</Badge> },
  { id: 'date', accessorKey: 'date', header: ({ column }) => <DataTableColumnHeader column={column} label="탐지일" />,
    cell: ({ row }) => { const r = row.original; return <div className="text-sm text-muted-foreground tabular-nums">{r.date.slice(5)}<p className={`mt-1 text-xs ${r.age >= 3 ? 'font-medium' : ''}`} style={{ color: ageTone(r.age) }}>{r.age === 0 ? '오늘' : `${r.age}일 경과`}</p></div> } },
]

export default function Lists({ kind, records, user, onOpen, state, setState }: { kind: Kind; records: RecordItem[]; user: string; onOpen: (r: RecordItem) => void; state: DataState; setState: (s: DataState) => void }) {
  const [query, setQuery] = useState(''), [filters, setFilters] = useState<Filter[]>([]), [field, setField] = useState<FilterField>('owner'), [value, setValue] = useState('내 담당'), [filterOpen, setFilterOpen] = useState(false)
  const [range, setRange] = useState<DateRange>()
  const [rowsPerPage] = useMemoryState('settings:rows', '20') // 설정 > 페이지당 행(20/50/100)을 첫 값으로 쓴다
  const base = useMemo(() => records.filter(r => r.kind === kind), [records, kind])
  const result = useMemo(() => state === 'empty' ? [] : base.filter(r => matches(r, filters, query, range?.from, range?.to)), [state, base, filters, query, range])
  const pageSize = Number(rowsPerPage) || 20
  const k = kind === 'Alert' ? 'a' : 'e' // Alert·Episode 목록이 URL 정렬·페이지를 섞지 않도록 키를 나눈다
  const { table } = useDataTable({
    data: result, columns, pageCount: Math.max(1, Math.ceil(result.length / pageSize)), clientSide: true, getRowId: r => r.id, defaultColumn: { enableHiding: false },
    initialState: { sorting: [{ id: 'score', desc: true }], pagination: { pageIndex: 0, pageSize } },
    queryKeys: { page: `${k}Page`, perPage: `${k}PerPage`, sort: `${k}Sort`, filters: `${k}Filters`, joinOperator: `${k}Join` },
  })
  const fields: Record<FilterField, string[]> = {
    risk: ['고위험', '중위험', '저위험'], owner: ['내 담당', ...new Set(base.map(r => r.owner).filter(x => x !== user))],
    status: ['신규', kind === 'Alert' ? '검토 중' : '조사 중', '종결'], pattern: [...patternOptions], age: ageOptions,
  }
  const toFirst = () => table.setPageIndex(0)
  const normalized = (f: Filter): Filter => f.field === 'owner' && f.value === '내 담당' ? { field: 'owner', value: user } : f
  const chipLabel = (f: Filter) => f.field === 'owner' && f.value === user ? '담당자: 내 담당' : f.field === 'age' ? `경과일: ${f.value}일 이상` : `${fieldNames[f.field]}: ${f.value}`
  const reset = () => { setQuery(''); setFilters([]); setRange(undefined); toFirst(); setState('normal') }
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
          <Input aria-label={`${kind} 검색`} placeholder="ID, 탐지 내용, 담당자 검색" value={query} onChange={e => { setQuery(e.target.value); toFirst() }} className="pl-9 h-9 text-xs" />
        </div>
        <DateRangeButton value={range} onChange={r => { setRange(r); toFirst() }} />
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="filter-trigger date-range-control h-9"><ListFilter data-icon="inline-start" />필터{filters.length > 0 && <Badge className="ml-1 h-5 min-w-5 px-1.5">{filters.length}</Badge>}</Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-3">
            <Label>조건 추가</Label>
            <Select value={field} onValueChange={v => { setField(v as FilterField); setValue(fields[v as FilterField][0]) }}>
              <SelectTrigger className="w-full" aria-label="필터 항목"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(fieldNames).map(([key, v]) => <SelectItem key={key} value={key}>{v}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger className="w-full" aria-label="필터 값"><SelectValue /></SelectTrigger>
              <SelectContent>{fields[field].map(v => <SelectItem key={v} value={v}>{field === 'age' ? `${v}일 이상` : v}</SelectItem>)}</SelectContent>
            </Select>
            <Button className="w-full" size="sm" onClick={() => { const f = normalized({ field, value }); setFilters(p => p.some(x => x.field === f.field && x.value === f.value) ? p : [...p, f]); toFirst(); setFilterOpen(false) }}>조건 적용</Button>
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
          <div className="text-xs flex-1">재조회 실패 · 마지막 정상 결과를 유지합니다<span className="block text-[10px] text-muted-foreground mt-0.5">마지막 성공 14:32</span></div>
          <Button size="sm" variant="outline" onClick={() => setState('normal')}><RefreshCw className="size-3" />다시 시도</Button>
        </div>
      )}
      {state === 'loading'
        ? <DataTableSkeleton columnCount={8} filterCount={0} rowCount={8} withViewOptions={false} aria-label="목록 불러오는 중" />
        : state === 'error'
          ? <div className="glass-surface rounded-md border py-20 text-center"><TriangleAlert className="size-6 mx-auto mb-4 text-muted-foreground" /><p className="text-sm">목록을 불러오지 못했습니다.</p><p className="text-xs text-muted-foreground mt-2 mb-4">잠시 후 다시 시도해 주세요.</p><Button size="sm" variant="outline" onClick={() => setState('normal')}>다시 시도</Button></div>
          : result.length
            ? <DataTable table={table} onRowClick={onOpen} data-testid="record-table" />
            : <div className="glass-surface rounded-md border py-20 text-center"><Inbox className="size-7 mx-auto mb-4 text-muted-foreground" /><p className="text-sm">조건에 맞는 {kind}가 없습니다.</p><p className="text-xs text-muted-foreground mt-2 mb-4">검색어와 필터를 확인하세요.</p><Button size="sm" variant="outline" onClick={reset}>전체 목록 보기</Button></div>}
    </div>
  )
}
