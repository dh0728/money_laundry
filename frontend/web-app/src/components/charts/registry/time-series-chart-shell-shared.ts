// Split from time-series-chart-shell.tsx so that file exports only components (react-refresh lint).
export function timeSeriesChartHasRoom(width: number, height: number) {
  return width >= 10 && height >= 10;
}
