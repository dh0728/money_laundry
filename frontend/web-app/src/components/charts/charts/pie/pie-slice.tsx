"use client";

import { m, useTransform } from "motion/react";
import { memo, type CSSProperties } from "react";
import { arcPath } from "./arc-path";
import { usePieHover, usePieStable } from "./pie-context";
import { useEnterComplete } from "./use-enter-complete";
import { useMountProgress } from "../use-mount-progress";
import "./pie-slice.css";

// 마우스를 올려도 조각 모양·위치·투명도는 바뀌지 않는다. 튀어나오기·커지기·다른 조각 흐리기 효과는
// 대시보드·Alert 개요의 원형 차트가 움찔거리고 색이 바뀌어 보이던 원인이라 없앴다. 처음 그릴 때 차오르는 효과만 남긴다.

// `m.path` uses `initial={false}`: Motion can't read `d` back from an SVG path,
// so without it the first frame animates from `undefined` (console warning + an invalid `d="undefined"` attribute).

export interface PieSliceProps {
  /** Index of the slice in the data array */
  index: number;
  /** Optional color override - falls back to data color or palette */
  color?: string;
  /** Optional fill override for patterns/gradients (e.g., "url(#patternId)") */
  fill?: string;
  /** Animate the slice on mount. Default: true */
  animate?: boolean;
  /** Show glow effect on hover. Default: false */
  showGlow?: boolean;
  /** Additional CSS class */
  className?: string;
}

interface AnimatedSliceProps {
  index: number;
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  endAngle: number;
  cornerRadius: number;
  padAngle: number;
  fill: string;
  animationKey: number;
}

// 처음 그릴 때 12시 방향에서 끝 각도까지 차오른다. 다 그린 뒤에는 고정된 모양이다.
function AnimatedSlice({
  index,
  innerRadius,
  outerRadius,
  startAngle,
  endAngle,
  cornerRadius,
  padAngle,
  fill,
  animationKey,
}: AnimatedSliceProps) {
  const {
    enterTransition,
    enterStaggerScale,
    animationKey: pieAnimationKey,
  } = usePieStable();
  const animationDelay = (0.1 + index * 0.08) * enterStaggerScale;
  const mountProgress = useMountProgress(
    enterTransition,
    animationDelay,
    pieAnimationKey
  );
  const enterComplete = useEnterComplete(mountProgress);

  const animatedPath = useTransform(mountProgress, (mount) => {
    const currentEndAngle = startAngle + (endAngle - startAngle) * mount;
    if (currentEndAngle <= startAngle + 0.01) {
      return "";
    }
    return arcPath(
      innerRadius,
      outerRadius,
      startAngle,
      currentEndAngle,
      cornerRadius,
      padAngle
    );
  });

  if (enterComplete) {
    return (
      <path
        d={arcPath(innerRadius, outerRadius, startAngle, endAngle, cornerRadius, padAngle)}
        fill={fill}
        pointerEvents="none"
        className="pie-slice-visual"
      />
    );
  }

  return (
    <m.path
      d={animatedPath}
      fill={fill}
      initial={false}
      key={`slice-${animationKey}-${index}`}
      pointerEvents="none"
      className="pie-slice-visual"
    />
  );
}

export const PieSlice = memo(function PieSlice({
  index,
  color: colorProp,
  fill: fillProp,
  animate = true,
  showGlow = false,
}: PieSliceProps) {
  const {
    arcs,
    innerRadius,
    outerRadius,
    cornerRadius,
    animationKey,
    geometryScrubbing,
    scrubSlicePaths,
    getColor,
    getFill,
  } = usePieStable();
  const { hoveredIndex, setHoveredIndex } = usePieHover();

  const arcData = arcs[index];
  if (!arcData) {
    return null;
  }

  const color = colorProp || getColor(index);
  const fill = fillProp || getFill(index);

  if (geometryScrubbing) {
    const scrubPath = scrubSlicePaths?.[index];
    if (!scrubPath) {
      return null;
    }
    return <path d={scrubPath} fill={fill} pointerEvents="none" />;
  }

  const isHovered = hoveredIndex === index;
  const slicePath = arcPath(
    innerRadius,
    outerRadius,
    arcData.startAngle,
    arcData.endAngle,
    cornerRadius,
    arcData.padAngle
  );

  return (
    <g className="pie-slice" data-pie-slice-glow={showGlow && isHovered ? "" : undefined}
      style={{ "--pie-slice-glow-color": showGlow ? color : undefined } as CSSProperties}>
      {/* Invisible hitbox - reports which slice is under the pointer (tooltips, glow) */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: SVG path used as hover hitbox for visualization */}
      <path
        d={slicePath}
        fill="transparent"
        onMouseEnter={() => setHoveredIndex(index)}
        onMouseLeave={() => setHoveredIndex(null)}
      />

      {animate ? (
        <AnimatedSlice
          animationKey={animationKey}
          cornerRadius={cornerRadius}
          endAngle={arcData.endAngle}
          fill={fill}
          index={index}
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          padAngle={arcData.padAngle}
          startAngle={arcData.startAngle}
        />
      ) : (
        <path d={slicePath} fill={fill} pointerEvents="none" className="pie-slice-visual" />
      )}
    </g>
  );
});

PieSlice.displayName = "PieSlice";

export default PieSlice;
