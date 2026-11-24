import { useState } from 'react';
import { RiskBandRing } from '../../components/charts/charts/risk-band-ring';
import { readChartNumber } from '../../components/charts/chart-design-values';
import { ModelRiskSphere } from '../../components/charts/charts/model-risk-sphere';
import { Box, Text } from '../../components/layout-primitives';

export function ModelRiskDial({ values, onChange, disabled }) {
  const [design] = useState(() => ({
    size: readChartNumber('--model-risk-dial-units', 240),
    start: readChartNumber('--model-risk-dial-start-angle', 150),
    sweep: readChartNumber('--model-risk-dial-sweep-angle', 240),
    radius: readChartNumber('--model-risk-dial-band-radius', 91),
    halfWidth: readChartNumber('--model-risk-dial-band-half-width', 4),
    closeRange: readChartNumber('--model-risk-thumb-close-range', 7),
    separatedInset: readChartNumber('--model-risk-thumb-separated-inset', 20),
  }));
  const { size, start, sweep, radius, closeRange, separatedInset } = design;
  const center = size / 2;
  const [medium, high] = values;
  const labels = ['주의 시작 점수', '고위험 시작 점수'];
  return <Box className="model-risk-dial">
    <ModelRiskSphere values={values} />
    <RiskBandRing values={values} size={size} start={start} sweep={sweep} radius={radius} halfWidth={design.halfWidth} />
    {values.map((value, index) => {
      const min = index === 0 ? 1 : medium + 1;
      const max = index === 0 ? high - 1 : 99;
      const knobRadius = high - medium < closeRange ? radius + (index ? separatedInset : -separatedInset) : radius;
      const angle = (start + value / 100 * sweep) * Math.PI / 180;
      const x = center + Math.cos(angle) * knobRadius;
      const y = center + Math.sin(angle) * knobRadius;
      const update = next => onChange(values.map((current, i) =>
        i === index ? Math.max(min, Math.min(max, next)) : current));
      return <Text as="span" key={index} role="slider" tabIndex={disabled ? undefined : 0} aria-label={labels[index]}
        aria-disabled={disabled || undefined} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value}점`}
        className="model-risk-slider-thumb"
        style={{ '--model-risk-thumb-x': `${x / (size / 100)}%`, '--model-risk-thumb-y': `${y / (size / 100)}%` }}
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
