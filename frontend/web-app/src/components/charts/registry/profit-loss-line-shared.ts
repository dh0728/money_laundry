// Split from profit-loss-line.tsx so that file exports only components (react-refresh lint).
/** Semantic trend tokens with Tailwind fallbacks for apps without `--chart-positive` / `--chart-negative`. */
export const PROFIT_LOSS_POSITIVE_COLOR =
  "var(--chart-positive, var(--color-emerald-500))";
export const PROFIT_LOSS_NEGATIVE_COLOR =
  "var(--chart-negative, var(--color-red-500))";
export function profitLossColor(value: number) {
  return value >= 0 ? PROFIT_LOSS_POSITIVE_COLOR : PROFIT_LOSS_NEGATIVE_COLOR;
}
export const PROFIT_LOSS_TOOLTIP_LABEL_FALLBACK = "Profit/Loss";
export function resolveProfitLossTooltipLabel(label: string) {
  const trimmed = label.trim();
  return trimmed || PROFIT_LOSS_TOOLTIP_LABEL_FALLBACK;
}
