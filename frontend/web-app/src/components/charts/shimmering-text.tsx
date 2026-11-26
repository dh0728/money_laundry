"use client";

import { domAnimation, LazyMotion, m } from "motion/react";
import { useAppReducedMotion } from "@/hooks/use-reduced-motion";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import "./chart-utilities.css";

/**
 * Highlight band painted across the text. The gradient is 3× the text width
 * with the band in its middle third, so at either end of the sweep the visible
 * window is solid `--color` and the band enters/leaves fully off-text.
 */
const SWEEP_FROM = "100% 0%";
const SWEEP_TO = "0% 0%";

export type ShimmeringTextProps = Omit<
  ComponentProps<typeof m.span>,
  "children" | "style"
> & {
  /** The text to render with the shimmering effect. */
  text: string;
  /**
   * Duration in seconds for one shimmer sweep across the text.
   * @defaultValue 1.5
   */
  duration?: number;
  /**
   * Pause the shimmer (e.g. when the hero leaves the viewport).
   * @defaultValue false
   */
  paused?: boolean;
  /**
   * Legacy alias for `paused`.
   * @defaultValue false
   */
  isStopped?: boolean;
};

export function ShimmeringText({
  text,
  duration = 1.5,
  isStopped = false,
  paused = false,
  className,
  ...props
}: ShimmeringTextProps) {
  const reducedMotion = useAppReducedMotion();
  const stopped = isStopped || paused || reducedMotion === true;

  // One gradient across the whole run (rather than per-character colors), so
  // the highlight is a smooth band and RTL / cursive scripts keep their glyph
  // joining and visual order.
  return (
    <LazyMotion features={domAnimation}>
      <m.span
        animate={
          stopped
            ? { backgroundPosition: SWEEP_TO }
            : { backgroundPosition: [SWEEP_FROM, SWEEP_TO] }
        }
        className={cn(
          "chart-shimmering-text inline-block select-none whitespace-nowrap leading-none",
          "[--color:var(--muted-text)] [--shimmering-color:var(--text)]",
          className
        )}
        initial={{ backgroundPosition: SWEEP_FROM }}
        transition={
          stopped
            ? { duration: duration * 0.5, ease: "easeOut" }
            : {
                duration,
                ease: "easeInOut",
                repeat: Number.POSITIVE_INFINITY,
                repeatType: "loop",
                repeatDelay: duration * 0.4,
              }
        }
        {...props}
      >
        {text}
      </m.span>
    </LazyMotion>
  );
}
