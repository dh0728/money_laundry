// Split from gauge-arc-layers.tsx so that file exports only components (react-refresh lint).
/* -------------------------------------------------------------------------- */
/*                                  Geometry                                  */
/* -------------------------------------------------------------------------- */

export const MIN_SWEEP = 0.01;
export const MAX_SWEEP = 359.99;
export function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return [cx + Math.cos(rad) * r, cy + Math.sin(rad) * r] as const;
}
/** Centerline arc from `a0` to `a1` (degrees, clockwise). Empty when degenerate. */
export function arcStrokePath(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number
): string {
  const sweep = Math.min(MAX_SWEEP, a1 - a0);
  if (sweep < MIN_SWEEP || r <= 0) {
    return "";
  }
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a0 + sweep);
  const large = sweep > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}
/** Filled ring segment between radii `r0` (inner, may be 0) and `r1`. */
export function annularSectorPath(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number
): string {
  const sweep = Math.min(MAX_SWEEP, a1 - a0);
  if (sweep < MIN_SWEEP) {
    return "";
  }
  const end = a0 + sweep;
  const large = sweep > 180 ? 1 : 0;
  const [ox0, oy0] = polar(cx, cy, r1, a0);
  const [ox1, oy1] = polar(cx, cy, r1, end);
  if (r0 <= 0.5) {
    return `M ${cx} ${cy} L ${ox0} ${oy0} A ${r1} ${r1} 0 ${large} 1 ${ox1} ${oy1} Z`;
  }
  const [ix1, iy1] = polar(cx, cy, r0, end);
  const [ix0, iy0] = polar(cx, cy, r0, a0);
  return `M ${ox0} ${oy0} A ${r1} ${r1} 0 ${large} 1 ${ox1} ${oy1} L ${ix1} ${iy1} A ${r0} ${r0} 0 ${large} 0 ${ix0} ${iy0} Z`;
}
/* -------------------------------------------------------------------------- */
/*                                    Zones                                   */
/* -------------------------------------------------------------------------- */

export interface GaugeZone {
  /** Start of the zone, 0–100 */
  from: number;
  /** End of the zone, 0–100 */
  to: number;
  color: string;
}
export function zoneColorAt(
  zones: readonly GaugeZone[] | undefined,
  t: number
): string | undefined {
  if (!zones) {
    return;
  }
  const pct = t * 100;
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i];
    if (z && pct >= z.from && pct <= z.to) {
      return z.color;
    }
  }
}
/* -------------------------------------------------------------------------- */
/*                                   Sector                                   */
/* -------------------------------------------------------------------------- */

export interface GaugeSectorOptions {
  /**
   * `conic` — brightens toward the leading edge · `radial` — brightens toward
   * the rim · `none` — flat `color` (use a `url(#pattern)` for patterns).
   * Default `conic`.
   */
  gradient?: "conic" | "radial" | "none";
  /** Default `var(--chart-1)` */
  color?: string;
  /** Peak opacity. Default 0.85 */
  opacity?: number;
  /** Inner radius as a fraction of the sector's outer radius. Default 0 */
  innerRadius?: number;
}
export function resolveSectorOptions(
  sector: boolean | GaugeSectorOptions | undefined
): GaugeSectorOptions | null {
  if (!sector) {
    return null;
  }
  return sector === true ? {} : sector;
}
/* -------------------------------------------------------------------------- */
/*                                Progress ring                               */
/* -------------------------------------------------------------------------- */

export interface GaugeProgressRingOptions {
  /** Default `var(--chart-1)` */
  color?: string;
  /** Remainder colour. Default `var(--muted-foreground)` */
  trackColor?: string;
  /** Remainder opacity. Default 0.35 */
  trackOpacity?: number;
  /** Stroke width as a fraction of size. Default 0.01 */
  width?: number;
  /** Gap from the track as a fraction of size. Default 0.022 */
  gap?: number;
}
export function resolveProgressRingOptions(
  ring: boolean | GaugeProgressRingOptions | undefined
): GaugeProgressRingOptions | null {
  if (!ring) {
    return null;
  }
  return ring === true ? {} : ring;
}
export function progressRingExtent(
  options: GaugeProgressRingOptions,
  size: number
) {
  return size * ((options.gap ?? 0.022) + (options.width ?? 0.01));
}
/* -------------------------------------------------------------------------- */
/*                                Progress dots                               */
/* -------------------------------------------------------------------------- */

export interface GaugeDotsOptions {
  /** Concentric rings of dots. Default 5 */
  rings?: number;
  /** Distance between dots (and rings) as a fraction of size. Default 0.03 */
  spacing?: number;
  /** Dot radius in px. Default 1.6 */
  radius?: number;
  /** Default `var(--chart-1)` */
  color?: string;
  /** Opacity of dots past the value. Default 0.12 */
  dimOpacity?: number;
  /** Opacity of dots up to the value. Default 0.9 */
  litOpacity?: number;
  /** Fade rings toward the center. Default true */
  fadeInward?: boolean;
}
export function resolveDotsOptions(
  dots: boolean | GaugeDotsOptions | undefined
): GaugeDotsOptions | null {
  if (!dots) {
    return null;
  }
  return dots === true ? {} : dots;
}
/* -------------------------------------------------------------------------- */
/*                              Disc + glow filter                            */
/* -------------------------------------------------------------------------- */

export interface GaugeCenterDiscOptions {
  /** Radius as a fraction of size. Default 0.19 */
  radius?: number;
  /** Default `var(--background)` */
  fill?: string;
  /** Default `var(--foreground)` */
  stroke?: string;
  strokeOpacity?: number;
  /** Ring width in px. Default 3 */
  strokeWidth?: number;
}
export function resolveCenterDiscOptions(
  disc: boolean | GaugeCenterDiscOptions | undefined
): GaugeCenterDiscOptions | null {
  if (!disc) {
    return null;
  }
  return disc === true ? {} : disc;
}
export interface GaugeGlowOptions {
  /** Blur radius in px. Default 6 */
  blur?: number;
  /** Glow strength 0–1. Default 0.8 */
  intensity?: number;
}
export function resolveGlowOptions(
  glow: boolean | GaugeGlowOptions | undefined
): GaugeGlowOptions | null {
  if (!glow) {
    return null;
  }
  return glow === true ? {} : glow;
}
