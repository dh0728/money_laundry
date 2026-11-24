import React from 'react';
import { Panel } from '../../components/panel';
import { AISummaryPanel } from '../../components/ai-summary-panel';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import CountUp from '../../components/react-bits/CountUp';
import { CaseProgressBoard } from '../investigation/preview-case-card';
import {
  BenchmarkAnalyticsSkeleton, DashboardAnalyticsSkeleton, DashboardBoardSkeleton,
  DashboardMetricGrid, PersonalDashboardOverview,
} from './dashboard-layout';
import { ibmLaundering, ibmTotal } from '../investigation/ibm-hi-small-aggregate';
import { benchmarkDashboardMetrics } from './benchmark-dashboard-metrics';
import { ActionButton } from '../../components/primary-button';
import { exportCases } from '../../components/query-controls';
import { BoardSectionDownload, SectionDownloadHeading } from '../../components/section-download';
import { BarSparkline } from '../../components/charts/sparkline';
import { modelRiskBand, modelRiskLabels } from '../settings/model-risk-settings';
import { Box, Heading, Stack, Text } from '../../components/layout-primitives';
import { dashboardDateKey } from './dashboard-investigation';
import { readWorkspaceLength } from './workspace-metrics';
import { LinkTag, StatusTag, reviewStates } from '../../components/semantic-tags';
import { Bar } from '../../components/charts/charts/bar';
import { BarChart } from '../../components/charts/charts/bar-chart';
import { AccountTrailGraph } from '../../components/charts/charts/account-trail-graph';
import { flowColors } from './dashboard-flows';

const formatter = new Intl.NumberFormat('ko-KR');
const count = value => `${formatter.format(value)}건`;
const smallPercent = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 3 });
const share = (value, total) => total ? smallPercent.format(value / total) : '—';
const noMargin = { top: 0, right: 0, bottom: 0, left: 0 };
const animated = new Set();
const Analytics = React.lazy(() => import('./dashboard-analytics').then(module => ({ default: module.Analytics })));
const BenchmarkCharts = React.lazy(() => import('./dashboard-analytics').then(module => ({ default: module.BenchmarkCharts })));

function WorkloadBar({ composition, total }) {
  return <Stack className="dashboard-workload-composition">
    {total > 0 && <Box className="dashboard-score-band dashboard-workload-bar" aria-hidden="true">
      <BarChart data={[{ name: '내 담당 업무', ...composition }]} stacked orientation="horizontal" barGap={0}
        margin={noMargin} horizontalValueDomain={[0, total]}>
        {reviewStates.map(({ preset }) => <Bar key={preset} dataKey={preset}
          fill={flowColors[preset]} lineCap="butt" animate={false} />)}
      </BarChart>
    </Box>}
    <Box className="dashboard-legend" role="group" aria-label="내 담당 업무 처리 상태">
      {reviewStates.map(({ preset, label }) => <Text as="span" className="dashboard-status-legend-item" key={preset}>
        <StatusTag preset={preset}>{label}</StatusTag>
        <Text as="strong">{count(composition[preset])}</Text>
      </Text>)}
    </Box>
  </Stack>;
}

function Metric({ item, reduced, trendHeight }) {
  const { label, value, unit, detail, key, trend, composition } = item;
  const hasTrend = trend?.rows.some(row => row[trend.key] > 0);
  const wide = (typeof value === 'number' ? formatter.format(value).length : value.length) >= 8;
  return <Box className="dashboard-metric">
    <SectionDownloadHeading as="h3">{label}</SectionDownloadHeading>
    <Box className="dashboard-metric-reading">
      <Text as="strong" className="dashboard-metric-value" data-wide-value={wide || undefined}>
        {typeof value === 'number' && !reduced && !animated.has(key)
          ? <CountUp to={value} className="count-up-fast" trigger="view" separator="," onEnd={() => animated.add(key)} />
          : typeof value === 'number' ? formatter.format(value) : value}
        {unit && <Text as="small">{unit}</Text>}
      </Text>
    </Box>
    {detail && <Text>{detail}</Text>}
    {composition && <WorkloadBar composition={composition} total={value} />}
    {hasTrend && <Box className="dashboard-metric-trend">
      <BarSparkline data={trend.rows} dataKey={trend.key} color={trend.color} height={trendHeight}
        dot={false} animate={!reduced} aria-label={label + ' · ' + trend.caption + ' · ' +
          trend.rows.map(row => row.label + ' ' + count(row[trend.key])).join(', ')} />
      <Text as="span" className="dashboard-note">{trend.caption}</Text>
    </Box>}
  </Box>;
}

function Metrics({ items, appearance }) {
  return <DashboardMetricGrid items={items.map(item => ({
    id: item.key,
    content: <Metric item={item} reduced={appearance.reduced} />,
  }))} appearance={appearance} />;
}

function personalIndicators(data) {
  const hourly = (key, color) => ({ rows: data.hourly, key, color, caption: '생성 시간대 · KST' });
  const highRiskColor = 'var(--chart-risk-high)';
  const riskDetail = '미완료 · 위험 점수 ' + modelRiskLabels().high;
  const statusByCode = data.investigation.statusByCode;
  const casesByStatus = Map.groupBy(data.mine, row => statusByCode[row.code] ?? row.status);
  const composition = Object.fromEntries(reviewStates.map(({ value, preset }) =>
    [preset, casesByStatus.get(value)?.length ?? 0]));
  const episodes = data.mine.filter(row => row.kind === 'Episode' && row.open && modelRiskBand(row.score) === 'high');
  const episodesByDay = Map.groupBy(episodes, row => dashboardDateKey(row.date));
  return [
    { label: '내 담당 업무', value: data.mine.length, composition },
    { label: '고위험 Alert', value: data.highRisk, detail: riskDetail, trend: hourly('highRisk', highRiskColor) },
    { label: '3일 초과 경과', value: data.overdue, detail: 'Alert ' + count(data.overdueAlerts) + ' · Episode ' + count(data.overdueEpisodes),
      trend: hourly('overdue', highRiskColor) },
    { label: '고위험 Episode', value: episodes.length, detail: riskDetail,
      trend: {
        rows: data.operationalDaily.map(({ date, label }) => ({ label, count: episodesByDay.get(date)?.length ?? 0 })),
        key: 'count', color: highRiskColor, caption: '생성일 · KST',
      } },
  ];
}

function PersonalIndicators({ data, reduced }) {
  const trendHeight = readWorkspaceLength('--chart-detail-sparkline-height') || undefined;
  return personalIndicators(data).map(item => <Panel as="article" className="dashboard-priority-metric" key={item.label}>
    <Metric item={{ unit: '건', key: item.label, ...item }} reduced={reduced} trendHeight={trendHeight} />
  </Panel>);
}

function EvidenceRecord({ evidence, direction }) {
  const { record, transaction } = evidence;
  const amount = Number.isFinite(transaction.amount) && transaction.currency
    ? `${formatter.format(transaction.amount)} ${transaction.currency}` : undefined;
  return <Box as="li" className="dashboard-trail-record">
    <Stack>
      <Text as="strong">{direction}</Text>
      <Stack direction="row" wrap align="center">
        <LinkTag code={record.code} />
        <LinkTag code={transaction.code} />
      </Stack>
      <Text as="span">{[`${transaction.from.code} → ${transaction.to.code}`, transaction.timestamp.slice(5), amount]
        .filter(Boolean).join(' · ')}</Text>
    </Stack>
  </Box>;
}

function DashboardSummary({ trail, reduced }) {
  const reason = trail?.returned ? '서로 다른 사건에서 두 계좌가 반대 방향으로 송금' : '서로 다른 사건에서 같은 계좌의 수취·송금 확인';
  return <AISummaryPanel as="section" reduced={reduced} className="dashboard-priority-panel">
    <Heading className="dashboard-priority-heading"><Sparkles className="icon" aria-hidden="true" />분석 추천</Heading>
    {trail ? <Stack as="figure" className="dashboard-account-trail">
      <Text as="figcaption" className="dashboard-trail-reason">{reason}{trail.sameAmount ? ' · 같은 통화와 금액' : ''}</Text>
      <AccountTrailGraph comparison={trail.comparison} focus={trail.account} />
      <Heading level={3} className="dashboard-trail-step-heading">권장 확인 순서</Heading>
      <Box as="ol" className="dashboard-trail-records" aria-label="권장 확인 순서 · 한국 표준시">
        <EvidenceRecord evidence={trail.received} direction="공유 계좌 수취 확인" />
        <EvidenceRecord evidence={trail.sent} direction={trail.returned ? '원 송금 계좌로 향한 후속 거래 확인' : '공유 계좌 후속 송금 확인'} />
      </Box>
    </Stack> : <Text className="dashboard-trail-empty">조회 범위에서 함께 확인할 Alert·Episode 관계가 없습니다.</Text>}
  </AISummaryPanel>;
}

function interleaveCaseKinds(records) {
  const alerts = records.filter(row => row.kind === 'Alert');
  const episodes = records.filter(row => row.kind === 'Episode');
  return Array.from({ length: Math.max(alerts.length, episodes.length) }, (_, index) =>
    [alerts[index], episodes[index]].filter(Boolean)).flat();
}

function WorkBoard({ records, mine, sort, appearance, statusByCode }) {
  return <Box as="section" className="dashboard-board" aria-label={mine ? '내 담당 업무' : '업무 현황'}>
    <Box as="header" className="dashboard-board-heading">
      <Heading id="dashboard-work-title" tabIndex={-1}>{mine ? '내 업무 현황' : '업무 현황'}</Heading>
      <Box data-dashboard-sort-tags></Box>
      <Box className="dashboard-board-actions">
        <Box data-dashboard-sort></Box>
        <BoardSectionDownload records={records} label="업무 현황" onDownload={rows => exportCases(rows, 'work-board')} />
      </Box>
    </Box>
    <Box className="dashboard-board-scroll">
      <CaseProgressBoard rows={records} reduced={appearance.reduced} theme={appearance.theme} showAssignee={!mine} pageSize={8} statusByCode={statusByCode}
        orderRows={mine && !sort ? interleaveCaseKinds : undefined} />
    </Box>
  </Box>;
}

export function PreviewDashboard({ mine, data, appearance }) {
  const rows = data.board?.content;
  const summary = <DashboardSummary trail={data.accountRecommendation} reduced={appearance.reduced} />;
  return <Box className="preview-dashboard" data-mine={mine}>
    {mine ? <PersonalDashboardOverview recommendation={summary}>
      <PersonalIndicators data={data} reduced={appearance.reduced} />
    </PersonalDashboardOverview> :
      <React.Suspense fallback={<DashboardAnalyticsSkeleton reduced={appearance.reduced} />}>
        <Analytics data={data} reduced={appearance.reduced} summary={summary} />
      </React.Suspense>}
    {rows ? <WorkBoard records={rows}
      mine={mine} sort={data.sort} appearance={appearance} statusByCode={data.investigation.statusByCode} /> : <DashboardBoardSkeleton />}
  </Box>;
}

export function BenchmarkDashboard({ mine, dataset, range, appearance }) {
  const { from, to, days, totals, peak } = benchmarkDashboardMetrics(dataset, range);
  const period = from === to ? from : `${from} ~ ${to}`;
  const peakShare = peak ? share(peak.labeled, totals.labeled) : undefined;
  const chartRows = days.map(day => ({ ...day, label: day.date.slice(5).replace('-', '/') }));
  const fullPatternScope = days.length === dataset.days.length
    && totals.transactions === ibmTotal && totals.labeled === ibmLaundering
    && days[0]?.date === '2022-09-01' && days.at(-1)?.date === '2022-09-18';
  const metric = (label, value, detail, unit = '건') => ({
    label, value, unit, detail, key: `benchmark-${label}`,
  });
  const metrics = [
    metric('전체 거래', totals.transactions),
    metric('원본 세탁 라벨 거래', totals.labeled),
    metric('원본 세탁 라벨 비율', share(totals.labeled, totals.transactions),
      `${count(totals.labeled)} ÷ ${count(totals.transactions)}`, ''),
    metric('처음 등장한 계좌', totals.newAccounts, `최초 등장 은행 코드 ${formatter.format(totals.newBanks)}개`, '개'),
  ];
  return <Box className="preview-dashboard preview-benchmark-dashboard" data-mine={mine}>
    {mine && <Panel as="article" className="dashboard-personal-status">
      <Heading>내 담당 업무</Heading>
      <Text className="dashboard-note">개인 담당 업무를 표시하려면 기관의 업무 데이터 연결이 필요합니다.</Text>
    </Panel>}
    <Box as="section" className="dashboard-top" aria-label="원본 거래 요약 및 주요 지표">
      <Panel as="article" className="dashboard-summary-card">
        <Heading>원본 거래 요약</Heading>
        <Text as="strong">{peak ? `${peak.date} · 세탁 라벨 ${count(peak.labeled)}`
          : (totals.transactions ? '조회 기간에 세탁 라벨 거래가 없습니다.' : '조회 기간에 거래가 없습니다.')}</Text>
        {peak && <Text>기간 내 최다 · 라벨 거래의 {peakShare}</Text>}
        <Text className="dashboard-note">{dataset.source} · {period} · 원본 거래 일자 기준</Text>
        <Box className="dashboard-summary-links">
          <ActionButton className="dashboard-summary-link" as="a" href="/benchmark/ledger?view=table" shape="pill" surface="floating">
            거래 원장 열기 <ArrowUpRight className="icon icon-compact" aria-hidden="true" />
          </ActionButton>
          <ActionButton className="dashboard-summary-link" as="a" href="/dashboard/all" shape="pill">업무 대시보드로 돌아가기</ActionButton>
        </Box>
      </Panel>
      <Metrics items={metrics} appearance={appearance} />
    </Box>
    {chartRows.length > 0 && <React.Suspense fallback={<BenchmarkAnalyticsSkeleton showPatterns={fullPatternScope} />}>
      <BenchmarkCharts chartRows={chartRows} totals={totals} period={period} fullPatternScope={fullPatternScope} reduced={appearance.reduced} />
    </React.Suspense>}
  </Box>;
}
