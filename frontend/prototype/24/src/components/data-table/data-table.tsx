import { flexRender, type Table as TanstackTable } from "@tanstack/react-table";
import * as React from "react";

import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getColumnPinningStyle } from "@/lib/data-table";
import { cn } from "@/lib/utils";

interface DataTableProps<TData> extends Omit<React.ComponentProps<"div">, "children"> {
  table: TanstackTable<TData>;
  tableClassName?: string;
  topHorizontalScroll?: boolean;
  separatedColumns?: boolean;
  columnGroups?: Partial<Record<string, "sender" | "receiver">>;
  /** AML RADAR: 행을 누르거나 Enter로 상세를 연다 */
  onRowClick?: (row: TData) => void;
}

export const shouldActivateTableRow = (key: string, originatedOnRow: boolean) => key === "Enter" && originatedOnRow;
export const toggleSingleSelectedId = (current: string | null | undefined, clicked: string) => current === clicked ? null : clicked;
export const syncHorizontalScroll = (source: { scrollLeft: number }, target: { scrollLeft: number } | null) => {
  if (target && target.scrollLeft !== source.scrollLeft) target.scrollLeft = source.scrollLeft;
};

export function DataTable<TData>({
  table,
  tableClassName,
  topHorizontalScroll = false,
  separatedColumns = false,
  columnGroups,
  onRowClick,
  className,
  ...props
}: DataTableProps<TData>) {
  const topScrollRef = React.useRef<HTMLDivElement>(null);
  const bodyScrollRef = React.useRef<HTMLDivElement>(null);
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = React.useState(false);
  const tableWidth = table.getTotalSize();
  React.useLayoutEffect(() => {
    if (!topHorizontalScroll) return;
    const body = bodyScrollRef.current;
    if (!body) return;
    const update = () => setHasHorizontalOverflow(body.scrollWidth > body.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(body);
    return () => observer.disconnect();
  }, [tableWidth, topHorizontalScroll]);
  const columnClass = (columnId: string, index: number) => {
    const group = columnGroups?.[columnId];
    if (group === "sender") return "bg-muted/15";
    if (group === "receiver") return "bg-muted/30";
    return separatedColumns ? cn(index % 2 ? "bg-muted/10" : "bg-card/70") : undefined;
  };
  return (
    <div
      className={cn("flex w-full flex-col gap-2.5 overflow-visible", className)}
      {...props}
    >
      <div className="glass-surface overflow-hidden rounded-md border">
        {topHorizontalScroll && <div
          ref={topScrollRef}
          data-slot="table-top-scroll"
          role="region"
          aria-label="거래 표 가로 스크롤"
          tabIndex={0}
          onScroll={event => syncHorizontalScroll(event.currentTarget, bodyScrollRef.current)}
          className={cn("h-4 w-full overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-color:var(--muted-foreground)_var(--muted)] [scrollbar-gutter:stable] [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-muted [&::-webkit-scrollbar-thumb]:bg-muted-foreground [&::-webkit-scrollbar-track]:bg-muted", !hasHorizontalOverflow && "hidden")}
        ><div className="h-px" style={{ width: tableWidth }} aria-hidden="true" /></div>}
        <Table
          className={tableClassName}
          containerRef={bodyScrollRef}
          containerClassName={topHorizontalScroll ? "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : undefined}
          containerOnScroll={topHorizontalScroll ? event => syncHorizontalScroll(event.currentTarget, topScrollRef.current) : undefined}
          style={topHorizontalScroll ? { width: tableWidth, minWidth: "100%" } : undefined}
        >
          {topHorizontalScroll && <colgroup>{table.getVisibleLeafColumns().map(column => <col key={column.id} style={{ width: column.getSize() }} />)}</colgroup>}
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header, index) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    data-column-boundary={separatedColumns ? "header" : undefined}
                    data-column-group={columnGroups?.[header.column.id]}
                    className={columnClass(header.column.id, index)}
                    aria-sort={
                      header.column.getIsSorted() === "asc"
                        ? "ascending"
                        : header.column.getIsSorted() === "desc"
                          ? "descending"
                          : undefined
                    }
                    style={{
                      ...getColumnPinningStyle({ column: header.column }),
                    }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  data-interactive={onRowClick ? "true" : undefined}
                  className={onRowClick ? "cursor-pointer" : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={onRowClick ? (e) => { if (shouldActivateTableRow(e.key, e.target === e.currentTarget)) onRowClick(row.original); } : undefined}
                >
                  {row.getVisibleCells().map((cell, index) => (
                    <TableCell
                      key={cell.id}
                      data-column-boundary={separatedColumns ? "cell" : undefined}
                      data-column-group={columnGroups?.[cell.column.id]}
                      className={columnClass(cell.column.id, index)}
                      data-sorted={cell.column.getIsSorted() ? "true" : undefined}
                      style={{
                        ...getColumnPinningStyle({ column: cell.column }),
                      }}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={table.getAllColumns().length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-2.5">
        <DataTablePagination table={table} />
      </div>
    </div>
  );
}
