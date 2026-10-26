// v24 Lists.tsx(kind=Alert)를 옮김. 툴바(검색·기간·필터·조건 칩) + data-table + "Episode로 묶기".
import { useCallback, useMemo, useReducer, useState, type ReactNode } from 'react'
import type { DateRange } from 'react-day-picker'
import type { ColumnDef } from '@tanstack/react-table'
import { Combine, Download, Inbox, ListFilter, Search } from 'lucide-react'
import type { AlertRow } from '@/api/alerts'
import { typeDisplay, type AlertStatus, type TypeCode } from '@/api/codes'
import { useCurrentUser } from '@/app/session'
import { DateRangeButton } from '@/components/DateRangeButton'
import { FilterChip } from '@/components/FilterChip'
import { AgeBadge, PatternBadge, RiskBadge, StatusBadge, alertStatusLabels } from '@/components/badges'
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
import { useMemoryState } from '@/lib/memory'
import { useViewState } from '@/lib/workspaceState'
import { ageOptions, alertCode, episodeCode, filterFieldNames, filterLabel, matchesAlert, type AlertFilter, type AlertFilterField } from './alertFilters'
import { canLink, episodeLinkReducer, initialLinkState, linkableEpisodes, type EpisodeTarget, type EpisodeLinkState, type EpisodeLinkAction } from './episodeLink'


export type AlertListRow = Pick<AlertRow, 'alertId' | 'riskScore' | 'txCount' | 'assignee' | 'status' | 'createdAt' | 'ageDays' | 'episodeId' > & Partial<Pick<AlertRow, 'summary' | 'subjectAccount' | 'lastTxAt'>> & { primaryType: { code: TypeCode | null; name: string }; accountCount?: number; bankCount?: number; totalAmountUsd?: number; amountLabel?: string }

const baseColumns: ColumnDef<AlertListRow>[] = [
  {
    id: 'alertId', accessorKey: 'alertId',
    header: ({ column }) => <DataTableColumnHeader column={column} label="ID / 계좌 구성" />,
    cell: ({ row }) => (
      <div className="min-w-0 max-w-[340px]">
        <p className="font-mono text-sm" translate="no">{alertCode(row.original.alertId)}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{row.original.accountCount == null ? '조사 거래 묶음' : `계좌 ${row.original.accountCount}개 · 은행 ${row.original.bankCount}곳`}</p>
      </div>
    ),
  },
  { id: 'riskScore', accessorKey: 'riskScore', header: ({ column }) => <DataTableColumnHeader column={column} label="위험도" />, cell: ({ row }) => <RiskBadge score={row.original.riskScore} /> },
  { id: 'type', accessorFn: row => row.primaryType.code, header: ({ column }) => <DataTableColumnHeader column={column} label="탐지 유형" />, cell: ({ row }) => <>{row.original.primaryType.code == null ? <Badge variant="outline">{row.original.primaryType.name}</Badge> : <PatternBadge code={row.original.primaryType.code} />}</> },
  { id: 'amount', header: '거래 총액 (USD)', enableSorting: false, cell: ({ row }) => <span className="block max-w-full overflow-x-auto whitespace-nowrap font-mono text-xs tabular-nums">{row.original.amountLabel ?? 'USD 환산액 미제공'}</span> },
  {
    id: 'txCount', accessorKey: 'txCount',
    header: ({ column }) => <DataTableColumnHeader column={column} label="거래" className="flex-row-reverse justify-start" />,
    cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.txCount}건</div>,
  },
  { id: 'assignee', accessorFn: row => row.assignee.name, header: ({ column }) => <DataTableColumnHeader column={column} label="담당자" />, cell: ({ row }) => <span className="block truncate" title={row.original.assignee.name}>{row.original.assignee.name}</span> },
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
  alertId: '14%', riskScore: '8%', type: '14%', amount: '16%',
  txCount: '7%', assignee: '10%', status: '9%', createdAt: '13%', episode: '9%',
}
const linkColumnWidths = { ...browseColumnWidths, select: '4%', alertId: '12%', amount: '14%' }

const filterPresets = (me: number): [string, AlertFilter[]][] => [['내 담당 미처리', [{ field: 'assignee', value: me }, { field: 'status', value: 'OPEN' }]], ['고위험', [{ field: 'risk', value: 'high' }]], ['3일 이상', [{ field: 'age', value: 3 }]], ['전체', []]]
const statusValues: AlertStatus[] = ['OPEN', 'ESCALATED', 'CLOSED']
const typeValues = Array.from({ length: 9 }, (_, code) => code as TypeCode)

type Props = {
  rows: AlertListRow[]
  today: Date
  onOpen: (row: AlertListRow) => void
  onLink: (alertIds: number[], target: EpisodeTarget, comment: string) => void | Promise<void>
  remote?: { filters: AlertFilter[]; onFilters: (filters: AlertFilter[]) => void; query: string; onQuery: (query: string) => void; assignees: { id: number; name: string }[]; footer: ReactNode; range?: DateRange; onRange: (range?: DateRange) => void; busy?: boolean; targets?: number[]; loading?: boolean; draftScope?: string }
}

export default function AlertList({ rows, today, onOpen, onLink, remote }: Props) {
  const currentUser = useCurrentUser()
  const me = currentUser.userId
  const [localLink, dispatchLocalLink] = useReducer(episodeLinkReducer, initialLinkState)
  const [localTarget, setLocalTarget] = useState<string>('new')
  const [localComment, setLocalComment] = useState('')
  const [draft, setDraft] = useViewState<{ link: EpisodeLinkState; target: string; comment: string }>(
    `alert-link/${me}/${currentUser.role}/${remote?.draftScope ?? 'local'}`,
    { link: initialLinkState, target: 'new', comment: '' },
  )
  const persistent = remote?.draftScope != null
  const link = persistent ? draft.link : localLink
  const linking = !remote?.loading && (link.mode === 'link' || localLink.mode === 'link')
  const target = persistent ? draft.target : localTarget
  const comment = persistent ? draft.comment : localComment
  const dispatchLink = useCallback((action: EpisodeLinkAction) => {
    dispatchLocalLink(action)
    if (persistent) setDraft(previous => ({ ...previous, link: episodeLinkReducer(previous.link, action) }))
  }, [persistent, setDraft])
  const [localQuery, setLocalQuery] = useState('')
  const query = remote ? remote.query : localQuery
  const clearSelection = () => { if (linking) dispatchLink({ type: 'start' }) }
  const setQuery = (value: string) => { clearSelection(); if (remote) remote.onQuery(value); else setLocalQuery(value) }
  // v24처럼 "내 담당" 조건을 켠 채 시작한다(API.md §3.2 기본 뷰 assigneeId=me)
  const [localFilters, setLocalFilters] = useState<AlertFilter[]>([{ field: 'assignee', value: me }])
  const filters = remote ? remote.filters : localFilters
  const setFilters = (value: AlertFilter[] | ((previous: AlertFilter[]) => AlertFilter[])) => {
    const next = typeof value === 'function' ? value(filters) : value
    clearSelection(); if (remote) remote.onFilters(next); else setLocalFilters(next)
  }
  const [localRange, setLocalRange] = useState<DateRange>()
  const range = remote ? remote.range : localRange
  const setRange = (next?: DateRange) => { clearSelection(); if (remote) remote.onRange(next); else setLocalRange(next) }
  const [filterOpen, setFilterOpen] = useState(false)
  const [field, setField] = useState<AlertFilterField>('status')
  const [value, setValue] = useState('OPEN')
  const setTarget = (next: string) => { if (persistent) setDraft(previous => ({ ...previous, target: next })); else setLocalTarget(next) }
  const setComment = (next: string) => { if (persistent) setDraft(previous => ({ ...previous, comment: next })); else setLocalComment(next) }

  const assignees = useMemo(() => new Map(remote ? remote.assignees.map(row => [row.id, row.name] as const) : rows.map(row => [row.assignee.userId, row.assignee.name] as const)), [rows, remote])
  const episodes = useMemo(() => remote?.targets ?? linkableEpisodes(rows), [rows, remote?.targets])
  const result = useMemo(() => remote ? rows : rows.filter(row => matchesAlert(row, filters, query, remote ? undefined : range)), [rows, filters, query, range, remote])
  const invalidSelection = [...link.selected].some(id => !rows.some(row => row.alertId === id && canLink(row, currentUser)))
  const invalidTarget = target !== 'new' && !episodes.includes(Number(target))

  const columns = useMemo<ColumnDef<AlertListRow>[]>(() => !linking ? baseColumns : [
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
  ], [linking, link.selected, currentUser, dispatchLink])

  const [rowsPerPage] = useMemoryState('settings:rows', '20') // 설정 > 페이지당 행
  const pageSize = Number(rowsPerPage) || 20
  const { table } = useDataTable({
    data: result, columns, pageCount: Math.max(1, Math.ceil(result.length / pageSize)), clientSide: !remote,
    getRowId: row => String(row.alertId), defaultColumn: { enableHiding: false, enableSorting: !remote },
    initialState: { sorting: [{ id: 'riskScore', desc: true }], pagination: { pageIndex: 0, pageSize } },
    queryKeys: { page: 'aPage', perPage: 'aPerPage', sort: 'aSort', filters: 'aFilters', joinOperator: 'aJoin' },
  })
  const toFirst = () => table.setPageIndex(0)

  const valueOptions: Record<AlertFilterField, { value: string; label: string }[]> = {
    status: statusValues.map(s => ({ value: s, label: alertStatusLabels[s] })),
    type: remote ? [...Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: typeDisplay((i + 1) as TypeCode).label })), { value: '패턴 미특정', label: '패턴 미특정' }, { value: '혼합', label: '혼합' }] : typeValues.map(code => ({ value: String(code), label: typeDisplay(code).label })),
    assignee: [{ value: String(me), label: '내 담당' }, ...[...assignees].filter(([id]) => id !== me).map(([id, name]) => ({ value: String(id), label: name }))],
    age: ageOptions.map(days => ({ value: String(days), label: `${days}일 이상` })),
    risk: [{ value: 'high', label: '높음 (0.80 이상)' }, { value: 'medium', label: '보통 (0.50 이상)' }, { value: 'low', label: '낮음 (0.50 미만)' }],
  }
  const toFilter = (f: AlertFilterField, v: string): AlertFilter =>
    f === 'status' ? { field: f, value: v as AlertStatus } : f === 'type' ? { field: f, value: v === '패턴 미특정' || v === '혼합' ? v : Number(v) as TypeCode } : f === 'risk' ? { field: f, value: v as 'high' | 'medium' | 'low' } : { field: f, value: Number(v) }

  const reset = () => { setQuery(''); setFilters([]); setRange(undefined); toFirst() }
  const endLink = (type: 'complete' | 'cancel') => { dispatchLink({ type }); setTarget('new'); setComment('') }

  function download() {
    const csv = '\uFEFF' + [
      ['ID', '위험도', '탐지 유형', '거래', '담당자', '상태'],
      ...result.map(r => [alertCode(r.alertId), r.riskScore, r.primaryType.name, r.txCount, r.assignee.name, r.status]),
    ].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n')
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
            <Label>미리 정한 조건</Label>
            <div className="grid grid-cols-2 gap-1.5">{filterPresets(me).map(([label, preset]) =>
              <Button key={label} size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setFilters(preset); toFirst(); setFilterOpen(false) }}>{label}</Button>)}</div>
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
        {currentUser.role === 'STAFF' && !linking && <Button variant="outline" size="sm" className="ml-auto" disabled={!rows.some(row => canLink(row, currentUser))} onClick={() => dispatchLink({ type: 'start' })}><Combine className="size-3.5" />Episode로 묶기</Button>}
        <Button variant="outline" size="sm" className={!linking ? '' : 'ml-auto'} onClick={download}><Download className="size-3.5" />{remote ? '현재 페이지 다운로드' : '다운로드'}</Button>
      </div>

      {linking && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-md border bg-background/95 px-3 py-2 shadow-sm backdrop-blur" data-testid="episode-link-action-bar">
          <strong className="mr-auto text-sm">{link.selected.size}건 선택 <span className="ml-1 text-xs font-normal text-muted-foreground">현재 서버에서는 본인 담당 열린 Alert만 선택 가능 · 새 Episode는 2건 이상</span></strong>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger size="sm" className="w-52" aria-label="Episode 연결 방식"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="new">새 Episode 생성</SelectItem>
              {episodes.map(id => <SelectItem key={id} value={String(id)}>기존 Episode · {episodeCode(id)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input aria-label="연결 의견" placeholder="의견 (필수)" value={comment} onChange={e => setComment(e.target.value)} className="h-8 w-64 text-xs" />
          <Button size="sm" title={invalidSelection ? '선택 Alert 상태가 변경됐습니다. 최신 목록에서 다시 선택해 주세요.' : invalidTarget ? '연결할 Episode를 최신 목록에서 다시 선택해 주세요.' : undefined} disabled={Boolean(remote?.busy || remote?.loading) || invalidSelection || invalidTarget || link.selected.size < (remote && target === 'new' ? 2 : 1) || !comment.trim()} onClick={() => {
            void Promise.resolve().then(() => onLink([...link.selected], target === 'new' ? 'new' : Number(target), comment.trim())).then(() => endLink('complete')).catch(() => undefined)
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
        ? <><div className="space-y-2 md:hidden">{table.getRowModel().rows.map(({ original: row }) => <article key={row.alertId} data-testid="alert-mobile-card" className="min-w-0 rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between gap-2">{linking ? <label className="flex items-center gap-2"><Checkbox aria-label={`${alertCode(row.alertId)} 모바일 선택`} disabled={!canLink(row, currentUser)} checked={link.selected.has(row.alertId)} onCheckedChange={() => dispatchLink({ type: 'toggle', id: row.alertId })} /><strong className="font-mono text-sm">{alertCode(row.alertId)}</strong></label> : <button type="button" className="font-mono text-sm font-semibold underline-offset-2 hover:underline" onClick={() => onOpen(row)}>{alertCode(row.alertId)} 상세 보기</button>}<RiskBadge score={row.riskScore} /></div>
          <div className="mt-2 flex flex-wrap items-center gap-2">{row.primaryType.code == null ? <Badge variant="outline">{row.primaryType.name}</Badge> : <PatternBadge code={row.primaryType.code} />}<StatusBadge status={row.status} />{row.episodeId != null && <Badge variant="outline">{episodeCode(row.episodeId)}</Badge>}</div>
          <p className="mt-2 text-xs text-muted-foreground">거래 {row.txCount}건 · {row.assignee.name} · {row.createdAt.slice(0, 10)}</p>
          <p className="mt-2 overflow-x-auto whitespace-nowrap font-mono text-xs tabular-nums">{row.amountLabel ?? 'USD 환산액 미제공'}</p>
        </article>)}</div><div className="hidden md:block"><DataTable pagination={!remote} table={table} columnWidths={linking ? linkColumnWidths : browseColumnWidths} tableClassName="table-fixed min-w-[980px] [&_th]:px-2.5 [&_td]:px-2.5" onRowClick={linking ? row => canLink(row, currentUser) && dispatchLink({ type: 'toggle', id: row.alertId }) : onOpen} data-testid="alert-table" /></div></>
        : remote?.loading ? null
        : (
          <div className="glass-surface rounded-md border py-20 text-center">
            <Inbox className="mx-auto mb-4 size-7 text-muted-foreground" />
            <p className="text-sm">조건에 맞는 Alert가 없습니다.</p>
            <p className="mb-4 mt-2 text-xs text-muted-foreground">검색어와 필터를 확인하세요.</p>
            <Button size="sm" variant="outline" onClick={reset}>전체 목록 보기</Button>
          </div>
        )}
      {remote?.footer}
    </div>
  )
}
