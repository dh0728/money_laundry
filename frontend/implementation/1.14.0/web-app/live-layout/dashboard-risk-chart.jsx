import React, { useRef } from 'react';
import { PieChart } from './bklit/charts/pie/pie-chart';
import { PieSlice } from './bklit/charts/pie/pie-slice';
import { useElementSize } from './bklit/charts/use-element-size';

// PieChart and PieSlice are from the MIT-licensed Bklit UI pie-chart registry.
const count = new Intl.NumberFormat('ko-KR');
const share = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 1 });

export function DashboardRiskChart({ segments, reduced = false, label = '모델 의심 거래의 위험 점수 구간', totalLabel = '전체 건수' }) {
  const data = segments.filter(({ value }) => value > 0);
  const total = data.reduce((sum, point) => sum + point.value, 0);
  const plot = useRef(null);
  const { width, height } = useElementSize(plot, 10);
  const size = Math.floor(Math.min(width, height)) || 144;

  return <figure className="dashboard-risk-chart" aria-label={label}>
    <div className="dashboard-donut-plot" ref={plot}>
      <div className="dashboard-donut-ring" style={{ width: size, height: size }}>
        {total > 0 ? <div aria-hidden="true" className="col-start-1 row-start-1">
          <PieChart data={data} size={size} innerRadius={Math.round(size * 0.326)} cornerRadius={6} padAngle={0.045} hoverOffset={4}
            startAngle={0} endAngle={Math.PI * 2} geometryScrubbing={reduced}>
            {!reduced && data.map(({ label }, index) => <PieSlice key={label} index={index} />)}
          </PieChart>
        </div> : <div aria-hidden="true" className="col-start-1 row-start-1 rounded-full"
          style={{ width: size - 8, height: size - 8, border: `${Math.round(size * 0.146)}px solid var(--inner-surface)` }} />}
        <div className="dashboard-donut-center">
          <strong className="tabular-nums" style={{ fontSize: 'var(--aml-type-page-title-size)', lineHeight: 1.1 }}>{count.format(total)}</strong>
          <span style={{ color: 'var(--muted-text)', fontSize: 'var(--aml-type-caption-size)' }}>{totalLabel}</span>
        </div>
      </div>
    </div>
    <ul className="dashboard-risk-legend">
      {segments.map(({ label, value, color }) => <li key={label}>
        <i aria-hidden="true" className="rounded-full"
          style={{ inlineSize: 'var(--aml-space-8)', blockSize: 'var(--aml-space-8)', backgroundColor: color }} />
        <span>{label}</span>
        <strong>{count.format(value)}건</strong>
        <span style={{ color: 'var(--muted-text)' }}>{total > 0 ? share.format(value / total) : '—'}</span>
      </li>)}
    </ul>
  </figure>;
}
