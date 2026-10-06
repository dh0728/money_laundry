// v24 TxTable.tsx를 옮김. 송금·수취를 소유주와 계좌로 나눠 보여 주고(v23 요구), 두 묶음 사이에 구분선을 긋는다.
// 거래 ID·소유주·계좌는 버튼이라 누르면 거래 내역에서 그 항목이 선택된 채 열린다.
import { useMemo, useState } from 'react'
import { getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type Column, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { ExternalLink } from 'lucide-react'
import type { AlertTransaction } from '@/api/alerts'
import { hrefFor } from '@/app/navigation'
import { RiskBadge } from '@/components/badges'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { TxRelabel } from '@/features/graph/relabel'
import { formatMoney, type TransactionTarget } from '@/features/transactions/transactionIndex'
import { useTransactionTarget } from '@/features/transactions/transactionTarget'

// Episode 거래는 어느 Alert에서 왔는지(alertId)를 함께 가진다
export type TxRow = Pick<AlertTransaction, 'txId' | 'txAt' | 'amountPaid' | 'paymentCurrency' | 'paymentFormat' | 'fromAccount' | 'toAccount' | 'fromOwnerName' | 'toOwnerName'> & { role: string; launderingScore: number | null; alertId?: number; relabel?: TxRelabel; reviewLabel?: string }
type Open = (target: TransactionTarget) => void

const roleLabels: Record<string, string> = { SEED: '시작 거래', SUPPORTING: '연결 거래', PATH: '경로', PATTERN_MEMBER: '패턴 구성' }

const header = (column: Column<TxRow, unknown>, label: string) => <DataTableColumnHeader column={column} label={label} className="px-2" />
const tag = (text: string) => <Badge variant="outline" className="semantic-metadata-badge font-normal">{text}</Badge>

function Shortcut({ label, target, onOpen, mono = false }: { label: string; target: TransactionTarget; onOpen: Open; mono?: boolean }) {
  const kind = target.type === 'transaction' ? '거래' : target.type === 'owner' ? '소유주' : '계좌'
  return (
    <Button type="button" variant="ghost" size="sm" title={`거래 내역에서 ${kind} ${label} 보기`} aria-label={`${label} ${kind} 거래 내역에서 보기`}
      className={`h-8 w-full min-w-0 justify-start gap-1 px-1 font-normal hover:[&>svg]:text-foreground ${mono ? "font-mono" : ""}`} onClick={() => onOpen(target)}>
      <span className="min-w-0 truncate">{label}</span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
    </Button>
  )
}

const columnsFor = (onOpen: Open, remote: boolean): ColumnDef<TxRow>[] => [
  { accessorKey: 'txId', size: 116, header: ({ column }) => header(column, '거래 ID'), cell: ({ row }) => remote ? <span className="px-1 font-mono">T-{row.original.txId}</span> : <Shortcut label={String(row.original.txId)} target={{ type: 'transaction', transactionId: String(row.original.txId) }} onOpen={onOpen} mono /> },
  { accessorKey: 'txAt', size: 118, header: ({ column }) => header(column, '일시'), cell: ({ row }) => <span className="px-1 text-sm tabular-nums">{row.original.txAt.slice(5, 16).replace('T', ' ')}</span> },
  { accessorKey: 'amountPaid', size: 110, header: ({ column }) => header(column, '금액'), cell: ({ row }) => <div className="truncate px-1 text-right text-sm tabular-nums">{formatMoney(row.original.amountPaid, row.original.paymentCurrency)}</div> },
  { accessorKey: 'paymentFormat', size: 92, header: ({ column }) => header(column, '결제 수단'), cell: ({ row }) => <span className="px-1">{tag(row.original.paymentFormat)}</span> },
  { accessorKey: 'fromOwnerName', size: 118, header: ({ column }) => header(column, '송금 소유주'), cell: ({ row }) => row.original.fromOwnerName ? <Shortcut label={row.original.fromOwnerName} target={{ type: 'owner', owner: row.original.fromOwnerName }} onOpen={onOpen} /> : '—' },
  { accessorKey: 'fromAccount', size: 118, header: ({ column }) => header(column, '송금 계좌'), cell: ({ row }) => remote ? <span title={row.original.fromAccount} className="block truncate px-1 font-mono">{row.original.fromAccount}</span> : <Shortcut label={row.original.fromAccount} target={{ type: 'account', account: row.original.fromAccount }} onOpen={onOpen} mono /> },
  { accessorKey: 'toOwnerName', size: 118, header: ({ column }) => header(column, '수취 소유주'), cell: ({ row }) => row.original.toOwnerName ? <Shortcut label={row.original.toOwnerName} target={{ type: 'owner', owner: row.original.toOwnerName }} onOpen={onOpen} /> : '—' },
  { accessorKey: 'toAccount', size: 118, header: ({ column }) => header(column, '수취 계좌'), cell: ({ row }) => remote ? <span title={row.original.toAccount} className="block truncate px-1 font-mono">{row.original.toAccount}</span> : <Shortcut label={row.original.toAccount} target={{ type: 'account', account: row.original.toAccount }} onOpen={onOpen} mono /> },
  {
    accessorKey: 'launderingScore', size: 128, header: ({ column }) => header(column, '점수'),
    // 사람이 판정을 바꾼 거래에는 "사람 판정" 태그와 사유 툴팁을 단다
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5 px-1">
        {row.original.launderingScore == null ? '—' : <RiskBadge score={row.original.launderingScore} />}
        {row.original.relabel && <Badge variant="outline" className="semantic-metadata-badge font-normal" title={`${row.original.relabel.actor} · ${row.original.relabel.reason}`}>사람 판정</Badge>}
      </span>
    ),
  },
  {
    accessorKey: 'role', size: 96, header: ({ column }) => header(column, '편입 역할'),
    cell: ({ row }) => <span className="px-1">{row.original.role === 'SEED' ? <Badge className="font-normal">{roleLabels.SEED}</Badge> : tag(roleLabels[row.original.role] ?? row.original.role)}</span>,
  },
]

const sourceColumn: ColumnDef<TxRow> = {
  accessorKey: 'alertId', size: 96, header: ({ column }) => header(column, '출처 Alert'),
  cell: ({ row }) => (
    <Button asChild variant="ghost" size="sm" className="h-8 w-full justify-start gap-1 px-1 font-mono font-normal">
      <a href={hrefFor('alerts', row.original.alertId)} title={`A-${row.original.alertId} 상세 보기`}>A-{row.original.alertId}<ExternalLink className="size-3 text-muted-foreground" /></a>
    </Button>
  ),
}

type Selection = { ids: number[]; onToggle: (txId: number) => void; disabled?: (txId: number) => boolean }

export default function AlertTxTable({ rows, selection, remote = false }: { rows: TxRow[]; selection?: Selection; remote?: boolean }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'txAt', desc: false }])
  const [, setTarget] = useTransactionTarget()
  const data = useMemo(() => rows, [rows])
  const withSource = rows.some(row => row.alertId != null)
  const columns = useMemo(() => {
    const open: Open = target => { if (selection) return; setTarget(target); window.location.hash = 'transactions' }
    const base = columnsFor(open, remote)
    if (remote) base.push({ id: 'reviewLabel', header: '조사 상태', cell: ({ row }) => row.original.reviewLabel ?? '—' })
    const visible = withSource ? [sourceColumn, ...base] : base
    return selection ? [{
      id: 'select', size: 40,
      header: () => <span className="sr-only">거래 선택</span>,
      cell: ({ row }) => <span className="flex w-full justify-center"><input type="checkbox" aria-label={`거래 T-${row.original.txId} 선택`}
        disabled={selection.disabled?.(row.original.txId)} checked={selection.ids.includes(row.original.txId)} onClick={event => event.stopPropagation()}
        onChange={() => selection.onToggle(row.original.txId)} /></span>,
    } as ColumnDef<TxRow>, ...visible] : visible
  }, [withSource, setTarget, selection, remote])
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table은 React Compiler 최적화 대상이 아니다
  const table = useReactTable({
    data, columns, getRowId: row => String(row.txId),
    state: { sorting, rowSelection: Object.fromEntries((selection?.ids ?? []).map(id => [String(id), true])) },
    onSortingChange: setSorting, enableHiding: false,
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
  })
  return <DataTable table={table} topHorizontalScroll onRowClick={selection ? row => { if (!selection.disabled?.(row.txId)) selection.onToggle(row.txId) } : undefined}
    columnGroups={{ fromOwnerName: 'sender', fromAccount: 'sender', toOwnerName: 'receiver', toAccount: 'receiver' }}
    data-testid="tx-table" tableClassName="table-fixed [&_th]:overflow-hidden [&_td]:overflow-hidden [&_th]:px-0 [&_td]:p-1" />
}
