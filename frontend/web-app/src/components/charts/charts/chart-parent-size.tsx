"use client";

import { type ReactNode, useRef } from "react";
import { cn } from "@/lib/utils";
import { useElementSize } from "./use-element-size";
import "../chart-utilities.css";

export interface ChartParentSizeProps {
  children: (size: { width: number; height: number }) => ReactNode;
  className?: string;
  debounceTime?: number;
}

/**
 * Drop-in for visx `<ParentSize>` without its `overflow: hidden` measuring
 * layer, so tooltips, markers, and strokes at the chart edge aren't clipped.
 * Measures before first paint (see {@link useElementSize}).
 */
export function ParentSize({
  children,
  className,
  debounceTime,
}: ChartParentSizeProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(parentRef, debounceTime ?? 300);
  return (
    <div className={cn("chart-parent-size", className)}>
      <div ref={parentRef} className="chart-parent-size-content">
        {children({ width, height })}
      </div>
    </div>
  );
}
