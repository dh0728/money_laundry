import React, { useId, useState } from 'react';
import { readChartDurationSeconds, readChartNumber } from '../chart-design-values';
import './graph-flow-pulse.css';

export const readGraphFlowDuration = () => readChartDurationSeconds('--graph-flow-travel-duration', .56) * 1000;

export function readGraphCanvasPulse() {
  return {
    duration: readGraphFlowDuration(),
    revealDuration: readChartDurationSeconds('--graph-flow-reveal-duration', .48) * 1000,
    pulseLength: readChartNumber('--graph-flow-pulse-length', .16),
    fadeShare: readChartNumber('--graph-flow-canvas-fade-share', .12),
    width: readChartNumber('--graph-flow-canvas-width', 5),
    highlightWidth: readChartNumber('--graph-flow-highlight-width', 2),
  };
}

// 선 위를 계속 흐르는 표식(관계 그래프). 간격·속도는 화면 px 기준이다.
export function readGraphFlowMarkers() {
  return {
    spacing: readChartNumber('--graph-flow-marker-spacing', 64),
    speed: readChartNumber('--graph-flow-marker-speed', 36),
    markerRadius: readChartNumber('--graph-flow-marker-radius', 4.5),
    dotRadius: readChartNumber('--graph-flow-dot-radius', 3.5),
    dotOpacity: readChartNumber('--graph-flow-dot-opacity', .75),
    outline: readChartNumber('--graph-flow-marker-outline', 1.5),
    fadeShare: readChartNumber('--graph-flow-marker-fade-share', .08),
    denseEdges: readChartNumber('--graph-flow-marker-dense-edges', 40),
    badgeHeight: readChartNumber('--graph-shared-badge-height', 14),
    badgeWidth: readChartNumber('--graph-shared-badge-width', 42),
  };
}

export function GraphTransferParticle({ path, radius, duration }) {
  return <circle r={radius} fill="var(--foreground)" className="timeline-edge-particle" aria-hidden="true">
    <animateMotion dur={`${duration}ms`} repeatCount="indefinite" path={path} />
  </circle>;
}

export function GraphFlowReveal({ path, pulse, width, height, children }) {
  const id = useId();
  const [elapsed] = useState(() => performance.now() - pulse.startedAt);
  return <g mask={`url(#${id})`} data-graph-reveal="">
    <defs data-graph-transient="">
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}>
        <path className="graph-flow-reveal-mask" d={path} pathLength="1" fill="none" strokeLinecap="round"
          style={{ '--graph-flow-animation-delay': `-${Math.round(elapsed)}ms` }} />
      </mask>
    </defs>
    {children}
  </g>;
}

export function GraphFlowStroke({ path, pulse, color, width, ambientDelay = 0 }) {
  const [elapsed] = useState(() => pulse ? performance.now() - pulse.startedAt : 0);
  return <g className="graph-flow-pulse" data-ambient={!pulse || undefined}
    data-graph-transient="" aria-hidden="true" pointerEvents="none"
    style={{
      '--graph-flow-animation-delay': pulse ? `-${Math.round(elapsed)}ms` : `${ambientDelay}s`,
      '--graph-flow-link-width': width === undefined ? undefined : `${width}px`,
    }}>
    <path className="graph-flow-pulse-color" d={path} pathLength="1" stroke={color} />
    <path className="graph-flow-pulse-highlight" d={path} pathLength="1" />
  </g>;
}
