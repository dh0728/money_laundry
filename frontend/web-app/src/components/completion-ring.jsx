import React from 'react';
import { RingChart } from './charts/charts/ring/ring-chart';
import { Ring } from './charts/charts/ring/ring';

// RingChart and Ring are from the MIT-licensed Bklit UI ring-chart registry.
const percent = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 1 });
const count = new Intl.NumberFormat('ko-KR');

export function CompletionRing({ label, value, total, color = 'var(--review-status-done-accent)', reduced = false, size = 72, showValue = true }) {
  const hasTotal = total > 0;
  const progress = hasTotal ? Math.min(total, Math.max(0, value)) : 0;
  const text = hasTotal ? percent.format(progress / total) : '—';
  const strokeWidth = Math.max(4, Math.round(size / 12));
  const data = [{ label, value: progress, maxValue: hasTotal ? total : 1, color }];

  return <div className="completion-ring relative inline-grid shrink-0 place-items-center"
    role="img" aria-hidden={!showValue || undefined} aria-label={`${label} · 전체 ${count.format(total)}건 중 ${count.format(value)}건${hasTotal ? ` · ${text}` : ''}`}
    style={{ width: size, height: size, '--border': 'var(--inner-surface)' }}>
    <div aria-hidden="true" className="col-start-1 row-start-1">
      <RingChart data={data} size={size} strokeWidth={strokeWidth} padding={2}
        baseInnerRadius={size / 2 - strokeWidth - 2} startAngle={0} endAngle={Math.PI * 2}
        geometryScrubbing={reduced} animationDuration={reduced ? 0 : undefined}>
        {!reduced && <Ring index={0} showGlow={false} />}
      </RingChart>
    </div>
    {showValue && <strong aria-hidden="true" className="pointer-events-none z-10 col-start-1 row-start-1 tabular-nums"
      style={{ fontSize: Math.max(9, Math.round(size / 6)) }}>{text}</strong>}
  </div>;
}
