// v20 R7: 상세 거래 표도 목록과 같은 data-table(Dice UI · TanStack Table)과 열 머리글 정렬 메뉴를 쓴다.
import { useMemo, useState } from 'react'
import { getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type Column, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { ExternalLink } from 'lucide-react'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { Button } from '@/components/ui/button'
import { formatMoney } from './v23-domain'
import type { TransactionTarget } from './transactionIndex'

export type TxRow = { id: string; at: string; from: string; fromOwner: string; to: string; toOwner: string; usd: number; amount: number; currency: string; format: string }

const header = (column: Column<TxRow, unknown>, label: string) => <DataTableColumnHeader column={column} label={label} className="px-2" />
const shortcut = (label: string, target: TransactionTarget, onOpen?: (target: TransactionTarget) => void, mono = false) => onOpen
  ? <Button type="button" variant="ghost" size="sm" className={`h-8 w-full min-w-0 justify-start gap-1 px-1 font-normal ${mono ? 'font-mono' : ''}`} aria-label={`${label} ${target.type === 'transaction' ? '거래' : target.type === 'owner' ? '소유주' : '계좌'} 보기`} title={`${label} 보기`} onClick={() => onOpen(target)}><span className={target.type === 'owner' ? 'whitespace-nowrap' : 'min-w-0 truncate'}>{label}</span><ExternalLink className="size-3.5" /></Button>
  : <span className={`${mono ? 'font-mono' : ''} text-sm`} translate={mono ? 'no' : undefined}>{label}</span>

const columnsFor = (onOpen?: (target: TransactionTarget) => void): ColumnDef<TxRow>[] => [
  { accessorKey: 'id', size: 144, header: ({ column }) => header(column, '거래 ID'), cell: ({ row }) => shortcut(row.original.id, { type: 'transaction', transactionId: row.original.id }, onOpen, true) },
  { accessorKey: 'at', size: 154, header: ({ column }) => header(column, '일시'), cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.at}</span> },
  { accessorKey: 'amount', size: 134, header: ({ column }) => header(column, '금액'), cell: ({ row }) => <div className="truncate text-right text-sm tabular-nums">{formatMoney(row.original.amount, row.original.currency)}</div> },
  { accessorKey: 'format', size: 84, header: ({ column }) => header(column, '결제 수단'), cell: ({ row }) => <span title={row.original.format} className="block truncate text-sm">{row.original.format}</span> },
  { accessorKey: 'fromOwner', size: 220, header: ({ column }) => header(column, '송금 소유주'), cell: ({ row }) => shortcut(row.original.fromOwner, { type: 'owner', owner: row.original.fromOwner }, onOpen) },
  { accessorKey: 'from', size: 132, header: ({ column }) => header(column, '송금 계좌'), cell: ({ row }) => shortcut(row.original.from, { type: 'account', account: row.original.from }, onOpen, true) },
  { accessorKey: 'toOwner', size: 220, header: ({ column }) => header(column, '수취 소유주'), cell: ({ row }) => shortcut(row.original.toOwner, { type: 'owner', owner: row.original.toOwner }, onOpen) },
  { accessorKey: 'to', size: 132, header: ({ column }) => header(column, '수취 계좌'), cell: ({ row }) => shortcut(row.original.to, { type: 'account', account: row.original.to }, onOpen, true) },
]

export default function TxTable({ rows, onOpenTransaction }: { rows: TxRow[]; onOpenTransaction?: (target: TransactionTarget) => void }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'at', desc: false }])
  const columns = useMemo(() => columnsFor(onOpenTransaction), [onOpenTransaction])
  const table = useReactTable({
    data: rows, columns, getRowId: r => r.id,
    state: { sorting },
    onSortingChange: setSorting, enableHiding: false,
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
  })
  return <DataTable table={table} topHorizontalScroll separatedColumns columnGroups={{ fromOwner: 'sender', from: 'sender', toOwner: 'receiver', to: 'receiver' }} data-testid="tx-table" tableClassName="table-fixed [&_th]:overflow-hidden [&_td]:overflow-hidden [&_th]:px-0 [&_td]:p-1" />
}
