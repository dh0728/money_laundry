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
