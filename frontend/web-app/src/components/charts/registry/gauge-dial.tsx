"use client";

import {
  type MotionValue,
} from "motion/react";
import { clamp01, useMotionValueApply, type GaugeRulerOptions, resolveRulerLabels, rulerFontSize, type GaugeNeedleVariant, type GaugeNeedleOptions } from "./gauge-dial-shared";
import {
  type ReactNode,
  useId,
  useRef,
} from "react";
/* -------------------------------------------------------------------------- */
/*                                   Ruler                                    */
/* -------------------------------------------------------------------------- */
const RULER_OPACITY = {
  majorLit: 0.95,
  majorDim: 0.32,
  minorLit: 0.55,
  minorDim: 0.16,
} as const;

export function GaugeRuler({
  cx,
  cy,
  size,
  anchorRadius,
  startAngle,
  endAngle,
  progress,
  options,
}: {
  cx: number;
  cy: number;
  size: number;
  /** Track edge the ruler hangs from (inner edge for inside, outer for outside) */
  anchorRadius: number;
  startAngle: number;
  endAngle: number;
  progress: MotionValue<number>;
  options: GaugeRulerOptions;
}) {
  const {
    position = "inside",
    ticks = 50,
    majorEvery = 5,
    color = "var(--foreground)",
    majorLength = 0.05,
    minorLength = 0.028,
    gap = 0.028,
    highlightActive = true,
  } = options;
  const labels = resolveRulerLabels(options.labels);
  const intervals = Math.max(1, Math.round(ticks));
  const every = Math.max(1, Math.round(majorEvery));
  const dir = position === "outside" ? 1 : -1;
  const rStart = anchorRadius + dir * size * gap;
  const refs = useRef<(SVGLineElement | null)[]>([]);

  useMotionValueApply(progress, (p) => {
    for (let j = 0; j <= intervals; j++) {
      const el = refs.current[j];
      if (!el) {
        continue;
      }
      const major = j % every === 0;
      const dim = major ? RULER_OPACITY.majorDim : RULER_OPACITY.minorDim;
      const lit = major ? RULER_OPACITY.majorLit : RULER_OPACITY.minorLit;
      // Ramp over half an interval so ticks light as the fill reaches them.
      const t = highlightActive
        ? clamp01((p - j / intervals) * intervals * 2 + 1)
        : 0;
      el.setAttribute("stroke-opacity", String(dim + (lit - dim) * t));
    }
  });

  const sweep = endAngle - startAngle;
  const fontSize = rulerFontSize(size);
  const labelRadius =
    rStart + dir * (size * majorLength + fontSize * (dir > 0 ? 1 : 1.1));
  const min = labels?.min ?? 0;
  const max = labels?.max ?? 100;
  const format =
    labels?.format ?? ((v: number) => String(Math.round(v * 100) / 100));

  return (
    <g>
      {Array.from({ length: intervals + 1 }, (_, j) => {
        const major = j % every === 0;
        const rad = ((startAngle + (j / intervals) * sweep) * Math.PI) / 180;
        const len = size * (major ? majorLength : minorLength);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        return (
          <line
            key={j}
            ref={(el) => {
              refs.current[j] = el;
            }}
            stroke={color}
            strokeLinecap="round"
            strokeOpacity={
              major ? RULER_OPACITY.majorDim : RULER_OPACITY.minorDim
            }
            strokeWidth={major ? 1.75 : 1}
            x1={cx + cos * rStart}
            x2={cx + cos * (rStart + dir * len)}
            y1={cy + sin * rStart}
            y2={cy + sin * (rStart + dir * len)}
          />
        );
      })}
      {labels
        ? Array.from({ length: intervals + 1 }, (_, j) => {
            const isEnd = j === 0 || j === intervals;
            const show =
              labels.show === "ends" ? isEnd : j % every === 0 || isEnd;
            if (!show) {
              return null;
            }
            const t = j / intervals;
            const rad = ((startAngle + t * sweep) * Math.PI) / 180;
            return (
              <text
                dominantBaseline="central"
                fill={labels.color ?? "var(--foreground)"}
                fillOpacity={labels.color ? 1 : 0.72}
                fontSize={fontSize}
                key={`label-${j}`}
                style={{ fontVariantNumeric: "tabular-nums" }}
                textAnchor="middle"
                x={cx + Math.cos(rad) * labelRadius}
                y={cy + Math.sin(rad) * labelRadius}
              >
                {format(min + t * (max - min))}
              </text>
            );
          })
        : null}
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Needle                                   */
/* -------------------------------------------------------------------------- */
const NEEDLE_DEFAULT_WIDTH: Record<GaugeNeedleVariant, number> = {
  line: 2.5,
  gradient: 4,
  triangle: 10,
  polygon: 8,
};

export function GaugeNeedle({
  cx,
  cy,
  reach,
  startAngle,
  endAngle,
  progress,
  options,
}: {
  cx: number;
  cy: number;
  /** Distance from center to needle tip */
  reach: number;
  startAngle: number;
  endAngle: number;
  progress: MotionValue<number>;
  options: GaugeNeedleOptions;
}) {
  const {
    variant = "gradient",
    color = "var(--foreground)",
    width = NEEDLE_DEFAULT_WIDTH[variant],
    length = 0.55,
    pivot = false,
  } = options;
  const gradientId = `gauge-needle-${useId().replace(/:/g, "")}`;
  const groupRef = useRef<SVGGElement>(null);

  const angleAt = (p: number) => startAngle + p * (endAngle - startAngle);
  const transformAt = (p: number) =>
    `translate(${cx} ${cy}) rotate(${angleAt(p)})`;

  useMotionValueApply(progress, (p) => {
    groupRef.current?.setAttribute("transform", transformAt(p));
  });

  const tip = reach;
  const base = reach * (1 - Math.min(1, Math.max(0.05, length)));
  const span = tip - base;
  const half = width / 2;

  let shape: ReactNode;
  switch (variant) {
    case "line":
      shape = (
        <line
          stroke={color}
          strokeLinecap="round"
          strokeWidth={width}
          // Keep the round caps inside [base, tip] so the tip never overruns.
          x1={base + half}
          x2={tip - half}
          y1={0}
          y2={0}
        />
      );
      break;
    case "gradient":
      shape = (
        <>
          <defs>
            <linearGradient
              gradientUnits="userSpaceOnUse"
              id={gradientId}
              x1={base}
              x2={tip}
              y1={0}
              y2={0}
            >
              <stop offset="0%" stopColor={color} stopOpacity={0} />
              <stop offset="70%" stopColor={color} stopOpacity={0.7} />
              <stop offset="100%" stopColor={color} stopOpacity={1} />
            </linearGradient>
          </defs>
          {/* Tapered body so the fade reads as light, not a cut-off stroke */}
          <path
            d={`M ${base} ${-half * 0.35} L ${tip - half} ${-half} A ${half} ${half} 0 0 1 ${tip - half} ${half} L ${base} ${half * 0.35} Z`}
            fill={`url(#${gradientId})`}
          />
        </>
      );
      break;
    case "triangle":
      shape = (
        <polygon
          fill={color}
          points={`${base},${-half} ${tip},0 ${base},${half}`}
          stroke={color}
          strokeLinejoin="round"
          strokeWidth={1.25}
        />
      );
      break;
    case "polygon": {
      const shoulder = base + span * 0.22;
      shape = (
        <polygon
          fill={color}
          points={`${base},0 ${shoulder},${-half} ${tip},0 ${shoulder},${half}`}
          stroke={color}
          strokeLinejoin="round"
          strokeWidth={1.25}
        />
      );
      break;
    }
    default:
      shape = null;
  }

  return (
    <g>
      <g ref={groupRef} transform={transformAt(progress.get())}>
        {shape}
      </g>
      {pivot ? (
        <>
          <circle cx={cx} cy={cy} fill={color} r={Math.max(4, width * 0.9)} />
          <circle
            cx={cx}
            cy={cy}
            fill="var(--background)"
            r={Math.max(1.5, width * 0.35)}
          />
        </>
      ) : null}
    </g>
  );
}
