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
import { Box, Heading, Stack, Text } from '../../components/layout-primitives';
import { LinkTag, VerdictTag } from '../../components/semantic-tags';
import { AccountTrailGraph } from '../../components/charts/charts/account-trail-graph';
import { StagedSankey } from '../../components/charts/charts/sankey/staged-sankey';
import { previewJudgmentReason } from '../investigation/case-judgment-data';
import { workRequestUserName } from '../investigation/preview-work-requests';
import { personalInvestigationFlow } from './dashboard-flows';

const formatter = new Intl.NumberFormat('ko-KR');
const count = value => `${formatter.format(value)}건`;
const smallPercent = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 3 });
const share = (value, total) => total ? smallPercent.format(value / total) : '—';
const animated = new Set();
const Analytics = React.lazy(() => import('./dashboard-analytics').then(module => ({ default: module.Analytics })));
const BenchmarkCharts = React.lazy(() => import('./dashboard-analytics').then(module => ({ default: module.BenchmarkCharts })));

function Metric({ item, reduced }) {
  const { label, value, unit, detail, key } = item;
  const wide = (typeof value === 'number' ? formatter.format(value).length : value.length) >= 8;
  const reading = <Box className="dashboard-metric-reading">
      <Text as="strong" className="dashboard-metric-value" data-wide-value={wide || undefined}>
        {typeof value === 'number' && !reduced && !animated.has(key)
          ? <CountUp to={value} className="count-up-fast" trigger="view" separator="," onEnd={() => animated.add(key)} />
          : typeof value === 'number' ? formatter.format(value) : value}
        {unit && <Text as="small">{unit}</Text>}
      </Text>
    </Box>;
  return <Box className="dashboard-metric">
    <SectionDownloadHeading as="h3">{label}</SectionDownloadHeading>
    {reading}
    {detail && <Text>{detail}</Text>}
  </Box>;
}

function Metrics({ items, appearance }) {
  return <DashboardMetricGrid items={items.map(item => ({
    id: item.key,
    content: <Metric item={item} reduced={appearance.reduced} />,
  }))} appearance={appearance} />;
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

function WorkHistoryPanel({ title, entries, empty, renderEntry }) {
  return <Panel as="section" className="dashboard-chart dashboard-personal-history">
    <SectionDownloadHeading>{title}</SectionDownloadHeading>
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

function DashboardSummary({ trail, reduced }) {
  return <AISummaryPanel as="section" reduced={reduced} className="dashboard-priority-panel">
    <Heading className="dashboard-priority-heading"><Sparkles className="icon" aria-hidden="true" />분석 추천</Heading>
    {trail ? <Stack as="figure" className="dashboard-account-trail">
      <Text as="figcaption" className="dashboard-trail-reason">
        공유 계좌 {trail.account}에서 수취 후 {timeBetweenTransactions(trail)} 만에
        {trail.returned ? ' 원 송금 계좌로 다시 송금' : ' 후속 송금'}
        {trail.sameAmount ? ' · 같은 통화와 금액' : ''}
      </Text>
      <AccountTrailGraph key={`${trail.received.transaction.code}/${trail.sent.transaction.code}`} comparison={trail.comparison} focus={trail.account} />
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
      <PersonalInvestigation data={data} reduced={appearance.reduced} />
      <WorkHistoryPanel title="내 담당 변경 기록" entries={data.workHistory?.assignments} empty="담당자가 바뀐 기록이 없습니다."
        renderEntry={entry => <AssignmentHistoryEntry entry={entry} />} />
      <WorkHistoryPanel title="내 담당 판정 기록" entries={data.workHistory?.judgments} empty="기록된 판정이 없습니다."
        renderEntry={entry => <><LinkTag code={entry.code} /><VerdictTag verdict={entry.verdict} /></>} />
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
