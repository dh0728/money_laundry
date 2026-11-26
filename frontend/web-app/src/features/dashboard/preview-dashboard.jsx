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
import { csvDownloadEntry } from '../../components/query-controls';
import { BoardSectionDownload, SectionDownloadHeading } from '../../components/section-download';
import { Box, Heading, Stack, Text } from '../../components/layout-primitives';
import { LinkTag, VerdictTag, verdictLabels } from '../../components/semantic-tags';
import { AccountTrailGraph } from '../../components/charts/charts/account-trail-graph';
import { dataSeriesColors, transactionTotalColor } from '../../components/charts/charts/chart-context';
import { StagedSankey } from '../../components/charts/charts/sankey/staged-sankey';
import { useElementSize } from '../../components/charts/charts/use-element-size';
import { AreaSparkline } from '../../components/charts/sparkline';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import { previewJudgmentReason } from '../investigation/case-judgment-data';
import { workRequestUserName } from '../investigation/preview-work-requests';
import { flowColors, personalInvestigationFlow, reviewStatusTotals, share as compactShare } from './dashboard-flows';

const formatter = new Intl.NumberFormat('ko-KR');
const count = value => `${formatter.format(value)}건`;
const smallPercent = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 3 });
const share = (value, total) => total ? smallPercent.format(value / total) : '—';
const animated = new Set();
const Analytics = React.lazy(() => import('./dashboard-analytics').then(module => ({ default: module.Analytics })));
const BenchmarkCharts = React.lazy(() => import('./dashboard-analytics').then(module => ({ default: module.BenchmarkCharts })));

function dailyTrend(rows, measure, color, { rate = false, caption = '일별 · KST', comparison } = {}) {
  return {
    rows: (rows ?? []).map(row => ({ date: row.date, value: measure(row), comparison: comparison?.measure(row) })),
    color, rate, caption, comparison,
  };
}

function dailyRate(value, total) {
  return Number.isFinite(value) && Number.isFinite(total) && total > 0 ? value / total : null;
}

function unfinishedStatusTrend(rows) {
  return dailyTrend(rows, row => {
    const { unfinished, total } = reviewStatusTotals([row]);
    return dailyRate(unfinished, total);
  }, flowColors.inProgress, { rate: true, caption: '생성일별 현재 상태 · KST' });
}

function MetricTrend({ label, trend, reduced }) {
  const known = trend.rows.filter(({ value }) => Number.isFinite(value));
  if (!known.length || (!trend.rate && !known.some(({ value }) => value > 0))) return null;
  return <MetricTrendPlot label={label} trend={trend} known={known} reduced={reduced} />;
}

function MetricTrendPlot({ label, trend, known, reduced }) {
  const [index, setIndex] = React.useState(null);
  const plot = React.useRef(null);
  const { height } = useElementSize(plot);
  const formatValue = value => Number.isFinite(value) ? (trend.rate ? smallPercent.format(value) : count(value)) : '집계 없음';
  const comparison = trend.comparison;
  const values = dataKey => trend.rows.map(row => `${row.date} ${formatValue(row[dataKey])}`).join(', ');
  const yDomain = trend.rate ? [0, 1] : [0, comparison ? Math.max(...known.map(({ value }) => value)) : undefined];
  const point = trend.rows[index];
  const onKeyDown = event => {
    if (event.key === 'Escape') {
      setIndex(null);
      return;
    }
    const last = trend.rows.length - 1;
    const current = index ?? 0;
    const keys = { ArrowLeft: Math.max(0, current - 1), ArrowRight: Math.min(last, current + 1), Home: 0, End: last };
    if (!Object.hasOwn(keys, event.key)) return;
    event.preventDefault();
    setIndex(keys[event.key]);
  };
  return <Box className="dashboard-metric-trend">
    <Text as="span" className="dashboard-note">{trend.caption}</Text>
    <TooltipProvider>
      <Tooltip open={Boolean(point)} disableHoverableContent>
        <TooltipTrigger asChild>
          <Box ref={plot} className="dashboard-metric-trend-plot" tabIndex={0} aria-label={`${label} 일별 추이, 좌우 방향키로 날짜 이동`}
            onFocus={event => { if (event.currentTarget.matches(':focus-visible')) setIndex(0); }}
            onBlur={() => setIndex(null)} onKeyDown={onKeyDown}>
            <AreaSparkline data={trend.rows} dataKey="value" color={trend.color} height={height} yDomain={yDomain}
              endDot={known.length === 1} animate={!reduced} hoverTransition={!reduced} hoverIndex={index}
              interactive={!comparison} onHoverChange={setIndex} crosshair={comparison ? false : undefined}
              aria-label={`${comparison ? '들어온 거래' : label} ${trend.caption} · ${values('value')}`} />
            {comparison && <AreaSparkline data={trend.rows} dataKey="comparison" color={comparison.color} height={height} yDomain={yDomain}
              endDot={known.length === 1} animate={!reduced} hoverTransition={!reduced} hoverIndex={index} onHoverChange={setIndex}
              aria-label={`${comparison.label} ${trend.caption} · ${values('comparison')}`} />}
          </Box>
        </TooltipTrigger>
        {point && <TooltipContent className="dashboard-metric-tooltip">
          <Text as="time" dateTime={point.date}>{point.date} KST</Text>
          <Text as="strong">{comparison && '들어온 거래 '}{formatValue(point.value)}</Text>
          {comparison && <Text as="strong">{comparison.label} {formatValue(point.comparison)}</Text>}
        </TooltipContent>}
      </Tooltip>
    </TooltipProvider>
  </Box>;
}

function MetricComparison({ comparison, relation }) {
  const { numerator, denominator, numeratorRelation, denominatorRelation } = comparison;
  const valueRef = React.useRef(null);
  React.useLayoutEffect(() => {
    const value = valueRef.current;
    if (!value) return;
    let active = true;
    let frame = 0;
    let observedWidth;
    const fit = () => {
      if (!active || !value.clientWidth) return;
      value.style.removeProperty('--dashboard-comparison-fit');
      const available = value.clientWidth;
      const textWidth = value.scrollWidth;
      if (textWidth > available) {
        const fullSize = Number.parseFloat(getComputedStyle(value).fontSize);
        value.style.setProperty('--dashboard-comparison-fit', `${Math.floor(fullSize * available / textWidth)}px`);
      }
    };
    const scheduleFit = () => {
      if (!active) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    fit();
    const observer = new ResizeObserver(([entry]) => {
      const { width } = entry.contentRect;
      if (width === observedWidth) return;
      observedWidth = width;
      scheduleFit();
    });
    observer.observe(value.parentElement);
    document.fonts?.ready.then(scheduleFit);
    return () => { active = false; cancelAnimationFrame(frame); observer.disconnect(); };
  }, [numerator, denominator]);

  return <Text as="strong" ref={valueRef} className="dashboard-metric-value dashboard-metric-comparison"
    data-dashboard-metric-source={denominatorRelation ? undefined : relation}>
    <Text as="span" data-kpi-tone="suspect" data-dashboard-metric-source={numeratorRelation}>{formatter.format(numerator)}</Text>{' / '}
    <Text as="span" data-dashboard-metric-source={denominatorRelation}>{formatter.format(denominator)}</Text>
    {denominator > 0 && <Text as="span" data-kpi-tone="suspect">{' '}({compactShare(numerator, denominator)})</Text>}
  </Text>;
}

function Metric({ item, reduced }) {
  const { label, value, unit, detail, key, relation, comparison, tone, trend } = item;
  const wide = (typeof value === 'number' ? formatter.format(value).length : value.length) >= 8;
  const reading = <Box className="dashboard-metric-reading">
      <Text as="strong" className="dashboard-metric-value" data-wide-value={wide || undefined}
        data-dashboard-metric-source={relation} data-kpi-tone={value === '—' ? undefined : tone}>
        {typeof value === 'number' && !reduced && !animated.has(key)
          ? <CountUp to={value} className="count-up-fast" trigger="view" separator="," onEnd={() => animated.add(key)} />
          : typeof value === 'number' ? formatter.format(value) : value}
        {unit && <Text as="small">{unit}</Text>}
      </Text>
    </Box>;
  return <Box className="dashboard-metric">
    <SectionDownloadHeading as="h3">{label}</SectionDownloadHeading>
    {comparison ? <MetricComparison comparison={comparison} relation={relation} /> : reading}
    {detail && <Text>{detail}</Text>}
    {trend && <MetricTrend label={label} trend={trend} reduced={reduced} />}
  </Box>;
}

function Metrics({ items, appearance }) {
  return <DashboardMetricGrid items={items.map(item => ({
    id: item.key,
    content: <Metric item={item} reduced={appearance.reduced} />,
  }))} appearance={appearance} />;
}

function institutionMetricCards(data, reduced) {
  const { coverageScope, investigation, linked, operationalDaily, dailyAlertStatus, dailyEpisodeStatus } = data;
  const total = data.transactions.length;
  const suspicious = data.suspicious.length;
  const institution = coverageScope === 'institution';
  const alerts = reviewStatusTotals(dailyAlertStatus);
  const episodes = reviewStatusTotals(dailyEpisodeStatus);
  const alertTotal = investigation?.totalAlerts;
  const metrics = [
    { label: '의심 거래 / 들어온 거래', value: total,
      relation: total > 0 ? 'transactions' : undefined,
      detail: institution ? undefined : '선택 업무의 근거 거래',
      tone: 'neutral',
      trend: dailyTrend(operationalDaily, row => row.total, transactionTotalColor, {
        comparison: { label: '의심 거래', measure: row => row.suspicious, color: flowColors.suspect },
      }),
      comparison: { numerator: suspicious, denominator: total,
        numeratorRelation: suspicious > 0 ? 'suspicious' : undefined,
        denominatorRelation: total > 0 ? 'transactions' : undefined } },
    { label: '생성 Alert', value: alertTotal ?? '—', unit: alertTotal == null ? undefined : '건',
      relation: alertTotal > 0 ? 'created-alerts' : undefined,
      trend: dailyTrend(operationalDaily, row => row.alerts, dataSeriesColors.teal) },
    { label: '의심 거래 중 Alert 편입', value: linked == null ? '—' : compactShare(linked, suspicious),
      detail: linked == null ? 'Alert 연결 집계 미제공' : undefined,
      tone: 'suspect',
      trend: dailyTrend(operationalDaily, row => dailyRate(row.linked, row.suspicious), flowColors.suspect, { rate: true }),
      comparison: linked == null ? null : { numerator: linked, denominator: suspicious },
      relation: linked > 0 ? 'linked' : undefined },
    { label: '미처리 Alert', value: compactShare(alerts.unfinished, alerts.total), compact: true,
      detail: dailyAlertStatus ? `Alert ${count(alerts.total)} 중 ${count(alerts.unfinished)} · 검토 대기와 처리 중` : 'Alert 상태 집계 미제공',
      tone: 'in-progress',
      trend: unfinishedStatusTrend(dailyAlertStatus),
      relation: alerts.unfinished > 0 ? 'open-alerts' : undefined },
    { label: '미완료 Episode', value: compactShare(episodes.unfinished, episodes.total), compact: true,
      detail: dailyEpisodeStatus ? `Episode ${count(episodes.total)} 중 ${count(episodes.unfinished)} · 처리 중` : 'Episode 상태 집계 미제공',
      tone: 'in-progress',
      trend: unfinishedStatusTrend(dailyEpisodeStatus),
      relation: episodes.total > 0 ? 'open-episodes' : undefined },
  ];
  return metrics.map(item => <Panel as="article" key={item.label} data-compact-kpi={item.compact || undefined}>
    <Metric item={{ ...item, key: `institution-${item.label}` }} reduced={reduced} />
  </Panel>);
}

const personalStages = ['배정된 업무', '현재 상태', '완료 판정'];
const historyClock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short',
});

function PersonalInvestigation({ data, reduced }) {
  const flow = personalInvestigationFlow(data.mine, data.investigation);
  return <Panel as="article" className="dashboard-chart dashboard-personal-flow">
    <SectionDownloadHeading downloadLabel={flow.hasData ? '내 담당 업무 처리 흐름' : undefined}>내 담당 업무 처리 흐름</SectionDownloadHeading>
    {flow.hasData ? <StagedSankey data={flow} stages={personalStages} label="내 담당 업무 처리 흐름" reduced={reduced} />
      : <Text className="dashboard-note">조회 조건에 맞는 배정 업무가 없습니다.</Text>}
  </Panel>;
}

function WorkHistoryPanel({ title, entries, empty, renderEntry, exportFile, exportColumns, exportRow }) {
  const downloads = entries?.length ? [csvDownloadEntry(title, exportFile, ['시각 (KST)', '업무 ID', ...exportColumns],
    entries.map(entry => [historyClock.format(new Date(entry.at)), entry.code, ...exportRow(entry)]))] : [];
  return <Panel as="section" className="dashboard-chart dashboard-personal-history">
    <SectionDownloadHeading entries={downloads}>{title}</SectionDownloadHeading>
    {entries?.length ? <>
      <Text className="dashboard-note">한국 표준시</Text>
      <Box as="ol" className="dashboard-work-history" aria-label={title} tabIndex={0}>
        {entries.map(entry => <Box as="li" key={entry.id}>
          <Stack>
            <Stack direction="row" wrap align="center">
              {renderEntry(entry)}
              <Text as="time" className="dashboard-note dashboard-history-time" dateTime={entry.at}>
                {historyClock.format(new Date(entry.at))}
              </Text>
            </Stack>
            {entry.judgment?.reason && <Text as="span">{previewJudgmentReason(entry.judgment)}</Text>}
          </Stack>
        </Box>)}
      </Box>
    </> : <Text className="dashboard-note">{entries === null ? '담당 변경 기록을 불러오지 못했습니다.' : empty}</Text>}
  </Panel>;
}

function AssignmentHistoryEntry({ entry }) {
  const { code, incoming, previous, next } = entry;
  const sender = incoming ? workRequestUserName(previous) : '나';
  const recipient = incoming ? '나' : workRequestUserName(next);

  return <>
    <Text as="strong">{incoming ? '받음' : '넘김'}</Text>
    <Stack direction="row" wrap align="center">
      <Text as="span">{sender} →</Text>
      <LinkTag code={code} />
      <Text as="span">→ {recipient}</Text>
    </Stack>
  </>;
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

function timeBetweenTransactions(trail) {
  const minutes = Math.floor((trail.sent.time - trail.received.time) / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const remainder = minutes % 60;
  return [days && `${days}일`, hours && `${hours}시간`, remainder && `${remainder}분`]
    .filter(Boolean).join(' ') || '1분 이내';
}

function DashboardSummary({ trail, reduced, showContext }) {
  const downloads = trail ? [csvDownloadEntry('분석 추천 근거 거래', 'recommendation-evidence',
    ['순서', '업무 ID', '거래 ID', '송금 계좌', '수취 계좌', '시각 (KST)', '금액', '통화'],
    [trail.received, trail.sent].map(({ record, transaction }, index) => [
      index + 1, record.code, transaction.code, transaction.from.code, transaction.to.code,
      transaction.timestamp, transaction.amount, transaction.currency,
    ]))] : [];
  return <AISummaryPanel as="section" reduced={reduced} className="dashboard-priority-panel">
    <SectionDownloadHeading headingClassName="dashboard-priority-heading" downloadLabel={trail ? '분석 추천' : undefined}
      entries={downloads} readRoot={host => host.closest('.dashboard-priority-panel').querySelector('.account-trail-network')}>
      <Sparkles className="icon" aria-hidden="true" />분석 추천
    </SectionDownloadHeading>
    {trail ? <Stack as="figure" className="dashboard-account-trail">
      <Text as="figcaption" className="dashboard-trail-reason">
        공유 계좌 {trail.account}에서 수취 후 {timeBetweenTransactions(trail)} 만에
        {trail.returned ? ' 원 송금 계좌로 다시 송금' : ' 후속 송금'}
        {trail.sameAmount ? ' · 같은 통화와 금액' : ''}
      </Text>
      <AccountTrailGraph key={`${trail.received.transaction.code}/${trail.sent.transaction.code}`} comparison={trail.comparison} focus={trail.account} alwaysShowContext={showContext} />
      <Heading level={3} className="dashboard-trail-step-heading">먼저 확인할 거래</Heading>
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
  const title = mine ? '내 업무 현황' : '업무 현황';
  const rows = records.map(row => {
    const status = statusByCode?.[row.code] ?? row.status;
    return status === row.status ? row : { ...row, status };
  });
  return <Box as="section" className="dashboard-board" aria-label={mine ? '내 담당 업무' : title}>
    <Box as="header" className="dashboard-board-heading">
      <Heading id="dashboard-work-title" tabIndex={-1}>{title}</Heading>
      <Box data-dashboard-sort-tags></Box>
      <Box className="dashboard-board-actions">
        <Box data-dashboard-sort></Box>
        <BoardSectionDownload records={rows} label={title} file="work-board" />
      </Box>
    </Box>
    <Box className="dashboard-board-scroll">
      <CaseProgressBoard rows={rows} reduced={appearance.reduced} theme={appearance.theme} showAssignee={!mine}
        plainCount pageSize={8}
        orderRows={mine && !sort ? interleaveCaseKinds : undefined} />
    </Box>
  </Box>;
}

export function PreviewDashboard({ mine, data, appearance }) {
  const rows = data.board?.content;
  const summary = <DashboardSummary trail={data.accountRecommendation} reduced={appearance.reduced} showContext={!mine} />;
  return <Box className="preview-dashboard" data-mine={mine}>
    {mine ? <PersonalDashboardOverview recommendation={summary}>
      <PersonalInvestigation data={data} reduced={appearance.reduced} />
      <WorkHistoryPanel title="내 담당 변경 기록" entries={data.workHistory?.assignments} empty="담당자가 바뀐 기록이 없습니다."
        exportFile="assignment-history" exportColumns={['방향', '보낸 담당자', '받은 담당자']}
        exportRow={entry => [entry.incoming ? '받음' : '넘김', workRequestUserName(entry.previous), workRequestUserName(entry.next)]}
        renderEntry={entry => <AssignmentHistoryEntry entry={entry} />} />
      <WorkHistoryPanel title="내 담당 판정 기록" entries={data.workHistory?.judgments} empty="기록된 판정이 없습니다."
        exportFile="personal-judgment-history" exportColumns={['판정', '판정 사유']}
        exportRow={entry => [verdictLabels[entry.verdict], entry.judgment?.reason ? previewJudgmentReason(entry.judgment) : '']}
        renderEntry={entry => <><LinkTag code={entry.code} /><VerdictTag verdict={entry.verdict} /></>} />
    </PersonalDashboardOverview> : (
      <React.Suspense fallback={<DashboardAnalyticsSkeleton reduced={appearance.reduced} />}>
        <Analytics data={data} reduced={appearance.reduced} summary={summary} metrics={institutionMetricCards(data, appearance.reduced)} />
      </React.Suspense>
    )}
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
        <SectionDownloadHeading entries={totals.transactions ? [csvDownloadEntry('원본 거래 요약', 'ibm-hi-small-summary',
          ['시작일', '종료일', '전체 거래 수', '세탁 라벨 거래 수', '최초 등장 계좌 수', '최초 등장 은행 코드 수', '세탁 라벨 최다 일자', '당일 건수'],
          [[from, to, totals.transactions, totals.labeled, totals.newAccounts, totals.newBanks, peak?.date, peak?.labeled]])] : []}>
          원본 거래 요약
        </SectionDownloadHeading>
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
