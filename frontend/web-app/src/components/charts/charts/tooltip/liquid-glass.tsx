"use client";

import { type RefObject, useLayoutEffect, useRef } from "react";
import {
  CHANNEL_OFFSETS,
  DISPLACEMENT_SCALE,
  MAP_HEIGHT,
  MAP_WIDTH,
  getDisplacementMapUri,
} from "./liquid-glass-style";

/**
 * The SVG filter behind a glass surface. Keeps the displacement map sized to
 * `surfaceRef` (the pill's width springs between labels) by writing the
 * `feImage` size from a `ResizeObserver` — no React re-render.
 */
export function LiquidGlassFilter({
  id,
  surfaceRef,
}: {
  id: string;
  surfaceRef: RefObject<HTMLElement | null>;
}) {
  const imageRef = useRef<SVGFEImageElement>(null);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const image = imageRef.current;
    if (!(surface && image)) {
      return;
    }
    const sync = () => {
      image.setAttribute("width", `${surface.offsetWidth}`);
      image.setAttribute("height", `${surface.offsetHeight}`);
    };
    sync();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(sync);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [surfaceRef]);

  const channel = (
    key: keyof typeof CHANNEL_OFFSETS,
    matrix: string,
    result: string
  ) => (
    <>
      <feDisplacementMap
        in="SourceGraphic"
        in2="map"
        result={`${result}-displaced`}
        scale={DISPLACEMENT_SCALE + CHANNEL_OFFSETS[key]}
        xChannelSelector="R"
        yChannelSelector="B"
      />
      <feColorMatrix
        in={`${result}-displaced`}
        result={result}
        type="matrix"
        values={matrix}
      />
    </>
  );

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute"
      height="0"
      width="0"
    >
      <defs>
        <filter colorInterpolationFilters="sRGB" id={id}>
          <feImage
            height={MAP_HEIGHT}
            href={getDisplacementMapUri()}
            preserveAspectRatio="none"
            ref={imageRef}
            result="map"
            width={MAP_WIDTH}
            x="0"
            y="0"
          />
          {channel("r", "1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0", "red")}
          {channel("g", "0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0", "green")}
          {channel("b", "0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0", "blue")}
          <feBlend in="red" in2="green" mode="screen" result="rg" />
          <feBlend in="rg" in2="blue" mode="screen" result="rgb" />
          <feGaussianBlur in="rgb" stdDeviation="0.3" />
        </filter>
      </defs>
    </svg>
  );
}
