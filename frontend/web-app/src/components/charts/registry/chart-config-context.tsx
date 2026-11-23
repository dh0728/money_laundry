"use client";

import { type ChartConfigValue, DEFAULT_CHART_CONFIG, ChartConfigContext } from "./chart-config-context-shared";
import { type ReactNode, useMemo } from "react";

export interface ChartConfigProviderProps {
  value?: Partial<ChartConfigValue>;
  children: ReactNode;
}

export function ChartConfigProvider({
  value,
  children,
}: ChartConfigProviderProps) {
  const merged = useMemo<ChartConfigValue>(
    () => ({
      ...DEFAULT_CHART_CONFIG,
      ...value,
    }),
    [value]
  );

  return (
    <ChartConfigContext.Provider value={merged}>
      {children}
    </ChartConfigContext.Provider>
  );
}
