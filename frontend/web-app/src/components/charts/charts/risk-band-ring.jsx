import { useMemo } from 'react';
import { arc } from 'd3-shape';

const bandRanges = ([medium, high]) => [[0, medium, 'low'], [medium, high, 'medium'], [high, 100, 'high']];

export function riskBandPoint(value, { size, radius, start, sweep }) {
  const angle = (start + value / 100 * sweep) * Math.PI / 180;
  return [size / 2 + Math.cos(angle) * radius, size / 2 + Math.sin(angle) * radius];
}

export function RiskBandArc({ values, design }) {
  const { size, radius, sweep } = design;
  return <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
    {bandRanges(values).map(([from, to, band]) => {
      const [startX, startY] = riskBandPoint(from, design);
      const [endX, endY] = riskBandPoint(to, design);
      const longArc = (to - from) * sweep > 18000 ? 1 : 0;
      return <path key={band} data-band={band} fill="none"
        d={`M ${startX} ${startY} A ${radius} ${radius} 0 ${longArc} 1 ${endX} ${endY}`} />;
    })}
  </svg>;
}

export function RiskBandRing({ values, size, radius, halfWidth, start, sweep }) {
  const center = size / 2;
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
      {bandRanges(values).map(([from, to, band]) =>
        <path key={band} fill={`var(--risk-${band})`} d={bandArc([from, to])} />)}
    </g>
  </svg>;
}
