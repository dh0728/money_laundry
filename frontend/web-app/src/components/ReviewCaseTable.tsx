import { useMemo } from 'react'
import { getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import type { ReviewCase, ReviewKind } from '@/api/liveReview'
import { AgeBadge, RiskBadge, WorkStatusBadge } from '@/components/badges'
import { DataTable } from '@/components/data-table/data-table'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'

type Props = {
  kind: ReviewKind
  rows: ReviewCase[]
  selecting: boolean
  selectedIds: number[]
  busy: boolean
  eligible: (row: ReviewCase) => boolean
  onToggle: (row: ReviewCase) => void
  onOpen: (caseId: number) => void
}

export default function ReviewCaseTable({ kind, rows, selecting, selectedIds, busy, eligible, onToggle, onOpen }: Props) {
  const columns = useMemo<ColumnDef<ReviewCase>[]>(() => [
    ...(selecting && kind === 'ALERT' ? [{ id: 'select', header: '선택', cell: ({ row }: { row: { original: ReviewCase } }) =>
      <Checkbox aria-label={`새 Episode 선택 A-${row.original.alertId ?? row.original.caseId}`} disabled={!eligible(row.original) || busy} checked={selectedIds.includes(row.original.caseId)} onClick={event => event.stopPropagation()} onCheckedChange={() => onToggle(row.original)} /> }] : []),
    { id: 'id', header: kind === 'ALERT' ? 'ID / 계좌 구성' : 'ID / 구성', accessorFn: row => row.caseId, cell: ({ row }) => <div className="min-w-0 max-w-[340px]"><p className="font-mono text-sm">{kind === 'ALERT' ? `A-${row.original.alertId ?? row.original.caseId}` : `E-${row.original.caseId}`}</p><p className="mt-1 truncate text-xs text-muted-foreground">{kind === 'ALERT' ? '계좌·은행 데이터 없음' : `Alert ${row.original.sourceAlertIds.length}건 · 유형 ${row.original.primaryTypes.length}개`}</p></div> },
    { id: 'risk', header: '위험도', accessorFn: row => row.summary.riskScore, cell: ({ row }) => <RiskBadge score={row.original.summary.riskScore} /> },
    { id: 'type', header: '탐지 유형', accessorFn: row => row.summary.primaryType, cell: ({ row }) => <Badge variant="outline" className="semantic-pattern-badge max-w-full truncate font-mono text-xs font-normal" title={row.original.summary.primaryType}>{row.original.summary.primaryType || '데이터 없음'}</Badge> },
    { id: 'amount', header: '거래 총액 (USD)', cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.summary.amountsByCurrency?.USD == null ? '데이터 없음' : `${row.original.summary.amountsByCurrency.USD.toLocaleString('ko-KR')} USD`}</div> },
    { id: 'transactions', header: '거래', accessorFn: row => row.summary.txCount, cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.summary.txCount}건</div> },
    { id: 'assignee', header: '담당자', accessorKey: 'assigneeName' },
    { id: 'status', header: '상태', accessorKey: 'status', cell: ({ row }) => <WorkStatusBadge status={row.original.status === 'OPEN' ? 'IN_PROGRESS' : 'DONE'} /> },
    { id: 'created', header: kind === 'ALERT' ? '탐지일' : '생성일', accessorKey: 'createdAt', cell: ({ row }) => <div className="flex items-center gap-2 whitespace-nowrap text-sm tabular-nums text-muted-foreground"><span>{row.original.createdAt?.slice(5, 10) ?? '—'}</span><AgeBadge days={row.original.ageDays} /></div> },
    ...(kind === 'ALERT' ? [{ id: 'related', header: 'Episode 연결', cell: ({ row }: { row: { original: ReviewCase } }) => row.original.episodeId == null ? <span className="text-xs text-muted-foreground">미연결</span> : <Badge variant="outline" className="font-mono text-xs font-normal">E-{row.original.episodeId}</Badge> }] : []),
  ], [kind, selecting, selectedIds, busy, eligible, onToggle])
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() })
  return <DataTable table={table} hidePagination columnWidths={{ id: '16%', risk: '8%', type: '16%', amount: '13%', transactions: '8%', assignee: '10%', status: '10%', created: '11%', related: '8%' }} tableClassName="table-fixed min-w-[990px] [&_th]:px-2.5 [&_td]:px-2.5" onRowClick={row => selecting && kind === 'ALERT' ? onToggle(row) : onOpen(row.caseId)} data-testid="review-case-table" />
}
