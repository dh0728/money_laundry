import React from 'react';
import { RingChart } from './charts/charts/ring/ring-chart';
import { Ring } from './charts/charts/ring/ring';
import { readChartNumber } from './charts/chart-design-values';

// RingChart and Ring are from the MIT-licensed Bklit UI ring-chart registry.
const percent = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 1 });
const count = new Intl.NumberFormat('ko-KR');

export function CompletionRing({ label, value, total, color = 'var(--review-status-done-accent)', reduced = false, size = readChartNumber('--completion-ring-default-size', 72), showValue = true }) {
  const hasTotal = total > 0;
  const progress = hasTotal ? Math.min(total, Math.max(0, value)) : 0;
  const text = hasTotal ? percent.format(progress / total) : '—';
  const padding = readChartNumber('--aml-space-2', 2);
  const strokeWidth = Math.max(readChartNumber('--aml-space-4', 4), Math.round(size / 12));
  const data = [{ label, value: progress, maxValue: hasTotal ? total : 1, color }];

  return <div className="completion-ring relative inline-grid shrink-0 place-items-center"
    role="img" aria-hidden={!showValue || undefined} aria-label={`${label} · 전체 ${count.format(total)}건 중 ${count.format(value)}건${hasTotal ? ` · ${text}` : ''}`}
    style={{ '--ring-chart-size': `${size}px` }}>
    <div aria-hidden="true" className="col-start-1 row-start-1">
      <RingChart data={data} size={size} strokeWidth={strokeWidth} padding={padding}
        baseInnerRadius={size / 2 - strokeWidth - padding} startAngle={0} endAngle={Math.PI * 2}
        geometryScrubbing={reduced} animationDuration={reduced ? 0 : undefined}>
        {!reduced && <Ring index={0} showGlow={false} />}
      </RingChart>
    </div>
    {showValue && <strong aria-hidden="true" className="completion-ring-value pointer-events-none z-10 col-start-1 row-start-1 tabular-nums"
      style={{ '--completion-ring-value-size': `${Math.max(readChartNumber('--completion-ring-min-value-size', 9), Math.round(size / 6))}px` }}>{text}</strong>}
  </div>;
}
