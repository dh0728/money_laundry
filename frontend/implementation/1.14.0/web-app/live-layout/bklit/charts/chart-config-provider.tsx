"use client";

import { type ReactNode, useMemo } from "react";
import { ChartConfigContext, DEFAULT_CHART_CONFIG, type ChartConfigValue } from "./chart-config-context";

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
