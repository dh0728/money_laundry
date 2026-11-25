"use client";

import { m } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { readChartNumber } from "../chart-design-values";
import { ShimmeringText } from "../shimmering-text";
import {
  LINE_LOADING_PULSE_EASE,
  LOADING_LABEL_EXIT_S,
  LOADING_LABEL_EXIT_Y_PX,
} from "./line-loading-timing";

export interface ChartLoadingLabelProps {
  /** Label shown centered over the chart. */
  text?: string;
  className?: string;
  /** Animate down, fade, and blur during loading → ready handoff. */
  exiting?: boolean;
}

export function ChartLoadingLabel({
  text = "Loading",
  className,
  exiting = false,
}: ChartLoadingLabelProps) {
  const [exitBlur] = useState(() => readChartNumber("--aml-space-2", 2));
  if (!text.trim()) {
    return null;
  }

  return (
    <m.div
      animate={{
        y: exiting ? LOADING_LABEL_EXIT_Y_PX : 0,
        opacity: exiting ? 0 : 1,
        "--chart-loading-label-blur": exiting ? exitBlur : 0,
      }}
      aria-live="polite"
      className={cn(
        "chart-loading-label pointer-events-none absolute inset-0 flex items-center justify-center",
        className
      )}
      initial={false}
      role="status"
      transition={{
        duration: LOADING_LABEL_EXIT_S,
        ease: [...LINE_LOADING_PULSE_EASE],
      }}
    >
      <ShimmeringText
        className="whitespace-nowrap font-medium text-sm tracking-normal [--color:var(--muted-text)] [--shimmering-color:var(--text)]"
        text={text}
      />
    </m.div>
  );
}

export default ChartLoadingLabel;
