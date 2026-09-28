// v24 TxTable.tsx를 옮김. 송금·수취를 소유주와 계좌로 나눠 보여 준다(v23 요구).
import { useMemo, useState } from 'react'
import { getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type Column, type ColumnDef, type SortingState } from '@tanstack/react-table'
import type { AlertTransaction } from '@/api/alerts'
import { formatScore } from '@/api/codes'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { formatMoney } from '@/features/transactions/transactionIndex'

const roleLabels: Record<AlertTransaction['role'], string> = { SEED: '시작 거래', SUPPORTING: '연결 거래', PATH: '경로', PATTERN_MEMBER: '패턴 구성' }

// Episode 거래는 어느 Alert에서 왔는지(alertId)를 함께 가진다
type TxRow = AlertTransaction & { alertId?: number }

const header = (column: Column<TxRow, unknown>, label: string) => <DataTableColumnHeader column={column} label={label} className="px-2" />
const mono = (text: string) => <span className="block truncate px-1 font-mono text-sm" translate="no" title={text}>{text}</span>
const plain = (text = '—') => <span className="block truncate px-1 text-sm" title={text}>{text}</span>

const columns: ColumnDef<TxRow>[] = [
  { accessorKey: 'txId', size: 110, header: ({ column }) => header(column, '거래 ID'), cell: ({ row }) => mono(String(row.original.txId)) },
  { accessorKey: 'txAt', size: 128, header: ({ column }) => header(column, '일시'), cell: ({ row }) => <span className="px-1 text-sm tabular-nums">{row.original.txAt.slice(5, 16).replace('T', ' ')}</span> },
  { accessorKey: 'amountPaid', size: 120, header: ({ column }) => header(column, '금액'), cell: ({ row }) => <div className="truncate px-1 text-right text-sm tabular-nums">{formatMoney(row.original.amountPaid, row.original.paymentCurrency)}</div> },
  { accessorKey: 'paymentFormat', size: 88, header: ({ column }) => header(column, '결제 수단'), cell: ({ row }) => plain(row.original.paymentFormat) },
  { accessorKey: 'fromOwnerName', size: 120, header: ({ column }) => header(column, '송금 소유주'), cell: ({ row }) => plain(row.original.fromOwnerName) },
  { accessorKey: 'fromAccount', size: 110, header: ({ column }) => header(column, '송금 계좌'), cell: ({ row }) => mono(row.original.fromAccount) },
  { accessorKey: 'toOwnerName', size: 120, header: ({ column }) => header(column, '수취 소유주'), cell: ({ row }) => plain(row.original.toOwnerName) },
  { accessorKey: 'toAccount', size: 110, header: ({ column }) => header(column, '수취 계좌'), cell: ({ row }) => mono(row.original.toAccount) },
  { accessorKey: 'launderingScore', size: 80, header: ({ column }) => header(column, '점수'), cell: ({ row }) => <span className={`px-1 font-mono text-sm ${row.original.isSuspicious ? 'text-destructive' : 'text-muted-foreground'}`}>{formatScore(row.original.launderingScore)}</span> },
  { accessorKey: 'role', size: 90, header: ({ column }) => header(column, '편입 역할'), cell: ({ row }) => plain(roleLabels[row.original.role]) },
]

const sourceColumn: ColumnDef<TxRow> = { accessorKey: 'alertId', size: 84, header: ({ column }) => header(column, '출처 Alert'), cell: ({ row }) => mono(`A-${row.original.alertId}`) }

export default function AlertTxTable({ rows }: { rows: TxRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'txAt', desc: false }])
  const data = useMemo(() => rows, [rows])
  const withSource = rows.some(row => row.alertId != null)
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table은 React Compiler 최적화 대상이 아니다
  const table = useReactTable({
    data, columns: withSource ? [sourceColumn, ...columns] : columns, getRowId: row => String(row.txId),
    state: { sorting }, onSortingChange: setSorting, enableHiding: false,
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
  })
  return <DataTable table={table} topHorizontalScroll separatedColumns columnGroups={{ fromOwnerName: 'sender', fromAccount: 'sender', toOwnerName: 'receiver', toAccount: 'receiver' }} data-testid="tx-table" tableClassName="table-fixed [&_th]:overflow-hidden [&_td]:overflow-hidden [&_th]:px-0 [&_td]:p-1" />
}
