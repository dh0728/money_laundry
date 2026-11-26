import React, { useRef } from 'react';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Panel } from '../../components/panel';
import { LinkTag, PatternTag, ReviewStatusTag } from '../../components/semantic-tags';
import { BarChart } from '../../components/charts/charts/bar-chart';
import { Bar, BarHatch } from '../../components/charts/charts/bar';
import { BarXAxis } from '../../components/charts/charts/bar-x-axis';
import { readChartNumber } from '../../components/charts/chart-design-values';
import { Grid } from '../../components/charts/charts/grid';
import { ChartTooltip } from '../../components/charts/charts/tooltip/chart-tooltip';
import { ibmLaundering, ibmPatterns, ibmRemaining } from '../investigation/ibm-hi-small-aggregate';
import { SectionDownloadHeading } from '../../components/section-download';
import { dashboardPattern } from '../../mocks/dashboard-patterns';
import { Box, Grid as LayoutGrid, Text } from '../../components/layout-primitives';
import { SankeyDetailsLinks, StagedSankey } from '@/components/charts/charts/sankey/staged-sankey';
import { flowColors, investigationFlow, reviewStatusTotals, share as compactShare, statusLabels, transactionFlow } from './dashboard-flows';
import { dataSeriesColors, transactionTotalColor } from '@/components/charts/charts/chart-context';
import { DashboardIndicatorsGrid, InstitutionMetricsGrid } from './dashboard-layout';

const integer = new Intl.NumberFormat('ko-KR');
const count = value => `${integer.format(value)}건`;
const smallPercent = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 3 });
const share = (value, total) => total ? smallPercent.format(value / total) : '—';

function volumeAxisLabel(point, label) {
  return <Text as="span" className="dashboard-volume-axis">{label}<Text as="small">{share(point.labeled, point.total)}</Text></Text>;
}

function DailySeries({ rows, series, reduced, label, showShare = false, detail, stacked = true, separatedStack = false }) {
  const columns = detail ?? series.map(item => ({ label: item.label, value: row => count(row[item.key]), color: item.color }));
  const barGap = readChartNumber('--aml-space-2', 2);
  const sideInset = readChartNumber('--aml-space-4', 4);
  const cap = separatedStack ? readChartNumber('--aml-radius-small', 4) : 'round';
  const margin = {
    top: readChartNumber('--aml-space-6', 6),
    right: sideInset,
    bottom: showShare ? readChartNumber('--chart-axis-detail-inset', 42) : readChartNumber('--chart-axis-label-inset', 28),
    left: sideInset,
  };
  const singleCategoryGap = rows.length === 1 ? readChartNumber('--chart-single-category-gap-ratio', 0.94) : undefined;
  const enterDuration = reduced ? 0 : readChartNumber('--chart-dashboard-enter-duration', 340);
  return <Box as="figure" className="dashboard-series" aria-label={label}>
    <Box className="dashboard-series-plot">
      <BarChart className="dashboard-bklit-series" data={rows} xDataKey="label" stacked={stacked}
        margin={margin} barGap={singleCategoryGap} animationDuration={enterDuration}>
        <Grid horizontal />
        {series.map(item => <Bar key={item.key} dataKey={item.key} fill={item.color}
          lineCap={cap} roundStack={stacked && !separatedStack} groupGap={barGap}
          stackGap={separatedStack ? barGap : undefined} animate={!reduced} />)}
        <BarXAxis maxLabels={showShare ? { base: 4, sm: 10, lg: 18 } : 14} tickerHalfWidth={0}
          formatLabel={showShare ? volumeAxisLabel : undefined} />
        <ChartTooltip showCrosshair showDatePill={false} showDots={false} damping={reduced ? 0 : 25}
          rows={point => columns.map(column => ({
            label: column.label, color: column.color, value: column.value(point),
          }))} />
      </BarChart>
    </Box>
    <Box className="visually-hidden">
      <Table>
        <TableCaption>일별 수치</TableCaption>
        <TableHeader><TableRow><TableHead scope="col">일자</TableHead>{columns.map(column => <TableHead scope="col" key={column.label}>{column.label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{rows.map(row => <TableRow key={row.label}><TableHead scope="row">{row.label}</TableHead>
          {columns.map(column => <TableCell key={column.label}>{column.value(row)}</TableCell>)}</TableRow>)}</TableBody>
      </Table>
    </Box>
  </Box>;
}

function ChartPanel({ title, headingAs, note, children, className = '', hasChart = true, ...props }) {
  return <Panel as="article" className={`dashboard-chart ${className}`} {...props}>
    <SectionDownloadHeading as={headingAs} downloadLabel={hasChart ? title : undefined}>{title}</SectionDownloadHeading>
    {note && <Text className="dashboard-note">{note}</Text>}
    {children}
  </Panel>;
}

function CompositionLegend({ segments, total, label, formatShare = share }) {
  return <Box as="ul" className="dashboard-composition-legend" aria-label={label}>
    {segments.map(({ label, tone, value }) => <Box as="li" key={label} data-segment={tone}>
      <Text as="i" aria-hidden="true" />
      <Text as="span">{label}</Text>
      <Text as="strong">{count(value)}</Text>
      <Text as="span">{formatShare(value, total)}</Text>
    </Box>)}
  </Box>;
}

const segmentInk = tone => `var(--segment-${tone})`;
const noMargin = { top: 0, right: 0, bottom: 0, left: 0 };
const launderingBarScale = 500;

function ProportionBar({ label, segments, total, orientation = 'horizontal', formatShare = share, separated = false }) {
  if (!total) return <Box className="dashboard-proportion-empty" aria-hidden="true" />;

  const horizontal = orientation === 'horizontal';
  const gap = separated ? readChartNumber('--aml-space-2', 2) : 0;
  const cap = separated ? readChartNumber('--aml-radius-small', 4) : 'round';
  const displayTotal = segments.reduce((sum, { value, visualScale = 1 }) => sum + value * visualScale, 0);
  const point = { label, ...Object.fromEntries(segments.map(({ tone, value, visualScale = 1 }) =>
    [tone, value * visualScale / (horizontal ? 1 : displayTotal)])) };
  return <BarChart className="dashboard-proportion-band" data={[point]} xDataKey="label"
    margin={noMargin} horizontalValueDomain={horizontal ? [0, displayTotal] : undefined}
    orientation={orientation} stacked stackGap={gap} barGap={0} animationDuration={0}>
    {segments.map(({ tone }) => <Bar key={tone} dataKey={tone} fill={segmentInk(tone)}
      lineCap={cap} stackGap={gap} animate={false} fadedOpacity={1} />)}
    <ChartTooltip showDatePill={false} showDots={false} damping={0}
      rows={() => segments.map(({ tone, label, value }) => ({
        label, value: `${count(value)} · ${formatShare(value, total)}`, color: segmentInk(tone),
      }))} />
  </BarChart>;
}

function TransactionSummary({ title, note, composition, children, hasChart }) {
  return <ChartPanel title={title} note={note} hasChart={hasChart}>
    <Box className="dashboard-transaction-details">
      <Box as="section" className="dashboard-transaction-breakdown" aria-label="전체 거래 구성">
        {composition}
      </Box>
      {children}
    </Box>
  </ChartPanel>;
}

function TransactionComposition({ total, labeled }) {
  const overview = [
    { label: '그 외 거래', tone: 'other', value: total - labeled },
    { label: '세탁 라벨 거래', tone: 'suspect', value: labeled, visualScale: launderingBarScale },
  ];
  return <>
    <Box className="dashboard-composition-chart">
      <CompositionLegend segments={overview} total={total} label="전체 거래 기준" />
      <ProportionBar label="전체 거래" segments={overview} total={total} orientation="vertical" />
    </Box>
    <Text className="dashboard-note">세탁 라벨 막대만 ×{launderingBarScale} 확대 · 표시 건수와 비율은 원본 기준</Text>
  </>;
}

const patternRows = [...ibmPatterns, ...ibmRemaining];

function TransactionPatterns({ reduced, label = '의심 거래 유형별 건수', rows = patternRows,
  total = ibmLaundering, seriesLabel = '원본 세탁 라벨 거래' }) {
  const patternId = React.useId();
  const points = rows.map(({ label, value }) => {
    const { name, supported } = dashboardPattern(label);
    return { label: name, value, supported };
  }).sort((left, right) => Number(right.supported) - Number(left.supported) || right.value - left.value);
  const hasReference = points.some(row => !row.supported);
  const barGap = readChartNumber('--chart-pattern-bar-gap-ratio', 0.28);
  const enterDuration = reduced ? 0 : readChartNumber('--chart-dashboard-enter-duration', 340);
  return <Box as="section" className="dashboard-transaction-breakdown" aria-label={label}>
    <Text className="dashboard-note">{seriesLabel} {count(total)} 기준</Text>
    {!rows.length ? <Text className="dashboard-note">조회 조건에 해당하는 유형이 없습니다.</Text> :
    <Box className="dashboard-pattern-chart" style={{ '--dashboard-pattern-count': rows.length }}>
      <Box as="ul" className="dashboard-pattern-labels">
        {points.map(({ label, value, supported }) => <Box as="li" key={label} data-reference={!supported || undefined}>
          {supported ? <PatternTag>{label}</PatternTag> : <Text as="span">{label}</Text>}
          <Text as="strong">{count(value)}</Text>
        </Box>)}
      </Box>
      <BarChart className="dashboard-pattern-bars" data={points} xDataKey="label" orientation="horizontal"
        margin={noMargin} barGap={barGap} animationDuration={enterDuration}>
        <BarHatch id={patternId} fill="var(--chart-pattern)" stroke="var(--information-panel-surface)" />
        <Bar dataKey="value" getFill={point => point.supported ? 'var(--chart-pattern)' : `url(#${patternId})`}
          lineCap="round" animate={!reduced} />
        <ChartTooltip showDatePill={false} showDots={false} damping={reduced ? 0 : 25}
          rows={point => [{ label: point.label, color: 'var(--chart-pattern)',
            value: `${count(point.value)} · ${share(point.value, total)}` }]} />
      </BarChart>
    </Box>}
    {hasReference && <Text className="dashboard-note">빗금 · 모델 지원 외 유형</Text>}
  </Box>;
}

const volumeDetail = [
  { label: '전체 거래', color: transactionTotalColor, value: row => count(row.total) },
  { label: '세탁 라벨 거래', color: 'var(--chart-suspect)', value: row => count(row.labeled) },
  { label: '세탁 라벨 비율', color: 'var(--chart-suspect)', value: row => share(row.labeled, row.total) },
];
const relationTargets = [{ id: 'total', color: transactionTotalColor }, { id: 'suspect', color: flowColors.suspect }];
const institutionRelationTargets = [...relationTargets, { id: 'new-entities', source: 'total', color: transactionTotalColor }];
const institutionMetricRoutes = [
  { id: 'transactions', target: '.dashboard-transaction-flow [data-sankey-anchor="total"]' },
  { id: 'suspicious', target: '.dashboard-transaction-flow [data-sankey-anchor="suspect"]' },
  { id: 'created-alerts', target: '.dashboard-investigation-flow [data-sankey-top-anchor="alerts"]' },
  { id: 'linked', target: '.dashboard-investigation-flow [data-sankey-top-anchor="alert-link"]' },
  { id: 'open-alerts-pending', source: 'open-alerts', target: '.dashboard-investigation-flow [data-sankey-top-anchor="pending"]', partial: true },
  { id: 'open-alerts-in-progress', source: 'open-alerts', target: '.dashboard-investigation-flow [data-sankey-top-anchor="inProgress"]', partial: true },
  { id: 'open-episodes', target: '[data-dashboard-metric-target="open-episodes"]', color: flowColors.inProgress },
  { id: 'completion-episodes', source: 'completion', target: '[data-dashboard-metric-target="completed-episodes"]', color: flowColors.done, partial: true },
].map(route => ({ ...route, source: `[data-dashboard-metric-source="${route.source ?? route.id}"]` }));
const transactionStages = ['수신처', '전체 거래', '이진 분류', '패턴 분류'];
const investigationStages = ['의심 거래', 'Alert 연결', '조사 경로', '현재 상태', '완료 판정'];
const riskScoreColors = {
  high: 'var(--chart-suspect)',
  medium: 'var(--dashboard-score-middle)',
  low: 'var(--dashboard-score-lower)',
};

function SeriesLegend({ series }) {
  return <Box className="dashboard-legend">
    {series.map(item => <Text as="span" className="dashboard-series-legend-item" key={item.key}>
      <Text as="i" aria-hidden="true" style={{ '--dashboard-series-swatch': item.color }} />{item.label}
      {item.total && <> <Text as="strong" className="dashboard-metric-value" style={{ '--dashboard-metric-ink': item.totalInk }}>{item.total}</Text></>}
    </Text>)}
  </Box>;
}

const newEntitySeries = [
  { key: 'newAccounts', label: '새 계좌', color: dataSeriesColors.teal, totalInk: 'var(--case-comparison-teal)', value: row => integer.format(row.newAccounts) + '개' },
  { key: 'newOwners', label: '새 소유주', color: dataSeriesColors.pink, totalInk: 'var(--case-comparison-pink)', value: row => integer.format(row.newOwners) + '명' },
];

function NewEntitiesMetric({ data, reduced }) {
  const available = data.coverageScope === 'institution';
  const title = '새 계좌 · 새 소유주';
  const hasChart = available && (data.newAccounts > 0 || data.newOwners > 0);
  return <ChartPanel title={title} note={available ? '전체 거래 이력상 최초 등장 · KST' : '기관 전체 조회에서 제공'}
    className="dashboard-priority-metric dashboard-new-entities" hasChart={hasChart}
    data-sankey-detail={available ? 'new-entities' : undefined}>
    {available && <SeriesLegend series={newEntitySeries.map(item => ({ ...item, total: item.value(data) }))} />}
    {hasChart && <DailySeries rows={data.operationalDaily} series={newEntitySeries} detail={newEntitySeries} reduced={reduced}
      label="거래 이력 기준 일별 최초 등장 계좌와 소유주" stacked={false} />}
  </ChartPanel>;
}

const meanCount = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 });

function StaffWorkloadMetric({ workload, reduced, showAssignments }) {
  const { byAssignee, equalAssignments, staffCount, total, overdue } = workload;
  const rows = byAssignee.map(person => ({ ...person,
    value: showAssignments ? person.assignments : person.total - person.overdue,
    count: showAssignments ? person.assignments : person.total,
  }));
  const baseline = showAssignments ? equalAssignments : null;
  const visibleRowLimit = readChartNumber('--dashboard-staff-visible-rows', 7);
  const longChart = rows.length >= 2 * visibleRowLimit;
  const upperBound = Math.max(1, ...rows.map(row => row.count)) + 1;
  const title = showAssignments ? '분석가별 최근 배정' : '분석가별 현재 미완료';
  const note = showAssignments
    ? baseline == null ? '기간 내 마지막 배정 기록 · 분석가 명단 미제공'
      : `기간 내 마지막 배정 기록 · 등록 분석가 ${integer.format(staffCount)}명`
    : `전체 미완료 ${count(total)} · 선택 기간 생성 업무`;
  const color = showAssignments ? transactionTotalColor : 'var(--risk-medium)';
  const stackGap = readChartNumber('--aml-space-2', 2);
  const cornerRadius = readChartNumber('--aml-radius-small', 4);
  const animationDuration = reduced ? 0 : readChartNumber('--chart-dashboard-enter-duration', 340);
  return <ChartPanel title={title} note={note} className="dashboard-priority-metric dashboard-staff-metric" hasChart={rows.length > 0}>
    {baseline != null && <Box className="dashboard-staff-reference-key">
      <Text as="span">균등 기준 {meanCount.format(baseline)}건/명</Text>
    </Box>}
    {!showAssignments && <SeriesLegend series={[
      { key: 'withinThreeDays', label: `3일 이하 ${count(total - overdue.length)}`, color },
      { key: 'overdue', label: `3일 초과 ${count(overdue.length)}`, color: flowColors.suspect },
    ]} />}
    {rows.length ? <Box className="dashboard-staff-scroll" data-scroll-exception={longChart ? 'long-chart' : undefined}>
      <Box as="figure" className="dashboard-staff-chart" aria-label={title}
        style={{ '--dashboard-staff-row-count': rows.length,
          '--dashboard-staff-reference-position': baseline == null ? undefined : `${100 * baseline / upperBound}%` }}>
        <Box as="ul" className="dashboard-staff-labels">
          {rows.map(person => <Box as="li" key={person.id}>
            <Text as="span" title={person.name}>{person.name}</Text>
            <Text as="strong">{count(person.count)}</Text>
            {!showAssignments && <Text as="strong" className="dashboard-staff-overdue" aria-label={`3일 초과 ${count(person.overdue)}`}>
              {count(person.overdue)}
            </Text>}
          </Box>)}
        </Box>
        <Box className="dashboard-staff-plot">
          <BarChart data={rows} xDataKey="id" orientation="horizontal" stacked={!showAssignments}
            aspectRatio="auto" horizontalValueDomain={[0, upperBound]} margin={noMargin}
            barGap={readChartNumber('--chart-staff-bar-gap-ratio', 0.24)} animationDuration={animationDuration}>
            <Bar dataKey="value" fill={color} lineCap={cornerRadius} stackGap={showAssignments ? undefined : stackGap} animate={!reduced} />
            {!showAssignments && <Bar dataKey="overdue" fill={flowColors.suspect} lineCap={cornerRadius} stackGap={stackGap} animate={!reduced} />}
            <ChartTooltip showDatePill={false} showDots={false} rows={person => showAssignments
              ? [{ label: person.name, value: count(person.count), color }]
              : [{ label: '3일 이하', value: count(person.value), color },
                { label: '3일 초과', value: count(person.overdue), color: flowColors.suspect }]} />
          </BarChart>
          {baseline != null && <Box className="dashboard-staff-reference" aria-hidden="true" />}
        </Box>
      </Box>
    </Box> : <Text className="dashboard-note">표시할 담당자 집계가 없습니다.</Text>}
  </ChartPanel>;
}

function RiskSegments({ data }) {
  const rows = data.flags.map(row => ({ ...row, label: row.label.split(' · ')[0] }));
  const scored = rows.reduce((sum, row) => sum + row.count, 0);
  const gap = readChartNumber('--aml-space-2', 2);
  const cap = readChartNumber('--aml-radius-small', 4);
  const point = { label: '이상 거래', ...Object.fromEntries(rows.map(row => [row.key, row.count])) };
  return <ChartPanel title="위험 점수"
    className="dashboard-flow-risk" data-sankey-detail="suspect" hasChart={scored > 0}>
    {scored ? <>
      <BarChart className="dashboard-score-band" data={[point]} xDataKey="label" stacked stackGap={gap} barGap={0}
        aspectRatio="auto" margin={noMargin} verticalValueDomain={[0, scored]} animationDuration={0}>
        {rows.map(row => <Bar key={row.key} dataKey={row.key} fill={riskScoreColors[row.key]} lineCap={cap} stackGap={gap}
          animate={false} showValue valueLabelOrientation="horizontal" valueLabelFormatter={() => `${row.label} · ${count(row.count)}`}
          valueLabelColor={row.key === 'high' ? 'var(--status-accent-light-ink)' : 'var(--text)'} />)}
        <ChartTooltip showDatePill={false} showDots={false} rows={() => rows.map(row => ({
          label: row.label, color: riskScoreColors[row.key], value: count(row.count),
        }))} />
      </BarChart>
      <Box as="ul" className="visually-hidden" aria-label="위험 점수 구간별 건수">
        {rows.map(row => <Box as="li" key={row.key}>{row.label} · {count(row.count)}</Box>)}
      </Box>
      {scored < data.suspicious.length && <Text className="dashboard-note">점수 미집계 {count(data.suspicious.length - scored)}</Text>}
    </> : <Text className="dashboard-note">표시할 점수 분포가 없습니다.</Text>}
  </ChartPanel>;
}

function TransactionDetails({ data, flow, reduced, summary }) {
  const { scale } = flow;
  const series = [
    { key: 'total', label: '전체 거래', color: transactionTotalColor },
    { key: 'displaySuspicious', label: '모델 의심 거래', color: flowColors.suspect },
  ];
  const detail = [
    { ...series[0], value: row => count(row.total) },
    { ...series[1], value: row => count(row.suspicious) + ' · ' + share(row.suspicious, row.total) },
  ];
  const rows = data.operationalDaily.map(row => ({ ...row, displaySuspicious: row.suspicious * scale }));
  const badge = [flow.sample ? '은행별 건수는 예시' : null,
    scale > 1 ? '이상 띠 두께 ×' + scale + ' · 건수·비율 원본' : null].filter(Boolean).join(' · ');
  return <LayoutGrid columns={12} className="dashboard-flow-family dashboard-work-overview-grid">
    <ChartPanel title="거래 분류" note={badge} className="dashboard-transaction-flow" hasChart={flow.hasData}>
      {flow.hasData ? <StagedSankey data={flow} stages={transactionStages} label="거래 분류 흐름" reduced={reduced} />
        : <Text className="dashboard-note">조회 기간에 거래가 없습니다.</Text>}
      {import.meta.env.DEV && data.dataSource === 'sample' && <LinkTag href="/dashboard/all?data=ibm">IBM 원본 거래 집계</LinkTag>}
    </ChartPanel>
    <ChartPanel title="기간별 거래량 추이" note={scale > 1 ? '의심 막대 높이 ×' + scale + ' · 건수·비율 원본' : '거래일 기준 · KST'}
      className="dashboard-flow-volume" data-sankey-detail="total" hasChart={flow.hasData}>
      {flow.hasData ? <>
        <SeriesLegend series={series} />
        <DailySeries rows={rows} series={series} detail={detail} reduced={reduced} label="기간별 거래량 추이" stacked={false} />
      </> : <Text className="dashboard-note">표시할 일별 거래량이 없습니다.</Text>}
    </ChartPanel>
    <RiskSegments data={data} />
    {summary}
  </LayoutGrid>;
}

function InvestigationStatus({ data, episode = false, reduced }) {
  const keys = episode ? ['inProgress', 'done'] : ['pending', 'inProgress', 'done'];
  const daily = episode ? data.dailyEpisodeStatus : data.dailyAlertStatus;
  const rows = (daily ?? []).map(row => ({ ...row, label: row.date.slice(5).replace('-', '/') }));
  const series = keys.map(key => ({ key, label: statusLabels[key], color: flowColors[key] }));
  const sums = reviewStatusTotals(rows);
  const { total } = sums;
  const title = episode ? '일별 Episode 처리 상태' : '일별 Alert 처리 상태';
  const note = total ? '생성일별 현재 상태 · ' + count(total) + ' · 완료 ' + compactShare(sums.done, total) : '생성일별 현재 상태 · KST';
  return <ChartPanel title={title} note={note} className="dashboard-flow-status" hasChart={total > 0}>
    {total ? <>
      <Box className="dashboard-legend">
        {series.map(item => <Box className="dashboard-status-legend-item" key={item.key}>
          <ReviewStatusTag status={item.key === 'pending' ? '처리 전' : item.label} />
          <Text as="strong" data-dashboard-metric-target={episode ? (item.key === 'done' ? 'completed-episodes' : 'open-episodes') : undefined}>
            {count(sums[item.key])}
          </Text>
        </Box>)}
      </Box>
      <DailySeries rows={rows} series={series} reduced={reduced} label={title} separatedStack />
    </> : <Text className="dashboard-note">{daily ? '조회 기간에 생성된 업무가 없습니다.' : '처리 상태 집계 미제공'}</Text>}
  </ChartPanel>;
}

function CaseCompletion({ data }) {
  const individual = data.investigation?.routes?.individual;
  const alerts = reviewStatusTotals(individual && [individual]);
  const episodes = reviewStatusTotals(data.dailyEpisodeStatus);
  const available = individual != null && data.dailyEpisodeStatus != null;
  const total = available ? alerts.total + episodes.total : 0;
  const done = alerts.done + episodes.done;
  const segments = [
    { label: statusLabels.pending, tone: 'pending', value: alerts.pending + episodes.pending },
    { label: statusLabels.inProgress, tone: 'in-progress', value: alerts.inProgress + episodes.inProgress },
    { label: statusLabels.done, tone: 'done', value: done },
  ];
  return <ChartPanel title="업무 처리율" headingAs="h3" className="dashboard-completion" hasChart={total > 0}
    note="생성일별 현재 상태 · 개별 처리 Alert와 Episode를 건별로 집계">
    {total ? <>
      <Box className="dashboard-metric-reading dashboard-completion-reading">
        <Text as="span">{count(total)} 중 {count(done)} 완료 · 개별 처리 Alert {count(alerts.total)} + Episode {count(episodes.total)}</Text>
        <Text as="strong" className="dashboard-metric-value" data-dashboard-metric-source="completion">{compactShare(done, total)}</Text>
      </Box>
      <ProportionBar label="개별 처리 Alert·Episode 처리 상태" segments={segments} total={total} formatShare={compactShare} separated />
      <CompositionLegend label="개별 처리 Alert·Episode 처리 상태별 건수와 비율" segments={segments} total={total} formatShare={compactShare} />
    </> : <Text className="dashboard-note">{available ? '조회 기간에 생성된 Alert·Episode가 없습니다.' : 'Alert·Episode 처리 상태 집계 미제공'}</Text>}
  </ChartPanel>;
}

export function Analytics({ data, reduced, summary, metrics }) {
  const [transactionsCard, alertsCard, linkedCard, ...unfinishedCards] = metrics;
  const hostRef = useRef(null);
  const transactions = transactionFlow(data);
  const investigation = investigationFlow(data);
  const scope = data.coverageScope === 'case-evidence' ? '선택 업무의 근거 거래' : null;
  const investigationNote = data.linked == null
    ? '의심 거래의 Alert 연결 집계 미제공'
    : '첫 구간은 거래 건수 · 이후에는 Alert 건수';
  const { episodeAlerts, totalAlerts } = data.investigation ?? {};
  const episodeNote = totalAlerts > 0 && episodeAlerts != null
    ? ` · Alert의 Episode 편입 ${count(episodeAlerts)} / ${count(totalAlerts)} (${compactShare(episodeAlerts, totalAlerts)})` : '';
  return <Box as="section" className="dashboard-analytics dashboard-workflow-charts dashboard-institution-relations"
    aria-label="기관 탐지 현황" ref={hostRef}>
    <InstitutionMetricsGrid aria-label="전체 대시보드 요약 지표">
      {transactionsCard}{alertsCard}{linkedCard}
      <CaseCompletion data={data} />
      {unfinishedCards}
    </InstitutionMetricsGrid>
    <DashboardIndicatorsGrid aria-label="기관 주요 지표">
      <NewEntitiesMetric data={data} reduced={reduced} />
      <StaffWorkloadMetric workload={data.institutionWorkload} reduced={reduced} showAssignments />
      <StaffWorkloadMetric workload={data.institutionWorkload} reduced={reduced} />
    </DashboardIndicatorsGrid>
    {scope && <Text className="dashboard-note">거래 집계 범위 · {scope}</Text>}
    <TransactionDetails data={data} flow={transactions} reduced={reduced} summary={summary} />
    <ChartPanel title="조사 처리 흐름" note={investigationNote + episodeNote} className="dashboard-investigation-flow" hasChart={investigation.hasData}>
      {investigation.hasData ? <StagedSankey data={investigation} stages={investigationStages} label="조사 처리 흐름" reduced={reduced} />
        : <Text className="dashboard-note">표시할 조사 처리 흐름이 없습니다.</Text>}
    </ChartPanel>
    <LayoutGrid columns={12} className="dashboard-flow-status-grid">
      <InvestigationStatus data={data} reduced={reduced} />
      <InvestigationStatus data={data} reduced={reduced} episode />
    </LayoutGrid>
    {transactions.hasData && <SankeyDetailsLinks hostRef={hostRef}
      relations={scope ? relationTargets : institutionRelationTargets} />}
    <SankeyDetailsLinks hostRef={hostRef} routes={institutionMetricRoutes} />
  </Box>;
}

const benchmarkTotalSeries = [{ key: 'total', label: '전체 거래', color: transactionTotalColor }];
const benchmarkLabelSeries = [{ key: 'labeled', label: '원본 세탁 라벨 거래', color: 'var(--chart-suspect)' }];

export function BenchmarkCharts({ chartRows, totals, period, fullPatternScope, reduced }) {
  return <Box as="section" className="dashboard-analytics" aria-label="원본 거래 흐름">
      <Box className="dashboard-analytics-row">
        <ChartPanel title="일별 전체 거래">
          <DailySeries rows={chartRows} series={benchmarkTotalSeries} label="일별 전체 거래 건수"
            reduced={reduced} stacked={false} />
        </ChartPanel>
        <ChartPanel title="일별 세탁 라벨 거래" note="비율 기준 · 해당 일자 전체 거래">
          <DailySeries rows={chartRows} series={benchmarkLabelSeries} detail={volumeDetail}
            label="일별 원본 세탁 라벨 거래 건수와 비율" reduced={reduced} showShare stacked={false} />
        </ChartPanel>
      </Box>
      <TransactionSummary title={fullPatternScope ? '원본 거래 구성과 유형' : '원본 거래 구성'}
        note={`${period} · 원본 세탁 라벨 기준`} hasChart={totals.transactions > 0}
        composition={<TransactionComposition total={totals.transactions} labeled={totals.labeled} />}>
        {fullPatternScope && <TransactionPatterns reduced={reduced} label="원본 라벨 유형별 거래 건수" />}
      </TransactionSummary>
    </Box>;
}
