import { useState, type ReactNode } from 'react'
import { ArrowUpDown, Network } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button, Checkbox } from './primitives'

// Figma table. 머리 줄과 본문 줄 모두 높이 37, 칸마다 아래·오른쪽 선.
// width 가 있으면 고정 폭, 없으면 남는 폭을 나눠 갖고 minWidth 아래로는 줄지 않는다.
export type Column<Row> = {
  key: string
  header: string
  width?: number
  minWidth?: number
  sortable?: boolean
  /** 머리 글자 앞의 묶음 아이콘(분석 탭 표) */
  grouped?: boolean
  cell: (row: Row) => ReactNode
}

const cellBox = 'flex h-[37px] shrink-0 flex-col items-start justify-center border-b border-r border-(--rd-line) bg-(--rd-subtle)'
const sizeOf = <Row,>(column: Column<Row>) =>
  column.width ? { width: column.width } : { flex: '1 0 0', minWidth: column.minWidth ?? 150 }

type DataTableProps<Row> = {
  label: string
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  rowHref?: (row: Row) => string
  /** 줄을 눌러 하나를 고르는 표(룰 목록 · 백테스트 사례). 고른 줄은 activeKey 로 알려 준다. */
  onRowClick?: (row: Row) => void
  activeKey?: string
  /** 머리 줄의 정렬 버튼을 눌렀을 때. 실제 정렬은 rows 를 주는 쪽이 한다. */
  onSort?: (columnKey: string) => void
  /** 표 둘레에 선을 긋는다(Figma 에서 패널 안에 따로 놓인 표) */
  bordered?: boolean
}

export function DataTable<Row>({ label, columns, rows, rowKey, rowHref, onRowClick, activeKey, onSort, bordered }: DataTableProps<Row>) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const allSelected = rows.length > 0 && selected.size === rows.length
  const toggle = (key: string, next: boolean) => setSelected(current => {
    const copy = new Set(current)
    if (next) copy.add(key); else copy.delete(key)
    return copy
  })

  return (
    <div className={cn('rd-scroll-thin w-full overflow-auto', bordered && 'rounded-[4px] border border-(--rd-line)')}>
      <div role="table" aria-label={label} className="flex w-full min-w-max flex-col">
        <div role="row" className="flex w-full items-start">
          <div role="columnheader" className={cn(cellBox, 'w-10 items-center')}>
            <div className="flex w-full flex-1 items-center px-3 py-2">
              <Checkbox checked={allSelected} onChange={next => setSelected(next ? new Set(rows.map(rowKey)) : new Set())} label="전체 선택" />
            </div>
          </div>
          {columns.map(column => (
            <div key={column.key} role="columnheader" style={sizeOf(column)} className={cellBox}>
              <div className="flex w-full items-center justify-between overflow-clip px-3 py-2">
                <div className="flex min-w-px flex-1 items-center gap-2">
                  {column.grouped && <Network className="size-3 shrink-0 text-(--rd-strong)" />}
                  <p className="whitespace-nowrap text-[14px] font-semibold leading-[1.4] text-(--rd-strong)">{column.header}</p>
                </div>
                {column.sortable && <Button size="sm" aria-label={`${column.header} 정렬`} onClick={onSort && (() => onSort(column.key))} iconStart={<ArrowUpDown />} />}
              </div>
            </div>
          ))}
        </div>
        {rows.map(row => {
          const key = rowKey(row)
          const active = key === activeKey
          const pick = onRowClick && (() => onRowClick(row))
          return (
            <div key={key} role="row" aria-selected={onRowClick ? active : undefined} tabIndex={onRowClick ? 0 : undefined} onClick={pick}
              onKeyDown={pick && (event => { if (event.key === 'Enter' && event.target === event.currentTarget) pick() })}
              className={cn('flex w-full items-center outline-none', onRowClick && 'cursor-pointer focus-visible:[&>div]:bg-(--rd-hover) hover:[&>div]:bg-(--rd-hover)', active && '[&>div]:bg-(--rd-brand-subtle) hover:[&>div]:bg-(--rd-brand-subtle)')}>
              <div role="cell" className={cn(cellBox, 'w-10 items-center')}>
                <div className="flex w-full flex-1 items-center px-3 py-2">
                  <Checkbox checked={selected.has(key)} onChange={next => toggle(key, next)} label={`${key} 선택`} />
                </div>
              </div>
              {columns.map((column, index) => {
                const content = (
                  <div className="flex w-full items-center gap-2 overflow-clip whitespace-nowrap px-3 py-2 text-[14px] leading-[1.4] text-(--rd-strong)">{column.cell(row)}</div>
                )
                // 첫 칸(ID)은 상세로 가는 링크다
                return (
                  <div key={column.key} role="cell" style={sizeOf(column)} className={cellBox}>
                    {index === 0 && rowHref ? <a href={rowHref(row)} className="flex h-full w-full cursor-pointer items-center outline-none hover:bg-(--rd-hover) focus-visible:bg-(--rd-hover)">{content}</a> : content}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
