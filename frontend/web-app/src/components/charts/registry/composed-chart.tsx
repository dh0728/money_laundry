"use client";

import type { Transition } from "motion/react";
import { domAnimation, LazyMotion } from "motion/react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { type Margin, useStableMargin } from "./chart-context-shared";
import { ChartLoadingLabel } from "./chart-loading-label";
import { ParentSize } from "./chart-parent-size";
import {
  type ChartPhase,
  type ChartStatus,
  DEFAULT_CHART_STATUS,
  DEFAULT_Y_DOMAIN_TWEEN_MS,
  resolveRestingChartPhase,
} from "./chart-phase";
import { TimeSeriesChartInner } from "./time-series-chart-shell";
import { timeSeriesChartHasRoom } from "./time-series-chart-shell-shared";
import { type ComposedSeries, extractComposedSeries } from "./composed-chart-shared";
import type { YDomainOverride } from "./y-domain-utils";

export interface ComposedChartProps {
  /** Data array — each row typically has a date and multiple numeric series */
  data: Record<string, unknown>[];
  /** Key for the x-axis (time). Default: "date" */
  xDataKey?: string;
  margin?: Partial<Margin>;
  animationDuration?: number;
  animationEasing?: string;
  enterTransition?: Transition;
  /** Signature of motion URL state — triggers reveal replay when it changes. */
  revealSignature?: string;
  /** Aspect ratio as "width / height". Default: "2 / 1". Pass `""` to fill a sized parent. */
  aspectRatio?: string;
  className?: string;
  /** Inline container styles (e.g. a fixed height). */
  style?: CSSProperties;
  /**
   * Series and chrome. Every time-series primitive composes: `Line`, `Area`,
   * `SeriesBar`, `Scatter`, `Candlestick`, `ProfitLossLine`, plus `Band`,
   * `ProjectionLine`, `TrendLine`, `ReferenceArea`, `Grid`, axes and
   * `ChartTooltip`. Fragments are walked, so series can be grouped.
   */
  children: ReactNode;
  /** Target bar width in px (Recharts-style `barSize`). */
  barSize?: number;
  /** Maximum bar width in px (`maxBarSize`). */
  maxBarSize?: number;
  /** Gap between grouped `SeriesBar` series in px. Default: 4 */
  barGap?: number;
  /** Stack `SeriesBar` segments in child order at each x (other series are not stacked). */
  stacked?: boolean;
  /** Gap in px between stacked segments. Default: 0 */
  stackGap?: number;
  /**
   * Inset the x-axis by half a slot on each side when the chart has
   * `SeriesBar` series, so the first and last bars sit inside the plot instead
   * of spilling into the y-axis gutters. Lines, areas and the x-axis share the
   * inset scale and stay centred on their bars. Default: `true`
   */
  barEdgeInset?: boolean;
  /** Loading vs ready — drives chart phase and loading chrome. Default: `"ready"`. */
  status?: ChartStatus;
  /** Centered shimmer label while loading. */
  loadingLabel?: string;
  /** Animate y-domain over this duration (ms) on status transitions. Default: 500. */
  yDomainTweenDuration?: number;
  /** Animate y-domain when status or target domain changes. Default: true */
  yDomainTween?: boolean;
  /** Visible x-domain for brush zoom. */
  xDomain?: [Date, Date];
  /** Full dataset length for x-scale padding when `xDomain` is set. */
  xDomainSlotCount?: number;
  /** Tween y-domain when brush changes the visible x-range. Default: false */
  tweenYDomainOnXDomainChange?: boolean;
  /**
   * Fixed y-domain max for single-axis charts: `[0, yScaleDomainMax × 1.1]`.
   * Default: data max per axis (stacked `SeriesBar` axes use stack totals).
   */
  yScaleDomainMax?: number;
  /**
   * Per-axis y-domain overrides keyed by `yAxisId`: a fixed `[min, max]` or a
   * function of the auto domain, e.g. `{ volume: ([, max]) => [0, max * 3] }`
   * keeps volume bars in the bottom third under price candles. Hoist or
   * memoize the object so the domain is not recomputed every render.
   */
  yDomains?: Record<string, YDomainOverride>;
  onPhaseChange?: (phase: ChartPhase) => void;
}

const DEFAULT_MARGIN: Margin = { top: 40, right: 40, bottom: 40, left: 40 };

function computeStackOffsets(
  data: Record<string, unknown>[],
  barDataKeys: string[]
): Map<number, Map<string, number>> {
  const offsets = new Map<number, Map<string, number>>();
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    if (!d) {
      continue;
    }
    const pointOffsets = new Map<string, number>();
    let cumulative = 0;
    for (const key of barDataKeys) {
      pointOffsets.set(key, cumulative);
      const v = d[key];
      if (typeof v === "number") {
        cumulative += v;
      }
    }
    offsets.set(i, pointOffsets);
  }
  return offsets;
}

export function ComposedChart({
  data,
  xDataKey = "date",
  margin: marginProp,
  animationDuration = 1100,
  animationEasing,
  enterTransition,
  revealSignature,
  aspectRatio = "2 / 1",
  className = "",
  style,
  children,
  barSize,
  maxBarSize,
  barGap = 4,
  stacked = false,
  stackGap = 0,
  barEdgeInset = true,
  status = DEFAULT_CHART_STATUS,
  loadingLabel,
  yDomainTweenDuration = DEFAULT_Y_DOMAIN_TWEEN_MS,
  yDomainTween = true,
  xDomain,
  xDomainSlotCount,
  tweenYDomainOnXDomainChange = false,
  yScaleDomainMax,
  yDomains,
  onPhaseChange,
}: ComposedChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const margin = useStableMargin({ ...DEFAULT_MARGIN, ...marginProp });

  // Keyed by a string signature so new `children` identities (every parent
  // render) keep the same series references and skip shell recomputation.
  const seriesSignature = useMemo(
    () => JSON.stringify(extractComposedSeries(children)),
    [children]
  );
  const { lines, barDataKeys, extraDomainKeysByAxis, floatingYAxisIds } =
    useMemo(
      () => JSON.parse(seriesSignature) as ComposedSeries,
      [seriesSignature]
    );

  const [chartPhase, setChartPhase] = useState<ChartPhase>(() =>
    resolveRestingChartPhase(status)
  );
  const handlePhaseChange = useCallback(
    (phase: ChartPhase) => {
      setChartPhase(phase);
      onPhaseChange?.(phase);
    },
    [onPhaseChange]
  );

  const composedStackOffsets = useMemo(
    () =>
      stacked && barDataKeys.length > 0
        ? computeStackOffsets(data, barDataKeys)
        : undefined,
    [data, barDataKeys, stacked]
  );

  const hasExtraDomainKeys = Object.keys(extraDomainKeysByAxis).length > 0;

  const showLoadingLabel = Boolean(
    loadingLabel?.trim() &&
      (chartPhase === "loading" ||
        chartPhase === "exiting" ||
        chartPhase === "gridTweenReady" ||
        chartPhase === "revealingLoading")
  );

  return (
    <LazyMotion features={domAnimation}>
      <div
        className={cn("relative w-full", className)}
        ref={containerRef}
        style={{
          ...(aspectRatio ? { aspectRatio } : undefined),
          touchAction: "none",
          ...style,
        }}
      >
        <ParentSize debounceTime={10}>
          {({ width, height }) =>
            timeSeriesChartHasRoom(width, height) ? (
              <TimeSeriesChartInner
                animationDuration={animationDuration}
                animationEasing={animationEasing}
                chartStatus={status}
                clipPathId="composed-chart-grow-clip"
                composedBarDataKeys={
                  barDataKeys.length > 0 ? barDataKeys : undefined
                }
                composedBarEdgeInset={barEdgeInset}
                composedBarGap={barGap}
                composedBarSize={barSize}
                composedMaxBarSize={maxBarSize}
                composedStacked={stacked}
                composedStackGap={stackGap}
                composedStackOffsets={composedStackOffsets}
                containerRef={containerRef}
                data={data}
                enterTransition={enterTransition}
                extraDomainKeysByAxis={
                  hasExtraDomainKeys ? extraDomainKeysByAxis : undefined
                }
                floatingYAxisIds={
                  floatingYAxisIds.length > 0 ? floatingYAxisIds : undefined
                }
                height={height}
                lines={lines}
                loadingLabel={loadingLabel}
                margin={margin}
                onPhaseChange={handlePhaseChange}
                revealSignature={revealSignature}
                tweenYDomainOnXDomainChange={tweenYDomainOnXDomainChange}
                width={width}
                xDataKey={xDataKey}
                xDomain={xDomain}
                xDomainSlotCount={xDomainSlotCount}
                yDomainOverrides={yDomains}
                yDomainTween={yDomainTween}
                yDomainTweenDuration={yDomainTweenDuration}
                yScaleDomainMax={yScaleDomainMax}
              >
                {children}
              </TimeSeriesChartInner>
            ) : null
          }
        </ParentSize>
        {showLoadingLabel ? (
          <ChartLoadingLabel
            exiting={chartPhase !== "loading"}
            text={loadingLabel}
          />
        ) : null}
      </div>
    </LazyMotion>
  );
}

ComposedChart.displayName = "ComposedChart";

export default ComposedChart;
