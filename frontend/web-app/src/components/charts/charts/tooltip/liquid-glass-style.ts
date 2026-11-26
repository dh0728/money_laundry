"use client";

import { useId } from "react";
import glassMapTokens from "@/styles/glass-map-tokens.css?raw";

/**
 * Liquid glass for small capsules (the date pill): the backdrop is refracted
 * at the rim through an SVG displacement map, with the red, green and blue
 * channels displaced by slightly different amounts for a thin chromatic
 * fringe, then saturated.
 *
 * SVG filters in `backdrop-filter` only render in Chromium. Elsewhere the
 * surface falls back to a frosted blur.
 */

/** Displacement map size — stretched to the surface, so only the aspect matters. */
export const MAP_WIDTH = 128;
export const MAP_HEIGHT = 32;
/** Rim thickness as a fraction of the short side. */
const MAP_BORDER = 0.07;
/** Softness of the neutral (undisplaced) centre — larger = wider refracting rim. */
const MAP_BLUR = 4;
/** Base displacement (px); negative pulls the backdrop inward like a lens. */
export const DISPLACEMENT_SCALE = -48;
/** Extra displacement per channel for the chromatic fringe. */
export const CHANNEL_OFFSETS = { r: 0, g: 6, b: 12 } as const;
/**
 * Red ramps left → right (x displacement), blue top → bottom (y), combined
 * with `difference`; a blurred mid-grey capsule on top zeroes the centre so
 * only the rim bends the backdrop.
 */
function displacementMapUri(): string {
  const radius = MAP_HEIGHT / 2;
  const inset = Math.min(MAP_WIDTH, MAP_HEIGHT) * (MAP_BORDER / 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" width="${MAP_WIDTH}" height="${MAP_HEIGHT}">
<style>${glassMapTokens}</style>
<defs>
<linearGradient id="r" x1="100%" y1="0%" x2="0%" y2="0%"><stop offset="0%" stop-color="var(--glass-map-zero)"/><stop offset="100%" stop-color="var(--glass-map-horizontal-axis)"/></linearGradient>
<linearGradient id="b" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="var(--glass-map-zero)"/><stop offset="100%" stop-color="var(--glass-map-vertical-axis)"/></linearGradient>
<filter id="s"><feGaussianBlur stdDeviation="${MAP_BLUR}"/></filter>
</defs>
<rect width="${MAP_WIDTH}" height="${MAP_HEIGHT}" fill="var(--glass-map-zero)"/>
<rect width="${MAP_WIDTH}" height="${MAP_HEIGHT}" rx="${radius}" fill="url(#r)"/>
<rect width="${MAP_WIDTH}" height="${MAP_HEIGHT}" rx="${radius}" fill="url(#b)" class="glass-map-vertical-layer"/>
<rect x="${inset}" y="${inset}" width="${MAP_WIDTH - inset * 2}" height="${MAP_HEIGHT - inset * 2}" rx="${radius - inset}" class="glass-map-center" filter="url(#s)"/>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

let cachedMapUri: string | null = null;
export function getDisplacementMapUri(): string {
  cachedMapUri ??= displacementMapUri();
  return cachedMapUri;
}

let cachedSupport: boolean | null = null;

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

export const DATE_TICKER_GLASS_CLASS =
  "relative overflow-hidden rounded-full px-4 py-1 text-zinc-900 dark:text-white " +
  "bg-white/15 dark:bg-white/[0.06] " +
  "shadow-(--date-ticker-glass-shadow) dark:shadow-(--date-ticker-glass-shadow-dark)";

const saturation = "saturate(var(--date-ticker-glass-saturation))";
const FALLBACK_BACKDROP = `blur(var(--aml-space-6)) ${saturation}`;

/**
 * Filter id and backdrop value for a glass surface. Render
 * `<LiquidGlassFilter>` inside the surface with the same id and ref.
 */
export function useLiquidGlass(): {
  filterId: string;
  svgFilter: boolean;
  backdrop: string;
} {
  // CSS `url(#…)` is happiest with a plain id.
  const filterId = `bklit-glass-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const svgFilter = supportsSvgBackdropFilter();
  const backdrop = svgFilter
    ? `url(#${filterId}) ${saturation}`
    : FALLBACK_BACKDROP;
  return {
    filterId,
    svgFilter,
    backdrop,
  };
}
