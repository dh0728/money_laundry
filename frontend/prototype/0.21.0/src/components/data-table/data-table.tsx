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

interface DataTableProps<TData> extends React.ComponentProps<"div"> {
  table: TanstackTable<TData>;
  actionBar?: React.ReactNode;
  tableClassName?: string;
  floatingHorizontalScrollbar?: boolean;
  /** AML RADAR: 행을 누르거나 Enter로 상세를 연다 */
  onRowClick?: (row: TData) => void;
}

export const shouldActivateTableRow = (key: string, originatedOnRow: boolean) => key === "Enter" && originatedOnRow;
export const toggleSingleSelectedId = (current: string | null | undefined, clicked: string) => current === clicked ? null : clicked;
export const shouldShowFloatingScrollbar = ({
  tableTop, tableBottom, viewportTop, viewportBottom, scrollWidth, clientWidth,
}: {
  tableTop: number; tableBottom: number; viewportTop: number; viewportBottom: number; scrollWidth: number; clientWidth: number;
}) => scrollWidth > clientWidth + 1 && Math.min(tableBottom, viewportBottom) - Math.max(tableTop, viewportTop) >= 48;

export function DataTable<TData>({
  table,
  actionBar,
  tableClassName,
  floatingHorizontalScrollbar = false,
  onRowClick,
  children,
  className,
  ...props
}: DataTableProps<TData>) {
  const tableSurfaceRef = React.useRef<HTMLDivElement>(null);
  const tableScrollRef = React.useRef<HTMLDivElement>(null);
  const floatingScrollRef = React.useRef<HTMLDivElement>(null);
  const [floatingBar, setFloatingBar] = React.useState({ visible: false, left: 0, width: 0, bottom: 8, contentWidth: 0 });

  React.useEffect(() => {
    if (!floatingHorizontalScrollbar) return;
    const surface = tableSurfaceRef.current;
    const viewport = tableScrollRef.current;
    const floating = floatingScrollRef.current;
    if (!surface || !viewport || !floating) return;
    const main = surface.closest('.app-main') as HTMLElement | null;

    const updateGeometry = () => {
      const tableRect = surface.getBoundingClientRect();
      const scrollRect = viewport.getBoundingClientRect();
      const mainRect = main?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
      const visible = shouldShowFloatingScrollbar({
        tableTop: tableRect.top, tableBottom: tableRect.bottom,
        viewportTop: mainRect.top, viewportBottom: mainRect.bottom,
        scrollWidth: viewport.scrollWidth, clientWidth: viewport.clientWidth,
      });
      setFloatingBar({
        visible, left: scrollRect.left, width: scrollRect.width,
        bottom: Math.max(8, window.innerHeight - mainRect.bottom + 8), contentWidth: viewport.scrollWidth,
      });
    };
    const syncFromTable = () => { floating.scrollLeft = viewport.scrollLeft; };
    const syncFromFloating = () => { viewport.scrollLeft = floating.scrollLeft; };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateGeometry);
    observer?.observe(surface); observer?.observe(viewport);
    const tableElement = viewport.querySelector('table'); if (tableElement) observer?.observe(tableElement);
    main?.addEventListener('scroll', updateGeometry, { passive: true });
    window.addEventListener('scroll', updateGeometry, { passive: true });
    window.addEventListener('resize', updateGeometry);
    viewport.addEventListener('scroll', syncFromTable, { passive: true });
    floating.addEventListener('scroll', syncFromFloating, { passive: true });
    updateGeometry(); syncFromTable();
    return () => {
      observer?.disconnect();
      main?.removeEventListener('scroll', updateGeometry);
      window.removeEventListener('scroll', updateGeometry);
      window.removeEventListener('resize', updateGeometry);
      viewport.removeEventListener('scroll', syncFromTable);
      floating.removeEventListener('scroll', syncFromFloating);
    };
  }, [floatingHorizontalScrollbar]);

  return (
    <div
      className={cn("flex w-full flex-col gap-2.5 overflow-visible", className)}
      {...props}
    >
      {children}
      {floatingHorizontalScrollbar && <div
        ref={floatingScrollRef}
        data-testid="floating-horizontal-scrollbar"
        aria-label="표 가로 스크롤"
        aria-hidden={!floatingBar.visible}
        tabIndex={floatingBar.visible ? 0 : -1}
        className={cn("floating-horizontal-scrollbar fixed z-50 h-4 overflow-x-scroll rounded-md border bg-background/95 shadow-md backdrop-blur transition-opacity", floatingBar.visible ? "opacity-100" : "pointer-events-none opacity-0")}
        style={{ left: floatingBar.left, width: floatingBar.width, bottom: floatingBar.bottom }}
      ><div className="h-px" style={{ width: floatingBar.contentWidth }} /></div>}
      <div ref={tableSurfaceRef} className="glass-surface overflow-hidden rounded-md border">
        <Table containerRef={tableScrollRef} className={tableClassName}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
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
                  className={onRowClick ? "cursor-pointer" : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={onRowClick ? (e) => { if (shouldActivateTableRow(e.key, e.target === e.currentTarget)) onRowClick(row.original); } : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
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
        {actionBar &&
          table.getFilteredSelectedRowModel().rows.length > 0 &&
          actionBar}
      </div>
    </div>
  );
}
