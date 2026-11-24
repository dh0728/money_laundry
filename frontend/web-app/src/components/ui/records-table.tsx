import { useState, type Key, type ReactNode } from "react"
import { Pagination } from "antd"
import { Checkbox } from "./checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table"

type Selection<Row, RowKey extends Key> = {
  keys: readonly RowKey[]
  isDisabled: (row: Row) => boolean
  onChange: (keys: RowKey[]) => void
  label: (row: Row) => string
}

type RecordsTableProps<Row, RowKey extends Key> = {
  rows: readonly Row[]
  rowKey: (row: Row) => RowKey
  columns: readonly { title: string; cell: (row: Row) => ReactNode }[]
  empty: string
  width?: "wide" | "evidence"
  compact?: boolean
  pagination?: false | {
    page?: number
    onPageChange?: (page: number) => void
    showSizeChanger?: boolean
  }
  selection?: Selection<Row, RowKey>
  "data-wiring-id"?: string
}

const defaultPageSize = 10

export function RecordsTable<Row, RowKey extends Key>({
  rows, rowKey, columns, empty, width, compact, pagination, selection, "data-wiring-id": wiringId,
}: RecordsTableProps<Row, RowKey>) {
  const [localPage, setLocalPage] = useState(1)
  const [pageSize, setPageSize] = useState(defaultPageSize)
  const paging = pagination === false ? undefined : pagination
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.min(paging?.page ?? localPage, pageCount)
  const visibleRows = pagination === false ? rows : rows.slice((page - 1) * pageSize, page * pageSize)
  const selected = new Set(selection?.keys)
  const selectable = selection ? visibleRows.filter(row => !selection.isDisabled(row)).map(rowKey) : []
  const allChecked = selectable.length > 0 && selectable.every(key => selected.has(key))
  const someChecked = !allChecked && selectable.some(key => selected.has(key))

  function changeSelection(keys: RowKey[], checked: boolean) {
    // Selection on other pages stays intact when the current page is toggled.
    const next = new Set(selected)
    for (const key of keys) {
      if (checked) next.add(key)
      else next.delete(key)
    }
    selection?.onChange([...next])
  }

  return (
    <div>
      <div data-wiring-id={wiringId}>
        <Table className="records-table" data-width={width} data-density={compact ? "compact" : undefined}>
          <TableHeader>
            <TableRow>
              {selection && <TableHead scope="col" aria-label="선택">
                <Checkbox aria-label="현재 페이지 전체 선택" checked={someChecked ? "indeterminate" : allChecked}
                  disabled={!selectable.length} onCheckedChange={checked => changeSelection(selectable, checked === true)} />
              </TableHead>}
              {columns.map(column => <TableHead key={column.title} scope="col">{column.title}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length === 0 && (
              <TableRow><TableCell className="records-table-empty" colSpan={columns.length + Number(Boolean(selection))}>
                {empty}
              </TableCell></TableRow>
            )}
            {visibleRows.map(row => {
              const key = rowKey(row)
              const checked = selected.has(key)
              return (
                <TableRow key={key} data-state={checked ? "selected" : undefined}>
                  {selection && <TableCell>
                    <Checkbox aria-label={selection.label(row)} checked={checked} disabled={selection.isDisabled(row)}
                      onCheckedChange={next => changeSelection([key], next === true)} />
                  </TableCell>}
                  {columns.map(column => <TableCell key={column.title}>{column.cell(row)}</TableCell>)}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      {pagination !== false && rows.length > 0 && <Pagination className="records-table-pagination"
        current={page} pageSize={pageSize} total={rows.length} showSizeChanger={paging?.showSizeChanger}
        onChange={(next, size) => {
          setPageSize(size)
          if (paging?.onPageChange) paging.onPageChange(next)
          else setLocalPage(next)
        }} />}
    </div>
  )
}
