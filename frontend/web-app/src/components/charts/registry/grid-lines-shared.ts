// Split from grid-lines.tsx so that file exports only components (react-refresh lint).

/**
 * Grid rows / columns that render what `@visx/grid` 4.0.0 `GridRows` and
 * `GridColumns` did (minus the `visx-group` / `visx-rows` / `visx-columns` /
 * `visx-line` classes), so charts keep identical markup without the dep.
 */

/** Any scale a grid can read: d3 linear / time / band / point. */
export interface GridScale<Value> {
  (value: Value): number | { valueOf(): number } | undefined;
  domain(): Value[];
  ticks?: (count?: number) => Value[];
  bandwidth?: () => number;
}
/**
 * Tick values the way visx resolves them: explicit `tickValues`, else
 * `scale.ticks(numTicks)`, else the domain thinned to about `numTicks`
 * entries (every `round((n - 1) / numTicks)`-th value) when it is longer.
 */
export function gridTickValues<Value>(
  scale: GridScale<Value>,
  numTicks: number | undefined = 10,
  tickValues?: Value[]
): Value[] {
  if (tickValues) {
    return tickValues;
  }
  if ("ticks" in scale && scale.ticks) {
    return scale.ticks(numTicks);
  }
  return scale
    .domain()
    .filter(
      (_, index, all) =>
        numTicks == null ||
        all.length <= numTicks ||
        index % Math.round((all.length - 1) / numTicks) === 0
    );
}
/**
 * Pixel position of each grid line: `scale(tick)` (0 when unmapped) plus
 * `offset` plus half the band for band scales (visx `getScaleBandwidth`).
 */
export function gridLinePositions<Value>(
  scale: GridScale<Value>,
  {
    numTicks,
    offset,
    tickValues,
  }: { numTicks?: number; offset?: number; tickValues?: Value[] } = {}
): number[] {
  const bandOffset =
    "bandwidth" in scale && scale.bandwidth ? scale.bandwidth() / 2 : 0;
  const scaleOffset = (offset ?? 0) + bandOffset;
  return gridTickValues(scale, numTicks, tickValues).map((tick) => {
    const mapped = scale(tick);
    const value =
      mapped != null && typeof mapped === "object" ? mapped.valueOf() : mapped;
    return (value ?? 0) + scaleOffset;
  });
}
