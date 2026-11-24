function readChartToken(token: string) {
  return typeof document === "undefined"
    ? ""
    : getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}

export function readChartNumber(token: string, fallback: number) {
  const value = Number.parseFloat(readChartToken(token));
  return Number.isFinite(value) ? value : fallback;
}

export function readChartDurationSeconds(token: string, fallback: number) {
  const value = readChartToken(token);
  const duration = Number.parseFloat(value);
  return Number.isFinite(duration) ? duration / (value.endsWith("ms") ? 1000 : 1) : fallback;
}
