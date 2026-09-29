// v24 Lists.tsx(kind=Episode)를 옮김. Episode 목록은 묶기 모드가 없다.
import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import type { DateRange } from 'react-day-picker'
import { Download, Inbox, ListFilter, Search } from 'lucide-react'
import { typeDisplay, type EpisodeStatus, type TypeCode } from '@/api/codes'
import type { EpisodeRow } from '@/api/episodes'
import { useCurrentUser } from '@/app/session'
import { FilterChip } from '@/components/FilterChip'
import { DateRangeButton } from '@/components/DateRangeButton'
import { ProvenanceBadge } from '@/components/Provenance'
import { AgeBadge, PatternBadge, RiskBadge, WorkStatusBadge } from '@/components/badges'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { episodeCode } from '@/features/alerts/alertFilters'
import { usd } from '@/features/alerts/metrics'
import { useDataTable } from '@/hooks/use-data-table'
import { useMemoryState } from '@/lib/memory'
import { episodeWorkStatus, workStatusLabels, type WorkStatus } from '@/lib/workStatus'
import { ageOptions } from '@/features/alerts/alertFilters'
import { episodeFilterLabel, episodeFilterNames, matchesEpisode, riskOptions, type EpisodeFilter, type EpisodeFilterField } from './episodeFilters'

export function EpisodeStatusBadge({ status, reviewRequested }: { status: EpisodeStatus; reviewRequested?: boolean }) {
  return <WorkStatusBadge status={episodeWorkStatus(status, reviewRequested)} title={reviewRequested && status === 'OPEN' ? '관리자 검수 요청됨 (FE 제안)' : undefined} />
}

const columns: ColumnDef<EpisodeRow>[] = [
  {
    id: 'episodeId', accessorKey: 'episodeId',
    header: ({ column }) => <DataTableColumnHeader column={column} label="ID / 구성" />,
    cell: ({ row }) => (
      <div className="min-w-0 max-w-[340px]">
        <p className="font-mono text-sm" translate="no">{episodeCode(row.original.episodeId)}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">Alert {row.original.alertCount}건 · 유형 {row.original.primaryTypes.length}개</p>
      </div>
    ),
  },
  { id: 'riskScore', accessorKey: 'riskScore', header: ({ column }) => <DataTableColumnHeader column={column} label="위험도" />, cell: ({ row }) => <RiskBadge score={row.original.riskScore} /> },
  {
    id: 'types', header: '탐지 유형', enableSorting: false,
    cell: ({ row }) => <div className="flex flex-wrap gap-1">{row.original.primaryTypes.map(t => <PatternBadge key={t.code} code={t.code} />)}</div>,
  },
  { id: 'totalAmountUsd', accessorKey: 'totalAmountUsd', header: ({ column }) => <DataTableColumnHeader column={column} label="거래 총액 (USD)" className="flex-row-reverse justify-start" />, cell: ({ row }) => <div className="text-right text-sm tabular-nums">{usd(row.original.totalAmountUsd)}</div> },
  { id: 'alertCount', accessorKey: 'alertCount', header: ({ column }) => <DataTableColumnHeader column={column} label="Alert" className="flex-row-reverse justify-start" />, cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.alertCount}건</div> },
  { id: 'txCount', accessorKey: 'txCount', header: ({ column }) => <DataTableColumnHeader column={column} label="거래" className="flex-row-reverse justify-start" />, cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.txCount}건</div> },
  { id: 'assignee', accessorFn: row => row.assignee.name, header: ({ column }) => <DataTableColumnHeader column={column} label="담당자" /> },
  { id: 'status', accessorKey: 'status', header: ({ column }) => <DataTableColumnHeader column={column} label="상태" />, cell: ({ row }) => <EpisodeStatusBadge status={row.original.status} reviewRequested={Boolean(row.original.reviewRequestedAt)} /> },
  {
    id: 'createdAt', accessorKey: 'createdAt',
    header: ({ column }) => <DataTableColumnHeader column={column} label="생성일" />,
    cell: ({ row }) => <div className="flex items-center gap-2 whitespace-nowrap text-sm tabular-nums text-muted-foreground"><span>{row.original.createdAt.slice(5, 10)}</span><AgeBadge days={row.original.ageDays} /></div>,
  },
]

const columnWidths = {
  episodeId: '12%', riskScore: '8%', types: '18%', totalAmountUsd: '14%',
  alertCount: '7%', txCount: '7%', assignee: '9%', status: '10%', createdAt: '15%',
}

export default function EpisodeList({ rows, today, onOpen }: { rows: EpisodeRow[]; today: Date; onOpen: (row: EpisodeRow) => void }) {
  const currentUser = useCurrentUser()
  const [query, setQuery] = useState('')
  const me = currentUser.userId
  const [filters, setFilters] = useState<EpisodeFilter[]>([{ field: 'assignee', value: me }])
  const [range, setRange] = useState<DateRange>()
  const [filterOpen, setFilterOpen] = useState(false)
  const [field, setField] = useState<EpisodeFilterField>('status')
  const [value, setValue] = useState('IN_PROGRESS')
  const assignees = useMemo(() => new Map(rows.map(row => [row.assignee.userId, row.assignee.name])), [rows])
  const result = useMemo(() => rows.filter(row => matchesEpisode(row, filters, query, range)), [rows, filters, query, range])

  const [rowsPerPage] = useMemoryState('settings:rows', '20')
  const pageSize = Number(rowsPerPage) || 20
  const { table } = useDataTable({
    data: result, columns, pageCount: Math.max(1, Math.ceil(result.length / pageSize)), clientSide: true,
    getRowId: row => String(row.episodeId), defaultColumn: { enableHiding: false },
    initialState: { sorting: [{ id: 'riskScore', desc: true }], pagination: { pageIndex: 0, pageSize } },
    queryKeys: { page: 'ePage', perPage: 'ePerPage', sort: 'eSort', filters: 'eFilters', joinOperator: 'eJoin' },
  })
  const toFirst = () => table.setPageIndex(0)
  const valueOptions: Record<EpisodeFilterField, { value: string; label: string }[]> = {
    status: (['IN_PROGRESS', 'DONE'] as WorkStatus[]).map(s => ({ value: s, label: workStatusLabels[s] })),
    type: Array.from({ length: 9 }, (_, code) => ({ value: String(code), label: typeDisplay(code as TypeCode).label })),
    risk: [...riskOptions],
    assignee: [{ value: String(me), label: '내 담당' }, ...[...assignees].filter(([id]) => id !== me).map(([id, name]) => ({ value: String(id), label: name }))],
    age: ageOptions.map(days => ({ value: String(days), label: `${days}일 이상` })),
  }
  const toFilter = (f: EpisodeFilterField, v: string): EpisodeFilter =>
    f === 'status' ? { field: f, value: v as WorkStatus }
      : f === 'type' ? { field: f, value: Number(v) as TypeCode }
        : f === 'risk' ? { field: f, value: v as 'high' | 'medium' | 'low' }
          : { field: f, value: Number(v) }
  const reset = () => { setQuery(''); setFilters([]); setRange(undefined); toFirst() }

  function download() {
    const csv = '﻿' + ['ID,위험도,Alert,거래,거래 총액(USD),담당자,상태', ...result.map(r => `${episodeCode(r.episodeId)},${r.riskScore},${r.alertCount},${r.txCount},${r.totalAmountUsd},${r.assignee.name},${r.status}`)].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'Episode-목록.csv'; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-[1320px] space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative mr-1 w-64">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Episode 검색" placeholder="ID, 탐지 유형, 담당자 검색" value={query} onChange={e => { setQuery(e.target.value); toFirst() }} className="h-9 pl-9 text-xs" />
        </div>
        <DateRangeButton value={range} onChange={r => { setRange(r); toFirst() }} today={today} />
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild><Button variant="outline" size="sm" className="filter-trigger date-range-control h-9"><ListFilter data-icon="inline-start" />필터{filters.length > 0 && <Badge className="ml-1 h-5 min-w-5 px-1.5">{filters.length}</Badge>}</Button></PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-3">
            <div className="flex items-center justify-between"><Label>조건 추가</Label>{['type', 'risk', 'age'].includes(field) && <ProvenanceBadge kind="proposal" title="이 조건은 Episode 목록 API에 없어 현재 불러온 목록에서만 적용됩니다." />}</div>
            <Select value={field} onValueChange={v => { const f = v as EpisodeFilterField; setField(f); setValue(valueOptions[f][0].value) }}>
              <SelectTrigger className="w-full" aria-label="필터 항목"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(episodeFilterNames).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger className="w-full" aria-label="필터 값"><SelectValue /></SelectTrigger>
              <SelectContent>{valueOptions[field].map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button className="w-full" size="sm" onClick={() => {
              const next = toFilter(field, value)
              setFilters(prev => prev.some(f => f.field === next.field && f.value === next.value) ? prev : [...prev, next])
              toFirst(); setFilterOpen(false)
            }}>조건 적용</Button>
          </PopoverContent>
        </Popover>
        <Button variant="outline" size="sm" className="ml-auto" onClick={download}><Download className="size-3.5" />다운로드</Button>
      </div>
      {filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {filters.map((filter, i) => <span key={`${filter.field}-${filter.value}`} className="inline-flex items-center gap-1"><FilterChip onRemove={() => { setFilters(prev => prev.filter((_, j) => j !== i)); toFirst() }}>{episodeFilterLabel(filter, id => assignees.get(id) ?? String(id), me)}</FilterChip>{['type', 'risk', 'age'].includes(filter.field) && <ProvenanceBadge kind="proposal" title="이 조건은 Episode 목록 API에 없어 현재 불러온 목록에서만 적용됩니다." />}</span>)}
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={reset}>모든 조건 지우기</Button>
        </div>
      )}
      {result.length
        ? <DataTable table={table} columnWidths={columnWidths} tableClassName="table-fixed min-w-[990px] [&_th]:px-2.5 [&_td]:px-2.5" onRowClick={onOpen} data-testid="episode-table" />
        : (
          <div className="glass-surface rounded-md border py-20 text-center">
            <Inbox className="mx-auto mb-4 size-7 text-muted-foreground" />
            <p className="text-sm">조건에 맞는 Episode가 없습니다.</p>
            <p className="mb-4 mt-2 text-xs text-muted-foreground">검색어와 필터를 확인하세요.</p>
            <Button size="sm" variant="outline" onClick={reset}>전체 목록 보기</Button>
          </div>
        )}
    </div>
  )
}
