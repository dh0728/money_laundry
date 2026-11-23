"use client";

import { ProfitLossLegendHoverContext } from "./profit-loss-legend-hover-shared";
import { type ReactNode } from "react";

export function ProfitLossLegendHoverProvider({
  hoveredIndex,
  children,
}: {
  hoveredIndex: number | null;
  children: ReactNode;
}) {
  return (
    <ProfitLossLegendHoverContext.Provider value={{ hoveredIndex }}>
      {children}
    </ProfitLossLegendHoverContext.Provider>
  );
}
