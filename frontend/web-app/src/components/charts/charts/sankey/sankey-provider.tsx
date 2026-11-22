"use client";

import { SankeyContext, type SankeyContextValue } from "./sankey-context";

export function SankeyProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: SankeyContextValue;
}) {
  return (
    <SankeyContext.Provider value={value}>{children}</SankeyContext.Provider>
  );
}
