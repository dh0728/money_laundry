import React from 'react';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Panel } from '../../components/panel';
import { PatternTag } from '../../components/semantic-tags';
import { getModelRiskThresholds } from '../settings/model-risk-settings';
import { ComposedChart } from '../../components/charts/registry/composed-chart';
import { SeriesBar } from '../../components/charts/registry/series-bar';
import { Line } from '../../components/charts/registry/line';
import { XAxis } from '../../components/charts/registry/x-axis';
import { YAxis } from '../../components/charts/registry/y-axis';
import { Grid as SeriesGrid } from '../../components/charts/registry/grid';
import { ChartTooltip as SeriesTooltip } from '../../components/charts/registry/tooltip/chart-tooltip';
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
      {composition && <section className="dashboard-transaction-breakdown" aria-label="전체 거래 구성">
        {composition}
      </section>}
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
const ratioSeries = { key: 'ratio', label: '의심 비율', color: 'var(--chart-suspect-label)' };
const alertFlowSeries = [
  { key: 'incoming', label: '생성', color: 'var(--chart-arrival)' },
  { key: 'completed', label: '완료', color: 'var(--chart-completion)' },
];
const volumeDetail = [
  { label: '전체 거래', color: 'var(--chart-total)', value: row => count(row.total) },
  { label: '세탁 라벨 거래', color: 'var(--chart-suspect)', value: row => count(row.labeled) },
  { label: '세탁 라벨 비율', color: 'var(--chart-suspect)', value: row => share(row.labeled, row.total) },
];
const dayLabel = date => date.slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/');
const ratioDomain = { ratio: [0, 100] };

// Ordered bands read as name → count → bar on one denominator, low to high like the score axis.
function RiskBands({ rows, total, basis, reduced }) {
  return <section className="dashboard-transaction-breakdown" aria-label="위험 점수 구간별 거래 수">
    <p className="dashboard-note">{basis} {count(total)} 기준 · 구간 경계 {rows.filter(row => row.cut).map(row => row.cut).join(' / ')}</p>
    <div className="dashboard-pattern-chart" style={{ '--dashboard-pattern-count': rows.length }}>
      <ul className="dashboard-pattern-labels">
        {rows.map(({ label, value }) => <li key={label}><span>{label}</span><strong>{count(value)}</strong></li>)}
      </ul>
      <BarChart className="dashboard-pattern-bars" data={rows} xDataKey="label" orientation="horizontal"
        margin={noMargin} barGap={0.28} horizontalValueDomain={[0, Math.max(total, 1)]} animationDuration={reduced ? 0 : 340}>
        <Bar dataKey="value" getFill={point => point.color} lineCap="round" animate={!reduced} />
        <ChartTooltip showDatePill={false} showDots={false} damping={reduced ? 0 : 25}
          rows={point => [{ label: point.label, color: point.color, value: `${count(point.value)} · ${share(point.value, total)}` }]} />
      </BarChart>
    </div>
  </section>;
}

// Counts on bars and the suspicious share on its own 0–100% axis, so the two units never share one bar length.
function VolumeChart({ rows, reduced }) {
  const points = rows.map(row => ({ ...row, date: new Date(`${row.date}T00:00:00`),
    ratio: row.total ? Math.round(row.suspicious / row.total * 1000) / 10 : 0 }));
  const labels = rows.map(row => row.label);
  return <figure className="dashboard-series" aria-label="일별 전체 거래·모델 의심 거래 건수와 의심 비율">
    <div className="dashboard-series-plot">
      <ComposedChart className="dashboard-bklit-series" data={points} maxBarSize={18} barGap={0.2} yDomains={ratioDomain}
        margin={{ top: 8, right: 40, bottom: 28, left: 36 }} animationDuration={reduced ? 0 : 340}
        enterTransition={reduced ? { duration: 0 } : undefined} yDomainTween={!reduced}>
        <SeriesGrid horizontal numTicksRows={4} />
        {volumeSeries.map(item => <SeriesBar key={item.key} dataKey={item.key} fill={item.color} radius={4} animate={!reduced} />)}
        <Line dataKey={ratioSeries.key} yAxisId="ratio" stroke={ratioSeries.color} strokeWidth={2} animate={!reduced} />
        <YAxis numTicks={4} formatValue={value => `${integer.format(value)}건`} />
        <YAxis yAxisId="ratio" orientation="right" numTicks={3} formatValue={value => `${Math.round(value)}%`} />
        <XAxis labels={labels} numTicks={rows.length} />
        <SeriesTooltip showDatePill={false} showCrosshair={false} dateLabels={labels}
          rows={point => [
            ...volumeSeries.map(item => ({ label: item.label, color: item.color, value: count(point[item.key]) })),
            { label: ratioSeries.label, color: ratioSeries.color, value: share(point.suspicious, point.total) },
          ]} />
      </ComposedChart>
    </div>
    <div className="visually-hidden">
      <Table>
        <TableCaption>일별 거래량</TableCaption>
        <TableHeader><TableRow><TableHead scope="col">일자</TableHead>{volumeSeries.map(item => <TableHead scope="col" key={item.key}>{item.label}</TableHead>)}<TableHead scope="col">{ratioSeries.label}</TableHead></TableRow></TableHeader>
        <TableBody>{rows.map(row => <TableRow key={row.date}><TableHead scope="row">{row.label}</TableHead>
          {volumeSeries.map(item => <TableCell key={item.key}>{count(row[item.key])}</TableCell>)}<TableCell>{share(row.suspicious, row.total)}</TableCell></TableRow>)}</TableBody>
      </Table>
    </div>
  </figure>;
}

export function Analytics({ data, reduced }) {
  const total = data.transactions.length;
  const suspicious = data.suspicious.length;
  // Score bands share one denominator: every scored transaction when the source has it, otherwise the suspicious ones (live API today).
  const scoredBasis = data.scoreBasis?.kind === 'scored';
  const bandTotal = scoredBasis ? data.scoreBasis.total : suspicious;
  const order = ['low', 'medium', 'high'];
  const [mediumCut, highCut] = getModelRiskThresholds();
  const cuts = { medium: `${mediumCut}점`, high: `${highCut}점` };
  const risk = [...data.flags].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
    .map(({ key, label, count: value }) => ({ color: `var(--chart-risk-${key})`, label, value, cut: cuts[key] }));
  const withoutScore = bandTotal - risk.reduce((sum, item) => sum + item.value, 0);
  if (withoutScore > 0) risk.push({ label: '점수 없음', value: withoutScore, color: 'var(--chart-total)' });
  // Pattern-unspecified suspicious transactions (NON_PATTERN, shown as 미분류) stay out of the pattern chart; the note keeps their count.
  const unspecified = data.patterns.filter(({ label }) => label === '미분류').reduce((sum, row) => sum + row.count, 0);
  const patterns = data.patterns.filter(({ label }) => label !== '미분류').map(({ label, count: value }) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const { from, to } = data.period;
  const period = from === to ? from : `${from} ~ ${to}`;
  const alertFlow = data.daily.map(row => ({ ...row, label: dayLabel(row.day) }));
  return <section className="dashboard-analytics" aria-label="기관 탐지 현황">
    <TransactionSummary title="의심 거래 유형" hasChart={suspicious > 0}
      note={`${period} · KST${unspecified ? ` · 유형 미특정 ${count(unspecified)} 제외` : ''}`}>
      <TransactionPatterns rows={patterns} total={suspicious} seriesLabel="모델 의심 거래" reduced={reduced} />
    </TransactionSummary>
    <section className="dashboard-analytics-row dashboard-detection-row" aria-label="위험 점수와 거래량 추이">
      <ChartPanel title="위험 점수 구간별 분포" hasChart={bandTotal > 0}
        note={scoredBasis ? `${period} · 모델 점수가 있는 전체 거래` : `${period} · 서버 집계는 의심 거래 점수만 제공`}>
        {bandTotal > 0 ? <RiskBands rows={risk} total={bandTotal} basis={scoredBasis ? '채점 거래' : '모델 의심 거래'} reduced={reduced} />
          : <p className="dashboard-note">조회 조건에 해당하는 거래가 없습니다.</p>}
      </ChartPanel>
      <ChartPanel title="기간별 거래량 추이" note={`${period} · 거래 발생일 KST`} hasChart={total > 0}>
        {total > 0 ? <>
          <div className="dashboard-legend">
            {volumeSeries.map(item => <span key={item.key}><i style={{ background: item.color }} aria-hidden="true" />{item.label}</span>)}
            <span><i className="dashboard-line-key" style={{ '--dashboard-line-key': ratioSeries.color }} aria-hidden="true" />{ratioSeries.label} · 오른쪽 축</span>
          </div>
          <VolumeChart rows={data.operationalDaily} reduced={reduced} />
        </> : <p className="dashboard-note">조회 조건에 해당하는 거래가 없습니다.</p>}
      </ChartPanel>
    </section>
    <ActivityChart title="일별 Alert 생성·완료" note={`${period} · 생성일·완료일 기준 · 단위 건 · KST`} rows={alertFlow}
      series={alertFlowSeries} reduced={reduced} empty="조회 기간에 생성되거나 완료된 Alert가 없습니다." />
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
