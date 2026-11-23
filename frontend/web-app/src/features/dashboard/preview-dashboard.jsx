import React from 'react';
import { Panel } from '../../components/panel';
import { AISummaryPanel } from '../../components/ai-summary-panel';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import CountUp from '../../components/react-bits/CountUp';
import { CaseProgressBoard } from '../investigation/preview-case-card';
import { DashboardAnalyticsSkeleton, DashboardBoardSkeleton, DashboardMetricGrid } from './dashboard-layout';
import { AreaSparkline, BarSparkline, LineSparkline } from '../../components/charts/sparkline';
import { ibmLaundering, ibmTotal } from '../investigation/ibm-hi-small-aggregate';
import { benchmarkDashboardMetrics } from './benchmark-dashboard-metrics';
import { ActionButton } from '../../components/primary-button';
import { exportCases } from '../../components/query-controls';
import { BoardSectionDownload, SectionDownloadHeading } from '../../components/section-download';
import { modelRiskBand, modelRiskLabels } from '../settings/model-risk-settings';

const formatter = new Intl.NumberFormat('ko-KR');
const percent = (count, total) => `${total ? Math.round(count / total * 1000) / 10 : 0}%`;
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

function CompletionBar({ label, value, total }) {
  return <div className="dashboard-completion-plot">
    <svg role="img" aria-label={`${label} · 전체 ${count(total)} 중 ${count(value)} 완료`} width="100%" height="20">
      <rect fill="var(--chart-total)" width="100%" height="100%" rx="10" />
      {value > 0 && <rect fill="var(--chart-completion)" width={`${value / total * 100}%`} height="100%" rx="10" />}
    </svg>
  </div>;
}

function Metric({ item, reduced }) {
  const { label, value, unit, detail, key, completion } = item;
  const trend = item.trend?.rows.some(row => row[item.trend.key] > 0) ? item.trend : undefined;
  const Sparkline = sparklines[trend?.type] ?? BarSparkline;
  const [hoverIndex, setHoverIndex] = React.useState(null);
  const hoveredHour = hoverIndex === null ? undefined : trend?.rows[hoverIndex];
  const wideValue = (typeof value === 'number' ? formatter.format(value).length : value.length) >= 8;
  const hasChart = Boolean(trend || completion?.total);
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
    {completion?.total > 0 && <CompletionBar label={label} {...completion} />}
    {trend && <div className="dashboard-metric-trend">
      <div className="dashboard-metric-plot" ref={plot}>
        <Sparkline data={trend.rows} dataKey={trend.key} color={trend.color} height={plotHeight}
          {...(Sparkline === BarSparkline ? { barRadius: 6 } : { curve: 'monotone', strokeWidth: 2, fillOpacity: 0.38 })}
          onHoverChange={setHoverIndex} crosshair="dashed" dot={false} animate={!reduced}
          aria-label={`${label} · ${trend.caption} · ${trend.rows.map(row => `${row.label} ${count(row[trend.key])}`).join(', ')}`} />
      </div>
      <span className="dashboard-note">{hoveredHour
        ? `${hoveredHour.label} KST · ${count(hoveredHour[trend.key])}`
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

function DashboardAISummary({ headline, alertRows, timeSlots, period, reduced, benchmarkLink, children }) {
  const [hovered, setHovered] = React.useState(null);
  const hasChart = alertRows.length > 0;
  const [plot, plotHeight] = usePlotHeight(hasChart, 96);
  const trend = timeSlots.map(({ label }, hour) => ({ label, value: alertRows.filter(row => row.hour === hour).length }));
  return <AISummaryPanel as="article" reduced={reduced} data-export-visualization={alertRows.length > 0 || undefined}>
    <SectionDownloadHeading className="dashboard-summary-heading" downloadLabel={hasChart ? 'AI 요약' : undefined}>
      <Sparkles className="icon" aria-hidden="true" /> AI 요약
    </SectionDownloadHeading>
    <strong>{headline}</strong>
    {children}
    {hasChart && <figure className="dashboard-summary-trend">
      <figcaption>생성 시간대 · KST</figcaption>
      <div className="dashboard-summary-plot" ref={plot}>
        <BarSparkline data={trend} dataKey="value"
          aria-label={`우선 확인 Alert 생성 시간대 · KST · ${trend.map(row => `${row.label} ${count(row.value)}`).join(', ')}`}
          height={plotHeight} color="var(--chart-risk-high)" barRadius={6} dot={false} crosshair="dashed" animate={!reduced}
          onHoverChange={(_, point) => setHovered(point)} />
      </div>
      <div className="dashboard-summary-trend-axis">
        <span>{hovered ? `${hovered.label} · ${count(hovered.value)}` : trend[0]?.label}</span>
        {!hovered && <span>{trend.at(-1)?.label}</span>}
      </div>
    </figure>}
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
  return <DashboardAISummary headline={`내 담당 미완료 ${count(data.unfinished)}`}
    alertRows={priorityAlerts(data.alertCases.filter(row => row.assigned))} timeSlots={data.hourly} period={data.period} reduced={reduced}>
    {data.unfinished > 0 && <p>{data.urgent > 0
      ? `위험 점수 ${high}이고 3일 이상 경과한 미완료 Alert ${count(data.urgent)}부터 확인하세요.`
      : `위험 점수 ${high}이며 3일 이상 경과한 미완료 Alert가 없습니다.`}</p>}
  </DashboardAISummary>;
}

function DashboardSummary({ data, reduced }) {
  const alerts = priorityAlerts(data.alertCases);
  return <DashboardAISummary headline={alerts.length
    ? `우선 확인할 장기 미처리 고위험 Alert ${count(alerts.length)}` : '장기 미처리 고위험 Alert 없음'}
    alertRows={alerts} timeSlots={data.hourly} period={data.period} reduced={reduced} benchmarkLink>
    {alerts.length > 0 && <p>{modelRiskLabels().high} · 3일 이상 경과</p>}
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
    ({ rows, key, color: `var(--chart-${color})`, type, caption: rows === data.hourly ? '생성 시간대 · KST' : '일별 · KST' });
  const kpis = mine ? [
    { ...metric(`위험 점수 ${modelRiskLabels().high}`, data.highRisk, '내 담당 미처리 Alert'), trend: trend('highRisk', 'risk-high', 'bar', data.hourly) },
    { ...metric('3일 이상 경과', data.overdue, '내 담당 미완료 Alert·Episode'), trend: trend('overdue', 'risk-medium', 'bar', data.hourly) },
  ] : [
    { swing: true, ...metric('들어온 거래 수', data.transactions.length), trend: trend('total', 'arrival', 'area') },
    { swing: true, ...metric('의심 거래 / 전체 거래', [{ amount: data.suspicious.length }, { amount: data.transactions.length }],
      `의심 비율 ${percent(data.suspicious.length, data.transactions.length)}`, ''), separator: '/', trend: trend('suspicious', 'suspect', 'area') },
    { swing: true, ...metric('새 계좌 · 새 소유주', [{ amount: data.newAccounts, unit: '개' }, { amount: data.newOwners, unit: '명' }],
      '거래 이력 기준', ''), separator: '·', trend: { ...trend('newAccounts', 'arrival', 'bar'), caption: '일별 최초 등장 계좌 · KST' } },
    { swing: true, ...metric('생성 Alert', data.alertCases.length), trend: trend('alerts', 'arrival', 'area') },
    { ...metric('업무 처리율', percent(data.settled, data.cases.length), `${count(data.cases.length)} 중 ${count(data.settled)} 완료`, ''),
      completion: { value: data.settled, total: data.cases.length } },
    { ...metric('미처리 Alert', data.alertCases.filter(row => row.open).length, '검토 대기·처리 중'), trend: trend('openAlerts', 'neutral') },
    { ...metric('의심 거래 중 Alert 편입', percent(data.linked, data.suspicious.length), `${count(data.suspicious.length)} 중 ${count(data.linked)}`, ''),
      trend: trend('linked', 'suspect') },
    { ...metric('미완료 Episode', data.cases.filter(row => row.kind === 'Episode' && row.open).length, '검토 대기·처리 중'), trend: trend('openEpisodes', 'neutral') },
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
