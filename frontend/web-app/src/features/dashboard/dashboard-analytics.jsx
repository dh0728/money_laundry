import React from 'react';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Panel } from '../../components/panel';
import { PatternTag, ReviewStatusTag, reviewStates } from '../../components/semantic-tags';
import { DashboardRiskChart } from './dashboard-risk-chart';
import { DashboardStatusArea } from './dashboard-status-area';
import { BarChart } from '../../components/charts/charts/bar-chart';
import { Bar } from '../../components/charts/charts/bar';
import { BarXAxis } from '../../components/charts/charts/bar-x-axis';
import { Grid } from '../../components/charts/charts/grid';
import { ChartTooltip } from '../../components/charts/charts/tooltip/chart-tooltip';
import { ibmLaundering, ibmPatterns, ibmRemaining } from '../investigation/ibm-hi-small-aggregate';
import { SectionDownloadHeading } from '../../components/section-download';
import { dashboardPattern } from '../../mocks/dashboard-patterns';

const integer = new Intl.NumberFormat('ko-KR');
const count = value => `${integer.format(value)}건`;
const smallPercent = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 3 });
const share = (value, total) => total ? smallPercent.format(value / total) : '—';

function volumeAxisLabel(point, label) {
  return <span className="dashboard-volume-axis">{label}<small>{share(point.labeled, point.total)}</small></span>;
}

function DailySeries({ rows, series, reduced, label, showShare = false, detail, stacked = true }) {
  const columns = detail ?? series.map(item => ({ label: item.label, value: row => count(row[item.key]), color: item.color }));
  return <figure className="dashboard-series" aria-label={label}>
    <div className="dashboard-series-plot">
      <BarChart className="dashboard-bklit-series" data={rows} xDataKey="label" stacked={stacked}
        margin={{ top: 6, right: 4, bottom: showShare ? 42 : 28, left: 4 }} barGap={rows.length === 1 ? 0.94 : undefined}
        animationDuration={reduced ? 0 : 340}>
        <Grid horizontal />
        {series.map(item => <Bar key={item.key} dataKey={item.key} fill={item.color}
          lineCap="round" groupGap={2} animate={!reduced} />)}
        <BarXAxis maxLabels={showShare ? { base: 4, sm: 10, lg: 18 } : 14} tickerHalfWidth={0}
          formatLabel={showShare ? volumeAxisLabel : undefined} />
        <ChartTooltip showCrosshair showDatePill={false} showDots={false} damping={reduced ? 0 : 25}
          rows={point => columns.map(column => ({
            label: column.label, color: column.color, value: column.value(point),
          }))} />
      </BarChart>
    </div>
    <div className="visually-hidden">
      <Table>
        <TableCaption>일별 수치</TableCaption>
        <TableHeader><TableRow><TableHead scope="col">일자</TableHead>{columns.map(column => <TableHead scope="col" key={column.label}>{column.label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{rows.map(row => <TableRow key={row.label}><TableHead scope="row">{row.label}</TableHead>
          {columns.map(column => <TableCell key={column.label}>{column.value(row)}</TableCell>)}</TableRow>)}</TableBody>
      </Table>
    </div>
  </figure>;
}

function ChartPanel({ title, note, children, className = '', hasChart = true }) {
  return <Panel as="article" className={`glass dashboard-chart ${className}`}>
    <SectionDownloadHeading downloadLabel={hasChart ? title : undefined}>{title}</SectionDownloadHeading>
    {note && <p className="dashboard-note">{note}</p>}
    {children}
  </Panel>;
}

function CompositionLegend({ segments, total, label }) {
  return <ul className="dashboard-composition-legend" aria-label={label}>
    {segments.map(({ label, tone, value }) => <li key={label} data-segment={tone}>
      <i aria-hidden="true" />
      <span>{label}</span>
      <strong>{count(value)}</strong>
      <span>{share(value, total)}</span>
    </li>)}
  </ul>;
}

const segmentInk = tone => `var(--segment-${tone})`;
const noMargin = { top: 0, right: 0, bottom: 0, left: 0 };
const launderingBarScale = 500;

function ProportionBar({ label, segments, total, orientation = 'horizontal' }) {
  if (!total) return <div className="dashboard-proportion-empty" aria-hidden="true" />;

  const horizontal = orientation === 'horizontal';
  const displayTotal = segments.reduce((sum, { value, visualScale = 1 }) => sum + value * visualScale, 0);
  const point = { label, ...Object.fromEntries(segments.map(({ tone, value, visualScale = 1 }) =>
    [tone, value * visualScale / (horizontal ? 1 : displayTotal)])) };
  return <BarChart className="dashboard-proportion-band" data={[point]} xDataKey="label"
    margin={noMargin} horizontalValueDomain={horizontal ? [0, displayTotal] : undefined}
    orientation={orientation} stacked barGap={0} animationDuration={0}>
    {segments.map(({ tone }) => <Bar key={tone} dataKey={tone} fill={segmentInk(tone)}
      lineCap="round" animate={false} fadedOpacity={1} />)}
    <ChartTooltip showDatePill={false} showDots={false} damping={0}
      rows={() => segments.map(({ tone, label, value }) => ({
        label, value: `${count(value)} · ${share(value, total)}`, color: segmentInk(tone),
      }))} />
  </BarChart>;
}

function TransactionSummary({ title, note, composition, children, hasChart }) {
  return <ChartPanel title={title} note={note} hasChart={hasChart}>
    <div className="dashboard-transaction-details">
      <section className="dashboard-transaction-breakdown" aria-label="전체 거래 구성">
        {composition}
      </section>
      {children}
    </div>
  </ChartPanel>;
}

function TransactionComposition({ total, labeled }) {
  const overview = [
    { label: '그 외 거래', tone: 'other', value: total - labeled },
    { label: '세탁 라벨 거래', tone: 'suspect', value: labeled, visualScale: launderingBarScale },
  ];
  return <>
    <div className="dashboard-composition-chart">
      <CompositionLegend segments={overview} total={total} label="전체 거래 기준" />
      <ProportionBar label="전체 거래" segments={overview} total={total} orientation="vertical" />
    </div>
    <p className="dashboard-note">세탁 라벨 막대만 ×{launderingBarScale} 확대 · 표시 건수와 비율은 원본 기준</p>
  </>;
}

const patternRows = [...ibmPatterns, ...ibmRemaining];
function ReferencePattern({ id }) {
  return <defs>
    <pattern id={id} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="7" height="7" fill="var(--chart-total)" />
      <path d="M 0 0 V 7" stroke="var(--chart-pattern-reference)" strokeWidth="2" />
    </pattern>
  </defs>;
}

function TransactionPatterns({ reduced, label = '의심 거래 유형별 건수', rows = patternRows,
  total = ibmLaundering, seriesLabel = '원본 세탁 라벨 거래' }) {
  const patternId = React.useId();
  const points = rows.map(({ label, value }) => {
    const { name, supported } = dashboardPattern(label);
    return { label: name, value, supported };
  }).sort((left, right) => Number(right.supported) - Number(left.supported) || right.value - left.value);
  const hasReference = points.some(row => !row.supported);
  return <section className="dashboard-transaction-breakdown" aria-label={label}>
    <p className="dashboard-note">{seriesLabel} {count(total)} 기준</p>
    {!rows.length ? <p className="dashboard-note">조회 조건에 해당하는 유형이 없습니다.</p> :
    <div className="dashboard-pattern-chart" style={{ '--dashboard-pattern-count': rows.length }}>
      <ul className="dashboard-pattern-labels">
        {points.map(({ label, value, supported }) => <li key={label} data-reference={!supported || undefined}>
          {supported ? <PatternTag>{label}</PatternTag> : <span>{label}</span>}
          <strong>{count(value)}</strong>
        </li>)}
      </ul>
      <BarChart className="dashboard-pattern-bars" data={points} xDataKey="label" orientation="horizontal"
        margin={noMargin} barGap={0.28} animationDuration={reduced ? 0 : 340}>
        <ReferencePattern id={patternId} />
        <Bar dataKey="value" getFill={point => point.supported ? 'var(--chart-pattern)' : `url(#${patternId})`}
          lineCap="round" animate={!reduced} />
        <ChartTooltip showDatePill={false} showDots={false} damping={reduced ? 0 : 25}
          rows={point => [{ label: point.label, color: point.supported ? 'var(--chart-pattern)' : 'var(--chart-pattern-reference)',
            value: `${count(point.value)} · ${share(point.value, total)}` }]} />
      </BarChart>
    </div>}
    {hasReference && <p className="dashboard-note">빗금 · 모델 지원 외 유형</p>}
  </section>;
}

const volumeSeries = [
  { key: 'total', label: '전체 거래', color: 'var(--chart-total)' },
  { key: 'suspicious', label: '모델 의심 거래', color: 'var(--chart-suspect)' },
];
const completionSeries = { key: 'completed', label: '종결일별 건수', color: 'var(--chart-completion)' };
const volumeDetail = [
  { label: '전체 거래', color: 'var(--chart-total)', value: row => count(row.total) },
  { label: '세탁 라벨 거래', color: 'var(--chart-suspect)', value: row => count(row.labeled) },
  { label: '세탁 라벨 비율', color: 'var(--chart-suspect)', value: row => share(row.labeled, row.total) },
];
const statusSeries = reviewStates.map(({ label, value, preset: key }) =>
  ({ key, label, value, color: `var(--review-status-${key}-accent)` }));

export function Analytics({ data, reduced }) {
  const total = data.transactions.length;
  const suspicious = data.suspicious.length;
  const risk = data.flags.map(({ key, label, count: value }) => ({ color: `var(--chart-risk-${key})`, label, value }));
  const withoutScore = suspicious - risk.reduce((sum, item) => sum + item.value, 0);
  if (withoutScore > 0) risk.push({ label: '점수 없음', value: withoutScore, color: 'var(--chart-total)' });
  const composition = [
    { label: '그 외 거래', value: total - suspicious, color: 'var(--chart-total)' },
    { label: '모델 의심 거래', value: suspicious, color: 'var(--chart-suspect)' },
  ];
  const patterns = data.patterns.map(({ label, count: value }) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const { from, to } = data.period;
  const period = from === to ? from : `${from} ~ ${to}`;
  const completedByDay = new Map(data.daily.map(({ day, completed }) => [day, completed]));
  const status = data.dailyAlertStatus.map(row => ({
    ...row, label: row.date.slice(5).replace('-', '/'), completed: completedByDay.get(row.date) ?? 0,
  }));
  const hasAlertActivity = status.some(row => row.pending + row.inProgress + row.done + row.completed > 0);
  return <section className="dashboard-analytics" aria-label="기관 탐지 현황">
    <TransactionSummary title="거래 구성과 의심 유형" note={`${period} · KST`}
      hasChart={total > 0} composition={
        <DashboardRiskChart segments={composition} reduced={reduced} label="전체 거래 중 모델 의심 거래 비중" />
      }>
      <TransactionPatterns rows={patterns} total={suspicious} seriesLabel="모델 의심 거래" reduced={reduced} />
    </TransactionSummary>
    <section className="dashboard-analytics-row dashboard-detection-row" aria-label="위험 점수와 거래량 추이">
      <ChartPanel title="위험 점수 구간별 분포" hasChart={suspicious > 0}>
        <DashboardRiskChart segments={risk} reduced={reduced} totalLabel="모델 의심 거래" />
      </ChartPanel>
      <ActivityChart title="기간별 거래량 추이" note={`${period} · 거래 발생일 KST`} rows={data.operationalDaily}
        series={volumeSeries} reduced={reduced} empty="조회 조건에 해당하는 거래가 없습니다." />
    </section>
    <ChartPanel title="일별 Alert 처리 상태" hasChart={hasAlertActivity} note={`${period} · 생성일별 현재 상태 · KST`}>
      {hasAlertActivity ? <>
        <div className="dashboard-legend">
          {statusSeries.map(item => <ReviewStatusTag key={item.key} status={item.value} />)}
          <span><i className="dashboard-status-line-key" aria-hidden="true" />{completionSeries.label}</span>
        </div>
        <DashboardStatusArea rows={status} series={statusSeries} completion={completionSeries} reduced={reduced} />
      </> : <p className="dashboard-note">조회 기간에 생성되거나 종결된 Alert가 없습니다.</p>}
    </ChartPanel>
  </section>;
}

function ActivityChart({ title, note, rows, series, reduced, empty }) {
  const hasData = rows.some(row => series.some(item => row[item.key] > 0));
  return <ChartPanel title={title} note={note} hasChart={hasData}>
    {hasData ? <>
      <div className="dashboard-legend">{series.map(item => <span key={item.key}>
        <i style={{ background: item.color }} aria-hidden="true" />{item.label}
      </span>)}</div>
      <DailySeries rows={rows} series={series} reduced={reduced} label={title} stacked={false} />
    </> : <p className="dashboard-note">{empty}</p>}
  </ChartPanel>;
}

const benchmarkTotalSeries = [{ key: 'total', label: '전체 거래', color: 'var(--chart-total)' }];
const benchmarkLabelSeries = [{ key: 'labeled', label: '원본 세탁 라벨 거래', color: 'var(--chart-suspect)' }];

export function BenchmarkCharts({ chartRows, totals, period, fullPatternScope, reduced }) {
  return <section className="dashboard-analytics" aria-label="원본 거래 흐름">
      <div className="dashboard-analytics-row">
        <ChartPanel title="일별 전체 거래">
          <DailySeries rows={chartRows} series={benchmarkTotalSeries} label="일별 전체 거래 건수"
            reduced={reduced} stacked={false} />
        </ChartPanel>
        <ChartPanel title="일별 세탁 라벨 거래" note="비율 기준 · 해당 일자 전체 거래">
          <DailySeries rows={chartRows} series={benchmarkLabelSeries} detail={volumeDetail}
            label="일별 원본 세탁 라벨 거래 건수와 비율" reduced={reduced} showShare stacked={false} />
        </ChartPanel>
      </div>
      <TransactionSummary title={fullPatternScope ? '원본 거래 구성과 유형' : '원본 거래 구성'}
        note={`${period} · 원본 세탁 라벨 기준`} hasChart={totals.transactions > 0}
        composition={<TransactionComposition total={totals.transactions} labeled={totals.labeled} />}>
        {fullPatternScope && <TransactionPatterns reduced={reduced} label="원본 라벨 유형별 거래 건수" />}
      </TransactionSummary>
    </section>;
}
