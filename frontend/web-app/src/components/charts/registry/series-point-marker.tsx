"use client";

import { MotionGlobalConfig } from "motion/react";
import { memo, useLayoutEffect, useRef } from "react";
import { type SeriesPointMarkerStyle } from "./series-point-marker-shared";
import { DEFAULT_ANIMATION_EASING } from "./animation";

interface MarkerCirclesProps {
  fill?: string;
  stroke?: string;
  strokeWidth: number;
  ringGap: number;
  outlineWidth: number;
  outlineColor?: string;
  radius: number;
}

function MarkerCircles({
  fill,
  stroke,
  strokeWidth,
  ringGap,
  outlineWidth,
  outlineColor,
  radius,
}: MarkerCirclesProps) {
  const resolvedStroke = stroke ?? fill ?? "currentColor";
  const resolvedOutlineColor = outlineColor ?? resolvedStroke;
  const ringOuter = strokeWidth > 0 ? radius + ringGap + strokeWidth : radius;
  const outlineRadius = outlineWidth > 0 ? ringOuter + outlineWidth / 2 : 0;

  return (
    <>
      {outlineWidth > 0 ? (
        <circle
          cx={0}
          cy={0}
          fill="none"
          r={outlineRadius}
          stroke={resolvedOutlineColor}
          strokeWidth={outlineWidth}
        />
      ) : null}
      <circle cx={0} cy={0} fill={fill} r={radius} />
      {strokeWidth > 0 ? (
        <circle
          cx={0}
          cy={0}
          fill="none"
          r={radius + ringGap + strokeWidth / 2}
          stroke={resolvedStroke}
          strokeWidth={strokeWidth}
        />
      ) : null}
    </>
  );
}

export interface StaticSeriesPointMarkerProps extends SeriesPointMarkerStyle {
  cx: number;
  cy: number;
  scale?: number;
}

export const StaticSeriesPointMarker = memo(function StaticSeriesPointMarker({
  cx,
  cy,
  scale = 1,
  fill,
  stroke,
  strokeWidth = 2,
  ringGap = 2,
  outlineWidth = 0,
  outlineColor,
  radius = 5,
}: StaticSeriesPointMarkerProps) {
  // Plain dot (no ring / outline): one positioned circle instead of a
  // translated group, halving DOM nodes for large scatter plots. Scaling a
  // lone circle about its centre is the same as scaling its radius.
  if (strokeWidth <= 0 && outlineWidth <= 0) {
    return <circle cx={cx} cy={cy} fill={fill} r={radius * scale} />;
  }
  return (
    <g transform={`translate(${cx}, ${cy}) scale(${scale})`}>
      <MarkerCircles
        fill={fill}
        outlineColor={outlineColor}
        outlineWidth={outlineWidth}
        radius={radius}
        ringGap={ringGap}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    </g>
  );
});

export interface SeriesPointMarkerProps extends SeriesPointMarkerStyle {
  dataKey: string;
  index: number;
  cx: number;
  cy: number;
  revealDelay: number;
  revealEpoch: number;
  enterDuration: number;
}

/** Marker style once the enter fade has finished (what Motion left inline). */
const MARKER_ENTERED_STYLE = { opacity: 1, filter: "blur(0px)" } as const;

/**
 * Enter marker — used only while the chart reveal is running.
 *
 * The fade/unblur is a Web Animation, not a Motion component: same keyframes,
 * delay, duration and easing (`DEFAULT_ANIMATION_EASING` is the chart enter
 * curve `[0.85, 0, 0.15, 1]`), but run by the browser, so a reveal with many
 * markers costs no per-frame JS and no Motion visual element per point. The
 * element renders its entered style and the animation's `backwards` fill
 * holds the hidden keyframe through the delay, before first paint. Like
 * Motion's mount animation the timing is fixed when it starts (a new
 * `revealEpoch` replays it), and `MotionGlobalConfig.skipAnimations` (OG
 * screenshots) shows the end state.
 */
export function SeriesPointMarker({
  dataKey,
  index,
  cx,
  cy,
  enterBlur = 2,
  revealDelay,
  revealEpoch,
  enterDuration,
  fill,
  stroke,
  strokeWidth = 2,
  ringGap = 2,
  outlineWidth = 0,
  outlineColor,
  radius = 5,
}: SeriesPointMarkerProps) {
  const enterRef = useRef<SVGGElement>(null);
  const timingRef = useRef({ enterBlur, revealDelay, enterDuration });
  useLayoutEffect(() => {
    timingRef.current = { enterBlur, revealDelay, enterDuration };
  });

  // Replays per reveal epoch only; the timing is read when it starts.
  useLayoutEffect(() => {
    const element = enterRef.current;
    if (
      !element ||
      typeof element.animate !== "function" ||
      MotionGlobalConfig.skipAnimations ||
      MotionGlobalConfig.instantAnimations
    ) {
      return;
    }
    const timing = timingRef.current;
    const animation = element.animate(
      [
        { opacity: 0, filter: `blur(${timing.enterBlur}px)` },
        MARKER_ENTERED_STYLE,
      ],
      {
        delay: timing.revealDelay * 1000,
        duration: timing.enterDuration * 1000,
        easing: DEFAULT_ANIMATION_EASING,
        fill: "backwards",
      }
    );
    return () => animation.cancel();
  }, [revealEpoch]);

  return (
    <g transform={`translate(${cx}, ${cy})`}>
      <g
        key={`${dataKey}-${index}-${revealEpoch}`}
        ref={enterRef}
        style={MARKER_ENTERED_STYLE}
      >
        <MarkerCircles
          fill={fill}
          outlineColor={outlineColor}
          outlineWidth={outlineWidth}
          radius={radius}
          ringGap={ringGap}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      </g>
    </g>
  );
}
