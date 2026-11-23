// Split from chart-legend-hover.tsx so that file exports only components (react-refresh lint).
import { createContext, useContext } from "react";

export interface ChartLegendHoverContextValue {
  hoveredIndex: number | null;
  setHoveredIndex: (index: number | null) => void;
}
export const ChartLegendHoverContext =
  createContext<ChartLegendHoverContextValue | null>(null);
export function useChartLegendHover(): ChartLegendHoverContextValue {
  const context = useContext(ChartLegendHoverContext);
  return (
    context ?? {
      hoveredIndex: null,
      setHoveredIndex: () => {
        /* noop outside ChartLegendHoverProvider */
      },
    }
  );
}
