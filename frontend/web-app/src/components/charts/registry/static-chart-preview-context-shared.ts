// Split from static-chart-preview-context.tsx so that file exports only components (react-refresh lint).
import { createContext, useContext } from "react";

export const StaticChartPreviewContext = createContext(false);
export function useStaticChartPreview() {
  return useContext(StaticChartPreviewContext);
}
