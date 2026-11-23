// Split from profit-loss-legend-hover.tsx so that file exports only components (react-refresh lint).
import { createContext, useContext } from "react";

export interface ProfitLossLegendHoverContextValue {
  hoveredIndex: number | null;
}
export const ProfitLossLegendHoverContext =
  createContext<ProfitLossLegendHoverContextValue | null>(null);
export function useProfitLossLegendHover(): ProfitLossLegendHoverContextValue {
  const context = useContext(ProfitLossLegendHoverContext);
  return context ?? { hoveredIndex: null };
}
