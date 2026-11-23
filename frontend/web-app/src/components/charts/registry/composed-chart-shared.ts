// Split from composed-chart.tsx so that file exports only components (react-refresh lint).
import {
  Children,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { Area, type AreaProps } from "./area";
import { Candlestick, type CandlestickProps } from "./candlestick";
import { resolveChartChildElement } from "./chart-child-passthrough";
import { defaultScatterColors, type LineConfig } from "./chart-context-shared";
import { Line, type LineProps } from "./line";
import { PROFIT_LOSS_POSITIVE_COLOR } from "./profit-loss-line-shared";
import {
  ProfitLossLine,
  type ProfitLossLineProps,
} from "./profit-loss-line";
import { Scatter, type ScatterProps } from "./scatter";
import { SeriesBar, type SeriesBarProps } from "./series-bar";
import { normalizeYAxisId } from "./y-axis-scales";

export const FALLBACK_STROKE = "var(--chart-line-primary)";
export function getChildComponentName(child: ReactElement): string {
  const childType = child.type as { displayName?: string; name?: string };
  return typeof child.type === "function"
    ? childType.displayName || childType.name || ""
    : "";
}
/** Matches by reference or by name (MDX / duplicate bundles break `===`). */
export function isComponent(
  child: ReactElement,
  component: unknown,
  name: string
): boolean {
  return child.type === component || getChildComponentName(child) === name;
}
export interface ComposedSeries {
  /** Tooltip / y-domain series in child order. */
  lines: LineConfig[];
  /** `SeriesBar` keys in child order (grouped / stacked columns). */
  barDataKeys: string[];
  /** Value keys that only extend an axis domain (candlestick high / low). */
  extraDomainKeysByAxis: Record<string, string[]>;
  /** Axes that float around their data instead of anchoring at zero. */
  floatingYAxisIds: string[];
}
export function upsertLineConfig(lines: LineConfig[], config: LineConfig): void {
  const index = lines.findIndex((line) => line.dataKey === config.dataKey);
  if (index === -1) {
    lines.push(config);
    return;
  }
  // Area+Line pairs share a dataKey — keep the later config (Line over Area).
  lines[index] = config;
}
export function addExtraDomainKeys(
  byAxis: Record<string, string[]>,
  axisId: string,
  keys: string[]
) {
  const existing = byAxis[axisId] ?? [];
  for (const key of keys) {
    if (!existing.includes(key)) {
      existing.push(key);
    }
  }
  byAxis[axisId] = existing;
}
export interface SeriesRegistrar {
  component: unknown;
  name: string;
  register: (
    props: unknown,
    series: ComposedSeries,
    walk: { scatterCount: number }
  ) => void;
}
export const SERIES_REGISTRARS: SeriesRegistrar[] = [
  {
    component: SeriesBar,
    name: "SeriesBar",
    register: (rawProps, series) => {
      const props = rawProps as SeriesBarProps;
      if (!props.dataKey) {
        return;
      }
      series.barDataKeys.push(props.dataKey);
      upsertLineConfig(series.lines, {
        dataKey: props.dataKey,
        stroke: props.stroke || props.fill || FALLBACK_STROKE,
        strokeWidth: 0,
        yAxisId: props.yAxisId,
      });
    },
  },
  {
    component: Line,
    name: "Line",
    register: (rawProps, series) => {
      const props = rawProps as LineProps;
      if (!props.dataKey) {
        return;
      }
      upsertLineConfig(series.lines, {
        dataKey: props.dataKey,
        stroke: props.stroke || FALLBACK_STROKE,
        strokeWidth: props.strokeWidth ?? 2.5,
        yAxisId: props.yAxisId,
      });
    },
  },
  {
    component: Area,
    name: "Area",
    register: (rawProps, series) => {
      const props = rawProps as AreaProps;
      if (!props.dataKey) {
        return;
      }
      upsertLineConfig(series.lines, {
        dataKey: props.dataKey,
        stroke: props.stroke || props.fill || FALLBACK_STROKE,
        strokeWidth: props.strokeWidth ?? 2,
        yAxisId: props.yAxisId,
      });
    },
  },
  {
    component: Scatter,
    name: "Scatter",
    register: (rawProps, series, walk) => {
      const props = rawProps as ScatterProps;
      if (!props.dataKey) {
        return;
      }
      const fallback =
        defaultScatterColors[walk.scatterCount % defaultScatterColors.length] ??
        FALLBACK_STROKE;
      walk.scatterCount += 1;
      upsertLineConfig(series.lines, {
        dataKey: props.dataKey,
        stroke: props.fill || props.stroke || fallback,
        strokeWidth: props.radius ?? 5,
        yAxisId: props.yAxisId,
      });
    },
  },
  {
    component: ProfitLossLine,
    name: "ProfitLossLine",
    register: (rawProps, series) => {
      const props = rawProps as ProfitLossLineProps;
      if (!props.dataKey) {
        return;
      }
      upsertLineConfig(series.lines, {
        dataKey: props.dataKey,
        stroke: props.positiveColor || PROFIT_LOSS_POSITIVE_COLOR,
        strokeWidth: props.strokeWidth ?? 2.5,
      });
    },
  },
  {
    component: Candlestick,
    name: "Candlestick",
    register: (rawProps, series) => {
      const props = rawProps as CandlestickProps;
      const axisId = normalizeYAxisId(props.yAxisId);
      // `close` is the tooltip row; wicks and opens extend the domain only.
      upsertLineConfig(series.lines, {
        dataKey: "close",
        stroke: "var(--chart-positive, var(--color-emerald-500))",
        strokeWidth: 0,
        yAxisId: props.yAxisId,
      });
      addExtraDomainKeys(series.extraDomainKeysByAxis, axisId, [
        "high",
        "low",
        "open",
      ]);
      if (!series.floatingYAxisIds.includes(axisId)) {
        series.floatingYAxisIds.push(axisId);
      }
    },
  },
];
/**
 * Walk chart children (through fragments and clip passthrough wrappers) and
 * register every time-series primitive for the shared x-scale, y-domains and
 * tooltip.
 */
export function extractComposedSeries(children: ReactNode): ComposedSeries {
  const series: ComposedSeries = {
    lines: [],
    barDataKeys: [],
    extraDomainKeysByAxis: {},
    floatingYAxisIds: [],
  };
  const walk = { scatterCount: 0 };

  const visit = (node: ReactNode) => {
    Children.forEach(node, (rawChild) => {
      if (!isValidElement(rawChild)) {
        return;
      }
      if (rawChild.type === Fragment) {
        visit((rawChild.props as { children?: ReactNode }).children);
        return;
      }
      const child = resolveChartChildElement(rawChild);
      const registrar = SERIES_REGISTRARS.find((entry) =>
        isComponent(child, entry.component, entry.name)
      );
      registrar?.register(child.props, series, walk);
    });
  };

  visit(children);
  return series;
}
