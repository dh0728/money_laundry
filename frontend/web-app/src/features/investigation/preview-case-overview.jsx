import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { BarSparkline } from '../../components/charts/sparkline';
import { BarChart } from '../../components/charts/charts/bar-chart';
import { Bar } from '../../components/charts/charts/bar';
import { PieChart } from '../../components/charts/charts/pie/pie-chart';
import { PieSlice } from '../../components/charts/charts/pie/pie-slice';
import { useElementSize } from '../../components/charts/charts/use-element-size';
import { ChartTooltip } from '../../components/charts/charts/tooltip/chart-tooltip';
import { previewJudgmentReason } from './case-judgment-data';
import { FooterPagination } from '../../components/radar/footer-pagination';
import { Panel } from '../../components/radar/panel';
import { AISummaryPanel } from '../../components/radar/ai-summary-panel';
import { ChartSectionDownload } from '../../components/radar/section-download';
import { OverviewScoreChart, overviewScorePoints } from './overview-score-chart';
import { CaseActorTag, LinkTag, ModelScoreTag, PatternTag, ReviewStatusTag, StatusTag, VerdictTag } from '../../components/radar/semantic-tags';
import { TransactionEvidenceTable } from './preview-case-table';
import { useCaseEvidenceSelection } from './case-evidence-selection';
import { caseOverviewEvidence, relatedJudgments } from './case-overview-evidence';
import { graphRiskBand } from './case-graph-scope';
import { modelRiskLabels } from '../settings/model-risk-settings';
import './preview-case-overview.css';

const number = new Intl.NumberFormat('ko-KR');
const decimal = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 });
const kst = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' });
const amount = record => `${number.format(record.amount)} ${record.currency}`;
const reviewAssignee = row => row.assigned ? '내 담당' : '다른 담당자';

function EvidencePeriod({ records }) {
  if (!records.length) return '자료 없음';
  const times = records.map(row => row.timestamp).sort();
  const start = times[0];
  const end = times.at(-1);
  const time = value => <time dateTime={value.replace(' ', 'T') + '+09:00'}>
    <span>{value.slice(0, 10)}</span>{' '}<span>{value.slice(11)}</span>
  </time>;
  return <>{time(start)}{start !== end && <> ~ {time(end)}</>} KST</>;
}

function CaseIdentity({ row }) {
  return <div className="semantic-tag-group">
    <VerdictTag verdict={row.verdict} />
    {row.open && row.elapsed >= 3 && <StatusTag preset={row.elapsed > 7 ? 'elapsedOver1w' : 'elapsedUnder1w'}>
      {row.elapsed}일 경과
    </StatusTag>}
    <ReviewStatusTag status={row.status} />
    <PatternTag>{row.pattern}</PatternTag>
    <CaseActorTag>{reviewAssignee(row)}</CaseActorTag>
  </div>;
}

function EvidenceBars({ label, points, unit, reduced, summary }) {
  const [hover, setHover] = useState(null);
  if (points.length < 2) return null;
  const labelPoint = ({ label: period, value }) => `${period} · ${number.format(value)}${unit}`;
  return <figure className="overview-evidence-bars" aria-label={label}>
    <figcaption>{label}</figcaption>
    <BarSparkline data={points} dataKey="value" height={40}
      yDomain={[0, undefined]} color="var(--muted-text)" interactive crosshair="solid"
      dot={false} barRadius={2} animate={!reduced} hoverTransition={!reduced}
      onHoverChange={(_, point) => setHover(point)} aria-label={points.map(labelPoint).join(', ')} />
    <p className="overview-bar-value">{hover ? labelPoint(hover) : summary ?? `${points[0].label} ~ ${points.at(-1).label}`}</p>
  </figure>;
}

function transactionTimeBuckets(records, hours, value = () => 1) {
  if (!records.length) return [];
  const window = hours * 60 * 60 * 1000;
  const time = record => Date.parse(record.timestamp.replace(' ', 'T') + '+09:00');
  const first = time(records[0]);
  const counts = new Map();
  for (const record of records) {
    const start = first + Math.floor((time(record) - first) / window) * window;
    counts.set(start, (counts.get(start) ?? 0) + value(record));
  }
  return [...counts].map(([start, value]) => ({ label: `${kst.format(start)} KST`, value }));
}

function KpiValue({ value, unit }) {
  return <span className="overview-kpi">
    <strong className="overview-kpi-number">{value}</strong>{' '}<span className="overview-kpi-unit">{unit}</span>
  </span>;
}

function CurrencyValues({ flows, field, emphasized = false }) {
  const parts = flows.filter(flow => flow[field] != null);
  if (!parts.length) return '산출 범위 없음';
  return <span className="overview-currency-values" data-emphasized={emphasized || undefined}>
    {parts.map(flow => {
      const ratio = field === 'ratio';
      const value = ratio ? decimal.format(flow.ratio) : number.format(flow[field]);
      const unit = ratio ? `% · ${flow.currency}` : flow.currency;
      return emphasized ? <KpiValue key={flow.currency} value={value} unit={unit} />
        : <span key={flow.currency}>{value}{ratio ? '' : ' '}{unit}</span>;
    })}
  </span>;
}

function FlowSummary({ evidence }) {
  const { focus, flows, inflows, outflows } = evidence;
  if (!flows.length) {
    const totals = [...Map.groupBy(evidence.records, record => record.currency)]
      .map(([currency, records]) => ({ currency, total: records.reduce((sum, record) => sum + record.amount, 0) }));
    return totals.length > 0
      ? <p className="overview-flow-total">연결 거래 금액 <CurrencyValues flows={totals} field="total" /></p>
      : <p className="overview-note">연결된 거래가 없습니다.</p>;
  }
  return <dl className="overview-flow-summary" aria-label="관측 중심 계좌의 거래 흐름">
    <div><dt>관측 유입</dt><dd><CurrencyValues flows={flows} field="inflow" /></dd>
      <dd className="overview-note">{inflows.length}건{inflows.length > 0 && ` · 첫 유입 ${inflows[0].timestamp.slice(11)}`}</dd></div>
    <div className="overview-flow-focus"><dt>관측 중심 계좌</dt><dd><code>{focus.code}</code> · {focus.owner}</dd>
      <dd className="overview-note">순유입 <CurrencyValues flows={flows} field="net" /></dd></div>
    <div><dt>관측 유출</dt><dd><CurrencyValues flows={flows} field="outflow" /></dd>
      <dd className="overview-note">{outflows.length}건{outflows.length > 0 && ` · 마지막 유출 ${outflows.at(-1).timestamp.slice(11)}`}</dd></div>
  </dl>;
}

const overviewChartMargin = { top: 0, right: 0, bottom: 0, left: 0 };

function OverviewBars({ label, measures, max, reduced, format = value => `${number.format(value)}건` }) {
  if (!measures.length) return <p className="overview-note">표시할 데이터가 없습니다.</p>;
  const barColor = point => point.color ?? 'var(--muted-text)';
  return <figure className="overview-horizontal-chart" style={{ '--overview-measures-count': measures.length }} aria-label={label}>
    <ul className="overview-horizontal-labels">
      {measures.map(({ label, value }) => <li key={label}><span>{label}</span><strong>{format(value)}</strong></li>)}
    </ul>
    <BarChart className="overview-horizontal-bars" data={measures} xDataKey="label" orientation="horizontal"
      aspectRatio="auto" horizontalValueDomain={[0, Math.max(max, 1)]} margin={overviewChartMargin}
      barGap={0.3} animationDuration={reduced ? 0 : 320}>
      <Bar dataKey="value" getFill={barColor} lineCap="round" animate={!reduced} />
      <ChartTooltip showDatePill={false} showDots={false} damping={reduced ? 0 : 25}
        rows={point => [{ label: String(point.label), value: format(point.value), color: barColor(point) }]} />
    </BarChart>
  </figure>;
}

function OverviewDonut({ label, segments, reduced }) {
  const plotRef = useRef(null);
  const { width } = useElementSize(plotRef);
  const size = Math.floor(width);
  const data = segments.filter(segment => segment.value > 0);
  if (!data.length) return <p className="overview-note">표시할 데이터가 없습니다.</p>;
  const total = data.reduce((sum, segment) => sum + segment.value, 0);
  return <figure className="overview-donut" aria-label={label}>
    <figcaption>{label}</figcaption>
    <div ref={plotRef} className="overview-donut-plot" aria-hidden="true">
      {size > 0 && <PieChart data={data} size={size} innerRadius={size * 0.34} cornerRadius={8} padAngle={data.length > 1 ? 0.045 : 0}
        startAngle={0} endAngle={Math.PI * 2} geometryScrubbing={reduced}>
        {!reduced && data.map(({ label }, index) => <PieSlice key={label} index={index} />)}
      </PieChart>}
      <span className="overview-donut-total"><strong>{number.format(total)}</strong><span>거래</span></span>
    </div>
    <ul className="overview-score-legend">
      {data.map(({ label, value, color }) => <li key={label}>
        <i style={{ background: color }} aria-hidden="true" />{label} <strong>{number.format(value)}건</strong>
      </li>)}
    </ul>
  </figure>;
}

function FlowCharts({ evidence, reduced }) {
  const { flows, records } = evidence;
  if (!records.length) return <p className="overview-note">연결된 거래가 없습니다.</p>;
  const amounts = flows.length
    ? flows.map(({ currency, inflow, outflow }) => ({
      currency, measures: [{ label: '관측 유입', value: inflow }, { label: '관측 유출', value: outflow }],
    }))
    : [...Map.groupBy(records, record => record.currency)].map(([currency, moves]) => ({
      currency, measures: [...Map.groupBy(moves, record => record.from.code)].map(([label, group]) => ({
        label, value: group.reduce((sum, record) => sum + record.amount, 0),
      })),
    }));
  return <div className="overview-flow-charts">
    {amounts.map(({ currency, measures }) => <section key={currency}>
      <h3>{currency}{!flows.length && ' · 송금 계좌별'}</h3>
      <OverviewBars label={`${currency} 자금 흐름`} measures={measures}
        max={Math.max(...measures.map(measure => measure.value))} reduced={reduced}
        format={value => `${number.format(value)} ${currency}`} />
    </section>)}
  </div>;
}

function ReviewTimeline({ records, row }) {
  const timeline = [];
  const evidenceDate = record => record.timestamp.replace(' ', 'T') + '+09:00';
  if (records.length) timeline.push({ label: '첫 근거 거래', at: evidenceDate(records[0]) });
  if (records.at(-1)?.timestamp !== records[0]?.timestamp) {
    timeline.push({ label: '마지막 근거 거래', at: evidenceDate(records.at(-1)) });
  }
  const completedAt = row.judgment?.at ?? row.completedAt;
  if (completedAt) timeline.push({ label: '처리 완료', at: completedAt, status: 'done' });
  for (const edit of row.membershipHistory ?? []) {
    const label = edit.action === 'remove' ? '근거 거래 제외' : edit.sourceCode === row.code ? '근거 거래 이동' : '근거 거래 편입';
    timeline.push({ label, at: edit.at, edit });
  }
  if (!timeline.length) return <p className="overview-note">세부 변경 시각 없음</p>;
  return <div className="overview-review-timeline">
    <ol aria-label="확인된 업무 시각">
      {timeline.toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at)).map(({ label, at, edit, status }) =>
        <li key={JSON.stringify([label, at, edit?.transactionCodes])} data-review={status}>
          <strong>{label}</strong><time dateTime={at}>{kst.format(new Date(at))} KST</time>
          {edit && <div className="overview-note">
            <p>{edit.reviewer} · {edit.reason}</p>
            <p>{edit.transactionCodes.join(' · ')}{edit.targetCode && <> · {edit.sourceCode} → {edit.targetCode}</>}</p>
          </div>}
        </li>)}
    </ol>
  </div>;
}

function buildPanels(row, evidence, history, activeRules, reduced, evidenceSelection) {
  const { records, accounts, focus, flows, inflows, outflows, lead } = evidence;
  const episode = row.kind === 'Episode';
  const methods = [...Map.groupBy(records, record => record.method)].map(([label, group]) => ({ label, value: group.length }));
  const overlap = row.overlappingAlerts ?? [];
  const prior = relatedJudgments(history, row.code, evidence);
  const otherCount = records.length - inflows.length - outflows.length;
  const composition = focus ? [
    { label: '중심 계좌로 유입', value: inflows.length }, { label: '중심 계좌에서 유출', value: outflows.length },
    { label: '나머지 근거 거래', value: otherCount },
  ].filter(part => part.value > 0) : methods;
  const analysisQuery = new URLSearchParams(location.search);
  analysisQuery.set('tab', 'analysis');
  analysisQuery.delete('mode');
  analysisQuery.delete('panel');
  const accountsQuery = new URLSearchParams(location.search);
  accountsQuery.set('mode', 'per');
  accountsQuery.set('panel', 'accounts');
  const accountMeasures = accounts.map(account => ({ label: account.code, value: account.transactions.size }));
  const scorePoints = overviewScorePoints(records);
  const compositionChart = <OverviewBars label="근거 거래 구성" measures={composition} max={records.length} reduced={reduced} />;
  const overlapNote = episode && overlap.length > 0 && <p>거래 ID 중복 제외 · 거래 공유 Alert {overlap.length}건</p>;
  const panels = {
    judgment: { title: '판단 요약', content: <>
      <p className="semantic-tag-group">사람 판정 <VerdictTag verdict={row.verdict} /></p>
      <p>{focus ? <><code>{focus.code}</code> · 근거 거래 {focus.transactions.size}건 · 유입 {inflows.length}건 · 유출 {outflows.length}건</>
        : <>근거 거래 {records.length}건 · 계좌 {accounts.length}개</>}</p>
      {episode && overlap.length > 0 && <p>거래 공유 Alert {overlap.length}건</p>}
      {row.judgment && <p className="overview-note">판정 사유 · {previewJudgmentReason(row.judgment)}</p>}
      {records.length > 0 && <LinkTag href={`?${analysisQuery}`}>분석에서 자금 흐름 보기</LinkTag>}
    </> },
    accounts: { title: '핵심 계좌', compact: accounts.length > 0 ? <>
      <OverviewBars label="참여 거래가 많은 계좌" measures={accountMeasures.slice(0, 3)}
        max={records.length} reduced={reduced} />
      <LinkTag href={`?${episode ? analysisQuery : accountsQuery}`}>전체 계좌 근거 보기</LinkTag>
    </> : <p className="overview-note">연결된 거래가 없습니다.</p>, content: <>
      {focus && <p>최다 참여 <strong><code>{focus.code}</code></strong> · {focus.transactions.size}/{records.length}건</p>}
      <ul className="overview-fact-list">{accounts.map(({ code, owner, sent, received }) => <li key={code}>
        <code>{code}</code><span>{owner}</span><span className="overview-note">송금 {sent} · 수취 {received}</span>
      </li>)}</ul>
      {episode && overlap.length > 0 && <><h3>거래가 겹치는 Alert · {overlap.length}건</h3>
        <ul className="overview-fact-list">{overlap.map(alert => <li key={alert.code}>
          <LinkTag code={alert.code} /><VerdictTag verdict={alert.verdict} /><PatternTag>{alert.pattern}</PatternTag>
          <span>{records.filter(record => alert.related.some(item => item.code === record.code)).length}건 공유</span>
        </li>)}</ul>
      </>}
    </> },
    past: { title: '과거 판단', content: prior.length ? <>
      <p>공유 계좌가 있는 다른 판정 {prior.length}건</p>
      <ul className="overview-fact-list overview-past-verdicts" tabIndex={0} aria-label="공유 계좌가 있는 판정">
        {prior.map(item => <li key={item.id}>
        <LinkTag href={`/report?selected=${item.id}`} code={item.id} />
        <VerdictTag verdict={item.verdict} />
        {item.at && <time dateTime={item.at}>{kst.format(new Date(item.at))} KST</time>}
        {item.targets.map(target => <span key={target.code} className="overview-shared-target">
          <LinkTag code={target.code} /> · {target.sharedAccounts.join(', ')}
        </span>)}
      </li>)}</ul>
    </> : <p className="overview-note">계좌를 공유하는 과거 판정이 없습니다.</p> },
    history: { title: episode ? '진행 · 최근 처리' : '처리 이력', content: <>
      <p className="semantic-tag-group"><ReviewStatusTag status={row.status} />
        <CaseActorTag>{reviewAssignee(row)}</CaseActorTag></p>
      {records.length > 0 && <p>근거 거래 확인 · <EvidencePeriod records={records} /></p>}
      {row.open && Number.isFinite(row.elapsed) && row.elapsed < 3 && <p>{row.elapsed}일 경과</p>}
      {row.judgment ? <>
        <p>판정자 {row.judgment.reviewer || '기록 없음'} · <time dateTime={row.judgment.at}>{kst.format(new Date(row.judgment.at))} KST</time></p>
        <p>{previewJudgmentReason(row.judgment)}</p>
        <LinkTag href={`/report?selected=${row.judgment.id}`} code={row.judgment.id} />
      </> : !row.open && <p className="overview-note">세부 변경 시각 없음</p>}
    </> },
    detection: { title: '탐지 근거',
      compact: scorePoints.length > 1 ? <OverviewScoreChart points={scorePoints} reduced={reduced} /> : undefined,
      content: <>
      <p className="semantic-tag-group">
        {lead && <ModelScoreTag score={lead.score} />}
        <PatternTag>{row.pattern}</PatternTag>
      </p>
      <p>연결된 근거 거래 {records.length}건{focus && <> · <code>{focus.code}</code>에 {focus.transactions.size}건 집중</>}</p>
      <ul className="overview-fact-list">{records.filter(record => Number.isFinite(record.score))
        .toSorted((a, b) => b.score - a.score).map(record => <li key={record.code}>
          <LinkTag code={record.code} /><ModelScoreTag score={record.score} />
          <span>{record.from.code} → {record.to.code}</span>
        </li>)}</ul>
    </> },
    transactions: {
      title: '씨앗 거래',
      details: <p className="overview-note">씨앗 역할 미기록 · 연결 근거 거래 전체 {records.length}건</p>,
      visualContent: <TransactionEvidenceTable title="근거 거래" transactions={records.toSorted((a, b) => (b.score ?? -1) - (a.score ?? -1))}
        showScore selectionControl={evidenceSelection} />,
    },
    flow: {
      title: '돈의 흐름',
      visualContent: <FlowSummary evidence={evidence} />,
      details: <>
        {records.length > 0 && <p><EvidencePeriod records={records} /> · 근거 거래 {records.length}건 · 원통화 기준</p>}
        {records.length > 0 && <LinkTag href={`?${analysisQuery}`}>분석에서 자금 흐름 보기</LinkTag>}
      </>,
    },
    rules: { title: '룰 적중', content: <>
      <p className="overview-note">탐지 당시 적중 기록이 없습니다.</p>
      {activeRules.length > 0 && <><h3>현재 운영 중인 룰</h3>
        <ul className="overview-fact-list">{activeRules.map(rule => <li key={rule.id}>
          <LinkTag href={`/rules?rule=${rule.id}`} code={rule.id} />
          <strong>v{rule.version} · {rule.name}</strong><span className="overview-shared-target">{rule.conditions}</span>
        </li>)}</ul></>}
    </> },
    composition: {
      title: `구성 · 근거 거래 ${records.length}건`,
      compact: <>{compositionChart}{overlapNote}</>,
      details: <>
        {overlapNote}
        <p className="overview-note">{focus ? <>관측 중심 계좌 <code>{focus.code}</code></> : '결제 수단별 근거 거래'}</p>
      </>,
      visualContent: compositionChart,
      graphic: composition.length > 0,
    },
  };
  const scoresByBand = Map.groupBy(records, record => graphRiskBand(record.score));
  const riskLabels = modelRiskLabels();
  const pastCounts = [...Map.groupBy(prior, item => item.verdict)].map(([verdict, rows]) => ({
    label: verdict === 'abnormal' ? '이상' : '정상', value: rows.length,
    color: verdict === 'abnormal' ? 'var(--status-danger-accent)' : 'var(--status-positive-accent)',
  }));
  const visuals = {
    judgment: <OverviewDonut label="근거 거래의 모델 위험 점수 구간" reduced={reduced} segments={[
      { label: riskLabels.high, color: 'var(--risk-high)', value: scoresByBand.get('high')?.length ?? 0 },
      { label: riskLabels.medium, color: 'var(--risk-medium)', value: scoresByBand.get('medium')?.length ?? 0 },
      { label: riskLabels.low, color: 'var(--risk-low)', value: scoresByBand.get('low')?.length ?? 0 },
      { label: '모델 점수 없음', color: 'var(--divider)', value: scoresByBand.get('unknown')?.length ?? 0 },
    ]} />,
    accounts: <OverviewBars label="계좌별 거래 참여" measures={accountMeasures} max={records.length} reduced={reduced} />,
    past: <OverviewBars label="과거 판정 구성" measures={pastCounts} max={prior.length} reduced={reduced} />,
    history: <ReviewTimeline records={records} row={row} />,
    detection: <OverviewScoreChart points={scorePoints} reduced={reduced} fill />,
    rules: <div className="overview-panel-hero">
      <KpiValue value={activeRules.length} unit="현재 운영 중인 룰" />
    </div>,
  };
  const graphicPanels = { judgment: records.length > 0, accounts: accounts.length > 0, past: prior.length > 0,
    detection: scorePoints.length > 0, flow: records.length > 0 };
  const layout = episode
    ? [['judgment', 1], ['flow', 2], ['history', 1], ['accounts', 1], ['detection', 1], ['rules', 1], ['composition', 2]]
    : [['judgment', 1], ['accounts', 1], ['past', 1], ['history', 1], ['detection', 2], ['composition', 2],
      ['transactions', 'full'], ['flow', 2], ['rules', 2]];
  return layout.map(([id, span], index) => {
    const panel = panels[id];
    const graphic = panel.graphic ?? graphicPanels[id];
    return { id, span, ...panel, number: index + 1,
      visualContent: panel.visualContent ?? visuals[id],
      panelVisual: id === 'flow' ? <FlowCharts evidence={evidence} reduced={reduced} /> : undefined,
      panelDetails: id === 'flow' ? <><FlowSummary evidence={evidence} />{panel.details}</> : undefined,
      graphic,
      overviewGraphic: id === 'detection' ? scorePoints.length > 1 : ['accounts', 'composition'].includes(id) && graphic,
    };
  });
}

function PanelOverview({ panels, initialPanel, paginationHost }) {
  const [index, setIndex] = useState(() => Math.max(0, panels.findIndex(panel => panel.id === initialPanel)));
  const last = panels.length - 1;
  function select(next) {
    if (next < 0 || next > last || next === index) return;
    setIndex(next);
    const url = new URL(location.href);
    url.searchParams.set('panel', panels[next].id);
    history.replaceState(history.state, '', url);
  }
  useEffect(() => {
    const handleKey = event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      if (event.target.closest('input,textarea,select,button,a,[contenteditable],[role="listbox"],[role="slider"],[role="menu"],[role="menuitem"],.screen-table-scroll,#sidebar,#screen-navigation') ||
        document.querySelector('dialog[open], [popover]:popover-open')) return;
      const next = index + (event.key === 'ArrowLeft' ? -1 : 1);
      if (next >= 0 && next <= last) {
        event.preventDefault();
        select(next);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  });
  const panel = panels[index];
  const pager = <FooterPagination host={paginationHost} label="개요 패널 이동" unit="패널"
    page={index} pageCount={panels.length} onPageChange={select}>
    <label className="visually-hidden" htmlFor="case-overview-panel">개요 패널</label>
    <select id="case-overview-panel" value={index} onChange={event => select(Number(event.target.value))}>
      {panels.map(({ id, title, number }, i) => <option key={id} value={i}>{number}. {title}</option>)}
    </select>
  </FooterPagination>;
  return <>
    <div className="overview-panel-layout">
      <Panel className="overview-current" aria-labelledby="overview-current-title" data-export-visualization={panel.graphic || undefined}>
        <div className="section-download-heading">
          <h2 id="overview-current-title">{panel.number}. {panel.title}</h2>
          {panel.graphic && <ChartSectionDownload label={panel.title} />}
        </div>
        <div className="overview-panel-visual">
          {panel.panelVisual ?? panel.visualContent}
        </div>
      </Panel>
      <Panel className="overview-current overview-panel-details" aria-label={`${panel.title} 상세`}>
        {panel.panelDetails ?? panel.details ?? panel.content}
      </Panel>
    </div>
    {pager}
  </>;
}

export function PreviewCaseOverview({ row, perPanel, initialPanel, appearance, history = [], activeRules = [], paginationHost, evidenceSelection }) {
  const selected = useCaseEvidenceSelection(evidenceSelection);
  if (!row) return <p>선택한 사건의 개요를 불러올 수 없습니다.</p>;
  const evidence = caseOverviewEvidence(row.related);
  const { records, accounts, ownerCount, focus, inflows, outflows, flows, lead } = evidence;
  const representative = lead ?? records[0];
  const episode = row.kind === 'Episode';
  const panels = buildPanels(row, evidence, history, activeRules, appearance.reduced,
    evidenceSelection && { selected, change: evidenceSelection.change });
  const window = episode ? 15 : 4;
  const incomingByCurrency = !episode && inflows.length > 0 ? Map.groupBy(inflows, record => record.currency) : null;
  const trendSeries = incomingByCurrency
    ? [...incomingByCurrency].map(([currency, moves]) => ({ label: `4시간 단위 관측 유입 · ${currency}`,
      points: transactionTimeBuckets(moves, 4, move => move.amount), unit: ` ${currency}` }))
    : [{ label: `${window}시간 단위 근거 거래 건수`, points: transactionTimeBuckets(records, window), unit: '건' }];
  const trends = trendSeries.filter(({ points }) => points.filter(point => point.value > 0).length >= 2);
  const boundary = focus && <><code>{focus.code}</code> 기준</>;
  const flowMetric = field => flows.some(flow => flow[field] != null) ? <CurrencyValues flows={flows} field={field} emphasized /> : null;
  const metrics = [
    ['최고 모델 점수', lead ? <KpiValue value={number.format(lead.score)} unit="점" /> : null, lead && <LinkTag code={lead.code} />],
    episode ? ['근거 거래', <KpiValue value={number.format(records.length)} unit="건" />, `거래 공유 Alert ${row.linkedAlerts ?? 0}건`]
      : ['외부 유출', flowMetric('outflow'), flows.length > 0 && <>{outflows.length}건 · {boundary}</>],
    ['계좌 · 소유주', <span className="overview-kpi-values">
      <KpiValue value={number.format(accounts.length)} unit="개" /><KpiValue value={number.format(ownerCount)} unit="명" />
    </span>, `근거 거래 ${records.length}건 기준`],
    ['근거 거래 기간', records.length ? <EvidencePeriod records={records} /> : null],
    ['외부 유입', flowMetric('inflow'), flows.length > 0 && <>{inflows.length}건 · {boundary}</>],
    ['순유입', flowMetric('net'), flows.length > 0 && '통화별 관측 유입 − 유출'],
    ['경유 비율', flowMetric('ratio'), flows.length > 0 && '통화별 관측 유출 ÷ 유입'],
  ];
  return <div className="preview-case-overview" data-per-panel={perPanel}>
    <CaseIdentity row={row} />
    {perPanel ? <PanelOverview panels={panels} initialPanel={initialPanel} paginationHost={paginationHost} /> : <>
      <div className="overview-top">
        <AISummaryPanel className="overview-ai-summary" reduced={appearance.reduced} aria-labelledby="overview-summary-title"
          data-export-visualization={trends.length > 0 || undefined}>
          <div className="section-download-heading">
            <h2 id="overview-summary-title"><Sparkles className="icon" aria-hidden="true" /> AI 요약</h2>
            {trends.length > 0 && <ChartSectionDownload label="AI 요약" />}
          </div>
          <strong>{focus ? `${focus.code} · 근거 거래 ${focus.transactions.size}건 집중` : records.length > 0
            ? `계좌 ${accounts.length}개 · 근거 거래 ${records.length}건` : '연결된 거래 없음'}</strong>
          {trends.length > 0 && <div className="overview-amount-charts">{trends.map(trend =>
            <EvidenceBars key={trend.label} {...trend} reduced={appearance.reduced} />)}</div>}
          <ul className="overview-summary-facts">
            {focus && <li>중심 계좌 기준 유입 {inflows.length}건 · 유출 {outflows.length}건</li>}
            {representative && <li>{lead ? `최고 점수 거래 ${lead.score}점` : '첫 근거 거래'} · <LinkTag code={representative.code} />
              {' · '}{representative.from.code} → {representative.to.code} · {amount(representative)}</li>}
            {episode && row.linkedAlerts > 0 && <li>동일 거래가 연결된 Alert {row.linkedAlerts}건</li>}
          </ul>
        </AISummaryPanel>
        <dl className="overview-metrics">
          {metrics.map(([title, value, detail]) => <Panel as="div" key={title} data-unavailable={value === null || undefined}>
            <dt>{title}</dt><dd>{value ?? '산출 범위 없음'}</dd>
            {detail ? <dd className="overview-note overview-metric-detail">{detail}</dd> : null}
          </Panel>)}
        </dl>
      </div>
      <div className="overview-tiles" data-episode={episode || undefined}>
        {panels.map(({ id, title, number, content, details, visualContent, span, overviewGraphic, compact }) => <Panel key={id}
          data-overview-panel={id} data-overview-span={span}
          data-export-visualization={overviewGraphic || undefined}>
          <div className="section-download-heading">
            <h2>{number}. {title}</h2>
            {overviewGraphic && <ChartSectionDownload label={title} />}
          </div>
          {compact ?? content ?? <>{visualContent}{details}</>}
        </Panel>)}
      </div>
    </>}
  </div>;
}
