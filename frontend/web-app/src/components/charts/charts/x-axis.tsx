"use client";

import { memo, useMemo } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  chartCssVars,
  selectTooltipData,
  useChartHoverSelector,
  useChartPortalContainer,
  useChartStable,
} from "./chart-context";
import { shortDateFmt } from "./chart-formatters";
import { type AxisTick, buildDataAlignedTicks } from "./x-axis-ticks";
import { DEFAULT_Y_DOMAIN_TWEEN_MS } from "./chart-phase";
import { useDatePillPresent } from "./date-pill-store";
import { LINE_LOADING_PULSE_EASE } from "./line-loading-timing";
import {
  type ChartLabelCount,
  resolveResponsiveChartLabelCount,
} from "./responsive-chart-label-count";
import {
  xAxisLabelColor,
  xAxisLabelHighlight,
  xAxisLabelOpacity,
} from "./x-axis-hover";

const X_AXIS_POSITION_TWEEN_MS = DEFAULT_Y_DOMAIN_TWEEN_MS;

/**
 * How labels react to the crosshair while hovering:
 * - `"fade"` — hide labels under the date pill, fade them back in beside it.
 * - `"highlight"` — recolor instead: the hovered label takes
 *   `activeLabelColor`, labels within `highlightRadius` blend toward
 *   `nearbyLabelColor`.
 * - `"none"` — labels never change.
 * - `"auto"` — `"fade"` while a `ChartTooltip` date pill is shown, else
 *   `"highlight"`.
 */
export type XAxisHoverEffect = "auto" | "fade" | "highlight" | "none";

export interface XAxisProps {
  /** Number of ticks to show (including first and last). Default: 5. */
  numTicks?: ChartLabelCount;
  /** Half the date pill's width (px) — the `"fade"` hide zone. Default: 50 */
  tickerHalfWidth?: number;
  /** Label reaction to the crosshair. Default: `"auto"`. */
  hoverEffect?: XAxisHoverEffect;
  /**
   * `"highlight"`: color of the label for the hovered row.
   * Default: `var(--chart-indicator-color)`.
   */
  activeLabelColor?: string;
  /**
   * `"highlight"`: color nearby labels blend toward (by distance).
   * Default: `activeLabelColor`.
   */
  nearbyLabelColor?: string;
  /** `"highlight"`: distance (px) over which nearby labels blend. Default: 80 */
  highlightRadius?: number;
  /** Classes for each label `<span>` (base: `text-chart-label text-xs`). */
  labelClassName?: string;
  /**
   * `"data"` — tick labels snap to data rows so crosshair and tooltip stay aligned (default).
   * `"domain"` — evenly spaced ticks across the time domain (may not align with hover).
   */
  tickMode?: "domain" | "data";
  /** Optional labels aligned with data rows for the displayed ticks. */
  labels?: string[];
}

interface XAxisLabelProps {
  label: string;
  x: number;
  /** Fades out near the crosshair; see {@link xAxisLabelOpacity}. */
  opacity: number;
  /** Highlight color near the crosshair; see {@link xAxisLabelHighlight}. */
  color: string | undefined;
  animatePosition: boolean;
  className: string | undefined;
}

// Memoised on its resolved opacity / color: a pointer move re-renders only
// the labels whose fade or highlight changes, not every label.
const XAxisLabel = memo(function XAxisLabel({
  label,
  x,
  opacity,
  color,
  animatePosition,
  className,
}: XAxisLabelProps) {
  return (
    <div
      className="absolute"
      style={{
        left: x,
        bottom: 12,
        width: 0,
        display: "flex",
        justifyContent: "center",
        transition: animatePosition
          ? `left ${X_AXIS_POSITION_TWEEN_MS}ms cubic-bezier(${LINE_LOADING_PULSE_EASE.join(", ")})`
          : undefined,
      }}
    >
      <span
        className={cn("whitespace-nowrap text-chart-label text-xs", className)}
        style={{
          opacity,
          color,
          transition: "opacity 0.4s ease-in-out, color 0.2s ease-out",
        }}
      >
        {label}
      </span>
    </div>
  );
});

function buildDomainTicks({
  marginLeft,
  numTicks,
  xScale,
}: {
  marginLeft: number;
  numTicks: number;
  xScale: {
    domain: () => Date[];
    (date: Date): number | undefined;
  };
}): AxisTick[] {
  const domain = xScale.domain();
  const startDate = domain[0];
  const endDate = domain[1];

  if (!(startDate && endDate)) {
    return [];
  }

  const startTime = startDate.getTime();
  const endTime = endDate.getTime();
  const timeRange = endTime - startTime;
  const tickCount = Math.max(2, numTicks);
  const seenLabels = new Set<string>();
  const ticks: AxisTick[] = [];

  for (let i = 0; i < tickCount; i++) {
    const t = i / (tickCount - 1);
    const date = new Date(startTime + t * timeRange);
    const label = shortDateFmt.format(date);
    if (seenLabels.has(label)) {
      continue;
    }
    seenLabels.add(label);
    ticks.push({
      date,
      label,
      x: (xScale(date) ?? 0) + marginLeft,
    });
  }

  return ticks;
}

function domainExtendsPastData(
  data: Record<string, unknown>[],
  xAccessor: (d: Record<string, unknown>) => Date,
  xScale: { domain: () => Date[] }
): boolean {
  if (data.length === 0) {
    return false;
  }
  const domainEnd = xScale.domain()[1];
  const lastPoint = data.at(-1);
  if (!(domainEnd && lastPoint)) {
    return false;
  }
  return domainEnd.getTime() > xAccessor(lastPoint).getTime();
}

/** Domain ticks for the projection tail when brush keeps data-aligned labels. */
function appendProjectionTailTicks(
  ticks: AxisTick[],
  data: Record<string, unknown>[],
  xAccessor: (d: Record<string, unknown>) => Date,
  xScale: {
    domain: () => Date[];
    (date: Date): number | undefined;
  },
  marginLeft: number,
  maxExtraTicks: number
): AxisTick[] {
  if (data.length === 0 || maxExtraTicks <= 0) {
    return ticks;
  }

  const lastPoint = data.at(-1);
  const domainEnd = xScale.domain()[1];
  if (!(lastPoint && domainEnd)) {
    return ticks;
  }

  const lastDate = xAccessor(lastPoint);
  const startTime = lastDate.getTime();
  const endTime = domainEnd.getTime();
  if (endTime <= startTime) {
    return ticks;
  }

  const seenLabels = new Set(ticks.map((tick) => tick.label));
  const extras: AxisTick[] = [];
  const extraCount = Math.min(maxExtraTicks, 3);

  for (let i = 1; i <= extraCount; i++) {
    const date = new Date(
      startTime + (i / (extraCount + 1)) * (endTime - startTime)
    );
    const label = shortDateFmt.format(date);
    if (seenLabels.has(label)) {
      continue;
    }
    seenLabels.add(label);
    extras.push({
      date,
      label,
      x: (xScale(date) ?? 0) + marginLeft,
    });
  }

  const endLabel = shortDateFmt.format(domainEnd);
  if (!seenLabels.has(endLabel)) {
    extras.push({
      date: domainEnd,
      label: endLabel,
      x: (xScale(domainEnd) ?? 0) + marginLeft,
    });
  }

  if (extras.length === 0) {
    return ticks;
  }

  return [...ticks, ...extras].sort((a, b) => a.x - b.x);
}

export function XAxis(props: XAxisProps) {
  const { containerRef } = useChartStable();

  const container = useChartPortalContainer(containerRef);
  if (!container) {
    return null;
  }

  return <XAxisInner {...props} container={container} />;
}

const XAxisInner = memo(function XAxisInner({
  numTicks = 5,
  tickerHalfWidth = 50,
  tickMode = "data",
  labels: labelsProp,
  hoverEffect = "auto",
  activeLabelColor = chartCssVars.indicatorColor,
  nearbyLabelColor,
  highlightRadius = 80,
  labelClassName,
  container,
}: XAxisProps & { container: HTMLDivElement }) {
  const {
    xScale,
    margin,
    data,
    xAccessor,
    dateLabels: contextDateLabels,
    xDomain,
    width,
  } = useChartStable();
  const tooltipData = useChartHoverSelector(selectTooltipData);
  const datePillPresent = useDatePillPresent(container);
  const autoEffect = datePillPresent ? "fade" : "highlight";
  const effect = hoverEffect === "auto" ? autoEffect : hoverEffect;
  const nearbyColor = nearbyLabelColor ?? activeLabelColor;
  const dateLabels = labelsProp ?? contextDateLabels;
  const resolvedNumTicks = useMemo(
    () => resolveResponsiveChartLabelCount(numTicks, width, 5),
    [numTicks, width]
  );

  const labelsToShow = useMemo(() => {
    const projectionExtendsScale =
      tickMode === "data" && domainExtendsPastData(data, xAccessor, xScale);

    if (tickMode === "domain") {
      return buildDomainTicks({
        marginLeft: margin.left,
        numTicks: resolvedNumTicks,
        xScale,
      });
    }

    // No brush: evenly spaced ticks across the full domain (data + projection).
    if (projectionExtendsScale && xDomain == null) {
      return buildDomainTicks({
        marginLeft: margin.left,
        numTicks: resolvedNumTicks,
        xScale,
      });
    }

    const dataTicks = buildDataAlignedTicks({
      data,
      dateLabels,
      marginLeft: margin.left,
      targetTickCount: resolvedNumTicks,
      xAccessor,
      xScale,
    });

    // Brush: keep data-aligned ticks, add labels only in the projection tail.
    if (projectionExtendsScale && xDomain != null) {
      return appendProjectionTailTicks(
        dataTicks,
        data,
        xAccessor,
        xScale,
        margin.left,
        Math.max(1, resolvedNumTicks - dataTicks.length + 1)
      );
    }

    return dataTicks;
  }, [
    tickMode,
    xDomain,
    data,
    dateLabels,
    xAccessor,
    xScale,
    margin.left,
    resolvedNumTicks,
  ]);

  const crosshairX =
    tooltipData && effect !== "none" ? tooltipData.x + margin.left : null;
  const hoveredLabel = tooltipData
    ? (dateLabels[tooltipData.index] ??
      shortDateFmt.format(xAccessor(tooltipData.point)))
    : null;

  return createPortal(
    <div className="pointer-events-none absolute inset-0">
      {labelsToShow.map((item) => (
        <XAxisLabel
          animatePosition={xDomain == null}
          className={labelClassName}
          color={
            effect === "highlight"
              ? xAxisLabelColor(
                  xAxisLabelHighlight(
                    item.label,
                    item.x,
                    crosshairX,
                    hoveredLabel,
                    highlightRadius
                  ),
                  activeLabelColor,
                  nearbyColor
                )
              : undefined
          }
          key={`${item.date.getTime()}-${item.x}`}
          label={item.label}
          opacity={
            effect === "fade"
              ? xAxisLabelOpacity(
                  item.label,
                  item.x,
                  crosshairX,
                  hoveredLabel,
                  tickerHalfWidth
                )
              : 1
          }
          x={item.x}
        />
      ))}
    </div>,
    container
  );
});

XAxis.displayName = "XAxis";

export default XAxis;
