"use client";

import { type CSSProperties, useId } from "react";

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
const SATURATION = 1.6;

/**
 * Red ramps left → right (x displacement), blue top → bottom (y), combined
 * with `difference`; a blurred mid-grey capsule on top zeroes the centre so
 * only the rim bends the backdrop.
 */
function displacementMapUri(): string {
  const radius = MAP_HEIGHT / 2;
  const inset = Math.min(MAP_WIDTH, MAP_HEIGHT) * (MAP_BORDER / 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" width="${MAP_WIDTH}" height="${MAP_HEIGHT}">
<defs>
<linearGradient id="r" x1="100%" y1="0%" x2="0%" y2="0%"><stop offset="0%" stop-color="#000"/><stop offset="100%" stop-color="#f00"/></linearGradient>
<linearGradient id="b" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#000"/><stop offset="100%" stop-color="#00f"/></linearGradient>
<filter id="s"><feGaussianBlur stdDeviation="${MAP_BLUR}"/></filter>
</defs>
<rect width="${MAP_WIDTH}" height="${MAP_HEIGHT}" fill="#000"/>
<rect width="${MAP_WIDTH}" height="${MAP_HEIGHT}" rx="${radius}" fill="url(#r)"/>
<rect width="${MAP_WIDTH}" height="${MAP_HEIGHT}" rx="${radius}" fill="url(#b)" style="mix-blend-mode:difference"/>
<rect x="${inset}" y="${inset}" width="${MAP_WIDTH - inset * 2}" height="${MAP_HEIGHT - inset * 2}" rx="${radius - inset}" fill="hsl(0 0% 50% / 0.93)" filter="url(#s)"/>
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
  "shadow-[0_6px_20px_rgb(0_0_0/0.12)] dark:shadow-[0_6px_20px_rgb(0_0_0/0.4)]";

const FALLBACK_BACKDROP = `blur(6px) saturate(${SATURATION})`;

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
