// Split from liquid-glass.tsx so that file exports only components (react-refresh lint).
import {
  type CSSProperties,
  useId,
} from "react";

export const SATURATION = 1.6;
export let cachedSupport: boolean | null = null;
/** `true` when the browser renders SVG filters in `backdrop-filter` (Chromium). */
export function supportsSvgBackdropFilter(): boolean {
  if (cachedSupport !== null) {
    return cachedSupport;
  }
  if (typeof window === "undefined" || typeof CSS === "undefined") {
    return false;
  }
  const brands = (
    navigator as Navigator & {
      userAgentData?: { brands?: { brand: string }[] };
    }
  ).userAgentData?.brands;
  const isChromium = brands?.some((b) => b.brand === "Chromium") ?? false;
  cachedSupport =
    isChromium && CSS.supports("backdrop-filter", "url(#bklit-glass)");
  return cachedSupport;
}
export const FALLBACK_BACKDROP = `blur(6px) saturate(${SATURATION})`;
/**
 * Filter id + inline backdrop style for a glass surface. Render
 * `<LiquidGlassFilter>` inside the surface with the same id and ref.
 */
export function useLiquidGlass(): {
  filterId: string;
  svgFilter: boolean;
  style: CSSProperties;
} {
  // CSS `url(#…)` is happiest with a plain id.
  const filterId = `bklit-glass-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const svgFilter = supportsSvgBackdropFilter();
  const backdrop = svgFilter
    ? `url(#${filterId}) saturate(${SATURATION})`
    : FALLBACK_BACKDROP;
  return {
    filterId,
    svgFilter,
    style: { backdropFilter: backdrop, WebkitBackdropFilter: backdrop },
  };
}
