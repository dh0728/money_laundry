// v24 Lists.tsx(kind=Alert)를 옮김. 툴바(검색·기간·필터·조건 칩) + data-table + "Episode로 묶기".
import { useMemo, useReducer, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import type { ColumnDef } from '@tanstack/react-table'
import { Combine, Download, Inbox, ListFilter, Search } from 'lucide-react'
import type { AlertRow } from '@/api/alerts'
import { typeDisplay, type AlertStatus, type TypeCode } from '@/api/codes'
import { useCurrentUser } from '@/app/session'
import { DateRangeButton } from '@/components/DateRangeButton'
import { FilterChip } from '@/components/FilterChip'
import { AgeBadge, PatternBadge, RiskBadge, StatusBadge } from '@/components/badges'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDataTable } from '@/hooks/use-data-table'
import { usd } from '@/lib/format'
import { useMemoryState } from '@/lib/memory'
import { alertWorkStatus, workStatusLabels } from '@/lib/workStatus'
import { ageOptions, alertCode, episodeCode, filterFieldNames, filterLabel, matchesAlert, type AlertFilter, type AlertFilterField } from './alertFilters'
import { canLink, episodeLinkReducer, initialLinkState, linkableEpisodes, type EpisodeTarget } from './episodeLink'


const baseColumns: ColumnDef<AlertRow>[] = [
  {
    id: 'alertId', accessorKey: 'alertId',
    header: ({ column }) => <DataTableColumnHeader column={column} label="ID / 계좌 구성" />,
    cell: ({ row }) => (
      <div className="min-w-0 max-w-[340px]">
        <p className="font-mono text-sm" translate="no">{alertCode(row.original.alertId)}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">계좌 {row.original.accountCount}개 · 은행 {row.original.bankCount}곳</p>
      </div>
    ),
  },
  { id: 'riskScore', accessorKey: 'riskScore', header: ({ column }) => <DataTableColumnHeader column={column} label="위험도" />, cell: ({ row }) => <RiskBadge score={row.original.riskScore} /> },
  { id: 'type', accessorFn: row => row.primaryType.code, header: ({ column }) => <DataTableColumnHeader column={column} label="탐지 유형" />, cell: ({ row }) => <PatternBadge code={row.original.primaryType.code} /> },
  {
    id: 'totalAmountUsd', accessorKey: 'totalAmountUsd',
    header: ({ column }) => <DataTableColumnHeader column={column} label="거래 총액 (USD)" className="flex-row-reverse justify-start" />,
    cell: ({ row }) => <div className="text-right text-sm tabular-nums">{usd(row.original.totalAmountUsd)}</div>,
  },
  {
    id: 'txCount', accessorKey: 'txCount',
    header: ({ column }) => <DataTableColumnHeader column={column} label="거래" className="flex-row-reverse justify-start" />,
    cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.txCount}건</div>,
  },
  { id: 'assignee', accessorFn: row => row.assignee.name, header: ({ column }) => <DataTableColumnHeader column={column} label="담당자" /> },
  { id: 'status', accessorKey: 'status', header: ({ column }) => <DataTableColumnHeader column={column} label="상태" />, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  {
    id: 'createdAt', accessorKey: 'createdAt',
    header: ({ column }) => <DataTableColumnHeader column={column} label="탐지일" />,
    cell: ({ row }) => {
      const { createdAt, ageDays } = row.original
      return (
        <div className="flex items-center gap-2 whitespace-nowrap text-sm tabular-nums text-muted-foreground">
          <span>{createdAt.slice(5, 10)}</span>
          <AgeBadge days={ageDays} />
        </div>
      )
    },
  },
  {
    id: 'episode', header: 'Episode 연결', enableSorting: false,
    cell: ({ row }) => row.original.episodeId != null
      ? <Badge variant="outline" className="font-mono text-xs font-normal">{episodeCode(row.original.episodeId)}</Badge>
      : <span className="text-xs text-muted-foreground">미연결</span>,
  },
]

const browseColumnWidths = {
  alertId: '13%', riskScore: '8%', type: '14%', totalAmountUsd: '14%',
  txCount: '7%', assignee: '9%', status: '9%', createdAt: '15%', episode: '11%',
}
const linkColumnWidths = { ...browseColumnWidths, select: '4%', alertId: '12%', type: '13%', totalAmountUsd: '13%', episode: '10%' }

const statusValues: AlertStatus[] = ['OPEN', 'ESCALATED', 'CLOSED']
const typeValues = Array.from({ length: 9 }, (_, code) => code as TypeCode)

type Props = {
  rows: AlertRow[]
  today: Date
  onOpen: (row: AlertRow) => void
  onLink: (alertIds: number[], target: EpisodeTarget, comment: string) => void
}

export default function AlertList({ rows, today, onOpen, onLink }: Props) {
  const currentUser = useCurrentUser()
  const me = currentUser.userId
  const [query, setQuery] = useState('')
  // v24처럼 "내 담당" 조건을 켠 채 시작한다(API.md §3.2 기본 뷰 assigneeId=me)
  const [filters, setFilters] = useState<AlertFilter[]>([{ field: 'assignee', value: me }])
  const [range, setRange] = useState<DateRange>()
  const [filterOpen, setFilterOpen] = useState(false)
  const [field, setField] = useState<AlertFilterField>('status')
  const [value, setValue] = useState('OPEN')
  const [link, dispatchLink] = useReducer(episodeLinkReducer, initialLinkState)
  const [target, setTarget] = useState<string>('new')
  const [comment, setComment] = useState('')

  const assignees = useMemo(() => new Map(rows.map(row => [row.assignee.userId, row.assignee.name])), [rows])
  const episodes = useMemo(() => linkableEpisodes(rows), [rows])
  const result = useMemo(() => rows.filter(row => matchesAlert(row, filters, query, range)), [rows, filters, query, range])

  const columns = useMemo<ColumnDef<AlertRow>[]>(() => link.mode === 'browse' ? baseColumns : [
    {
      id: 'select', header: '선택', enableSorting: false,
      cell: ({ row }) => (
        <Checkbox
          aria-label={`${alertCode(row.original.alertId)} 선택`}
          disabled={!canLink(row.original, currentUser)}
          checked={link.selected.has(row.original.alertId)}
          onClick={event => event.stopPropagation()}
          onCheckedChange={() => dispatchLink({ type: 'toggle', id: row.original.alertId })}
        />
      ),
    },
    ...baseColumns,
  ], [link, currentUser])

  const [rowsPerPage] = useMemoryState('settings:rows', '20') // 설정 > 페이지당 행
  const pageSize = Number(rowsPerPage) || 20
  const { table } = useDataTable({
    data: result, columns, pageCount: Math.max(1, Math.ceil(result.length / pageSize)), clientSide: true,
    getRowId: row => String(row.alertId), defaultColumn: { enableHiding: false },
    initialState: { sorting: [{ id: 'riskScore', desc: true }], pagination: { pageIndex: 0, pageSize } },
    queryKeys: { page: 'aPage', perPage: 'aPerPage', sort: 'aSort', filters: 'aFilters', joinOperator: 'aJoin' },
  })
  const toFirst = () => table.setPageIndex(0)

  const valueOptions: Record<AlertFilterField, { value: string; label: string }[]> = {
    status: statusValues.map(s => ({ value: s, label: workStatusLabels[alertWorkStatus(s)] })),
    type: typeValues.map(code => ({ value: String(code), label: typeDisplay(code).label })),
    assignee: [{ value: String(me), label: '내 담당' }, ...[...assignees].filter(([id]) => id !== me).map(([id, name]) => ({ value: String(id), label: name }))],
    age: ageOptions.map(days => ({ value: String(days), label: `${days}일 이상` })),
  }
  const toFilter = (f: AlertFilterField, v: string): AlertFilter =>
    f === 'status' ? { field: f, value: v as AlertStatus } : f === 'type' ? { field: f, value: Number(v) as TypeCode } : { field: f, value: Number(v) }

  const reset = () => { setQuery(''); setFilters([]); setRange(undefined); toFirst() }
  const endLink = (type: 'complete' | 'cancel') => { dispatchLink({ type }); setTarget('new'); setComment('') }

  function download() {
    const csv = '﻿' + ['ID,위험도,탐지 유형,거래 총액(USD),거래,담당자,상태', ...result.map(r => `${alertCode(r.alertId)},${r.riskScore},${typeDisplay(r.primaryType.code).key},${r.totalAmountUsd},${r.txCount},${r.assignee.name},${r.status}`)].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'Alert-목록.csv'; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-[1320px] space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative mr-1 w-64">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Alert 검색" placeholder="ID, 탐지 유형, 담당자 검색" value={query} onChange={e => { setQuery(e.target.value); toFirst() }} className="h-9 pl-9 text-xs" />
        </div>
        <DateRangeButton value={range} onChange={r => { setRange(r); toFirst() }} today={today} />
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="filter-trigger date-range-control h-9"><ListFilter data-icon="inline-start" />필터{filters.length > 0 && <Badge className="ml-1 h-5 min-w-5 px-1.5">{filters.length}</Badge>}</Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-3">
            <Label>조건 추가</Label>
            <Select value={field} onValueChange={v => { const f = v as AlertFilterField; setField(f); setValue(valueOptions[f][0].value) }}>
              <SelectTrigger className="w-full" aria-label="필터 항목"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(filterFieldNames).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
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
        {currentUser.role === 'STAFF' && link.mode === 'browse' && <Button variant="outline" size="sm" className="ml-auto" disabled={!rows.some(row => canLink(row, currentUser))} onClick={() => dispatchLink({ type: 'start' })}><Combine className="size-3.5" />Episode로 묶기</Button>}
        <Button variant="outline" size="sm" className={link.mode === 'browse' ? '' : 'ml-auto'} onClick={download}><Download className="size-3.5" />다운로드</Button>
      </div>

      {link.mode === 'link' && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-md border bg-background/95 px-3 py-2 shadow-sm backdrop-blur" data-testid="episode-link-action-bar">
          <strong className="mr-auto text-sm">{link.selected.size}건 선택 <span className="ml-1 text-xs font-normal text-muted-foreground">처리 전 Alert만 고를 수 있습니다</span></strong>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger size="sm" className="w-52" aria-label="Episode 연결 방식"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="new">새 Episode 생성</SelectItem>
              {episodes.map(id => <SelectItem key={id} value={String(id)}>기존 Episode · {episodeCode(id)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input aria-label="연결 의견" placeholder="의견 (필수)" value={comment} onChange={e => setComment(e.target.value)} className="h-8 w-64 text-xs" />
          <Button size="sm" disabled={link.selected.size === 0 || !comment.trim()} onClick={() => {
            onLink([...link.selected], target === 'new' ? 'new' : Number(target), comment.trim())
            endLink('complete')
          }}>연결 완료</Button>
          <Button size="sm" variant="outline" onClick={() => endLink('cancel')}>취소</Button>
        </div>
      )}

      {filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {filters.map((f, i) => (
            <FilterChip key={`${f.field}-${f.value}`} onRemove={() => { setFilters(prev => prev.filter((_, j) => j !== i)); toFirst() }}>
              {filterLabel(f, id => assignees.get(id) ?? String(id), me)}
            </FilterChip>
          ))}
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={reset}>모든 조건 지우기</Button>
        </div>
      )}

      {result.length
        ? <DataTable table={table} columnWidths={link.mode === 'link' ? linkColumnWidths : browseColumnWidths} tableClassName="table-fixed min-w-[990px] [&_th]:px-2.5 [&_td]:px-2.5" onRowClick={link.mode === 'link' ? row => canLink(row, currentUser) && dispatchLink({ type: 'toggle', id: row.alertId }) : onOpen} data-testid="alert-table" />
        : (
          <div className="glass-surface rounded-md border py-20 text-center">
            <Inbox className="mx-auto mb-4 size-7 text-muted-foreground" />
            <p className="text-sm">조건에 맞는 Alert가 없습니다.</p>
            <p className="mb-4 mt-2 text-xs text-muted-foreground">검색어와 필터를 확인하세요.</p>
            <Button size="sm" variant="outline" onClick={reset}>전체 목록 보기</Button>
          </div>
        )}
    </div>
  )
}
