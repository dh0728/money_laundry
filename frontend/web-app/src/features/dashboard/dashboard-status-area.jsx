import React, { useState } from 'react';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { AreaChart } from '../../components/charts/charts/area-chart';
import { Area } from '../../components/charts/charts/area';
import { curveLinear } from '../../components/charts/charts/line-path-geometry';
import { Grid } from '../../components/charts/charts/grid';
import { XAxis } from '../../components/charts/charts/x-axis';
import { ChartTooltip } from '../../components/charts/charts/tooltip/chart-tooltip';
import { TooltipContent } from '../../components/charts/charts/tooltip/tooltip-content';

// AreaChart and Area are from the MIT-licensed Bklit UI area-chart registry.
const integer = new Intl.NumberFormat('ko-KR');
const count = value => `${integer.format(value)}건`;
const topKey = key => `${key}StackTop`;
const bottomKey = key => `${key}StackBottom`;

function stackedDays(rows, series) {
  const points = rows.map(row => {
    const point = { ...row, plotDay: new Date(`${row.date}T12:00:00+09:00`) };
    let total = 0;
    for (const { key } of series) {
      point[bottomKey(key)] = total;
      total += row[key];
      point[topKey(key)] = total;
    }
    return point;
  });
  if (points.length !== 1) return points;
  // A single observation spans the chart; the tooltip and accessible table still use its real date.
  const [point] = points;
  const halfDay = 12 * 60 * 60 * 1000;
  return [-halfDay, 0, halfDay].map(offset => ({
    ...point, plotDay: new Date(point.plotDay.getTime() + offset), label: offset ? '' : point.label,
  }));
}

export function DashboardStatusArea({ rows, series, completion, reduced = false }) {
  const [active, setActive] = useState(null);
  const points = stackedDays(rows, series);
  const activeRow = active === null ? undefined : rows[active];
  const readoutSeries = [...series, completion];

  function browseDates(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -1 : 1;
    setActive(index => Math.max(0, Math.min(rows.length - 1, (index ?? 0) + delta)));
  }

  return <figure className="dashboard-series dashboard-status-series" aria-label="일별 Alert 처리 상태와 종결 건수 · KST">
    <div className="dashboard-status-area" role="group" aria-label="왼쪽과 오른쪽 방향키로 날짜별 집계 확인"
      tabIndex={0} onKeyDown={browseDates}
      onFocus={() => setActive(index => index ?? 0)} onBlur={() => setActive(null)}>
      <AreaChart data={points} xDataKey="plotDay" animationDuration={reduced ? 0 : 340}
        yDomainTween={false} margin={{ top: 10, right: 20, bottom: 26, left: 20 }}>
        <Grid horizontal numTicksRows={5} fadeHorizontal={false} />
        {series.map(({ key, color, label }) => <Area key={key} dataKey={topKey(key)} baselineDataKey={bottomKey(key)}
          fill={color} stroke={color} strokeWidth={2} fillOpacity={0.56} gradientToOpacity={0.24}
          showLine={rows.some(row => row[key] > 0)} showHighlight={false} animate={!reduced} aria-label={label} />)}
        <Area dataKey={completion.key} stroke={completion.color} strokeWidth={2} fillOpacity={0}
          curve={curveLinear} dashFromIndex={0} dashArray="5,4" showHighlight={false}
          showLine={rows.some(row => row[completion.key] > 0)} animate={!reduced} />
        <XAxis labels={points.map(point => point.label)} tickerHalfWidth={0} numTicks={{ base: 5, sm: 8 }} />
        <ChartTooltip showCrosshair showDatePill={false} showDots={false} damping={reduced ? 0 : 25}
          content={({ point }) => <TooltipContent title={`${point.date} KST`} rows={readoutSeries.map(({ key, label, color }) => ({
            label, color, value: count(point[key]),
          }))} />} />
      </AreaChart>
    </div>
    <div className="dashboard-status-readout" aria-live="polite">
      {activeRow && <><span>{activeRow.date} KST</span>{readoutSeries.map(item => <span key={item.key}>
        <i style={{ background: item.color }} aria-hidden="true" />{item.label} {count(activeRow[item.key])}
      </span>)}</>}
    </div>
    <div className="visually-hidden">
      <Table>
        <TableCaption>생성일별 Alert 처리 상태와 종결일별 종결 건수</TableCaption>
        <TableHeader><TableRow><TableHead scope="col">일자</TableHead>{readoutSeries.map(item => <TableHead scope="col" key={item.key}>{item.label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{rows.map(row => <TableRow key={row.date}><TableHead scope="row">{row.date}</TableHead>
          {readoutSeries.map(item => <TableCell key={item.key}>{count(row[item.key])}</TableCell>)}</TableRow>)}</TableBody>
      </Table>
    </div>
  </figure>;
}
