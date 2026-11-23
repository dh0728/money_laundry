import React from 'react';
import { Panel } from '../../components/panel';
import { AISummaryPanel } from '../../components/ai-summary-panel';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import CountUp from '../../components/react-bits/CountUp';
import { CaseProgressBoard } from '../investigation/preview-case-card';
import { DashboardAnalyticsSkeleton, DashboardBoardSkeleton, DashboardMetricGrid } from './dashboard-layout';
import { AreaSparkline, BarSparkline, LineSparkline } from '../../components/charts/sparkline';
import { BarChart } from '../../components/charts/charts/bar-chart';
import { Bar } from '../../components/charts/charts/bar';
import { ChartTooltip } from '../../components/charts/charts/tooltip/chart-tooltip';
import { Gauge } from '../../components/charts/registry/gauge';
import { ibmLaundering, ibmTotal } from '../investigation/ibm-hi-small-aggregate';
import { benchmarkDashboardMetrics } from './benchmark-dashboard-metrics';
import { ActionButton } from '../../components/primary-button';
import { exportCases } from '../../components/query-controls';
import { BoardSectionDownload, SectionDownloadHeading } from '../../components/section-download';
import { modelRiskBand, modelRiskLabels } from '../settings/model-risk-settings';

const formatter = new Intl.NumberFormat('ko-KR');
const percent = (count, total) => `${total ? Math.round(count / total * 1000) / 10 : 0}%`;
// A rate with no denominator is not 0%: show a dash and say there was nothing to count.
const rate = (count, total) => total ? percent(count, total) : '—';
const count = value => `${formatter.format(value)}건`;
const smallPercent = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 3 });
const share = (value, total) => total ? smallPercent.format(value / total) : '—';
const animated = new Set();
const Analytics = React.lazy(() => import('./dashboard-analytics').then(module => ({ default: module.Analytics })));
const BenchmarkCharts = React.lazy(() => import('./dashboard-analytics').then(module => ({ default: module.BenchmarkCharts })));
const sparklines = { area: AreaSparkline, line: LineSparkline, bar: BarSparkline };

function usePlotHeight(enabled, initialHeight) {
  const plot = React.useRef(null);
  const [height, setHeight] = React.useState(initialHeight);
  React.useLayoutEffect(() => {
    const host = plot.current;
    if (!enabled || !host) return;
    const measure = () => {
      if (host.clientHeight > 0) setHeight(host.clientHeight);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [enabled]);
  return [plot, height];
}

const instant = { duration: 0 };

// Completion share against a fixed 0–100% track: one value, so a linear gauge instead of a bar series.
function CompletionGauge({ label, value, total, reduced }) {
  return <div className="dashboard-completion-plot" role="img" aria-label={`${label} · 전체 ${count(total)} 중 ${count(value)} 완료`}>
    <Gauge orientation="linear" value={value / total * 100} minWidth={0} linearHeight={28} totalNotches={32}
      activeFill="var(--chart-completion)" inactiveFill="var(--chart-total)" inactiveFillOpacity={1}
      enterTransition={reduced ? instant : undefined} />
  </div>;
}

// New accounts and new owners count different things, so each gets its own row and scale instead of sharing one bar length.
function DailyBarsRow({ rows, item, reduced }) {
  return <div className="dashboard-metric-trend">
    <span className="dashboard-note">{item.label} · {item.unit}</span>
    <div className="dashboard-metric-plot">
      <BarChart className="dashboard-metric-bars" data={rows} xDataKey="label" aspectRatio="auto" margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
        animationDuration={reduced ? 0 : 340}>
        <Bar dataKey={item.key} fill={item.color} lineCap="round" animate={!reduced} />
        <ChartTooltip showCrosshair={false} showDatePill={false} showDots={false} damping={reduced ? 0 : 25}
          rows={point => [{ label: `${point.label} ${item.label}`, color: item.color, value: `${formatter.format(point[item.key])}${item.unit}` }]} />
      </BarChart>
    </div>
  </div>;
}

function Metric({ item, reduced }) {
  const { label, value, unit, detail, key, completion } = item;
  const trend = item.trend?.rows.some(row => row[item.trend.key] > 0) ? item.trend : undefined;
  const Sparkline = sparklines[trend?.type] ?? BarSparkline;
  const describe = row => trend?.describe ? trend.describe(row) : count(row[trend.key]);
  const [hoverIndex, setHoverIndex] = React.useState(null);
  const hoveredHour = hoverIndex === null ? undefined : trend?.rows[hoverIndex];
  const wideValue = (typeof value === 'number' ? formatter.format(value).length : value.length) >= 8;
  const hasChart = Boolean(trend || completion?.total || item.groups);
  const [plot, plotHeight] = usePlotHeight(Boolean(trend), 48);
  return <div className="dashboard-metric" data-export-visualization={hasChart || undefined}>
    <SectionDownloadHeading as="h3" downloadLabel={hasChart ? label : undefined}>{label}</SectionDownloadHeading>
    <div className="dashboard-metric-reading">
      <strong className="dashboard-metric-value" data-composite={Array.isArray(value) || undefined} data-wide-value={wideValue || undefined}>
        {typeof value === 'number' && !reduced && !animated.has(key)
          ? <CountUp to={value} duration={0.45} trigger="view" separator="," onEnd={() => animated.add(key)} />
          : typeof value === 'number' ? formatter.format(value)
            : Array.isArray(value) ? value.map(({ amount, unit: partUnit }, index) =>
              <React.Fragment key={index}>
                {index > 0 && <small aria-hidden="true">{item.separator}</small>}
                <span>{formatter.format(amount)}{partUnit && <small>{partUnit}</small>}</span>
              </React.Fragment>) : value}
        {unit && <small>{unit}</small>}
      </strong>
    </div>
    {detail && <p>{detail}</p>}
    {completion?.total > 0 && <CompletionGauge label={label} reduced={reduced} {...completion} />}
    {item.groups && <div className="dashboard-metric-trend">
      {item.groups.series.map(series => <DailyBarsRow key={series.key} rows={item.groups.rows} item={series} reduced={reduced} />)}
      <p className="visually-hidden">{label} · {item.groups.rows.map(row =>
        `${row.label} ${item.groups.series.map(series => `${series.label} ${formatter.format(row[series.key])}${series.unit}`).join(' ')}`).join(', ')}</p>
      <span className="dashboard-note">{item.groups.caption}</span>
    </div>}
    {trend && <div className="dashboard-metric-trend">
      <div className="dashboard-metric-plot" ref={plot}>
        <Sparkline data={trend.rows} dataKey={trend.key} color={trend.color} height={plotHeight}
          {...(Sparkline === BarSparkline
            ? { barRadius: 6, ...(trend.overlay && { overlayKey: trend.overlay.key, overlayColor: trend.overlay.color }) }
            : { curve: 'monotone', strokeWidth: 2, fillOpacity: 0.38 })}
          onHoverChange={setHoverIndex} crosshair="dashed" dot={false} animate={!reduced}
          aria-label={`${label} · ${trend.caption} · ${trend.rows.map(row => `${row.label} ${describe(row)}`).join(', ')}`} />
      </div>
      <span className="dashboard-note">{hoveredHour
        ? `${hoveredHour.label} KST · ${describe(hoveredHour)}`
        : trend.caption}</span>
    </div>}
  </div>;
}

function Metrics({ items, wide, appearance }) {
  return <DashboardMetricGrid items={items.map(item => ({
    id: item.key,
    // Charts whose up-and-down swing drives the call (spikes in inflow, suspicion, new accounts, Alerts) get two rows; backlog and ratio levels stay one row.
    rowSpan: wide && item.swing ? 2 : 1,
    content: <Metric item={item} reduced={appearance.reduced} />,
  }))} wide={wide} appearance={appearance} />;
}

// The summary says what to open next: a sentence, the count, and the list that holds those cases. Creation hour does not change that call, so no chart.
function DashboardAISummary({ headline, reduced, benchmarkLink, listLink, period, children }) {
  return <AISummaryPanel as="article" reduced={reduced}>
    <SectionDownloadHeading className="dashboard-summary-heading">
      <Sparkles className="icon" aria-hidden="true" /> AI 요약
    </SectionDownloadHeading>
    <strong>{headline}</strong>
    {children}
    {listLink && <ActionButton as="a" className="dashboard-summary-link" href={listLink.href} shape="pill" surface="floating">
      {listLink.label} <ArrowUpRight className="icon icon-compact" aria-hidden="true" />
    </ActionButton>}
    <div className="dashboard-summary-footer">
      <p className="dashboard-note">{period.from} ~ {period.to} · KST</p>
      {benchmarkLink && <ActionButton as="a" className="dashboard-summary-link" href="/dashboard/all?data=ibm" surface="ghost" shape="pill">
        IBM 원본 거래 집계 <ArrowUpRight className="icon icon-compact" aria-hidden="true" />
      </ActionButton>}
    </div>
  </AISummaryPanel>;
}

const priorityAlerts = rows => rows.filter(row => row.open && modelRiskBand(row.score) === 'high' && row.elapsed >= 3);

function MineSummary({ data, reduced }) {
  const { high } = modelRiskLabels();
  return <DashboardAISummary headline={`내 담당 미완료 ${count(data.unfinished)}`} period={data.period} reduced={reduced}
    listLink={data.unfinished > 0 ? { href: '/investigate/alerts?view=table', label: 'Alert 목록 열기' } : undefined}>
    {data.unfinished > 0 && <p>{data.urgent > 0
      ? `위험 점수 ${high}이고 3일 이상 경과한 미완료 Alert ${count(data.urgent)}부터 확인하세요.`
      : `위험 점수 ${high}이며 3일 이상 경과한 미완료 Alert가 없습니다.`}</p>}
  </DashboardAISummary>;
}

function DashboardSummary({ data, reduced }) {
  const alerts = priorityAlerts(data.alertCases);
  return <DashboardAISummary headline={alerts.length
    ? `우선 확인할 장기 미처리 고위험 Alert ${count(alerts.length)}` : '장기 미처리 고위험 Alert 없음'}
    period={data.period} reduced={reduced} benchmarkLink
    listLink={alerts.length > 0 ? { href: '/investigate/alerts?view=table', label: 'Alert 목록 열기' } : undefined}>
    {alerts.length > 0 && <p>위험 점수 {modelRiskLabels().high} · 3일 이상 경과 · 미처리 Alert {count(data.alertCases.filter(row => row.open).length)} 중</p>}
  </DashboardAISummary>;
}

function interleaveCaseKinds(records) {
  const alerts = records.filter(row => row.kind === 'Alert');
  const episodes = records.filter(row => row.kind === 'Episode');
  return Array.from({ length: Math.max(alerts.length, episodes.length) }, (_, index) =>
    [alerts[index], episodes[index]].filter(Boolean)).flat();
}

function WorkBoard({ records, mine, sort, appearance }) {
  return <section className="dashboard-board" aria-label={mine ? '내 담당 업무' : '업무 현황'}>
    <header className="dashboard-board-heading">
      <h2>업무 현황</h2>
      <div data-dashboard-sort-tags></div>
      <div className="dashboard-board-actions">
        <div data-dashboard-sort></div>
        <BoardSectionDownload records={records} label="업무 현황" onDownload={rows => exportCases(rows, 'work-board')} />
      </div>
    </header>
    <div className="dashboard-board-scroll">
      <CaseProgressBoard rows={records} reduced={appearance.reduced} theme={appearance.theme} showAssignee={!mine} pageSize={8}
        orderRows={mine && !sort ? interleaveCaseKinds : undefined} />
    </div>
  </section>;
}

export function PreviewDashboard({ mine, data, appearance }) {
  const metric = (label, value, detail, unit = '건') => ({ label, value, unit, detail, key: `${mine}-${label}` });
  const trend = (key, color, type = 'line', rows = data.operationalDaily) =>
    ({ rows, key, color: `var(--chart-${color})`, type, caption: '일별 · KST' });
  const days = data.operationalDaily?.length || 1;
  const openAlerts = data.alertCases.filter(row => row.open).length;
  const openEpisodes = data.cases.filter(row => row.kind === 'Episode' && row.open).length;
  const cohort = data.alertCohort ?? { days: 30, total: 0, completed: 0 };
  // Backlog charts read the cases still open at each day's close, not the ones created that day.
  const backlog = key => ({ ...trend(key, 'neutral', 'area'), caption: '일별 마감 시점 잔량 · KST' });
  const kpis = mine ? [
    { ...metric('미처리 Alert', data.unfinishedAlerts ?? 0, `위험 점수 ${modelRiskLabels().high} ${count(data.highRisk)}`) },
    { ...metric('미완료 Episode', data.unfinishedEpisodes ?? 0, '내 담당 검토 대기·처리 중') },
    { ...metric('3일 이상 경과 Alert', data.overdueAlerts ?? 0, `내 담당 미처리 Alert ${count(data.unfinishedAlerts ?? 0)} 중`) },
    { ...metric('3일 이상 경과 Episode', data.overdueEpisodes ?? 0, `내 담당 미완료 Episode ${count(data.unfinishedEpisodes ?? 0)} 중`) },
  ] : [
    { ...metric('들어온 거래 수', data.transactions.length, `일평균 ${count(Math.round(data.transactions.length / days))} · 거래 발생일 KST`) },
    { ...metric('의심 거래 / 전체 거래', [{ amount: data.suspicious.length }, { amount: data.transactions.length }],
      `의심 비율 ${percent(data.suspicious.length, data.transactions.length)} · 모델 점수 70점 이상`, ''), separator: '/' },
    { swing: true, ...metric('새 계좌 · 새 소유주', [{ amount: data.newAccounts, unit: '개' }, { amount: data.newOwners, unit: '명' }],
      '거래 이력 기준', ''), separator: '·', groups: {
      rows: data.operationalDaily, caption: '일별 · KST', series: [
        { key: 'newAccounts', label: '새 계좌', unit: '개', color: 'var(--chart-neutral)' },
        { key: 'newOwners', label: '새 소유주', unit: '명', color: 'var(--chart-neutral)' },
      ] } },
    { ...metric('생성 Alert', data.alertCases.length, `완료 ${count(data.alertCases.length - openAlerts)} · 미처리 ${count(openAlerts)}`) },
    { ...metric('업무 처리율', rate(cohort.completed, cohort.total), cohort.total
      ? `최근 ${cohort.days}일 생성 Alert ${count(cohort.total)} 중 ${count(cohort.completed)} 완료` : `최근 ${cohort.days}일 생성 Alert 없음`, ''),
      completion: { value: cohort.completed, total: cohort.total } },
    { ...metric('미처리 Alert', openAlerts, `72시간 이상 ${count(data.aged?.alerts ?? 0)}`), trend: backlog('backlogAlerts') },
    { ...metric('의심 거래 중 Alert 편입', rate(data.linked, data.suspicious.length),
      data.suspicious.length ? `의심 거래 ${count(data.suspicious.length)} 중 ${count(data.linked)}` : '의심 거래 없음', '') },
    { ...metric('미완료 Episode', openEpisodes, `72시간 이상 ${count(data.aged?.episodes ?? 0)}`), trend: backlog('backlogEpisodes') },
  ];
  return <div className="preview-dashboard" data-mine={mine}>
    <section className="dashboard-top" aria-label="요약 및 주요 지표">
      {mine ? <MineSummary data={data} reduced={appearance.reduced} /> : <DashboardSummary data={data} reduced={appearance.reduced} />}
      <Metrics items={kpis} wide={!mine} appearance={appearance} />
    </section>
    {!mine && <React.Suspense fallback={<DashboardAnalyticsSkeleton />}>
      <Analytics data={data} reduced={appearance.reduced} />
    </React.Suspense>}
    {data.board
      ? <WorkBoard records={data.board.content} mine={mine} sort={data.sort} appearance={appearance} />
      : <DashboardBoardSkeleton />}
  </div>;
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
  return <div className="preview-dashboard preview-benchmark-dashboard" data-mine={mine}>
    {mine && <Panel as="article" className="glass dashboard-personal-status">
      <h2>내 담당 업무</h2>
      <p className="dashboard-note">개인 담당 업무를 표시하려면 기관의 업무 데이터 연결이 필요합니다.</p>
    </Panel>}
    <section className="dashboard-top" aria-label="원본 거래 요약 및 주요 지표">
      <Panel as="article" className="glass dashboard-summary-card">
        <h2>원본 거래 요약</h2>
        <strong>{peak ? `${peak.date} · 세탁 라벨 ${count(peak.labeled)}`
          : (totals.transactions ? '조회 기간에 세탁 라벨 거래가 없습니다.' : '조회 기간에 거래가 없습니다.')}</strong>
        {peak && <p>기간 내 최다 · 라벨 거래의 {peakShare}</p>}
        <p className="dashboard-note">{dataset.source} · {period} · 원본 거래 일자 기준</p>
        <div className="dashboard-summary-links">
          <ActionButton className="dashboard-summary-link" as="a" href="/benchmark/ledger?view=table" shape="pill" surface="floating">
            거래 원장 열기 <ArrowUpRight className="icon icon-compact" aria-hidden="true" />
          </ActionButton>
          <ActionButton className="dashboard-summary-link" as="a" href="/dashboard/all" shape="pill">업무 대시보드로 돌아가기</ActionButton>
        </div>
      </Panel>
      <Metrics items={metrics} appearance={appearance} />
    </section>
    {chartRows.length > 0 && <React.Suspense fallback={<DashboardAnalyticsSkeleton benchmark showPatterns={fullPatternScope} />}>
      <BenchmarkCharts chartRows={chartRows} totals={totals} period={period} fullPatternScope={fullPatternScope} reduced={appearance.reduced} />
    </React.Suspense>}
  </div>;
}
