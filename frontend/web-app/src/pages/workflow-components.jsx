import React, { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { TableBody, TableCell, TableHeader, TableRow, TableRowHead } from '@/components/ui/table';
import { Check, Circle, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import StatusMark from '../components/react-bits/StatusMark';
import { ActionButton, PrimaryButton } from '../components/primary-button';
import { CardHeader } from '../components/card-header';
import { RecordCard } from '../components/record-card';
import { Panel } from '../components/panel';
import { ScreenActions } from '../components/screen-actions';
import { SectionDownloadHeading } from '../components/section-download';
import { CountTag, LinkTag, PatternTag, StatusTag, VerdictTag, verdictLabels } from '../components/semantic-tags';
import { csvDownloadEntry, inDateRange, LocalQueryTools } from '../components/query-controls';
import { LiveRuleBacktest } from '../features/rules/live-rule-backtest';
import { LiveRuleList } from '../features/rules/live-rule-list';
import { liveActiveRules, liveRules, refreshLiveRules } from '../features/rules/live-rule-store';
import { useCaseRuleHits } from '../features/rules/case-rule-hits';
import { liveSource } from '../features/investigation/live-data.js';
import { readWorkspaceDuration } from '../features/dashboard/workspace-metrics';
import { SortableTableHead, tableCount, useTableSort, WorkflowQueryHeading, WorkflowTable } from '../components/workflow-table';
import { DashboardSkeleton } from '../features/dashboard/dashboard-layout';
import { PreviewEpisodeDialog } from '../features/investigation/preview-episode-dialog';
import { canManagePreviewEpisodes, canTransferAlert } from '../features/investigation/preview-episode-transfer';
import { CaseJudgment } from '../features/investigation/case-judgment';
import { CaseTransactionEdit } from '../features/investigation/case-transaction-edit';
import { useCaseEvidenceSelection } from '../features/investigation/case-evidence-selection';
import { previewAlertEditUnavailable, previewAlertMembershipTargets } from '../features/investigation/case-membership-data';
import { currentPreviewUser, subscribePreviewUser } from '../features/auth/preview-session-user';
import { judgmentReasonLabels } from '../features/investigation/case-judgment-data';
import '../features/investigation/preview-case-card.css';
import './workflow-components.css';
import { Box, Heading, Text } from '@/components/layout-primitives';

const PreviewDashboard = lazy(() => import('../features/dashboard/preview-dashboard').then(module => ({ default: module.PreviewDashboard })));
const BenchmarkDashboard = lazy(() => import('../features/dashboard/preview-dashboard').then(module => ({ default: module.BenchmarkDashboard })));
const PreviewCaseOverview = lazy(() => import('../features/investigation/preview-case-overview').then(module => ({ default: module.PreviewCaseOverview })));
const reportSelection = { ids: [], verdict: 'all', order: 'recent' };
const verdictChoices = [
  { label: '전체', value: 'all' }, { label: '정상', value: 'normal' }, { label: '이상', value: 'abnormal' },
];
const reportSortOptions = [
  { label: '최근 판정순', value: 'recent' },
  { label: '오래된 판정순', value: 'oldest' },
];
const reportColumns = ['abnormal', 'normal'];
const reportTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});
const reportClock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short',
});
const reportTimestamp = instant => Number.isFinite(Date.parse(instant)) ? `${reportClock.format(new Date(instant))} KST` : '';
const reasonCategoryLabel = category => Object.hasOwn(judgmentReasonLabels, category) ? judgmentReasonLabels[category] : category;
const reportDate = instant => new Date(`${reportTime.format(new Date(instant))}T00:00:00`);

function reportHistory({ cases = [], transactions = [] } = {}) {
  // Each target belongs to one demo judgment. Group only cases with the same outcome and kind.
  const completed = new Map();
  const saved = [];
  for (const row of cases) {
    if (row.judgment) {
      saved.push({ ...row.judgment, kind: row.kind, targets: [row],
        patterns: [row.pattern].filter(Boolean) });
      continue;
    }
    if (row.status !== '처리 완료' || row.verdict === 'unjudged') continue;
    const key = `${row.kind}:${row.verdict}`;
    if (!completed.has(key)) completed.set(key, []);
    completed.get(key).push(row);
  }
  const batches = [...completed.entries()].flatMap(([key, rows]) => key === 'Alert:abnormal' ? rows.map(row => [row]) : [rows]);
  const individualTransfers = transactions.filter(row => row.status === '처리 완료' && row.verdict !== 'unjudged').map(row => [row]);
  const seeded = [...batches, ...individualTransfers].map((targets, index) => ({
    id: `J-261111-${String(index + 1).padStart(6, '0')}`,
    kind: targets[0].kind ?? '거래', verdict: targets[0].verdict, targets,
    patterns: [...new Set(targets.map(row => row.pattern).filter(Boolean))],
  }));
  return [...saved.sort((left, right) => right.at.localeCompare(left.at)), ...seeded];
}
const statusLabels = {
  pending: '실행 대기', running: '실행 중', done: '완료', failed: '실패', cancelled: '취소됨',
};

function useAppearance() {
  const root = document.documentElement;
  const read = () => ({
    reduced: root.dataset.reducedMotion === 'true',
    theme: root.dataset.theme === 'dark' ? 'dark' : 'light',
  });
  const [appearance, setAppearance] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setAppearance(read()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-reduced-motion', 'data-primary-variant'] });
    return () => observer.disconnect();
  }, [root]);
  return appearance;
}

function ResultStatus({ status, children }) {
  const { reduced } = useAppearance();
  const label = <StatusTag preset={status}>{children ?? statusLabels[status]}</StatusTag>;
  if (reduced) {
    const Icon = status === 'done' ? Check : status === 'failed' ? TriangleAlert : Circle;
    return <Text as="span" className="workflow-static-status" role="status"><Icon className="icon" aria-hidden="true" />{label}</Text>;
  }
  return <Box role="status"><StatusMark status={status} label={label}
    size="var(--aml-size-icon-small)" strike={false} doneColor="currentColor" errorColor="currentColor" /></Box>;
}

function announce(detail) {
  document.dispatchEvent(new CustomEvent('aml:result', { detail }));
}

const noticeTones = {
  done: { tone: 'success', Icon: Check },
  warning: { tone: 'warning', Icon: TriangleAlert },
  failed: { tone: 'error', Icon: CircleAlert },
  info: { tone: 'info', Icon: Info },
};
function FooterNotice({ item, onClose }) {
  const { reduced } = useAppearance();
  const [closing, setClosing] = useState(false);
  const { tone, Icon } = noticeTones[item.status] ?? noticeTones.info;
  useEffect(() => {
    const noticeDuration = readWorkspaceDuration('--notice-duration', 5000);
    const noticeMotion = readWorkspaceDuration('--notice-motion', 260);
    const timer = setTimeout(() => setClosing(true), noticeDuration + (reduced ? 0 : noticeMotion));
    return () => clearTimeout(timer);
  }, [reduced]);
  useEffect(() => {
    if (closing && reduced) onClose();
  }, [closing, reduced, onClose]);
  return <Box className="footer-notice glass" data-tone={tone} data-closing={closing || undefined}
    onAnimationEnd={event => { if (event.target === event.currentTarget && event.animationName === 'footer-notice-out') onClose(); }}
    role="status" aria-atomic="true">
    <Icon className="icon" aria-hidden="true" />
    <Text as="span" className="footer-notice-text" title={[item.title, item.description].filter(Boolean).join(' · ')}>
      <Text as="strong">{item.title}</Text>{item.description && <Text as="span"> · {item.description}</Text>}
    </Text>
    {item.showTimer !== false && <Text as="span" className="footer-notice-fuse" aria-hidden="true" />}
  </Box>;
}

function ResultNotifications() {
  const [item, setItem] = useState(null);
  useEffect(() => {
    const onResult = event => setItem({ ...event.detail, key: performance.now() });
    document.addEventListener('aml:result', onResult);
    document.addEventListener('aml:notice', onResult);
    return () => {
      document.removeEventListener('aml:result', onResult);
      document.removeEventListener('aml:notice', onResult);
    };
  }, []);
  return item && <FooterNotice key={item.key} item={item}
    onClose={() => setItem(current => current?.key === item.key ? null : current)} />;
}

async function downloadReport(rows) {
  const { downloadCaseReport } = await import('../features/investigation/case-report-pdf.js');
  await downloadCaseReport(rows);
}

function ReportAudit({ row }) {
  const { reviewer, at, evidence, observations, reason, reasonCategory } = row;
  const timestamp = reportTimestamp(at);
  const category = reasonCategoryLabel(reasonCategory);
  const rationale = reason || '기록 없음';
  const hasDetail = Boolean(reason || evidence || observations || category);
  return <Box className="report-audit">
    <Box as="dl" className="report-audit-fields">
      <Box><Box as="dt">판정자</Box><Box as="dd">{reviewer || '기록 없음'}</Box></Box>
      <Box><Box as="dt">판정 시각</Box><Box as="dd">{timestamp ? <Text as="time" dateTime={at}>{timestamp}</Text> : '기록 없음'}</Box></Box>
    </Box>
    {hasDetail ? <Box as="details" className="report-audit-details">
      <Box as="summary"><Text as="span">판정 사유</Text><Text as="span" className="report-audit-preview">{rationale}</Text></Box>
      <Box as="dl" className="report-audit-fields">
        {category && <Box><Box as="dt">사유 분류</Box><Box as="dd">{category}</Box></Box>}
        <Box><Box as="dt">사유</Box><Box as="dd">{rationale}</Box></Box>
        {evidence && <Box><Box as="dt">검토 근거</Box><Box as="dd">{evidence}</Box></Box>}
        {observations && <Box><Box as="dt">관찰 내용</Box><Box as="dd">{observations}</Box></Box>}
      </Box>
    </Box> : <Box as="dl" className="report-audit-fields"><Box><Box as="dt">판정 사유</Box><Box as="dd">{rationale}</Box></Box></Box>}
  </Box>;
}

function compareJudgments(left, right, order) {
  const [leftTime, rightTime] = [Date.parse(left.at), Date.parse(right.at)];
  const [leftDated, rightDated] = [Number.isFinite(leftTime), Number.isFinite(rightTime)];
  if (leftDated !== rightDated) return leftDated ? -1 : 1;
  const timestampDifference = leftDated ? leftTime - rightTime : 0;
  return (order === 'oldest' ? 1 : -1) * (timestampDifference || left.id.localeCompare(right.id));
}

function Report({ view, data, registerTableTools, documentId, actionsHost }) {
  const history = reportHistory(data);
  const target = history.find(row => row.id === documentId);
  const [selected, setSelected] = useState(() => target ? [target.id] : reportSelection.ids);
  const [filter, setFilter] = useState(() => target ? 'all' : reportSelection.verdict);
  const [range, setRange] = useState(() => target ? undefined : reportSelection.range);
  const [order, setOrder] = useState(reportSelection.order);
  const [status, setStatus] = useState('pending');
  const tableView = view !== 'card';
  const records = history.filter(row => (!tableView || filter === 'all' || row.verdict === filter)
    && (!range || row.at && inDateRange(reportDate(row.at), range)));
  const sorting = useTableSort(records);
  const shown = tableView ? sorting.rows : records.toSorted((left, right) => compareJudgments(left, right, order));
  const selectedRows = (tableView ? records : shown).filter(row => selected.includes(row.id));
  function changeFilter(value) {
    reportSelection.verdict = value;
    setFilter(value);
  }
  function changeRange(value) {
    reportSelection.range = value;
    setRange(value);
  }
  function changeOrder(value) {
    reportSelection.order = value;
    setOrder(value);
  }
  function updateSelection(ids, checked) {
    const next = new Set(selected);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    reportSelection.ids = [...next];
    setSelected(reportSelection.ids);
  }
  async function download() {
    if (!selectedRows.length || status === 'running') return;
    setStatus('running');
    try {
      await downloadReport(selectedRows);
      setStatus('done');
      announce({ status: 'done', title: 'PDF 생성 완료', description: `판정 ${selectedRows.length}건을 내보냈습니다.` });
    } catch (error) {
      setStatus('failed');
      announce({ status: 'failed', title: 'PDF 생성 실패', description: error.message });
    }
  }
  const csvEntry = (label, file, rows) => csvDownloadEntry(label, file,
    ['판정 ID', '대상 ID', '구분', '유형', '판정 결과', '판정자', '판정 시각 (KST)',
      '사유 분류', '판정 사유', '검토 근거', '관찰 내용'], rows.map(row => [
      row.id, row.targets.map(({ code }) => code).join(' · '), row.kind, row.patterns.join(' · '),
      verdictLabels[row.verdict], row.reviewer || '', reportTimestamp(row.at), reasonCategoryLabel(row.reasonCategory) || '',
      row.reason || '', row.evidence || '', row.observations || '',
    ]));
  const actions = {
    filter: tableView ? { label: '판정 결과', options: verdictChoices, value: filter, onChange: changeFilter } : undefined,
    sort: tableView ? undefined : { options: reportSortOptions, value: order, defaultValue: 'recent', onChange: changeOrder },
    period: { asOf: reportDate(new Date()), range, onChange: changeRange },
    panelDownload: !registerTableTools,
    entries: [
      ...(records.length ? [csvEntry('표시 중인 판정 이력', 'judgment-history', shown)] : []),
      ...(history.length > records.length ? [csvEntry('전체 판정 이력', 'judgment-history-all', history)] : []),
    ],
  };
  useEffect(() => registerTableTools?.(actions));
  const tools = registerTableTools ? true : <LocalQueryTools actions={actions} />;
  const summary = tableCount(records.length, history.length, '건', selectedRows.length);
  const verdict = row => <VerdictTag verdict={row.verdict} />;
  const targets = row => <Box className="workflow-report-targets">{row.targets.map(({ code }) =>
    <LinkTag key={code} code={code} />)}</Box>;
  const patterns = row => row.patterns.length ? row.patterns.map(pattern => <PatternTag emphasis="solid" key={pattern}>{pattern}</PatternTag>) : '자료 없음';
  return <Box as="section" className="screen-section workflow-report workflow-panel">
    {!tableView && <WorkflowQueryHeading title="판정 이력" summary={summary} tools={tools} />}
    {!tableView ? <Box className="workflow-report-cards">
      {reportColumns.map(result => {
        const rows = shown.filter(row => row.verdict === result);
        const label = `${verdictLabels[result]} 판정`;
        return <Box as="section" className="workflow-report-lane" aria-label={label} key={result}>
          <SectionDownloadHeading as="h3" entries={rows.length ? [csvEntry(label, `judgments-${result}`, rows)] : []}>
            <VerdictTag verdict={result} /> <CountTag count={rows.length} />
          </SectionDownloadHeading>
          {rows.map(row => <RecordCard key={row.id} className="preview-case-card" label={row.id}
          verdict={row.verdict} selected={selected.includes(row.id)}>
          <CardHeader code={row.id} openRecord={false} selection={{
            checked: selected.includes(row.id), disabled: status === 'running',
            onChange: checked => updateSelection([row.id], checked),
          }} />
          <Box className="preview-case-card-body">
            <Box className="semantic-tag-group">
              {verdict(row)}
              {row.patterns.length > 0 && patterns(row)}
            </Box>
            <Box as="dl"><Box><Box as="dt">대상 ID</Box><Box as="dd">{targets(row)}</Box></Box></Box>
            <ReportAudit row={row} />
          </Box>
          </RecordCard>)}
          {!rows.length && <Text tone="muted">표시할 판정이 없습니다.</Text>}
        </Box>;
      })}
    </Box> :
      <WorkflowTable label="판정 로그" title="판정 이력" tools={tools} scrollbarGutter="auto"
        cellAlignment="top" invertSelectedControls
        selection={{
          codes: sorting.rows.map(row => row.id),
          rowCount: records.length,
          selectedCount: selectedRows.length,
          has: id => selected.includes(id),
          toggleRow: (id, checked) => updateSelection([id], checked),
          toggleVisible: checked => updateSelection(records.map(row => row.id), checked),
          disabled: status === 'running',
        }}
        summary={summary}>
          <TableHeader><TableRow>
            <SortableTableHead sorting={sorting} column="judgment" value={row => row.id}>판정 ID</SortableTableHead>
            <SortableTableHead sorting={sorting} column="target" value={row => row.targets[0]?.code}>대상 ID</SortableTableHead>
            <SortableTableHead sorting={sorting} column="kind" value={row => row.kind}>구분</SortableTableHead>
            <SortableTableHead sorting={sorting} column="pattern" value={row => row.patterns[0]}>유형</SortableTableHead>
            <SortableTableHead sorting={sorting} column="verdict" value={row => verdictLabels[row.verdict]}>판정 결과</SortableTableHead>
            <SortableTableHead sorting={sorting} column="date" value={row => Date.parse(row.at) || null}>판정 기록</SortableTableHead>
          </TableRow></TableHeader>
          <TableBody>
            {sorting.rows.map(row => <TableRow key={row.id} data-selected={selected.includes(row.id) || undefined}>
              <TableRowHead><Text as="code">{row.id}</Text></TableRowHead>
              <TableCell>{targets(row)}</TableCell>
              <TableCell>{row.kind}</TableCell>
              <TableCell><Box className="workflow-report-patterns">{patterns(row)}</Box></TableCell>
              <TableCell>{verdict(row)}</TableCell>
              <TableCell className="report-audit-cell"><ReportAudit row={row} /></TableCell>
            </TableRow>)}
            {!records.length && <TableRow><TableCell colSpan={6}>조회 조건과 일치하는 판정이 없습니다.</TableCell></TableRow>}
          </TableBody>
      </WorkflowTable>}
    {status !== 'pending' && <ResultStatus status={status} />}
    <ScreenActions host={actionsHost} stackOnNarrow><PrimaryButton tone="brand"
      disabled={selectedRows.length === 0 || status === 'running'} onHold={download}>AI 보고서 다운로드</PrimaryButton></ScreenActions>
  </Box>;
}

function AlertEpisodeActions({ overview }) {
  const [open, setOpen] = useState(false);
  const user = useSyncExternalStore(subscribePreviewUser, currentPreviewUser);
  if (!canManagePreviewEpisodes(user)) return null;
  return <ScreenActions host={overview.actionsHost}>
    <PrimaryButton tone="brand" aria-haspopup="dialog" onClick={() => setOpen(true)}>Episode로 묶기</PrimaryButton>
    {open && <PreviewEpisodeDialog cases={overview.reportData.cases} save={overview.saveEpisode}
      onClose={saved => saved ? overview.refreshEpisode() : setOpen(false)} />}
  </ScreenActions>;
}

function CaseReviewActions({ overview }) {
  const [episodeAction, setEpisodeAction] = useState(null);
  const { row, evidenceSelection, reportData } = overview;
  const selection = useCaseEvidenceSelection(evidenceSelection);
  const user = useSyncExternalStore(subscribePreviewUser, currentPreviewUser);
  const selected = row.related.filter(record => selection.has(record.code)).map(record => record.code);
  const blockedReason = previewAlertEditUnavailable(row, user);
  const canManageEpisodes = canManagePreviewEpisodes(user);
  const compared = overview.comparedCases ?? [];
  const comparedAlerts = compared.filter(item => item.kind === 'Alert');
  const comparedEpisodes = compared.filter(item => item.kind === 'Episode');
  const transferAlerts = row.kind === 'Alert' ? [row, ...comparedAlerts] : comparedAlerts;
  const target = row.kind === 'Episode' ? row : comparedEpisodes[0];
  let bundle;
  let bundleBlocked;
  if (compared.length) {
    if (comparedEpisodes.length > 1) {
      bundleBlocked = '편입할 Episode를 한 건 선택해 주세요.';
    } else {
      const blockers = transferAlerts.filter(item => !canTransferAlert(item)).map(item =>
        `${item.code} · ${item.episodeCode ? '기존 Episode 소속' : !item.open || item.verdict !== 'unjudged' ? '판정 완료' : '다른 담당자'}`);
      if (target && !target.open) blockers.push(`${target.code} · 판정 완료`);
      if (blockers.length) {
        bundleBlocked = blockers.join('\n');
      } else if (transferAlerts.length < (target ? 1 : 2)) {
        bundleBlocked = '기존 Episode 또는 함께 묶을 Alert를 선택해 주세요.';
      } else if (canManageEpisodes) {
        bundle = { alerts: transferAlerts.map(item => item.code), target: target?.code };
      }
    }
  }
  const onRelationRequest = (bundleBlocked || target && !target.assigned) && user?.role === 'STAFF' && overview.openRelationRequest
    ? (reason, onSent) => overview.openRelationRequest({ codes: compared.map(item => item.code), reason, onSent })
    : undefined;
  return <>
    {overview.bundleNoticeHost && createPortal(
      bundle ? <ResultStatus status="pending">Alert {bundle.alerts.length}건 → {bundle.target ?? '새 Episode'}</ResultStatus> : null,
      overview.bundleNoticeHost,
    )}
    <ScreenActions host={overview.actionsHost} stackOnNarrow={selected.length > 0}>
      {selected.length > 0 && <CaseTransactionEdit row={row} selected={selected} canEdit={!blockedReason}
        blockedReason={blockedReason} destinations={!blockedReason ? previewAlertMembershipTargets(reportData.cases, row.code, user) : []}
        onApply={overview.editTransactions} onClear={evidenceSelection.clear} />}
      {row.episodeCode && <PrimaryButton tone="inverse" as="a" href={`/episodes/${row.episodeCode}?tab=related`}>연결 Episode 열기</PrimaryButton>}
      {canManageEpisodes && row.kind === 'Episode' && row.open && row.assigned && Boolean(row.linkedAlertCodes?.length)
        && <PrimaryButton tone="inverse" aria-haspopup="dialog" onClick={() => setEpisodeAction('unlink')}>Alert 연결 해제</PrimaryButton>}
      {episodeAction && <PreviewEpisodeDialog cases={reportData.cases} save={overview.saveEpisode} row={row}
        bundle={episodeAction === 'bundle' ? bundle : undefined} unlink={episodeAction === 'unlink'}
        onRelationRequest={episodeAction === 'bundle' ? onRelationRequest : undefined}
        onClose={saved => saved ? overview.refreshEpisode() : setEpisodeAction(null)} />}
      <CaseJudgment actor={user} bundleBlocked={bundleBlocked} onBundle={bundle ? () => setEpisodeAction('bundle') : undefined}
        onRelationRequest={onRelationRequest}
        onTransfer={!bundleBlocked && canManageEpisodes && canTransferAlert(row) ? () => setEpisodeAction('transfer') : undefined} row={row} startReview={overview.startReview} save={overview.saveJudgment}
        onSavedClose={overview.onJudgmentClose} onReport={overview.onJudgmentReport} />
    </ScreenActions>
  </>;
}

/**
 * 사건 개요. "현재 운영 중인 룰"은 룰 목록(live-rule-store)에서 읽는다.
 * 서비스 모드에서는 사건의 거래에 걸린 운영 룰 적중을 서버에서 읽어 "룰 적중" 칸에 같이 보여 준다.
 * 샘플 모드의 사건은 룰 평가를 돌린 거래가 아니라서 적중 카드는 없고 운영 중인 룰(샘플)만 나온다.
 */
function CaseOverview({ overview, appearance }) {
  const hits = useCaseRuleHits(liveRules ? overview?.row?.caseId : undefined);
  // 서비스 모드는 로그인할 때 룰 목록을 읽어 둔다. 샘플 모드는 여기서 읽고, 읽고 나면 다시 그린다.
  const [, setRulesLoaded] = useState(false);
  useEffect(() => {
    if (!liveRules) void refreshLiveRules().then(() => setRulesLoaded(true), () => undefined);
  }, []);
  // Episode 에서는 카드가 어느 Alert 의 것인지 화면 코드로 보여 준다
  const alertCode = id => liveSource().cases.find(row => row.kind === 'Alert' && row.caseId === id)?.code;
  return <Suspense fallback={null}><PreviewCaseOverview {...overview} appearance={appearance}
    history={reportHistory(overview?.reportData)} activeRules={liveActiveRules()}
    ruleHits={liveRules ? { ...hits, alertCode } : undefined} /></Suspense>;
}

function Workflow({ kind, view, dashboard, overview }) {
  const appearance = useAppearance();
  if (kind.includes('dashboard') && dashboard?.error) return <Panel className="dashboard-chart" role="alert">
    <Text>대시보드 데이터를 불러오지 못했습니다.</Text>
    <ActionButton surface="floating" shape="pill" onClick={dashboard.retry}>다시 불러오기</ActionButton>
  </Panel>;
  if (kind.startsWith('benchmark-dashboard-')) {
    const mine = kind === 'benchmark-dashboard-mine';
    const loading = <DashboardSkeleton mine={mine} appearance={appearance} benchmark />;
    return !dashboard ? loading : <Suspense fallback={loading}>
      <BenchmarkDashboard mine={mine} dataset={dashboard.dataset} range={dashboard.range} appearance={appearance} />
    </Suspense>;
  }
  if (kind.startsWith('dashboard-')) {
    const mine = kind === 'dashboard-mine';
    const loading = <DashboardSkeleton mine={mine} appearance={appearance} />;
    return dashboard == null ? loading : <Suspense fallback={loading}>
      <PreviewDashboard mine={mine} data={dashboard} appearance={appearance} />
    </Suspense>;
  }
  if (kind === 'case-overview') return <CaseOverview overview={overview} appearance={appearance} />;
  if (kind === 'alert-episode-actions') return <AlertEpisodeActions overview={overview} />;
  if (kind === 'case-judgment') return <CaseReviewActions overview={overview} />;
  if (kind === 'case-readonly') return <Panel><Heading>읽기 전용</Heading></Panel>;
  if (kind === 'backtest') return <LiveRuleBacktest initialRule={overview?.rule}
    registerTableTools={overview?.registerTableTools} actionsHost={overview?.actionsHost} />;
  if (kind === 'rules-list') return <LiveRuleList initialRule={overview?.rule}
    registerTableTools={overview?.registerTableTools} actionsHost={overview?.actionsHost} />;
  return <MotionConfig reducedMotion={appearance.reduced ? 'always' : 'never'}>
    {kind === 'report' &&
      <Report view={view} data={overview?.reportData} documentId={overview?.reportDocument}
        registerTableTools={overview?.registerTableTools} actionsHost={overview?.actionsHost} />}
  </MotionConfig>;
}

export function mountWorkflows(workspace, dashboard, overview) {
  const roots = Array.from(workspace.querySelectorAll('[data-workflow]'), host => ({ host, root: createRoot(host) }));
  const render = () => roots.forEach(({ host, root }) => root.render(
    <Workflow kind={host.dataset.workflow} view={host.dataset.reportView}
      dashboard={dashboard} overview={overview} />
  ));
  render();
  return {
    updateDashboard(data) {
      dashboard = typeof data === 'function' ? data(dashboard) : data;
      render();
    },
    updateDashboardSort(rows, sort) {
      if (!dashboard?.board) return false;
      const { board } = dashboard;
      const visible = new Set(board.content.map(row => row.code));
      dashboard = { ...dashboard, sort, board: { ...board, content: rows.filter(row => visible.has(row.code)) } };
      render();
      return true;
    },
    updateBundle(comparedCases, bundleNoticeHost) {
      overview = { ...overview, comparedCases, bundleNoticeHost };
      render();
    },
    updateCase(row, reportData) {
      overview = { ...overview, row, reportData };
      render();
    },
    unmount: () => roots.forEach(({ root }) => root.unmount()),
  };
}

export function mountWorkflowNotifications(host) {
  const root = createRoot(host);
  root.render(<ResultNotifications />);
  return () => root.unmount();
}
