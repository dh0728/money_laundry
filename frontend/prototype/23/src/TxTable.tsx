// v20 R7: 상세 거래 표도 목록과 같은 data-table(Dice UI · TanStack Table)과 열 머리글 정렬 메뉴를 쓴다.
import { useState } from 'react'
import { getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { DataTable, toggleSingleSelectedId } from '@/components/data-table/data-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { formatMoney } from './v23-domain'

export type TxRow = { id: string; at: string; from: string; fromOwner: string; to: string; toOwner: string; usd: number; amount: number; currency: string; format: string }

const mono = (v: string) => <span className="font-mono text-sm" translate="no">{v}</span>
const columns: ColumnDef<TxRow>[] = [
  { accessorKey: 'id', header: ({ column }) => <DataTableColumnHeader column={column} label="거래 ID" />, cell: ({ row }) => mono(row.original.id) },
  { accessorKey: 'at', header: ({ column }) => <DataTableColumnHeader column={column} label="일시" />, cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.at}</span> },
  { accessorKey: 'fromOwner', header: ({ column }) => <DataTableColumnHeader column={column} label="송금 소유주" className="border-l-2 border-border pl-3" />, cell: ({ row }) => <span className="-my-[14px] -ml-4 block border-l-2 border-border py-[14px] pl-3 text-sm whitespace-normal">{row.original.fromOwner}</span> },
  { accessorKey: 'from', header: ({ column }) => <DataTableColumnHeader column={column} label="송금 계좌" />, cell: ({ row }) => mono(row.original.from) },
  { accessorKey: 'toOwner', header: ({ column }) => <DataTableColumnHeader column={column} label="수취 소유주" className="border-l-2 border-border pl-3" />, cell: ({ row }) => <span className="-my-[14px] -ml-4 block border-l-2 border-border py-[14px] pl-3 text-sm whitespace-normal">{row.original.toOwner}</span> },
  { accessorKey: 'to', header: ({ column }) => <DataTableColumnHeader column={column} label="수취 계좌" />, cell: ({ row }) => mono(row.original.to) },
  { accessorKey: 'amount', header: ({ column }) => <DataTableColumnHeader column={column} label="금액" className="ml-auto" />, cell: ({ row }) => <div className="text-right text-sm tabular-nums">{formatMoney(row.original.amount, row.original.currency)}</div> },
  { accessorKey: 'format', header: ({ column }) => <DataTableColumnHeader column={column} label="결제 수단" />, cell: ({ row }) => <span className="text-sm">{row.original.format}</span> },
]

export default function TxTable({ rows, selectedId, onSelect }: { rows: TxRow[]; selectedId?: string; onSelect: (id: string | null) => void }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'at', desc: false }])
  const table = useReactTable({
    data: rows, columns, getRowId: r => r.id,
    state: { sorting, rowSelection: selectedId ? { [selectedId]: true } : {} },
    onSortingChange: setSorting, enableHiding: false,
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
  })
  return <DataTable table={table} onRowClick={r => onSelect(toggleSingleSelectedId(selectedId, r.id))} data-testid="tx-table" />
}
