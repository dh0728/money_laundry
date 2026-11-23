// Split from loading-sweep.tsx so that file exports only components (react-refresh lint).

export const HEIGHT_MIN_PCT = 20;
export const HEIGHT_MAX_PCT = 80;
// ─── Pure, SSR-safe helpers ──────────────────────────────────────────────
// Heights come from a deterministic hash of (index, seed), never
// `Math.random()`, so the first server render and first client render agree
// (no Next.js hydration mismatch). Re-randomizing only bumps the numeric seed
// on the client, after a sweep completes.

/** Cheap deterministic hash to a fractional part in [0, 1). */
export function hashFract(n: number): number {
  const x = Math.sin(n) * 43_758.5453;
  return x - Math.floor(x);
}
/** Deterministic heights (percentages of the available height) for a seed. */
export function getSkeletonHeights(
  count: number,
  seed = 0,
  min = HEIGHT_MIN_PCT,
  max = HEIGHT_MAX_PCT
): number[] {
  const range = max - min;
  return Array.from(
    { length: count },
    (_, i) => min + Math.floor(hashFract((i + 1) * 12.9898 + seed) * range)
  );
}
