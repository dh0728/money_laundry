import React from 'react';
import { arc } from 'd3-shape';
import { ModelGraph } from './model-graph';
import { Box, Text } from '../../components/layout-primitives';

const start = 150;
const sweep = 240;
const center = 120;
const radius = 91;
const halfWidth = 4;
const angleAt = value => (start + value / 100 * sweep) * Math.PI / 180;
const bandArc = arc()
  .innerRadius(radius - halfWidth)
  .outerRadius(radius + halfWidth)
  .cornerRadius(halfWidth)
  .startAngle(([from]) => angleAt(from) + Math.PI / 2)
  .endAngle(([, to]) => angleAt(to) + Math.PI / 2);

function point(value, r = radius) {
  const angle = angleAt(value);
  return [center + Math.cos(angle) * r, center + Math.sin(angle) * r];
}

export function ModelRiskDial({ values, onChange, disabled }) {
  const [medium, high] = values;
  const labels = ['주의 시작 점수', '고위험 시작 점수'];
  return <Box className="model-risk-dial">
    <ModelGraph values={values} />
    <svg viewBox="0 0 240 240" aria-hidden="true">
      <g transform={`translate(${center} ${center})`}>
        {[[0, medium, 'low'], [medium, high, 'medium'], [high, 100, 'high']].map(([from, to, band]) =>
          <path key={band} fill={`var(--risk-${band})`} d={bandArc([from, to])} />)}
      </g>
    </svg>
    {values.map((value, index) => {
      const min = index === 0 ? 1 : medium + 1;
      const max = index === 0 ? high - 1 : 99;
      const [x, y] = point(value, high - medium < 7 ? radius + (index ? 20 : -20) : radius);
      const update = next => onChange(values.map((current, i) =>
        i === index ? Math.max(min, Math.min(max, next)) : current));
      return <Text as="span" key={index} role="slider" tabIndex={disabled ? undefined : 0} aria-label={labels[index]}
        aria-disabled={disabled || undefined} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value}점`}
        className="model-risk-slider-thumb" style={{ left: `${x / 2.4}%`, top: `${y / 2.4}%` }}
        onPointerDown={disabled ? undefined : event => {
          if (!event.isPrimary || event.button !== 0) return;
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={disabled ? undefined : event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const rect = event.currentTarget.parentElement.getBoundingClientRect();
          const x = event.clientX - rect.left - rect.width / 2;
          const y = event.clientY - rect.top - rect.height / 2;
          const relative = (Math.atan2(y, x) * 180 / Math.PI - start + 720) % 360;
          update(relative > (sweep + 360) / 2 ? 0 : Math.round(relative / sweep * 100));
        }}
        onKeyDown={disabled ? undefined : event => {
          const next = {
            ArrowLeft: value - 1, ArrowDown: value - 1, ArrowRight: value + 1, ArrowUp: value + 1,
            PageDown: value - 10, PageUp: value + 10, Home: min, End: max,
          }[event.key];
          if (next === undefined) return;
          event.preventDefault();
          update(next);
        }} />;
    })}
  </Box>;
}
