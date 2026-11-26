import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface DataTableSkeletonProps extends React.ComponentProps<"div"> {
  columnCount: number;
  rowCount?: number;
  filterCount?: number;
  cellWidths?: string[];
  withViewOptions?: boolean;
  withPagination?: boolean;
  shrinkZero?: boolean;
}

type DataTableSkeletonRowsProps = Pick<DataTableSkeletonProps, "columnCount" | "rowCount" | "cellWidths" | "shrinkZero"> & {
  level?: 1 | 2 | 3;
};

function SkeletonCells({ columnCount, cellWidths = ["auto"], shrinkZero, header = false }: DataTableSkeletonRowsProps & { header?: boolean }) {
  const Cell = header ? TableHead : TableCell;
  return Array.from({ length: columnCount }, (_, index) => {
    const width = cellWidths[index % cellWidths.length] ?? "auto";
    return <Cell key={index} data-table-cell-sized style={{
      "--table-cell-width": width,
      "--table-cell-min-width": shrinkZero ? width : undefined,
    } as React.CSSProperties}>
      <Skeleton className="h-6 w-full" />
    </Cell>;
  });
}

export function DataTableSkeletonRows({ rowCount = 10, level, ...cells }: DataTableSkeletonRowsProps) {
  return Array.from({ length: rowCount }, (_, index) =>
    <TableRow key={index} level={level} aria-hidden="true" data-table-skeleton-row className="hover:bg-transparent">
      <SkeletonCells {...cells} />
    </TableRow>);
}

export function DataTableSkeleton({
  columnCount,
  rowCount = 10,
  filterCount = 0,
  cellWidths = ["auto"],
  withViewOptions = true,
  withPagination = true,
  shrinkZero = false,
  className,
  ...props
}: DataTableSkeletonProps) {
  const cells = { columnCount, cellWidths, shrinkZero };

  return (
    <div
      className={cn("flex w-full flex-col gap-2.5 overflow-auto", className)}
      {...props}
    >
      {(filterCount > 0 || withViewOptions) && <div className="flex w-full items-center justify-between gap-2 overflow-auto p-1">
        <div className="flex flex-1 items-center gap-2">
          {filterCount > 0
            ? Array.from({ length: filterCount }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-18 border-dashed" />
              ))
            : null}
        </div>
        {withViewOptions ? (
          <Skeleton className="ml-auto hidden h-7 w-18 lg:flex" />
        ) : null}
      </div>}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SkeletonCells {...cells} header />
            </TableRow>
          </TableHeader>
          <TableBody>
            <DataTableSkeletonRows {...cells} rowCount={rowCount} />
          </TableBody>
        </Table>
      </div>
      {withPagination ? (
        <div className="flex w-full items-center justify-between gap-4 overflow-auto p-1 sm:gap-8">
          <Skeleton className="h-7 w-40 shrink-0" />
          <div className="flex items-center gap-4 sm:gap-6 lg:gap-8">
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-7 w-18" />
            </div>
            <div className="flex items-center justify-center font-medium text-sm">
              <Skeleton className="h-7 w-20" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="hidden size-7 lg:block" />
              <Skeleton className="size-7" />
              <Skeleton className="size-7" />
              <Skeleton className="hidden size-7 lg:block" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
