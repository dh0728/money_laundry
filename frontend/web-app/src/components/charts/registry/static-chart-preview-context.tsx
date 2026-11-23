"use client";

import { StaticChartPreviewContext } from "./static-chart-preview-context-shared";
import { type ReactNode } from "react";

/** Disables cartesian reveal clip-path for static docs previews. */
export function StaticChartPreviewProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <StaticChartPreviewContext.Provider value={true}>
      {children}
    </StaticChartPreviewContext.Provider>
  );
}
