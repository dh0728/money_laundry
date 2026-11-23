"use client";

import {
  type ReactNode,
  useMemo,
  useSyncExternalStore,
} from "react";
import { type ChartHoverContextValue, type ChartContextValue, type ChartStableContextValue, ChartStableContext, ChartHoverContext, type ChartHoverStore, ChartHoverStoreContext } from "./chart-context-shared";

// CSS variable references for theming
/**
 * Above this many x labels, `ChartTooltip` switches to discrete interaction:
 * the crosshair, tooltip box and dots snap between points instead of
 * springing (springs would lag behind a dense series). The hover highlight
 * band follows the same rule.
 */
export const DISCRETE_INTERACTION_LABEL_THRESHOLD = 60;
const noop = () => undefined;

/** Read-only store over a plain hover value (re-created when it changes). */
function staticChartHoverStore(value: ChartHoverContextValue): ChartHoverStore {
  return {
    getSnapshot: () => value,
    subscribe: () => noop,
  };
}

/**
 * Publishes a hover store to `useChartHover()` (whole slice, re-renders on
 * every change) and `useChartHoverSelector()` (re-renders only when the
 * selected value changes). Only this provider re-renders on a hover change;
 * `children` keeps its identity, so the subtree is skipped apart from hover
 * consumers.
 */
export function ChartHoverStoreProvider({
  children,
  store,
}: {
  children: ReactNode;
  store: ChartHoverStore;
}) {
  const hover = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  return (
    <ChartHoverStoreContext.Provider value={store}>
      <ChartHoverContext.Provider value={hover}>
        {children}
      </ChartHoverContext.Provider>
    </ChartHoverStoreContext.Provider>
  );
}

/**
 * Splits the merged `value` into a stable slice and a volatile hover slice,
 * publishing each to its own context. Each slice is memoized on its own
 * field identities, so changing `tooltipData` does not bust the stable
 * slice — consumers of `useChartStable()` skip re-renders on hover.
 */
export function ChartProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ChartContextValue;
}) {
  const stable = useMemo<ChartStableContextValue>(
    () => ({
      data: value.data,
      renderData: value.renderData,
      xScale: value.xScale,
      yScale: value.yScale,
      yScales: value.yScales,
      width: value.width,
      height: value.height,
      innerWidth: value.innerWidth,
      innerHeight: value.innerHeight,
      margin: value.margin,
      columnWidth: value.columnWidth,
      containerRef: value.containerRef,
      lines: value.lines,
      bands: value.bands,
      referenceAreas: value.referenceAreas,
      chartPhase: value.chartPhase,
      chartStatus: value.chartStatus,
      loadingLabel: value.loadingLabel,
      yDomainTweenDuration: value.yDomainTweenDuration,
      yDomainSkeletonByAxis: value.yDomainSkeletonByAxis,
      yDomainTargetByAxis: value.yDomainTargetByAxis,
      isLoaded: value.isLoaded,
      animationDuration: value.animationDuration,
      animationEasing: value.animationEasing,
      enterTransition: value.enterTransition,
      revealEpoch: value.revealEpoch,
      notifyLoadingPulseComplete: value.notifyLoadingPulseComplete,
      xAccessor: value.xAccessor,
      dateLabels: value.dateLabels,
      xDomain: value.xDomain,
      xDomainSlotCount: value.xDomainSlotCount,
      barScale: value.barScale,
      bandWidth: value.bandWidth,
      barXAccessor: value.barXAccessor,
      orientation: value.orientation,
      stacked: value.stacked,
      stackOffsets: value.stackOffsets,
      composedBarDataKeys: value.composedBarDataKeys,
      composedBarSize: value.composedBarSize,
      composedMaxBarSize: value.composedMaxBarSize,
      composedBarGap: value.composedBarGap,
      composedStacked: value.composedStacked,
      composedStackOffsets: value.composedStackOffsets,
      composedStackGap: value.composedStackGap,
      nearestPointHover: value.nearestPointHover,
    }),
    [
      value.data,
      value.renderData,
      value.xScale,
      value.yScale,
      value.yScales,
      value.width,
      value.height,
      value.innerWidth,
      value.innerHeight,
      value.margin,
      value.columnWidth,
      value.containerRef,
      value.lines,
      value.bands,
      value.referenceAreas,
      value.chartPhase,
      value.chartStatus,
      value.loadingLabel,
      value.yDomainTweenDuration,
      value.yDomainSkeletonByAxis,
      value.yDomainTargetByAxis,
      value.isLoaded,
      value.animationDuration,
      value.animationEasing,
      value.enterTransition,
      value.revealEpoch,
      value.notifyLoadingPulseComplete,
      value.xAccessor,
      value.dateLabels,
      value.xDomain,
      value.xDomainSlotCount,
      value.barScale,
      value.bandWidth,
      value.barXAccessor,
      value.orientation,
      value.stacked,
      value.stackOffsets,
      value.composedBarDataKeys,
      value.composedBarSize,
      value.composedMaxBarSize,
      value.composedBarGap,
      value.composedStacked,
      value.composedStackOffsets,
      value.composedStackGap,
      value.nearestPointHover,
    ]
  );

  const hover = useMemo<ChartHoverContextValue>(
    () => ({
      tooltipData: value.tooltipData,
      setTooltipData: value.setTooltipData,
      selection: value.selection,
      clearSelection: value.clearSelection,
      hoveredBarIndex: value.hoveredBarIndex,
      setHoveredBarIndex: value.setHoveredBarIndex,
      hoveredCandleIndex: value.hoveredCandleIndex,
      setHoveredCandleIndex: value.setHoveredCandleIndex,
    }),
    [
      value.tooltipData,
      value.setTooltipData,
      value.selection,
      value.clearSelection,
      value.hoveredBarIndex,
      value.setHoveredBarIndex,
      value.hoveredCandleIndex,
      value.setHoveredCandleIndex,
    ]
  );

  const hoverStore = useMemo(() => staticChartHoverStore(hover), [hover]);

  return (
    <ChartStableContext.Provider value={stable}>
      <ChartHoverStoreContext.Provider value={hoverStore}>
        <ChartHoverContext.Provider value={hover}>
          {children}
        </ChartHoverContext.Provider>
      </ChartHoverStoreContext.Provider>
    </ChartStableContext.Provider>
  );
}

export default ChartStableContext;
