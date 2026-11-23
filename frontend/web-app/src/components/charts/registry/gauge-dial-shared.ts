// Split from gauge-dial.tsx so that file exports only components (react-refresh lint).
import {
  animate,
  type MotionValue,
  type Transition,
  useMotionValue,
  useMotionValueEvent,
} from "motion/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

export const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
/**
 * Default sweep: a critically damped spring (no bounce). It decelerates into
 * the value like a real dial settling, and keeps its velocity when the value
 * changes mid-flight instead of restarting.
 */
export const DEFAULT_GAUGE_SWEEP_TRANSITION: Transition = {
  type: "spring",
  visualDuration: 0.9,
  bounce: 0,
};
/** Track + ruler fade in before the fill starts sweeping. */
export const GAUGE_TRACK_ENTER_TRANSITION: Transition = {
  duration: 0.45,
  ease: [0.23, 1, 0.32, 1],
};
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/**
 * Animates a motion value toward `target`. Starts from 0 on mount (after
 * `enterDelay`), then follows later target changes from wherever it is.
 * Runs entirely off React state — subscribers write to the DOM directly.
 */
export function useGaugeSweep({
  target,
  transition,
  enterDelay,
  instant,
}: {
  target: number;
  transition: Transition;
  enterDelay: number;
  instant: boolean;
}): MotionValue<number> {
  const progress = useMotionValue(instant ? target : 0);
  const enteredRef = useRef(false);
  const transitionKey = JSON.stringify(transition);

  useEffect(() => {
    if (instant) {
      progress.jump(target);
      enteredRef.current = true;
      return;
    }
    const delay = enteredRef.current ? 0 : enterDelay;
    enteredRef.current = true;
    const controls = animate(progress, target, { ...transition, delay });
    return () => controls.stop();
  }, [target, instant, transitionKey, enterDelay, progress]);

  return progress;
}
/** Subscribe to a motion value and run `apply` on mount + every change. */
export function useMotionValueApply(
  value: MotionValue<number>,
  apply: (v: number) => void
) {
  const applyRef = useRef(apply);
  useIsoLayoutEffect(() => {
    applyRef.current = apply;
    applyRef.current(value.get());
  });
  useMotionValueEvent(value, "change", (v) => applyRef.current(v));
}
/* -------------------------------------------------------------------------- */
/*                                   Ruler                                    */
/* -------------------------------------------------------------------------- */

export type GaugeRulerPosition = "inside" | "outside";
export interface GaugeRulerLabelOptions {
  /** `"majors"` labels every major tick; `"ends"` only the first and last */
  show?: "majors" | "ends";
  /** Domain the labels count across. Default 0 → 100 */
  min?: number;
  max?: number;
  format?: (value: number) => string;
  /** Default `var(--foreground)` at 72% opacity */
  color?: string;
}
export interface GaugeRulerOptions {
  /** `inside` (default) sits within the track; `outside` rings it */
  position?: GaugeRulerPosition;
  /** Number of intervals along the sweep (ticks = intervals + 1). Default 50 */
  ticks?: number;
  /** Every Nth tick is a major tick. Default 5 */
  majorEvery?: number;
  /** Tick colour. Default `var(--foreground)` */
  color?: string;
  /** Major tick length as a fraction of gauge size. Default 0.05 */
  majorLength?: number;
  /** Minor tick length as a fraction of gauge size. Default 0.028 */
  minorLength?: number;
  /** Gap between track and ruler as a fraction of gauge size. Default 0.028 */
  gap?: number;
  /** Brighten ticks up to the current value. Default true */
  highlightActive?: boolean;
  /** Numeric labels beside the major ticks */
  labels?: boolean | "majors" | "ends" | GaugeRulerLabelOptions;
}
export function resolveRulerLabels(
  labels: GaugeRulerOptions["labels"]
): GaugeRulerLabelOptions | null {
  if (!labels) {
    return null;
  }
  if (labels === true) {
    return { show: "majors" };
  }
  if (typeof labels === "string") {
    return { show: labels };
  }
  return labels;
}
export function rulerFontSize(size: number) {
  return Math.max(9, size * 0.034);
}
/** Radial space an outside ruler occupies beyond the track (px). */
export function rulerOutsideExtent(options: GaugeRulerOptions, size: number) {
  const { majorLength = 0.05, gap = 0.028 } = options;
  const labels = resolveRulerLabels(options.labels);
  return size * (gap + majorLength) + (labels ? rulerFontSize(size) * 1.8 : 0);
}
/* -------------------------------------------------------------------------- */
/*                                   Needle                                   */
/* -------------------------------------------------------------------------- */

export type GaugeNeedleVariant = "line" | "gradient" | "triangle" | "polygon";
export interface GaugeNeedleOptions {
  /**
   * `line` — solid rounded stroke · `gradient` — stroke that fades in toward
   * the tip · `triangle` — slim acute triangle · `polygon` — slender diamond.
   * Default `gradient`.
   */
  variant?: GaugeNeedleVariant;
  /** Default `var(--foreground)` */
  color?: string;
  /** Stroke width (line / gradient) or base width (triangle / polygon) in px */
  width?: number;
  /**
   * Needle length as a fraction of its reach (center → tip). `1` runs from
   * the pivot; shorter values float the needle clear of the center label.
   */
  length?: number;
  /** Draw a pivot cap at the center (best with `length` near 1). */
  pivot?: boolean;
  /**
   * Where the tip lands: just inside the track (`inner`, default), the
   * track's outer edge (`outer`), or past the outermost layer (`edge`).
   */
  tip?: "inner" | "outer" | "edge";
}
export function resolveNeedleOptions(
  needle: boolean | GaugeNeedleVariant | GaugeNeedleOptions | undefined
): GaugeNeedleOptions | null {
  if (!needle) {
    return null;
  }
  if (needle === true) {
    return {};
  }
  if (typeof needle === "string") {
    return { variant: needle };
  }
  return needle;
}
export function resolveRulerOptions(
  ruler: boolean | GaugeRulerOptions | undefined
): GaugeRulerOptions | null {
  if (!ruler) {
    return null;
  }
  return ruler === true ? {} : ruler;
}
