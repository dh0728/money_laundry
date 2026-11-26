import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { BarSparkline } from '../../components/charts/sparkline';
import { readChartDurationSeconds, readChartNumber } from '../../components/charts/chart-design-values';
import { BarChart } from '../../components/charts/charts/bar-chart';
import { Bar } from '../../components/charts/charts/bar';
import { PieChart } from '../../components/charts/charts/pie/pie-chart';
import { PieSlice } from '../../components/charts/charts/pie/pie-slice';
import { useElementSize } from '../../components/charts/charts/use-element-size';
import { ChartTooltip } from '../../components/charts/charts/tooltip/chart-tooltip';
import { previewJudgmentReason } from './case-judgment-data';
import { FooterPagination } from '../../components/footer-pagination';
import GlideSelect from '../../components/react-bits/GlideSelect';
import { Panel } from '../../components/panel';
import { AISummaryPanel } from '../../components/ai-summary-panel';
import { SectionDownloadHeading } from '../../components/section-download';
import { csvDownloadEntry } from '../../components/query-controls';
import { OverviewScoreChart, overviewScorePoints } from './overview-score-chart';
import { CaseActorTag, CaseAgeTag, CountTag, LinkTag, ModelScoreTag, PatternTag, ReviewStatusTag, VerdictTag,
  reviewStatusLabel, verdictLabels } from '../../components/semantic-tags';
import { TransactionEvidenceTable } from './preview-case-table';
import { useCaseEvidenceSelection } from './case-evidence-selection';
import { caseOverviewEvidence, episodeAlertEvidence, relatedJudgments } from './case-overview-evidence';
import { graphRiskBand } from './case-graph-scope';
import { modelRiskLabels } from '../settings/model-risk-settings';
import { CaseRuleHits } from '../rules/case-rule-hits';
import './preview-case-overview.css';
import { Box, Heading, Stack, Text } from '../../components/layout-primitives';
import { dataSeriesColors, transactionTotalColor } from '@/components/charts/charts/chart-context';

const number = new Intl.NumberFormat('ko-KR');
const decimal = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 });
const kst = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' });
const amount = record => `${number.format(record.amount)} ${record.currency}`;
const reviewAssignee = row => row.assigned ? '내 담당' : '다른 담당자';
const caseTime = value => Number.isFinite(Date.parse(value)) ? kst.format(new Date(value)) : '';

function EvidencePeriod({ records }) {
  if (!records.length) return '자료 없음';
  const times = records.map(row => row.timestamp).sort();
  const start = times[0];
  const end = times.at(-1);
  const time = value => <Text as="time" dateTime={value.replace(' ', 'T') + '+09:00'}>
    <Text as="span">{value.slice(0, 10)}</Text>{' '}<Text as="span">{value.slice(11)}</Text>
  </Text>;
  return <>{time(start)}{start !== end && <> ~ {time(end)}</>} KST</>;
}

function CaseIdentity({ row }) {
  return <Box className="semantic-tag-group">
    <VerdictTag verdict={row.verdict} />
    {row.open && <CaseAgeTag days={row.elapsed} />}
    <ReviewStatusTag status={row.status} />
    <PatternTag>{row.pattern}</PatternTag>
    <CaseActorTag>{reviewAssignee(row)}</CaseActorTag>
  </Box>;
}

function EvidenceBars({ label, points, unit, reduced, summary }) {
  const [hover, setHover] = useState(null);
  const [layout] = useState(() => ({
    height: readChartNumber('--overview-evidence-sparkline-height', 40),
    barRadius: readChartNumber('--overview-evidence-bar-radius', 2),
  }));
  if (points.length < 2) return null;
  const labelPoint = ({ label: period, value }) => `${period} · ${number.format(value)}${unit}`;
  return <Box as="figure" className="overview-evidence-bars" aria-label={label}>
    <Box as="figcaption">{label}</Box>
    <BarSparkline data={points} dataKey="value" height={layout.height}
      yDomain={[0, undefined]} color={dataSeriesColors.teal} interactive crosshair="solid"
      dot={false} barRadius={layout.barRadius} animate={!reduced} hoverTransition={!reduced}
      onHoverChange={(_, point) => setHover(point)} aria-label={points.map(labelPoint).join(', ')} />
    <Text className="overview-bar-value">{hover ? labelPoint(hover) : summary ?? `${points[0].label} ~ ${points.at(-1).label}`}</Text>
  </Box>;
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
  return <Text as="span" className="overview-kpi">
    <Text as="strong" className="overview-kpi-number">{value}</Text>{' '}<Text as="span" className="overview-kpi-unit">{unit}</Text>
  </Text>;
}

function CurrencyValues({ flows, field }) {
  const parts = flows.filter(flow => flow[field] != null);
  if (!parts.length) return '산출 범위 없음';
  return <Text as="span" className="overview-currency-values">
    {parts.map(flow => {
      const ratio = field === 'ratio';
      const value = ratio ? decimal.format(flow.ratio) : number.format(flow[field]);
      const unit = ratio ? `% · ${flow.currency}` : flow.currency;
      return <Text as="span" key={flow.currency}>{value}{ratio ? '' : ' '}{unit}</Text>;
    })}
  </Text>;
}

function connectedTotals(records) {
  return [...Map.groupBy(records, record => record.currency)].map(([currency, group]) => ({
    currency, total: group.reduce((sum, record) => sum + record.amount, 0),
    count: group.length, first: group[0].timestamp, last: group.at(-1).timestamp,
  }));
}

function FlowSummary({ evidence, compact = false }) {
  const { focus, flows, inflows, outflows } = evidence;
  if (!flows.length) {
    const totals = connectedTotals(evidence.records);
    return totals.length > 0
      ? <Text className="overview-flow-total">연결 거래 금액 <CurrencyValues flows={totals} field="total" /></Text>
      : <Text className="overview-note">연결된 거래가 없습니다.</Text>;
  }
  const focusAccount = <><Text as="code">{focus.code}</Text> · {focus.owner}</>;
  const inflowDetail = <>{inflows.length}건{inflows.length > 0 && ` · 첫 유입 ${inflows[0].timestamp.slice(11)}`}</>;
  const outflowDetail = <>{outflows.length}건{outflows.length > 0 && ` · 마지막 유출 ${outflows.at(-1).timestamp.slice(11)}`}</>;
  if (compact) return <>
    <Text>관측 중심 계좌 {focusAccount} · 순유입 <CurrencyValues flows={flows} field="net" /></Text>
    <Text className="overview-note">유입 {inflowDetail} · 유출 {outflowDetail}</Text>
  </>;
  return <Box as="dl" className="overview-flow-summary" aria-label="관측 중심 계좌의 거래 흐름">
    <Box><Box as="dt">관측 유입</Box><Box as="dd"><CurrencyValues flows={flows} field="inflow" /></Box>
      <Box as="dd" className="overview-note">{inflowDetail}</Box></Box>
    <Box className="overview-flow-focus"><Box as="dt">관측 중심 계좌</Box><Box as="dd">{focusAccount}</Box>
      <Box as="dd" className="overview-note">순유입 <CurrencyValues flows={flows} field="net" /></Box></Box>
    <Box><Box as="dt">관측 유출</Box><Box as="dd"><CurrencyValues flows={flows} field="outflow" /></Box>
      <Box as="dd" className="overview-note">{outflowDetail}</Box></Box>
  </Box>;
}

const overviewChartMargin = { top: 0, right: 0, bottom: 0, left: 0 };

function OverviewBars({ label, measures, max, reduced, format = value => `${number.format(value)}건` }) {
  const [layout] = useState(() => ({
    barGap: readChartNumber('--overview-horizontal-bar-gap', 0.3),
    duration: readChartDurationSeconds('--overview-score-enter-duration', 0.32) * 1000,
    tooltipDamping: readChartNumber('--overview-horizontal-tooltip-damping', 25),
  }));
  if (!measures.length) return <Text className="overview-note">표시할 데이터가 없습니다.</Text>;
  const barColor = point => point.color ?? dataSeriesColors.teal;
  return <Box as="figure" className="overview-horizontal-chart" style={{ '--overview-measures-count': measures.length }} aria-label={label}>
    <Box as="ul" className="overview-horizontal-labels">
      {measures.map(({ label, value, code }) => <Box as="li" key={label}>
        {code ? <LinkTag code={code} /> : <Text as="span">{label}</Text>}<Text as="strong">{format(value)}</Text>
      </Box>)}
    </Box>
    <BarChart className="overview-horizontal-bars" data={measures} xDataKey="label" orientation="horizontal"
      aspectRatio="auto" horizontalValueDomain={[0, Math.max(max, 1)]} margin={overviewChartMargin}
      barGap={layout.barGap} animationDuration={reduced ? 0 : layout.duration}>
      <Bar dataKey="value" getFill={barColor} lineCap="round" animate={!reduced} />
      <ChartTooltip showDatePill={false} showDots={false} damping={reduced ? 0 : layout.tooltipDamping}
        rows={point => [{ label: String(point.label), value: format(point.value), color: barColor(point) }]} />
    </BarChart>
  </Box>;
}

function OverviewDonut({ label, segments, reduced }) {
  const plotRef = useRef(null);
  const [layout] = useState(() => ({
    innerRadiusRatio: readChartNumber('--overview-donut-inner-radius-ratio', 0.34),
    cornerRadius: readChartNumber('--overview-donut-corner-radius', 8),
    segmentGap: readChartNumber('--overview-donut-segment-gap', 0.045),
  }));
  const { width } = useElementSize(plotRef);
  const size = Math.floor(width);
  const data = segments.filter(segment => segment.value > 0);
  if (!data.length) return <Text className="overview-note">표시할 데이터가 없습니다.</Text>;
  const total = data.reduce((sum, segment) => sum + segment.value, 0);
  return <Box as="figure" className="overview-donut" aria-label={label}>
    <Box as="figcaption">{label}</Box>
    <Box ref={plotRef} className="overview-donut-plot" aria-hidden="true">
      {size > 0 && <PieChart data={data} size={size} innerRadius={size * layout.innerRadiusRatio}
        cornerRadius={layout.cornerRadius} padAngle={data.length > 1 ? layout.segmentGap : 0}
        startAngle={0} endAngle={Math.PI * 2} geometryScrubbing={reduced}>
        {!reduced && data.map(({ label }, index) => <PieSlice key={label} index={index} />)}
      </PieChart>}
      <Text as="span" className="overview-donut-total"><Text as="strong">{number.format(total)}</Text><Text as="span">거래</Text></Text>
    </Box>
    <Box as="ul" className="overview-score-legend">
      {data.map(({ label, value, color }) => <Box as="li" key={label}>
        <Text as="i" style={{ '--overview-score-legend-fill': color }} aria-hidden="true" />{label} <Text as="strong">{number.format(value)}건</Text>
      </Box>)}
    </Box>
  </Box>;
}

function FlowCharts({ evidence, reduced }) {
  const { flows, records } = evidence;
  if (!records.length) return <Text className="overview-note">연결된 거래가 없습니다.</Text>;
  const amounts = flows.length
    ? flows.map(({ currency, inflow, outflow }) => ({
      currency, measures: [{ label: '관측 유입', value: inflow, color: dataSeriesColors.teal },
        { label: '관측 유출', value: outflow, color: dataSeriesColors.pink }],
    }))
    : [...Map.groupBy(records, record => record.currency)].map(([currency, moves]) => ({
      currency, measures: [...Map.groupBy(moves, record => record.from.code)].map(([label, group]) => ({
        label, value: group.reduce((sum, record) => sum + record.amount, 0),
      })),
    }));
  return <Box className="overview-flow-charts">
    {amounts.map(({ currency, measures }) => <Box as="section" key={currency}>
      <Heading level={3}>{currency}{!flows.length && ' · 송금 계좌별'}</Heading>
      <OverviewBars label={`${currency} 자금 흐름`} measures={measures}
        max={Math.max(...measures.map(measure => measure.value))} reduced={reduced}
        format={value => `${number.format(value)} ${currency}`} />
    </Box>)}
  </Box>;
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
  if (!timeline.length) return <Text className="overview-note">세부 변경 시각 없음</Text>;
  return <Box className="overview-review-timeline">
    <Box as="ol" aria-label="확인된 업무 시각">
      {timeline.toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at)).map(({ label, at, edit, status }) =>
        <Box as="li" key={JSON.stringify([label, at, edit?.transactionCodes])} data-review={status}>
          <Text as="strong">{label}</Text><Text as="time" dateTime={at}>{kst.format(new Date(at))} KST</Text>
          {edit && <Box className="overview-note">
            <Text>{edit.reviewer} · {edit.reason}</Text>
            <Text>{edit.transactionCodes.join(' · ')}{edit.targetCode && <> · {edit.sourceCode} → {edit.targetCode}</>}</Text>
          </Box>}
        </Box>)}
    </Box>
  </Box>;
}

function EpisodeRelations({ relations, transactionCount, reduced }) {
  const { members, related, complete, unresolved } = relations;
  const measuredMembers = members.filter(member => member.value != null);
  const uncertain = members.filter(member => member.value == null);
  const sharingTitle = complete && !unresolved ? '소속 외 공유 Alert' : '소속 미확인 공유 Alert';
  const measures = (rows, color) => rows.map(({ code, value }) => ({ code, label: code, value, color }));
  return <Stack className="overview-episode-relations">
    <Text tone="muted">Episode 고유 근거 거래 {transactionCount}건</Text>
    <Box>
      <Heading level={3}>소속 Alert{(complete || members.length > 0) && <CountTag count={members.length + (complete ? unresolved : 0)} />}</Heading>
      {!complete && <Text tone="muted">{members.length ? '연결이 확인된 Alert만 표시' : '소속 Alert 정보 없음'}</Text>}
      {unresolved > 0 && <Text tone="muted">식별할 수 없는 소속 Alert {unresolved}건</Text>}
      {measuredMembers.length > 0 && <Box className="overview-episode-alert-list">
        <OverviewBars label="소속 Alert별 Episode 근거 거래"
          measures={measures(measuredMembers, dataSeriesColors.teal)} max={transactionCount} reduced={reduced} />
      </Box>}
      {uncertain.length > 0 && <Box as="ul" className="overview-fact-list">
        {uncertain.map(({ code }) => <Box as="li" key={code}><LinkTag code={code} /> <Text as="span" tone="muted">근거 거래 미확인</Text></Box>)}
      </Box>}
    </Box>
    {related.length > 0 && <Box>
      <Heading level={3}>{sharingTitle}<CountTag count={related.length} /></Heading>
      <Box className="overview-episode-alert-list" role="region" aria-label={sharingTitle} tabIndex={0}>
        <OverviewBars label={`${sharingTitle}별 근거 거래`} measures={measures(related, transactionTotalColor)}
          max={transactionCount} reduced={reduced} />
      </Box>
    </Box>}
  </Stack>;
}

function buildPanels(row, evidence, history, activeRules, reduced, evidenceSelection, episodeRelations, ruleHits) {
  const { records, accounts, focus, flows, inflows, outflows, lead } = evidence;
  const episode = row.kind === 'Episode';
  const caseRuleHits = ruleHits?.status === 'ready' ? ruleHits.hits : [];
  const alertCode = episode ? ruleHits?.alertCode : undefined;
  const methods = [...Map.groupBy(records, record => record.method)].map(([label, group]) => ({ label, value: group.length }));
  const prior = relatedJudgments(history, row.code, evidence);
  const otherCount = records.length - inflows.length - outflows.length;
  const composition = focus ? [
    { label: '중심 계좌로 유입', value: inflows.length, color: dataSeriesColors.teal },
    { label: '중심 계좌에서 유출', value: outflows.length, color: dataSeriesColors.pink },
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
  const relationsChart = episode && <EpisodeRelations relations={episodeRelations} transactionCount={records.length} reduced={reduced} />;
  const flowChart = <FlowCharts evidence={evidence} reduced={reduced} />;
  const flowLink = records.length > 0 && <LinkTag href={`?${analysisQuery}`}>분석에서 자금 흐름 보기</LinkTag>;
  const flowDetails = <>
    {records.length > 0 && <Text><EvidencePeriod records={records} /> · 근거 거래 {records.length}건 · 원통화 기준</Text>}
    {flowLink}
  </>;
  const panels = {
    judgment: { title: '판단 요약', content: <>
      <Text className="semantic-tag-group">사람 판정 <VerdictTag verdict={row.verdict} /></Text>
      {row.reviewDueOn && <Text>처리 기한 · <Text as="time" dateTime={row.reviewDueOn}>{row.reviewDueOn}</Text></Text>}
      <Text>{focus ? <><Text as="code">{focus.code}</Text> · 근거 거래 {focus.transactions.size}건 · 유입 {inflows.length}건 · 유출 {outflows.length}건</>
        : <>근거 거래 {records.length}건 · 계좌 {accounts.length}개</>}</Text>
      {row.judgment && <Text className="overview-note">판정 사유 · {previewJudgmentReason(row.judgment)}</Text>}
      {records.length > 0 && <LinkTag href={`?${analysisQuery}`}>분석에서 자금 흐름 보기</LinkTag>}
    </> },
    accounts: { title: '핵심 계좌', compact: accounts.length > 0 ? <>
      <OverviewBars label="참여 거래가 많은 계좌" measures={accountMeasures.slice(0, 3)}
        max={records.length} reduced={reduced} />
      <LinkTag href={`?${episode ? analysisQuery : accountsQuery}`}>전체 계좌 근거 보기</LinkTag>
    </> : <Text className="overview-note">연결된 거래가 없습니다.</Text>, content: <>
      {focus && <Text>최다 참여 <Text as="strong"><Text as="code">{focus.code}</Text></Text> · {focus.transactions.size}/{records.length}건</Text>}
      <Box as="ul" className="overview-fact-list">{accounts.map(({ code, owner, sent, received }) => <Box as="li" key={code}>
        <Text as="code">{code}</Text><Text as="span">{owner}</Text><Text as="span" className="overview-note">송금 {sent} · 수취 {received}</Text>
      </Box>)}</Box>
    </> },
    past: { title: '과거 판단', count: prior.length || undefined, content: prior.length ? <>
      <Text className="overview-note">공유 계좌가 있는 다른 판정</Text>
      <Box as="ul" className="overview-fact-list overview-past-verdicts" tabIndex={0} aria-label="공유 계좌가 있는 판정">
        {prior.map(item => <Box as="li" key={item.id}>
        <LinkTag href={`/report?selected=${item.id}`} code={item.id} />
        <VerdictTag verdict={item.verdict} />
        {item.at && <Text as="time" dateTime={item.at}>{kst.format(new Date(item.at))} KST</Text>}
        {item.targets.map(target => <Text as="span" key={target.code} className="overview-shared-target">
          <LinkTag code={target.code} /> · {target.sharedAccounts.join(', ')}
        </Text>)}
      </Box>)}</Box>
    </> : <Text className="overview-note">계좌를 공유하는 과거 판정이 없습니다.</Text> },
    history: { title: episode ? '진행 · 최근 처리' : '처리 이력', content: <>
      <Text className="semantic-tag-group"><ReviewStatusTag status={row.status} />
        <CaseActorTag>{reviewAssignee(row)}</CaseActorTag></Text>
      {records.length > 0 && <Text>근거 거래 확인 · <EvidencePeriod records={records} /></Text>}
      {row.open && Number.isFinite(row.elapsed) && row.elapsed < 3 && <Text>{row.elapsed}일 경과</Text>}
      {row.judgment ? <>
        <Text>판정자 {row.judgment.reviewer || '기록 없음'} · <Text as="time" dateTime={row.judgment.at}>{kst.format(new Date(row.judgment.at))} KST</Text></Text>
        <Text>{previewJudgmentReason(row.judgment)}</Text>
        <LinkTag href={`/report?selected=${row.judgment.id}`} code={row.judgment.id} />
      </> : !row.open && <Text className="overview-note">세부 변경 시각 없음</Text>}
    </> },
    detection: { title: '탐지 근거', count: records.length,
      compact: scorePoints.length > 0 ? <OverviewScoreChart points={scorePoints} reduced={reduced} exactTime /> : undefined,
      content: <>
      <Text className="semantic-tag-group">
        {lead && <ModelScoreTag score={lead.score} />}
        <PatternTag>{row.pattern}</PatternTag>
      </Text>
      {focus && <Text><Text as="code">{focus.code}</Text>에 {focus.transactions.size}건 집중</Text>}
      <Box as="ul" className="overview-fact-list">{records.filter(record => Number.isFinite(record.score))
        .toSorted((a, b) => b.score - a.score).map(record => <Box as="li" key={record.code}>
          <LinkTag code={record.code} /><ModelScoreTag score={record.score} />
          <Text as="span"><Text as="code">{record.from.code}</Text> → <Text as="code">{record.to.code}</Text></Text>
        </Box>)}</Box>
    </> },
    transactions: {
      title: episode ? '근거 거래' : '씨앗 거래',
      details: <Text className="overview-note">{episode ? 'Episode에 연결된 고유 거래' : '씨앗 역할 미기록 · 근거 거래 전체를 표시'}</Text>,
      visualContent: <TransactionEvidenceTable title="근거 거래" transactions={records.toSorted((a, b) => (b.score ?? -1) - (a.score ?? -1))}
        showScore selectionControl={evidenceSelection} />,
    },
    flow: {
      title: '돈의 흐름',
      compact: flows.length > 0 ? <>{flowChart}<FlowSummary evidence={evidence} compact />{flowDetails}</> : undefined,
      visualContent: <FlowSummary evidence={evidence} />,
      details: flowDetails,
      flowLink,
    },
    rules: { title: '룰 적중', count: caseRuleHits.length || undefined, content: <>
      {ruleHits ? <CaseRuleHits state={ruleHits} records={records} alertCode={alertCode} />
        : <Text className="overview-note">탐지 당시 적중 기록이 없습니다.</Text>}
      {activeRules.length > 0 && <><Heading level={3}>현재 운영 중인 룰</Heading>
        <Box as="ul" className="overview-fact-list">{activeRules.map(rule => <Box as="li" key={rule.id}>
          <LinkTag href={`/rules?rule=${rule.id}`} code={rule.id} />
          <Text as="strong">v{rule.version} · {rule.name}</Text><Text as="span" className="overview-shared-target">{rule.conditions}</Text>
        </Box>)}</Box></>}
    </> },
    composition: {
      title: '구성 · 근거 거래',
      count: records.length,
      compact: episode ? relationsChart : compositionChart,
      distribution: compositionChart,
      details: <>
        <Text className="overview-note">{focus ? <>관측 중심 계좌 <Text as="code">{focus.code}</Text></> : '결제 수단별 근거 거래'}</Text>
      </>,
      visualContent: episode ? <>{relationsChart}{compositionChart}</> : compositionChart,
      graphic: composition.length > 0 || Boolean(episodeRelations?.related.length),
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
      { label: '모델 점수 없음', color: dataSeriesColors.teal, value: scoresByBand.get('unknown')?.length ?? 0 },
    ]} />,
    accounts: <OverviewBars label="계좌별 거래 참여" measures={accountMeasures} max={records.length} reduced={reduced} />,
    past: <OverviewBars label="과거 판정 구성" measures={pastCounts} max={prior.length} reduced={reduced} />,
    history: <ReviewTimeline records={records} row={row} />,
    detection: <OverviewScoreChart points={scorePoints} reduced={reduced} fill exactTime={episode} />,
    rules: <Box className="overview-panel-hero">
      {ruleHits?.status === 'ready' && <KpiValue value={caseRuleHits.length} unit="이 사건에 걸린 룰 적중" />}
      <KpiValue value={activeRules.length} unit="현재 운영 중인 룰" />
    </Box>,
  };
  const graphicPanels = { judgment: records.length > 0, accounts: accounts.length > 0, past: prior.length > 0,
    detection: scorePoints.length > 0, flow: records.length > 0 };
  const caseCsv = (id, columns, rows) => csvDownloadEntry(panels[id].title, `${row.code}-${id}`, columns, rows);
  const compositionRows = composition.map(part => [part.label, part.value]);
  const distribution = csvDownloadEntry('근거 거래 구성', `${row.code}-distribution`, ['구분', '건수'], compositionRows);
  const transactionCodes = new Map(records.map(record => [record.txId, record.code]));
  const ruleHitDownload = csvDownloadEntry('사건의 룰 적중', `${row.code}-rule-hits`,
    ['Alert ID', '룰 ID', '버전', '룰 이름', '템플릿', '대상', '적중 날짜', '사건의 근거 거래 ID', '전체 근거 거래 수'],
    caseRuleHits.map(hit => [episode ? alertCode?.(hit.alertId) : row.code, hit.code, hit.versionNo, hit.name,
      hit.templateName, hit.subject, hit.hitDates.join(' · '),
      hit.matchedTxIds.map(txId => transactionCodes.get(txId) ?? txId).join(' · '), hit.evidenceTxCount]));
  const downloads = {
    judgment: caseCsv('judgment', ['업무 ID', '판정', '처리 기한', '근거 거래 수', '계좌 수', '판정 사유'],
      [[row.code, verdictLabels[row.verdict], row.reviewDueOn, records.length, accounts.length,
        row.judgment && previewJudgmentReason(row.judgment)]]),
    accounts: caseCsv('accounts', ['계좌', '소유주', '참여 거래 수', '송금 거래 수', '수취 거래 수'],
      accounts.map(account => [account.code, account.owner, account.transactions.size, account.sent, account.received])),
    past: caseCsv('past', ['판정 ID', '판정', '시각 (KST)', '대상 ID', '공유 계좌'],
      prior.flatMap(item => item.targets.map(target => [
        item.id, verdictLabels[item.verdict], caseTime(item.at), target.code, target.sharedAccounts.join(' · '),
      ]))),
    history: caseCsv('history', ['업무 ID', '처리 상태', '담당 범위', '판정자', '판정 시각 (KST)', '판정 사유'],
      [[row.code, reviewStatusLabel(row.status), reviewAssignee(row), row.judgment?.reviewer, caseTime(row.judgment?.at),
        row.judgment && previewJudgmentReason(row.judgment)]]),
    detection: caseCsv('detection', ['거래 ID', '시각 (KST)', '송금 계좌', '수취 계좌', '모델 점수', '탐지 패턴'],
      records.filter(record => Number.isFinite(record.score)).map(record => [
        record.code, record.timestamp, record.from.code, record.to.code, record.score, row.pattern,
      ])),
    flow: flows.length
      ? caseCsv('flow', ['중심 계좌', '통화', '유입', '유출', '순유입', '경유 비율 (%)'],
        flows.map(flow => [focus.code, flow.currency, flow.inflow, flow.outflow, flow.net, flow.ratio]))
      : caseCsv('flow', ['통화', '연결 거래 금액', '거래 수', '첫 거래 (KST)', '마지막 거래 (KST)'],
        connectedTotals(records).map(row => [row.currency, row.total, row.count, row.first, row.last])),
    rules: csvDownloadEntry('현재 운영 중인 룰', `${row.code}-active-rules`, ['룰 ID', '버전', '이름', '조건'],
      activeRules.map(rule => [rule.id, rule.version, rule.name, rule.conditions])),
    composition: episode ? csvDownloadEntry('Alert 연결', `${row.code}-alerts`, ['Alert ID', '관계', '공통 거래 수'],
      [['소속', episodeRelations.members], ['거래 공유', episodeRelations.related]].flatMap(([relation, items]) =>
        items.map(item => [item.code, relation, item.value]))) : distribution,
  };
  const layout = episode
    ? [['judgment', 4], ['flow', 8], ['history', 4], ['accounts', 4], ['detection', 4], ['rules', 4], ['composition', 8], ['transactions', 12]]
    : [['judgment', 3], ['accounts', 3], ['past', 3], ['history', 3], ['detection', 9], ['composition', 3],
      ['transactions', 12], ['flow', 6], ['rules', 6]];
  return layout.map(([id, span], index) => {
    const panel = panels[id];
    const graphic = panel.graphic ?? graphicPanels[id];
    return { id, span, ...panel, number: index + 1,
      visualContent: panel.visualContent ?? visuals[id],
      panelVisual: id === 'flow' ? flowChart : undefined,
      panelDetails: id === 'flow' ? <><FlowSummary evidence={evidence} />{panel.details}</> : undefined,
      graphic,
      entries: [id === 'rules' && ruleHitDownload, downloads[id]].filter(entry => entry && !entry.disabled),
      distributionEntries: id === 'composition' && !distribution.disabled ? [distribution] : [],
      overviewGraphic: id === 'detection' ? scorePoints.length > 0
        : id === 'flow' ? flows.length > 0 : ['accounts', 'composition'].includes(id) && graphic,
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
    <GlideSelect ariaLabel="개요 패널" placement="top" value={String(index)} onChange={value => select(Number(value))}
      options={panels.map(({ title, number }, value) => ({ value: String(value), label: `${number}. ${title}` }))} />
  </FooterPagination>;
  return <>
    <Box className="overview-panel-layout">
      <Panel className="overview-current" aria-labelledby="overview-current-title" data-export-visualization={panel.graphic || undefined}>
        <SectionDownloadHeading id="overview-current-title" downloadLabel={panel.graphic ? panel.title : undefined}>
          {panel.number}. {panel.title}{panel.count !== undefined && <CountTag count={panel.count} />}
        </SectionDownloadHeading>
        <Box className="overview-panel-visual">
          {panel.panelVisual ?? panel.visualContent}
        </Box>
      </Panel>
      <Panel className="overview-current overview-panel-details" aria-label={`${panel.title} 상세`}>
        {panel.entries.length > 0 && <SectionDownloadHeading entries={panel.entries}>{panel.title} 상세</SectionDownloadHeading>}
        {panel.panelDetails ?? panel.details ?? panel.content}
      </Panel>
    </Box>
    {pager}
  </>;
}

function OverviewTile({ panel, span = panel.span, title = panel.title, children }) {
  const { id, count, content, details, visualContent, overviewGraphic, compact } = panel;
  return <Panel data-overview-panel={id} data-overview-span={span} data-export-visualization={overviewGraphic || undefined}>
    <SectionDownloadHeading downloadLabel={overviewGraphic ? title : undefined} entries={panel.entries}>
      {title}{count !== undefined && <CountTag count={count} />}
    </SectionDownloadHeading>
    {children ?? compact ?? content ?? <>{visualContent}{details}</>}
  </Panel>;
}

function FlowOverviewTile({ panel, evidence }) {
  const { records, focus, flows, inflows, outflows } = evidence;
  return <OverviewTile panel={{ ...panel, overviewGraphic: panel.graphic }} title="자금 흐름">
    {records.length > 0 && <Text tone="muted"><EvidencePeriod records={records} /> · 근거 거래 {records.length}건 · 원통화 기준</Text>}
    {focus && <Text>관측 중심 계좌 <Text as="code">{focus.code}</Text> · {focus.owner}</Text>}
    {panel.panelVisual}
    {flows.length > 0 && <Stack direction="row" wrap>
      <Text as="span">유입 {inflows.length}건 · 유출 {outflows.length}건</Text>
      <Text as="span">순유입 <CurrencyValues flows={flows} field="net" /></Text>
      {flows.some(item => item.ratio != null) && <Text as="span">경유 비율 <CurrencyValues flows={flows} field="ratio" /></Text>}
    </Stack>}
    {panel.flowLink}
  </OverviewTile>;
}

function ScoreOverviewTile({ panel, lead }) {
  return <OverviewTile panel={panel} title="거래 시각별 모델 점수">
    {panel.compact ?? panel.visualContent}
    {lead && <Text className="semantic-tag-group">최고 모델 점수 <ModelScoreTag score={lead.score} /> <LinkTag code={lead.code} /></Text>}
  </OverviewTile>;
}

function AccountsOverviewTile({ panel, accounts, ownerCount }) {
  return <OverviewTile panel={panel}>
    <Text tone="muted">계좌 {accounts.length}개 · 소유주 {ownerCount}명</Text>
    {panel.compact}
  </OverviewTile>;
}

function AlertOverview({ panels, evidence, summary }) {
  const { accounts, ownerCount, lead } = evidence;
  const byId = new Map(panels.map(panel => [panel.id, panel]));
  return <>
    <Box className="overview-top" data-alert-evidence>
      <FlowOverviewTile panel={byId.get('flow')} evidence={evidence} />
      <ScoreOverviewTile panel={byId.get('detection')} lead={lead} />
      <Stack className="overview-side">
        {summary}
        <AccountsOverviewTile panel={byId.get('accounts')} accounts={accounts} ownerCount={ownerCount} />
      </Stack>
      <OverviewTile panel={byId.get('past')} />
    </Box>
    <Box className="overview-tiles">
      <Box data-overview-panel="transactions" data-overview-span="12">{byId.get('transactions').visualContent}</Box>
      <OverviewTile panel={byId.get('composition')} />
      <OverviewTile panel={byId.get('judgment')} />
      <OverviewTile panel={byId.get('history')} />
      <OverviewTile panel={byId.get('rules')} span={3} />
    </Box>
  </>;
}

function EpisodeOverview({ panels, evidence, summary }) {
  const { accounts, ownerCount, lead } = evidence;
  const byId = new Map(panels.map(panel => [panel.id, panel]));
  const composition = byId.get('composition');
  return <>
    <Box className="overview-top" data-episode-evidence>
      <OverviewTile panel={{ ...composition, count: undefined }} title="Alert 연결" />
      <FlowOverviewTile panel={byId.get('flow')} evidence={evidence} />
      <Stack className="overview-side">
        {summary}
        <AccountsOverviewTile panel={byId.get('accounts')} accounts={accounts} ownerCount={ownerCount} />
      </Stack>
      <Stack className="overview-side">
        <OverviewTile panel={byId.get('history')} />
        <OverviewTile panel={byId.get('judgment')} />
        <OverviewTile panel={byId.get('rules')} />
      </Stack>
    </Box>
    <Box className="overview-tiles">
      <ScoreOverviewTile panel={{ ...byId.get('detection'), span: 8 }} lead={lead} />
      <OverviewTile panel={{ ...composition, id: 'distribution', entries: composition.distributionEntries }}
        title="근거 거래 구성" span={4}>{composition.distribution}</OverviewTile>
      <Box data-overview-panel="transactions" data-overview-span="12">{byId.get('transactions').visualContent}</Box>
    </Box>
  </>;
}

export function PreviewCaseOverview({ row, perPanel, initialPanel, appearance, history = [], activeRules = [], reportData, paginationHost, evidenceSelection, ruleHits }) {
  const selected = useCaseEvidenceSelection(evidenceSelection);
  if (!row) return <Text>선택한 사건의 개요를 불러올 수 없습니다.</Text>;
  const evidence = caseOverviewEvidence(row.related);
  const { records, accounts, focus, inflows, outflows, lead } = evidence;
  const representative = lead ?? records[0];
  const episode = row.kind === 'Episode';
  const relations = episode ? episodeAlertEvidence(row, records, reportData?.cases) : undefined;
  const panels = buildPanels(row, evidence, history, activeRules, appearance.reduced,
    evidenceSelection && { selected, change: evidenceSelection.change }, relations, ruleHits);
  const window = episode ? 15 : 4;
  const incomingByCurrency = !episode && inflows.length > 0 ? Map.groupBy(inflows, record => record.currency) : null;
  const trendSeries = incomingByCurrency
    ? [...incomingByCurrency].map(([currency, moves]) => ({ label: `4시간 단위 관측 유입 · ${currency}`,
      points: transactionTimeBuckets(moves, 4, move => move.amount), unit: ` ${currency}` }))
    : [{ label: `${window}시간 단위 근거 거래 건수`, points: transactionTimeBuckets(records, window), unit: '건' }];
  const trends = trendSeries.filter(({ points }) => points.filter(point => point.value > 0).length >= 2);
  const summary = <AISummaryPanel className="overview-ai-summary" reduced={appearance.reduced} aria-labelledby="overview-summary-title"
          data-export-visualization={trends.length > 0 || undefined}>
          <SectionDownloadHeading id="overview-summary-title" downloadLabel={trends.length ? 'AI 요약' : undefined}
            entries={representative ? [csvDownloadEntry('AI 요약 근거', `${row.code}-summary`,
              ['중심 계좌', '연결 계좌 수', '근거 거래 수', '중심 계좌 유입 건수', '중심 계좌 유출 건수', '대표 거래 ID', '모델 점수'],
              [[focus?.code, accounts.length, records.length, inflows.length, outflows.length, representative.code, lead?.score]])] : []}>
            <Sparkles className="icon" aria-hidden="true" /> AI 요약
          </SectionDownloadHeading>
          <Text as="strong">{focus ? <><Text as="code">{focus.code}</Text> · 근거 거래 {focus.transactions.size}건 집중</>
            : records.length > 0 ? `계좌 ${accounts.length}개 · 근거 거래 ${records.length}건` : '연결된 거래 없음'}</Text>
          {trends.length > 0 && <Box className="overview-amount-charts">{trends.map(trend =>
            <EvidenceBars key={trend.label} {...trend} reduced={appearance.reduced} />)}</Box>}
          <Box as="ul" className="overview-summary-facts">
            {focus && <Box as="li">중심 계좌 기준 유입 {inflows.length}건 · 유출 {outflows.length}건</Box>}
            {representative && <Box as="li">{lead ? `최고 점수 거래 ${lead.score}점` : '첫 근거 거래'} · <LinkTag code={representative.code} />
              {' · '}<Text as="code">{representative.from.code}</Text> → <Text as="code">{representative.to.code}</Text> · {amount(representative)}</Box>}
          </Box>
        </AISummaryPanel>;
  return <Box className="preview-case-overview" data-per-panel={perPanel}>
    <CaseIdentity row={row} />
    {perPanel ? <PanelOverview panels={panels} initialPanel={initialPanel} paginationHost={paginationHost} />
      : episode ? <EpisodeOverview panels={panels} evidence={evidence} summary={summary} />
        : <AlertOverview panels={panels} evidence={evidence} summary={summary} />}
  </Box>;
}
