import React from 'react';
import { ScatterChart } from '../../components/charts/charts/scatter-chart';
import { Scatter } from '../../components/charts/charts/scatter';
import { Grid } from '../../components/charts/charts/grid';
import { GridColumns } from '../../components/charts/charts/grid-lines';
import { useChartStable } from '../../components/charts/charts/chart-context';
import { buildDataAlignedTicks } from '../../components/charts/charts/x-axis-ticks';
import { ChartTooltip } from '../../components/charts/charts/tooltip/chart-tooltip';
import { TooltipContent } from '../../components/charts/charts/tooltip/tooltip-content';
import { graphRiskBand } from './case-graph-scope';
import { getModelRiskThresholds, modelRiskLabels } from '../settings/model-risk-settings';

const colors = { high: 'var(--risk-high)', medium: 'var(--risk-medium)', low: 'var(--risk-low)' };
const scoreDomain = [0, 100];
const scoreTicks = [0, 25, 50, 75, 100];
const kstTick = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const kstDayTick = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const formatTick = date => kstTick.format(date);
const formatDayTick = date => kstDayTick.format(date);

export function overviewScorePoints(records) {
  const points = new Map();
  for (const { code, score, timestamp } of records) {
    const band = graphRiskBand(score);
    const date = new Date(typeof timestamp === 'string' ? timestamp.replace(' ', 'T') + '+09:00' : NaN);
    if (band === 'unknown' || !Number.isFinite(date.getTime()) || points.has(code)) continue;
    points.set(code, { code, timestamp, date, score, band, [band]: score });
  }
  return [...points.values()].sort((a, b) => a.date - b.date || a.code.localeCompare(b.code));
}

function ScoreAxis() {
  const { yScale } = useChartStable();
  return <g className="overview-score-axis" aria-hidden="true">
    {scoreTicks.map(value => <text key={value} x={-8} y={yScale(value)} dy="0.35em" textAnchor="end">{value}</text>)}
  </g>;
}

function ScoreTimeAxis() {
  const { data, dateLabels, innerWidth, innerHeight, xAccessor, xScale } = useChartStable();
  const gap = dateLabels.some(label => label.length > 5) ? 82 : 44;
  const targetTickCount = Math.min(5, Math.max(2, 1 + Math.floor(innerWidth / gap)));
  const candidates = buildDataAlignedTicks({ data, dateLabels, marginLeft: 0, targetTickCount, xAccessor, xScale });
  let previousX = -Infinity;
  const lastX = candidates.at(-1)?.x;
  const ticks = candidates.filter(({ x }, index) => {
    if (x - previousX < gap || (index > 0 && index < candidates.length - 1 && lastX - x < gap)) return false;
    previousX = x;
    return true;
  });
  return <g className="overview-score-time-axis" aria-hidden="true">
    <GridColumns className="overview-score-time-grid" height={innerHeight} scale={xScale}
      tickValues={ticks.map(tick => tick.date)} stroke="var(--overview-score-grid)" />
    <g className="overview-score-axis">
      {ticks.map(({ x, date, label }) => <text key={date.getTime()} x={x} y={innerHeight + 18}
        textAnchor={x < 1 ? 'start' : x > innerWidth - 1 ? 'end' : 'middle'}>{label}</text>)}
    </g>
  </g>;
}

export function OverviewScoreChart({ points, reduced, fill }) {
  if (!points.length) return <p className="overview-note">시각과 모델 점수를 함께 확인할 수 있는 거래가 없습니다.</p>;
  const labels = modelRiskLabels();
  const spansDays = points[0].timestamp.slice(0, 10) !== points.at(-1).timestamp.slice(0, 10);
  const thresholds = getModelRiskThresholds();
  return <figure className="overview-score-chart" aria-label="거래 시각별 모델 점수">
    <figcaption>거래 발생 시각 · KST</figcaption>
    <ScatterChart data={points} aspectRatio="auto" className={fill ? 'overview-score-plot' : 'overview-score-compact'}
      formatXLabel={spansDays ? formatDayTick : formatTick}
      jitter={{ x: 0.2, y: 0 }} yDomain={scoreDomain} margin={{ top: 16, right: 16, bottom: 34, left: 34 }}
      animationDuration={reduced ? 0 : 320} enterTransition={reduced ? { duration: 0 } : undefined}>
      <Grid horizontal rowTickValues={scoreTicks.filter(value => !thresholds.includes(value))}
        stroke="var(--overview-score-grid)" strokeDasharray="0" fadeHorizontal={false}
        highlightRowValues={thresholds} highlightRowStroke="var(--overview-score-threshold)" highlightRowStrokeDasharray="4,4" />
      <ScoreTimeAxis />
      {Object.entries(colors).map(([band, fill]) => <Scatter key={band} dataKey={band} fill={fill} radius={5} />)}
      <ScoreAxis />
      <ChartTooltip showDatePill={false} content={({ point }) => <TooltipContent
        title={point.code} rows={[
          { label: '거래 시각', value: `${point.timestamp} KST`, color: 'var(--muted-text)' },
          { label: '모델 점수', value: `${point.score}점`, color: colors[point.band] },
        ]} />} />
    </ScatterChart>
    <ul className="overview-score-legend" aria-label="모델 점수 범례">
      {['low', 'medium', 'high'].map(band => <li key={band}><i style={{ background: colors[band] }} />{labels[band]}</li>)}
    </ul>
  </figure>;
}
