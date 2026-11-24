import { useMemo } from 'react';
import { arc } from 'd3-shape';

export function RiskBandRing({ values, size, radius, halfWidth, start, sweep }) {
  const center = size / 2;
  const [medium, high] = values;
  const bandArc = useMemo(() => {
    const angle = value => (start + value / 100 * sweep) * Math.PI / 180 + Math.PI / 2;
    return arc()
      .innerRadius(radius - halfWidth)
      .outerRadius(radius + halfWidth)
      .cornerRadius(halfWidth)
      .startAngle(([from]) => angle(from))
      .endAngle(([, to]) => angle(to));
  }, [halfWidth, radius, start, sweep]);
  return <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
    <g transform={`translate(${center} ${center})`}>
      {[[0, medium, 'low'], [medium, high, 'medium'], [high, 100, 'high']].map(([from, to, band]) =>
        <path key={band} fill={`var(--risk-${band})`} d={bandArc([from, to])} />)}
    </g>
  </svg>;
}
