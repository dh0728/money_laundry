// v19: Alert·Episode 목록은 커뮤니티 표준 data-table(Dice UI · tablecn, TanStack Table + shadcn)을 그대로 쓴다.
// 직접 만든 표·필터 팝오버·페이지 버튼을 걷어내고, 열 정의(데이터·표시 방식)만 여기서 정한다.
import { useMemo, useState } from 'react'
import type { ColumnDef, FilterFn } from '@tanstack/react-table'
import { Download, Inbox, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { DataTableSkeleton } from '@/components/data-table/data-table-skeleton'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { useDataTable } from '@/hooks/use-data-table'
import { ageTone, nextSort, patternOptions, usd, type Kind, type RecordItem, type SortDirection } from './domain'
import { PatternBadge, RiskBadge } from './shared'
import { useMemoryState } from './memory'

export type DataState = 'normal' | 'loading' | 'empty' | 'error' | 'stale'

// 정렬 상태 hook: 상세 거래 표가 쓴다(목록은 data-table 정렬로 바뀜)
export function useSort<K extends string>(initialKey: K | null, initialDirection: SortDirection) {
  const [key, setKey] = useState<K | null>(initialKey), [direction, setDirection] = useState<SortDirection>(initialDirection)
  const toggle = (next: K) => {
    if (next === key) { const d = nextSort(direction); setDirection(d); if (!d) setKey(null) }
    else { setKey(next); setDirection('desc') }
  }
  return { key, direction, toggle }
}

// data-table 필터 값(URL에 저장)을 브라우저에서 적용하는 규칙
const oneOf: FilterFn<RecordItem> = (row, id, value) => !Array.isArray(value) || value.length === 0 || value.includes(String(row.getValue(id)))
const inRange: FilterFn<RecordItem> = (row, id, value) => {
  if (!Array.isArray(value)) return true
  const v = Number(row.getValue(id)), [min, max] = value.map(x => (x === '' || x == null ? undefined : Number(x)))
  return (min === undefined || v >= min) && (max === undefined || v <= max)
}
const dateIn: FilterFn<RecordItem> = (row, id, value) => {
  const [from, to] = (Array.isArray(value) ? value : [value]).map(x => (x ? Number(x) : undefined))
  const v = new Date(String(row.getValue(id))).getTime()
  return (from === undefined || v >= from) && (to === undefined || v <= to + 86_399_999)
}
const textMatch: FilterFn<RecordItem> = (row, _id, value) => {
  const q = String(value ?? '').trim().toLowerCase(), r = row.original
  return !q || [r.id, r.title, r.owner].some(s => s.toLowerCase().includes(q))
}

function columnsFor(kind: Kind, base: RecordItem[]): ColumnDef<RecordItem>[] {
  const opts = (values: string[]) => values.map(v => ({ label: v, value: v }))
  return [
    {
      id: 'id', accessorKey: 'id', filterFn: textMatch, enableColumnFilter: true, enableHiding: false,
      header: ({ column }) => <DataTableColumnHeader column={column} label="ID / 탐지 내용" />,
      cell: ({ row }) => <div className="min-w-0 max-w-[340px]"><p className="text-sm font-mono" translate="no">{row.original.id}</p><p className="text-xs text-muted-foreground mt-1 truncate">{row.original.title}</p></div>,
      meta: { label: 'ID·탐지 내용', placeholder: 'ID, 탐지 내용, 담당자 검색', variant: 'text' },
    },
    {
      id: 'score', accessorKey: 'score', filterFn: inRange, enableColumnFilter: true,
      header: ({ column }) => <DataTableColumnHeader column={column} label="위험도" />,
      cell: ({ row }) => <RiskBadge risk={row.original.risk} score={row.original.score} />,
      meta: { label: '위험 점수', variant: 'range', range: [0, 100] },
    },
    {
      id: 'pattern', accessorKey: 'pattern', filterFn: oneOf, enableColumnFilter: true,
      header: ({ column }) => <DataTableColumnHeader column={column} label="탐지 유형 · 확률" />,
      cell: ({ row }) => <PatternBadge pattern={row.original.pattern} probability={row.original.probability} />,
      meta: { label: '탐지 유형', variant: 'multiSelect', options: opts([...patternOptions]) },
    },
    {
      id: 'amount', accessorKey: 'amount',
      header: ({ column }) => <DataTableColumnHeader column={column} label="거래 금액 (USD)" className="ml-auto" />,
      cell: ({ row }) => <div className="text-right tabular-nums text-sm">{usd(row.original.amount)}</div>,
      meta: { label: '거래 금액' },
    },
    {
      id: 'count', accessorKey: 'count',
      header: ({ column }) => <DataTableColumnHeader column={column} label="거래" className="ml-auto" />,
      cell: ({ row }) => <div className="text-right tabular-nums text-sm">{row.original.count}건</div>,
      meta: { label: '거래 건수' },
    },
    {
      id: 'owner', accessorKey: 'owner', filterFn: oneOf, enableColumnFilter: true,
      header: ({ column }) => <DataTableColumnHeader column={column} label="담당자" />,
      meta: { label: '담당자', variant: 'multiSelect', options: opts([...new Set(base.map(r => r.owner))]) },
    },
    {
      id: 'status', accessorKey: 'status', filterFn: oneOf, enableColumnFilter: true,
      header: ({ column }) => <DataTableColumnHeader column={column} label="상태" />,
      cell: ({ row }) => <Badge variant={row.original.status === '신규' ? 'secondary' : 'outline'} className="font-normal text-xs">{row.original.status}</Badge>,
      meta: { label: '처리 상태', variant: 'multiSelect', options: opts(['신규', kind === 'Alert' ? '검토 중' : '조사 중', '상위 검토', '종결']) },
    },
    {
      id: 'date', accessorKey: 'date', filterFn: dateIn, enableColumnFilter: true,
      header: ({ column }) => <DataTableColumnHeader column={column} label="탐지일" />,
      cell: ({ row }) => { const r = row.original; return <div className="text-sm text-muted-foreground tabular-nums">{r.date.slice(5)}<p className={`mt-1 text-xs ${r.age >= 3 ? 'font-medium' : ''}`} style={{ color: ageTone(r.age) }}>{r.age === 0 ? '오늘' : `${r.age}일 경과`}</p></div> },
      meta: { label: '탐지일', variant: 'dateRange' },
    },
  ]
}

export default function Lists({ kind, records, onOpen, state, setState }: { kind: Kind; records: RecordItem[]; user: string; onOpen: (r: RecordItem) => void; state: DataState; setState: (s: DataState) => void }) {
  const base = useMemo(() => records.filter(r => r.kind === kind), [records, kind])
  const data = state === 'empty' ? [] : base
  const columns = useMemo(() => columnsFor(kind, base), [kind, base])
  const [rowsPerPage] = useMemoryState('settings:rows', '20') // 설정 > 페이지당 행(20/50/100)을 첫 값으로 쓴다
  const k = kind === 'Alert' ? 'a' : 'e' // Alert·Episode 목록이 URL 조건을 섞지 않도록 키를 나눈다
  const { table } = useDataTable({
    data, columns, pageCount: -1, clientSide: true, getRowId: r => r.id,
    initialState: { sorting: [{ id: 'score', desc: true }], pagination: { pageIndex: 0, pageSize: Number(rowsPerPage) || 20 } },
    queryKeys: { page: `${k}Page`, perPage: `${k}PerPage`, sort: `${k}Sort`, filters: `${k}Filters`, joinOperator: `${k}Join` },
  })
  const download = () => {
    const rows = table.getFilteredRowModel().rows.map(r => r.original)
    const csv = '﻿' + ['ID,위험도,점수,탐지 유형,확률,금액(USD),거래,상태', ...rows.map(r => `${r.id},${r.risk},${r.score},${r.pattern},${r.probability}%,${r.amount.toFixed(2)},${r.count},${r.status}`)].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })), a = document.createElement('a')
    a.href = url; a.download = `${kind}-목록.csv`; a.click(); URL.revokeObjectURL(url)
  }
  const reset = () => { table.resetColumnFilters(); setState('normal') }

  if (state === 'loading') return <DataTableSkeleton columnCount={8} filterCount={5} rowCount={8} aria-label="목록 불러오는 중" />
  if (state === 'error') return <div className="glass-surface rounded-md border py-20 text-center"><TriangleAlert className="size-6 mx-auto mb-4 text-muted-foreground" /><p className="text-sm">목록을 불러오지 못했습니다.</p><p className="text-xs text-muted-foreground mt-2 mb-4">잠시 후 다시 시도해 주세요.</p><Button size="sm" variant="outline" onClick={() => setState('normal')}>다시 시도</Button></div>

  return (
    <div className="flex flex-col gap-3">
      {state === 'stale' && (
        <div role="alert" className="flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
          <TriangleAlert className="size-4 text-destructive shrink-0" />
          <div className="text-xs flex-1">재조회 실패 · 마지막 정상 결과를 유지합니다<span className="block text-[10px] text-muted-foreground mt-0.5">마지막 성공 14:32 · 요청 REQ-DEMO-016</span></div>
          <Button size="sm" variant="outline" onClick={() => setState('normal')}><RefreshCw className="size-3" />다시 시도</Button>
        </div>
      )}
      <DataTable table={table} onRowClick={onOpen} data-testid="record-table">
        <DataTableToolbar table={table}>
          <Button variant="ghost" size="sm" onClick={download}><Download />다운로드</Button>
        </DataTableToolbar>
      </DataTable>
      {table.getFilteredRowModel().rows.length === 0 && (
        <div className="py-8 text-center"><Inbox className="size-7 mx-auto mb-3 text-muted-foreground" /><p className="text-sm">조건에 맞는 {kind}가 없습니다.</p><Button size="sm" variant="outline" className="mt-3" onClick={reset}>전체 목록 보기</Button></div>
      )}
    </div>
  )
}
