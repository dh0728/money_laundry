"use client";

import type { Column } from "@tanstack/react-table";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface DataTableColumnHeaderProps<TData, TValue>
  extends React.ComponentProps<"button"> {
  column: Column<TData, TValue>;
  label: string;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  label,
  className,
  ...props
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={cn(className)}>{label}</div>;
  }

  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      data-slot="sortable-column-button"
      aria-label={`${label} 정렬 · ${sorted === "asc" ? "오름차순" : sorted === "desc" ? "내림차순" : "미정렬"}`}
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      className={cn(
        "flex h-full w-full items-center justify-between gap-1.5 px-4 text-left transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {label}
      {sorted === "desc" ? <ChevronDown /> : sorted === "asc" ? <ChevronUp /> : <ChevronsUpDown className="text-muted-foreground" />}
    </button>
  );
}
