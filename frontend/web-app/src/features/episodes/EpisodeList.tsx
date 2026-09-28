// v24 Lists.tsx(kind=Episode)를 옮김. Episode 목록은 묶기 모드가 없다.
import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Download, Inbox, Search } from 'lucide-react'
import { typeDisplay, type EpisodeStatus } from '@/api/codes'
import type { EpisodeRow } from '@/api/episodes'
import { MOCK_USER } from '@/app/session'
import { FilterChip } from '@/components/FilterChip'
import { RiskBadge, WorkStatusBadge } from '@/components/badges'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { episodeCode } from '@/features/alerts/alertFilters'
import { usd } from '@/features/alerts/metrics'
import { useDataTable } from '@/hooks/use-data-table'
import { useMemoryState } from '@/lib/memory'
import { episodeWorkStatus, workStatusLabels, type WorkStatus } from '@/lib/workStatus'

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
        <p className="mt-1 truncate text-xs text-muted-foreground">Alert {row.original.alertCount}건 · {row.original.primaryTypes.map(t => typeDisplay(t.code).label).join(' · ')}</p>
      </div>
    ),
  },
  { id: 'riskScore', accessorKey: 'riskScore', header: ({ column }) => <DataTableColumnHeader column={column} label="위험도" />, cell: ({ row }) => <RiskBadge score={row.original.riskScore} /> },
  {
    id: 'types', header: '탐지 유형', enableSorting: false,
    cell: ({ row }) => <div className="flex flex-wrap gap-1">{row.original.primaryTypes.map(t => <Badge key={t.code} variant="outline" className="semantic-pattern-badge font-mono text-xs font-normal">{typeDisplay(t.code).key}</Badge>)}</div>,
  },
  { id: 'totalAmountUsd', accessorKey: 'totalAmountUsd', header: ({ column }) => <DataTableColumnHeader column={column} label="거래 총액 (USD)" className="ml-auto" />, cell: ({ row }) => <div className="text-right text-sm tabular-nums">{usd(row.original.totalAmountUsd)}</div> },
  { id: 'alertCount', accessorKey: 'alertCount', header: ({ column }) => <DataTableColumnHeader column={column} label="Alert" className="ml-auto" />, cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.alertCount}건</div> },
  { id: 'txCount', accessorKey: 'txCount', header: ({ column }) => <DataTableColumnHeader column={column} label="거래" className="ml-auto" />, cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.txCount}건</div> },
  { id: 'assignee', accessorFn: row => row.assignee.name, header: ({ column }) => <DataTableColumnHeader column={column} label="담당자" /> },
  { id: 'status', accessorKey: 'status', header: ({ column }) => <DataTableColumnHeader column={column} label="상태" />, cell: ({ row }) => <EpisodeStatusBadge status={row.original.status} reviewRequested={Boolean(row.original.reviewRequestedAt)} /> },
  {
    id: 'createdAt', accessorKey: 'createdAt',
    header: ({ column }) => <DataTableColumnHeader column={column} label="생성일" />,
    cell: ({ row }) => <div className="text-sm tabular-nums text-muted-foreground">{row.original.createdAt.slice(5, 10)}<p className="mt-1 text-xs">{row.original.ageDays === 0 ? '오늘' : `${row.original.ageDays}일 경과`}</p></div>,
  },
]

type StatusFilter = 'all' | WorkStatus

export default function EpisodeList({ rows, onOpen }: { rows: EpisodeRow[]; onOpen: (row: EpisodeRow) => void }) {
  const [query, setQuery] = useState('')
  const [mine, setMine] = useState(true)
  const [status, setStatus] = useState<StatusFilter>('all')
  const result = useMemo(() => {
    const text = query.trim().toLocaleLowerCase('ko')
    return rows.filter(row =>
      (!mine || row.assignee.userId === MOCK_USER.userId)
      && (status === 'all' || episodeWorkStatus(row.status, Boolean(row.reviewRequestedAt)) === status)
      && (!text || [episodeCode(row.episodeId), String(row.episodeId), row.assignee.name, ...row.primaryTypes.map(t => typeDisplay(t.code).label)].join(' ').toLocaleLowerCase('ko').includes(text)))
  }, [rows, query, mine, status])

  const [rowsPerPage] = useMemoryState('settings:rows', '20')
  const pageSize = Number(rowsPerPage) || 20
  const { table } = useDataTable({
    data: result, columns, pageCount: Math.max(1, Math.ceil(result.length / pageSize)), clientSide: true,
    getRowId: row => String(row.episodeId), defaultColumn: { enableHiding: false },
    initialState: { sorting: [{ id: 'riskScore', desc: true }], pagination: { pageIndex: 0, pageSize } },
    queryKeys: { page: 'ePage', perPage: 'ePerPage', sort: 'eSort', filters: 'eFilters', joinOperator: 'eJoin' },
  })
  const toFirst = () => table.setPageIndex(0)
  const reset = () => { setQuery(''); setMine(false); setStatus('all'); toFirst() }

  function download() {
    const csv = '﻿' + ['ID,위험도,Alert,거래,거래 총액(USD),담당자,상태', ...result.map(r => `${episodeCode(r.episodeId)},${r.riskScore},${r.alertCount},${r.txCount},${r.totalAmountUsd},${r.assignee.name},${r.status}`)].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'Episode-목록.csv'; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative mr-1 w-64">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Episode 검색" placeholder="ID, 탐지 유형, 담당자 검색" value={query} onChange={e => { setQuery(e.target.value); toFirst() }} className="h-9 pl-9 text-xs" />
        </div>
        <Select value={status} onValueChange={v => { setStatus(v as StatusFilter); toFirst() }}>
          <SelectTrigger className="h-9 w-40 text-xs" aria-label="상태"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">모든 상태</SelectItem>
            <SelectItem value="IN_PROGRESS">{workStatusLabels.IN_PROGRESS}</SelectItem>
            <SelectItem value="DONE">{workStatusLabels.DONE}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="ml-auto" onClick={download}><Download className="size-3.5" />다운로드</Button>
      </div>
      {mine && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip onRemove={() => { setMine(false); toFirst() }}>담당자: 내 담당</FilterChip>
        </div>
      )}
      {result.length
        ? <DataTable table={table} onRowClick={onOpen} data-testid="episode-table" />
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
