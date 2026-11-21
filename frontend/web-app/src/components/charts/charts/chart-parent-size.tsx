"use client";

import { type CSSProperties, type ReactNode, useRef } from "react";
import { useElementSize } from "./use-element-size";

export interface ChartParentSizeProps {
  children: (size: { width: number; height: number }) => ReactNode;
  className?: string;
  debounceTime?: number;
  style?: CSSProperties;
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
  style,
}: ChartParentSizeProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(parentRef, debounceTime ?? 300);
  return (
    <div
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", ...style }}
    >
      <div ref={parentRef} style={{ position: "absolute", inset: 0 }}>
        {children({ width, height })}
      </div>
    </div>
  );
}
