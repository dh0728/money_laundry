// v20 R7: 상세 거래 표도 목록과 같은 data-table(Dice UI · TanStack Table)과 열 머리글 정렬 메뉴를 쓴다.
import { useEffect, useState } from 'react'
import { getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { usd } from './domain'

export type TxRow = { id: string; at: string; from: string; to: string; usd: number; currency: string; format: string }

const mono = (v: string) => <span className="font-mono text-sm" translate="no">{v}</span>
const columns: ColumnDef<TxRow>[] = [
  { accessorKey: 'id', header: ({ column }) => <DataTableColumnHeader column={column} label="거래 ID" />, cell: ({ row }) => mono(row.original.id) },
  { accessorKey: 'at', header: ({ column }) => <DataTableColumnHeader column={column} label="일시" />, cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.at}</span> },
  { accessorKey: 'from', header: ({ column }) => <DataTableColumnHeader column={column} label="송금 계좌" />, cell: ({ row }) => mono(row.original.from) },
  { accessorKey: 'to', header: ({ column }) => <DataTableColumnHeader column={column} label="수취 계좌" />, cell: ({ row }) => mono(row.original.to) },
  { accessorKey: 'usd', header: ({ column }) => <DataTableColumnHeader column={column} label="금액 (USD)" className="ml-auto" />, cell: ({ row }) => <div className="text-right text-sm tabular-nums">{usd(row.original.usd)}</div> },
  { accessorKey: 'format', header: ({ column }) => <DataTableColumnHeader column={column} label="결제 수단" />, cell: ({ row }) => <span className="text-sm">{row.original.format}</span> },
]

export default function TxTable({ rows, selectedId, onSelect, onSelectedIndexChange }: { rows: TxRow[]; selectedId?: string; onSelect: (id: string) => void; onSelectedIndexChange?: (index: number) => void }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'at', desc: false }])
  const table = useReactTable({
    data: rows, columns, getRowId: r => r.id,
    state: { sorting, rowSelection: selectedId ? { [selectedId]: true } : {} },
    onSortingChange: setSorting, enableHiding: false,
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
  })
  const selectedIndex = Math.max(0, table.getRowModel().rows.findIndex(row => row.id === selectedId))
  useEffect(() => onSelectedIndexChange?.(selectedIndex), [onSelectedIndexChange, selectedIndex])
  return <DataTable table={table} onRowClick={r => onSelect(r.id)} data-testid="tx-table" />
}
