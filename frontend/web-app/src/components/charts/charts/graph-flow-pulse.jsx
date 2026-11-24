import React, { useId, useState } from 'react';
import './graph-flow-pulse.css';

export const graphFlowDuration = 560;
export const graphRevealDuration = 480;

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
        <path className="graph-flow-reveal-mask" d={path} pathLength="1" fill="none" stroke="white"
          strokeWidth="36" strokeLinecap="round"
          style={{ animationDuration: `${graphRevealDuration}ms`, animationDelay: `-${Math.round(elapsed)}ms` }} />
      </mask>
    </defs>
    {children}
  </g>;
}

export function GraphFlowStroke({ path, pulse, color, width = 4, ambientDelay = 0 }) {
  const [elapsed] = useState(() => pulse ? performance.now() - pulse.startedAt : 0);
  return <g className="graph-flow-pulse" data-ambient={!pulse || undefined}
    data-graph-transient="" aria-hidden="true" pointerEvents="none"
    style={pulse ? { animationDuration: `${graphFlowDuration}ms`, animationDelay: `-${Math.round(elapsed)}ms` }
      : { animationDelay: `${ambientDelay}s` }}>
    <path d={path} pathLength="1" stroke={color} strokeWidth={width} strokeOpacity=".9" />
    <path d={path} pathLength="1" stroke="white" strokeWidth={Math.min(2, width / 2)} />
  </g>;
}
