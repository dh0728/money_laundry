"use client";

import { m } from "motion/react";
import { memo, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { readChartDurationSeconds } from "../chart-design-values";
import {
  useChart,
  useChartPortalContainer,
  useChartStable,
} from "./chart-context";
import {
  type ChartLabelCount,
  resolveResponsiveChartLabelCount,
} from "./responsive-chart-label-count";

export interface BarXAxisProps {
  /** Width of the date ticker box for fade calculation. Default: 50 */
  tickerHalfWidth?: number;
  /** Whether to show all labels or skip some for dense data. Default: false */
  showAllLabels?: boolean;
  /** Maximum number of labels to show. Supports responsive breakpoints. */
  maxLabels?: ChartLabelCount;
  /** AML RADAR: optionally show a second line for a value too small to see in a bar. */
  formatLabel?: (point: Record<string, unknown>, label: string) => ReactNode;
}

interface BarXAxisLabelProps {
  label: ReactNode;
  x: number;
  crosshairX: number | null;
  isHovering: boolean;
  tickerHalfWidth: number;
  fadeDuration: number;
}

function BarXAxisLabel({
  label,
  x,
  crosshairX,
  isHovering,
  tickerHalfWidth,
  fadeDuration,
}: BarXAxisLabelProps) {
  const anchor = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    anchor.current?.style.setProperty("--bar-chart-axis-position", `${x}px`);
  }, [x]);
  const fadeBuffer = 20;
  const fadeRadius = tickerHalfWidth + fadeBuffer;

  let opacity = 1;
  if (isHovering && crosshairX !== null) {
    const distance = Math.abs(x - crosshairX);
    if (distance < tickerHalfWidth) {
      opacity = 0;
    } else if (distance < fadeRadius) {
      opacity = (distance - tickerHalfWidth) / fadeBuffer;
    }
  }

  // Zero-width container approach for perfect centering
  return (
    <div
      className="bar-chart-axis-label"
      ref={anchor}
    >
      <m.span
        animate={{ opacity }}
        className="whitespace-nowrap text-chart-label text-xs"
        initial={{ opacity: 1 }}
        transition={{ duration: fadeDuration, ease: "easeInOut" }}
      >
        {label}
      </m.span>
    </div>
  );
}

export function BarXAxis(props: BarXAxisProps) {
  const { containerRef, barScale } = useChartStable();
  const container = useChartPortalContainer(containerRef);
  if (!container) {
    return null;
  }

  if (!barScale) {
    return null;
  }

  return <BarXAxisInner {...props} container={container} />;
}

const BarXAxisInner = memo(function BarXAxisInner({
  tickerHalfWidth = 50,
  showAllLabels = false,
  maxLabels = 12,
  formatLabel,
  container,
}: BarXAxisProps & { container: HTMLDivElement }) {
  const [fadeDuration] = useState(() => readChartDurationSeconds("--chart-hover-fade-duration", 0.4));
  const {
    margin,
    tooltipData,
    barScale,
    bandWidth,
    barXAccessor,
    data,
    width,
  } = useChart();

  const resolvedMaxLabels = useMemo(
    () => resolveResponsiveChartLabelCount(maxLabels, width, 12),
    [maxLabels, width]
  );

  // Generate labels for each bar
  const labelsToShow = useMemo(() => {
    if (!(barScale && bandWidth && barXAccessor)) {
      return [];
    }

    const allLabels = data.map((d) => {
      const label = barXAccessor(d);
      const bandX = barScale(label) ?? 0;
      // Center the label under the bar group
      const x = bandX + bandWidth / 2 + margin.left;
      return { label, content: formatLabel?.(d, label) ?? label, x };
    });

    // If showAllLabels is true or we have fewer than maxLabels, show all
    if (showAllLabels || allLabels.length <= resolvedMaxLabels) {
      return allLabels;
    }

    // Otherwise, skip some labels to avoid crowding
    const step = Math.ceil(allLabels.length / Math.max(1, resolvedMaxLabels));
    return allLabels.filter((_, i) => i % step === 0);
  }, [
    barScale,
    bandWidth,
    barXAccessor,
    data,
    formatLabel,
    margin.left,
    showAllLabels,
    resolvedMaxLabels,
  ]);

  const isHovering = tooltipData !== null;
  const crosshairX = tooltipData ? tooltipData.x + margin.left : null;

  return createPortal(
    <div className="pointer-events-none absolute inset-0">
      {labelsToShow.map((item) => (
        <BarXAxisLabel
          fadeDuration={fadeDuration}
          crosshairX={crosshairX}
          isHovering={isHovering}
          key={`${item.label}-${item.x}`}
          label={item.content}
          tickerHalfWidth={tickerHalfWidth}
          x={item.x}
        />
      ))}
    </div>,
    container
  );
});

BarXAxis.displayName = "BarXAxis";

export default BarXAxis;
