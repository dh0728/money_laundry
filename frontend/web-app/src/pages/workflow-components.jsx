import React, { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { ruleConditionSummary, runBacktest } from '@/next/features/rules-logic';
import { Check, Circle, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import StatusMark from '../components/react-bits/StatusMark';
import Stepper, { Step } from '../components/react-bits/Stepper';
import MagicBento from '../components/react-bits/MagicBento';
import { ActionButton, PrimaryButton } from '../components/primary-button';
import { CardHeader } from '../components/card-header';
import { RecordCard } from '../components/record-card';
import { Panel } from '../components/panel';
import { ScreenActions } from '../components/screen-actions';
import { CompletionRing } from '../components/completion-ring';
import { SectionDownloadHeading } from '../components/section-download';
import { LinkTag, PatternTag, StatusTag, VerdictTag, verdictLabels } from '../components/semantic-tags';
import { downloadCsv, inDateRange, LocalQueryTools } from '../components/query-controls';
import { RuleList, ruleWorkspace } from '../features/rules/preview-rule-workspace';
import { LiveRuleBacktest } from '../features/rules/live-rule-backtest';
import { LiveRuleList } from '../features/rules/live-rule-list';
import { liveActiveRules, liveRules } from '../features/rules/live-rule-store';
import { useCaseRuleHits } from '../features/rules/case-rule-hits';
import { liveSource } from '../features/investigation/live-data.js';
import { RuleConditionFacts } from '../features/rules/rule-condition-tree';
import { readWorkspaceGap } from '../features/dashboard/workspace-metrics';
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

const PreviewDashboard = lazy(() => import('../features/dashboard/preview-dashboard').then(module => ({ default: module.PreviewDashboard })));
const BenchmarkDashboard = lazy(() => import('../features/dashboard/preview-dashboard').then(module => ({ default: module.BenchmarkDashboard })));
const PreviewCaseOverview = lazy(() => import('../features/investigation/preview-case-overview').then(module => ({ default: module.PreviewCaseOverview })));
const sampleDates = ruleWorkspace.transactions.map(record => record.date).sort();
const backtestPeriod = { start: sampleDates[0], end: sampleDates.at(-1) };
const reportSelection = { ids: [], verdict: 'all' };
const verdictChoices = [
  { label: '전체', value: 'all' }, { label: '정상', value: 'normal' }, { label: '이상', value: 'abnormal' },
];
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
const backtestStepperStyles = {
  '--stepper-ink': 'var(--text)',
  '--stepper-muted': 'var(--muted-text)',
  '--stepper-faint': 'var(--divider)',
  '--stepper-ring': 'var(--focus-ring)',
  '--stepper-well': 'var(--inner-surface)',
  '--stepper-track': 'var(--divider)',
  '--stepper-tile': 'var(--canvas-surface)',
  '--stepper-tile-edge': 'var(--divider)',
  '--stepper-tile-highlight': 'transparent',
  '--stepper-tile-shadow': 'var(--information-panel-shadow)',
  '--stepper-solid': 'var(--inverse-surface)',
  '--stepper-solid-ink': 'var(--inverse-text)',
  '--stepper-hover-fill': 'var(--hover)',
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
    return <span className="workflow-static-status" role="status"><Icon className="icon" aria-hidden="true" />{label}</span>;
  }
  return <div role="status"><StatusMark status={status} label={label}
    size={16} strike={false} doneColor="currentColor" errorColor="currentColor" /></div>;
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
const noticeDuration = 5000;
const noticeMotion = 260;

function FooterNotice({ item, onClose }) {
  const { reduced } = useAppearance();
  const [closing, setClosing] = useState(false);
  const { tone, Icon } = noticeTones[item.status] ?? noticeTones.info;
  useEffect(() => {
    const timer = setTimeout(() => setClosing(true), noticeDuration + (reduced ? 0 : noticeMotion));
    return () => clearTimeout(timer);
  }, [reduced]);
  useEffect(() => {
    if (closing && reduced) onClose();
  }, [closing, reduced, onClose]);
  return <div className="footer-notice glass" data-tone={tone} data-closing={closing || undefined}
    style={{ '--notice-duration': `${noticeDuration}ms`, '--notice-motion': `${noticeMotion}ms` }}
    onAnimationEnd={event => { if (event.target === event.currentTarget && event.animationName === 'footer-notice-out') onClose(); }}
    role="status" aria-atomic="true">
    <Icon className="icon" aria-hidden="true" />
    <span className="footer-notice-text" title={[item.title, item.description].filter(Boolean).join(' · ')}>
      <strong>{item.title}</strong>{item.description && <span> · {item.description}</span>}
    </span>
    {item.showTimer !== false && <span className="footer-notice-fuse" aria-hidden="true" />}
  </div>;
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

function BacktestMetric({ label, value, unit }) {
  return <Panel as="div" className="backtest-metric">
    <dt>{label}</dt>
    <dd><strong>{value.toLocaleString('ko-KR')}</strong> <span>{unit}</span></dd>
  </Panel>;
}

function Backtest({ selectedRule, registerTableTools, actionsHost }) {
  const { reduced, theme } = useAppearance();
  const rule = ruleWorkspace.rules.find(item => item.id === selectedRule) ?? ruleWorkspace.rules[0];
  const scope = { ...backtestPeriod, count: ruleWorkspace.transactions.length };
  const [step, setStep] = useState(1);
  const [score, setScore] = useState(Number((rule.scoreMin * 100).toFixed(2)));
  const hasScoreCondition = rule.scoreMin > 0;
  const scoreValid = Number.isFinite(score) && score >= 0 && score <= 100;
  const appliedRule = { ...rule, scoreMin: score / 100 };
  const runConditions = scoreValid ? ruleConditionSummary(appliedRule) : '최소 모델 점수를 입력하세요.';
  const [status, setStatus] = useState('pending');
  const [results, setResults] = useState(null);
  const [resultRange, setResultRange] = useState();
  const matches = results?.transactions ?? [];
  const sorting = useTableSort(matches.filter(record => inDateRange(new Date(`${record.date}T00:00:00`), resultRange)));
  const running = status === 'running';
  const reset = () => {
    setResults(null);
    setResultRange(undefined);
    setStatus('pending');
    setStep(1);
  };
  useEffect(() => registerTableTools?.({
    period: matches.length ? { asOf: new Date(`${matches.at(-1).date}T00:00:00`), range: resultRange, onChange: setResultRange } : undefined,
    entries: sorting.rows.length ? [{ label: '백테스트 근거 거래', format: 'CSV', count: sorting.rows.length,
      download: () => downloadCsv('backtest-evidence', ['거래', '거래일 (KST)', '송금 계좌', '수취 계좌', '모델 점수', '금액 (USD)'],
        sorting.rows.map(record => [record.displayId, record.date, record.fromAccountId, record.toAccountId,
          Math.round(record.score * 100), record.amountUsd])) }] : [],
  }));

  useEffect(() => {
    if (status !== 'running') return undefined;
    let current = true;
    const timer = window.setTimeout(async () => {
      try {
        const applied = { ...rule, scoreMin: score / 100 };
        const result = runBacktest(ruleWorkspace.transactions, applied, backtestPeriod, { limit: 100 });
        if (!current) return;
        setResults(result);
        setStatus('done');
        setStep(3);
        announce({ status: 'done', title: '백테스트 완료', description: `거래 ${result.matchedCount}건이 룰 조건에 해당합니다.` });
      } catch (error) {
        if (!current) return;
        setStatus('failed');
        announce({ status: 'failed', title: '백테스트 실패', description: error.problem?.detail ?? error.message });
      }
    }, 120);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [rule, score, status]);

  return <section className="screen-section workflow-panel workflow-backtest" aria-label="백테스트">
    <div className="backtest-grid">
      <Panel className="backtest-card">
        <header className="backtest-card-heading"><h2>백테스트 대상 룰</h2><ResultStatus status={status} /></header>
        <strong className="backtest-rule-name">{rule.name}</strong>
        <p className="backtest-meta"><code>{rule.id}</code> · v{rule.version}</p>
        <dl className="backtest-rule-conditions">
          <dt>기록된 룰 조건</dt><dd>{ruleConditionSummary(rule)}</dd>
        </dl>
      </Panel>
      <Panel className="backtest-card">
        <h2>백테스트 대상 거래</h2>
        <p className="backtest-metric-number"><strong>{(scope?.count ?? 0).toLocaleString('ko-KR')}</strong> <span>거래</span></p>
        <p className="backtest-meta"><time dateTime={scope?.start}>{scope?.start}</time>
          {' ~ '}<time dateTime={scope?.end}>{scope?.end}</time> · KST</p>
      </Panel>
    </div>
    <Stepper key={reduced} step={step} theme={theme} style={backtestStepperStyles} frame={false} width="100%" linear disableStepIndicators
      transition={reduced ? 'none' : 'fade'} showFooter={false}>
      <Step title="조건 설정">
        <div className="backtest-grid">
          {hasScoreCondition && <Panel className="backtest-card">
            <h2>최소 모델 점수</h2>
            <label className="workflow-threshold">
              <span className="visually-hidden">최소 모델 점수</span>
              <Input type="number" min="0" max="100" required step="0.01" inputMode="decimal"
                aria-invalid={!scoreValid} aria-describedby="backtest-score-range"
                value={score} onChange={event => setScore(event.target.value === '' ? '' : event.target.valueAsNumber)} />
              <span aria-hidden="true">점</span>
            </label>
            <p id="backtest-score-range" className="backtest-meta">0~100점 · 소수 둘째 자리까지</p>
          </Panel>}
          <Panel className="backtest-card">
            <h2>백테스트 적용 조건</h2>
            {scoreValid ? <RuleConditionFacts input={appliedRule} /> : <p>{runConditions}</p>}
          </Panel>
        </div>
      </Step>
      <Step title="실행 확인">
        <Panel className="backtest-card">
          <h2>실행할 조건</h2>
          <RuleConditionFacts input={appliedRule} />
        </Panel>
      </Step>
      <Step title="결과">
        {results && <>
          <Panel className="backtest-card" data-export-visualization={results.scannedCount > 0 || undefined}>
            <SectionDownloadHeading downloadLabel={results.scannedCount > 0 ? '백테스트 적중률' : undefined}>
              백테스트 결과
            </SectionDownloadHeading>
            <div className="backtest-result-summary">
              <CompletionRing label="거래 적중률" value={results.matchedCount} total={results.scannedCount}
                color="var(--status-caution-accent)" size={88} reduced={reduced} />
              <div>
                <strong>거래 적중률</strong>
                <p>{results.scannedCount.toLocaleString('ko-KR')}건 중 {results.matchedCount.toLocaleString('ko-KR')}건이 조건에 해당</p>
                <p className="backtest-meta">{runConditions}</p>
              </div>
            </div>
          </Panel>
          <dl className="backtest-grid backtest-comparison">
            <BacktestMetric label="적중 계좌" value={results.accountCount} unit="계좌" />
            <BacktestMetric label="적중 거래" value={results.matchedCount} unit="건" />
            <BacktestMetric label="검사 거래" value={results.scannedCount} unit="건" />
          </dl>
          <WorkflowTable label="백테스트 근거 거래" summary={<>
            {tableCount(sorting.rows.length, results.matchedCount)}
            <span>합계 {results.amountUsd.toLocaleString('ko-KR')} USD</span>
          </>}>
              <TableHeader><TableRow>
                <SortableTableHead sorting={sorting} column="transaction" value={record => record.displayId}>거래</SortableTableHead>
                <SortableTableHead sorting={sorting} column="date" value={record => Date.parse(record.occurredAt)}>거래일 · KST</SortableTableHead>
                <SortableTableHead sorting={sorting} column="from" value={record => record.fromAccountId}>송금 계좌</SortableTableHead>
                <SortableTableHead sorting={sorting} column="to" value={record => record.toAccountId}>수취 계좌</SortableTableHead>
                {hasScoreCondition && <SortableTableHead sorting={sorting} column="score" value={record => record.score}>모델 점수</SortableTableHead>}
                <SortableTableHead sorting={sorting} column="amount" value={record => record.amountUsd}>금액</SortableTableHead>
              </TableRow></TableHeader>
              <TableBody>
                {sorting.rows.map(record => <TableRow key={record.id}>
                  <th scope="row"><code>{record.displayId}</code></th>
                  <TableCell>{record.date}</TableCell>
                  <TableCell><code>{record.fromAccountId}</code></TableCell>
                  <TableCell><code>{record.toAccountId}</code></TableCell>
                  {hasScoreCondition && <TableCell>{Math.round(record.score * 100)}점</TableCell>}
                  <TableCell>{record.amountUsd.toLocaleString('ko-KR')} USD</TableCell>
                </TableRow>)}
                {!sorting.rows.length && <TableRow><TableCell colSpan={hasScoreCondition ? 6 : 5}>조건에 해당하는 거래가 없습니다.</TableCell></TableRow>}
              </TableBody>
          </WorkflowTable>
        </>}
      </Step>
    </Stepper>
    <ScreenActions host={actionsHost} stackOnNarrow>
      {step === 2 ? <>
        {hasScoreCondition && <PrimaryButton className="backtest-edit-conditions" disabled={running}
          onClick={() => setStep(1)}>조건 수정</PrimaryButton>}
        <PrimaryButton tone="brand" className="backtest-footer-action" disabled={running || !scoreValid}
          onHold={() => setStatus('running')}>백테스트 실행</PrimaryButton>
      </> : <PrimaryButton tone="brand" className="backtest-footer-action"
        disabled={step === 1 && !scoreValid} onClick={step === 1 ? () => setStep(2) : reset}>
        {step === 1 ? '실행 조건 확인' : '다시 설정'}
      </PrimaryButton>}
    </ScreenActions>
  </section>;
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
  return <div className="report-audit">
    <dl className="report-audit-fields">
      <div><dt>판정자</dt><dd>{reviewer || '기록 없음'}</dd></div>
      <div><dt>판정 시각</dt><dd>{timestamp ? <time dateTime={at}>{timestamp}</time> : '기록 없음'}</dd></div>
    </dl>
    {hasDetail ? <details className="report-audit-details">
      <summary><span>판정 사유</span><span className="report-audit-preview">{rationale}</span></summary>
      <dl className="report-audit-fields">
        {category && <div><dt>사유 분류</dt><dd>{category}</dd></div>}
        <div><dt>사유</dt><dd>{rationale}</dd></div>
        {evidence && <div><dt>검토 근거</dt><dd>{evidence}</dd></div>}
        {observations && <div><dt>관찰 내용</dt><dd>{observations}</dd></div>}
      </dl>
    </details> : <dl className="report-audit-fields"><div><dt>판정 사유</dt><dd>{rationale}</dd></div></dl>}
  </div>;
}

function Report({ view, data, appearance, registerTableTools, documentId, actionsHost }) {
  const history = reportHistory(data);
  const target = history.find(row => row.id === documentId);
  const [selected, setSelected] = useState(() => target ? [target.id] : reportSelection.ids);
  const [filter, setFilter] = useState(() => target ? 'all' : reportSelection.verdict);
  const [range, setRange] = useState(() => target ? undefined : reportSelection.range);
  const [status, setStatus] = useState('pending');
  const records = history.filter(row => (filter === 'all' || row.verdict === filter)
    && (!range || row.at && inDateRange(reportDate(row.at), range)));
  const sorting = useTableSort(records);
  const selectedRows = records.filter(row => selected.includes(row.id));
  const tableView = view !== 'card';
  function changeFilter(value) {
    reportSelection.verdict = value;
    setFilter(value);
  }
  function changeRange(value) {
    reportSelection.range = value;
    setRange(value);
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
  const csvEntry = (label, file, rows) => ({
    label, format: 'CSV', count: rows.length,
    download: () => downloadCsv(file, ['판정 ID', '대상 ID', '구분', '유형', '판정 결과', '판정자', '판정 시각 (KST)',
      '사유 분류', '판정 사유', '검토 근거', '관찰 내용'], rows.map(row => [
        row.id, row.targets.map(({ code }) => code).join(' · '), row.kind, row.patterns.join(' · '),
        verdictLabels[row.verdict], row.reviewer || '', reportTimestamp(row.at), reasonCategoryLabel(row.reasonCategory) || '',
        row.reason || '', row.evidence || '', row.observations || '',
      ])),
  });
  const actions = {
    filter: { label: '판정 결과', options: verdictChoices, value: filter, onChange: changeFilter },
    period: { asOf: reportDate(new Date()), range, onChange: changeRange },
    entries: [
      ...(records.length ? [csvEntry('표시 중인 판정 이력', 'aml-judgment-history', sorting.rows)] : []),
      ...(history.length > records.length ? [csvEntry('전체 판정 이력', 'aml-judgment-history-all', history)] : []),
    ],
  };
  useEffect(() => registerTableTools?.(actions));
  const tools = registerTableTools ? true : <LocalQueryTools actions={actions} />;
  const summary = tableCount(records.length, history.length, '건', selectedRows.length);
  const verdict = row => <VerdictTag verdict={row.verdict} />;
  const targets = row => <div className="workflow-report-targets">{row.targets.map(({ code }) =>
    <LinkTag key={code} code={code} />)}</div>;
  const patterns = row => row.patterns.length ? row.patterns.map(pattern => <PatternTag emphasis="solid" key={pattern}>{pattern}</PatternTag>) : '자료 없음';
  return <section className="screen-section workflow-report workflow-panel">
    {!tableView && <WorkflowQueryHeading title="판정 이력" summary={summary} tools={tools} />}
    {view === 'card' ? <div className="workflow-report-cards">
      <MagicBento key={appearance.reduced} className="report-bento preview-tilt-cards" columns={4} rowHeight={0} gap={readWorkspaceGap()}
        theme={appearance.theme} disableAnimations={appearance.reduced} intro={false} textAutoHide={false}
        enableTilt enableBorderGlow={false} enableSpotlight={false} enableStars={false} clickEffect={false}
        items={records.map(row => ({ id: row.id, content: <RecordCard className="preview-case-card" label={row.id}
          verdict={row.verdict} selected={selected.includes(row.id)}>
          <CardHeader code={row.id} openRecord={false} selection={{
            checked: selected.includes(row.id), disabled: status === 'running',
            onChange: checked => updateSelection([row.id], checked),
          }} />
          <div className="preview-case-card-body">
            <div className="semantic-tag-group">
              {verdict(row)}
              {row.patterns.length > 0 && patterns(row)}
            </div>
            <dl><div><dt>대상 ID</dt><dd>{targets(row)}</dd></div></dl>
            <ReportAudit row={row} />
          </div>
        </RecordCard> }))} />
    </div> :
      <WorkflowTable label="판정 로그" title="판정 이력" tools={tools}
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
              <th scope="row"><code>{row.id}</code></th>
              <TableCell>{targets(row)}</TableCell>
              <TableCell>{row.kind}</TableCell>
              <TableCell><div className="workflow-report-patterns">{patterns(row)}</div></TableCell>
              <TableCell>{verdict(row)}</TableCell>
              <TableCell className="report-audit-cell"><ReportAudit row={row} /></TableCell>
            </TableRow>)}
            {!records.length && <TableRow><TableCell colSpan={6}>조회 조건과 일치하는 판정이 없습니다.</TableCell></TableRow>}
          </TableBody>
      </WorkflowTable>}
    {!tableView && !records.length && <p>조회 조건과 일치하는 판정이 없습니다.</p>}
    {status !== 'pending' && <ResultStatus status={status} />}
    <ScreenActions host={actionsHost} stackOnNarrow><PrimaryButton tone="brand"
      disabled={selectedRows.length === 0 || status === 'running'} onHold={download}>AI 보고서 다운로드</PrimaryButton></ScreenActions>
  </section>;
}

function AlertEpisodeActions({ overview }) {
  const [open, setOpen] = useState(false);
  const user = useSyncExternalStore(subscribePreviewUser, currentPreviewUser);
  if (!canManagePreviewEpisodes(user)) return null;
  return <ScreenActions host={overview.actionsHost}>
    <ActionButton onClick={() => setOpen(true)}>Episode로 묶기</ActionButton>
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
      {row.episodeCode && <ActionButton as="a" href={`/episodes/${row.episodeCode}?tab=related`}>연결 Episode 열기</ActionButton>}
      {canManageEpisodes && row.kind === 'Episode' && row.open && row.assigned && Boolean(row.linkedAlertCodes?.length)
        && <ActionButton onClick={() => setEpisodeAction('unlink')}>Alert 연결 해제</ActionButton>}
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

/** 서비스 모드의 사건 개요. 사건의 거래에 걸린 운영 룰 적중을 서버에서 읽어 "룰 적중" 칸에 같이 보여 준다. */
function LiveCaseOverview({ overview, appearance }) {
  const hits = useCaseRuleHits(overview?.row?.caseId);
  // Episode 에서는 카드가 어느 Alert 의 것인지 화면 코드로 보여 준다
  const alertCode = id => liveSource().cases.find(row => row.kind === 'Alert' && row.caseId === id)?.code;
  return <Suspense fallback={null}><PreviewCaseOverview {...overview} appearance={appearance}
    history={reportHistory(overview?.reportData)} activeRules={liveActiveRules()} ruleHits={{ ...hits, alertCode }} /></Suspense>;
}

function Workflow({ kind, view, dashboard, overview, reason }) {
  const appearance = useAppearance();
  if (kind.includes('dashboard') && dashboard?.error) return <Panel className="dashboard-chart" role="alert">
    <p>대시보드 데이터를 불러오지 못했습니다.</p>
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
  if (kind === 'case-overview') {
    if (liveRules) return <LiveCaseOverview overview={overview} appearance={appearance} />;
    const activeRules = ruleWorkspace.rules.filter(rule => rule.status === 'ACTIVE')
      .map(rule => ({ id: rule.id, version: rule.version, name: rule.name, conditions: ruleConditionSummary(rule) }));
    return <Suspense fallback={null}><PreviewCaseOverview {...overview} appearance={appearance}
      history={reportHistory(overview?.reportData)} activeRules={activeRules} /></Suspense>;
  }
  if (kind === 'alert-episode-actions') return <AlertEpisodeActions overview={overview} />;
  if (kind === 'case-judgment') return <CaseReviewActions overview={overview} />;
  if (kind === 'case-readonly') return <Panel className="glass"><h2>읽기 전용</h2></Panel>;
  if (kind === 'backtest' && liveRules) return <LiveRuleBacktest initialRule={overview?.rule}
    registerTableTools={overview?.registerTableTools} actionsHost={overview?.actionsHost} />;
  if (kind === 'backtest' && !ruleWorkspace.rules.length) return <Panel className="glass"><h2>등록된 룰이 없습니다.</h2></Panel>;
  if (kind === 'rules-list' && liveRules) return <LiveRuleList initialRule={overview?.rule}
    registerTableTools={overview?.registerTableTools} actionsHost={overview?.actionsHost} />;
  if (kind === 'rules-list') return <RuleList reason={reason} initialRule={overview?.rule}
    registerTableTools={overview?.registerTableTools} actionsHost={overview?.actionsHost} />;
  return <MotionConfig reducedMotion={appearance.reduced ? 'always' : 'never'}>
    {kind === 'backtest' ? <Backtest selectedRule={overview?.rule} registerTableTools={overview?.registerTableTools}
      actionsHost={overview?.actionsHost} /> : kind === 'report' &&
      <Report view={view} data={overview?.reportData} documentId={overview?.reportDocument}
        appearance={appearance}
        registerTableTools={overview?.registerTableTools} actionsHost={overview?.actionsHost} />}
  </MotionConfig>;
}

export function mountWorkflows(workspace, dashboard, overview) {
  const roots = Array.from(workspace.querySelectorAll('[data-workflow]'), host => ({ host, root: createRoot(host) }));
  const render = () => roots.forEach(({ host, root }) => root.render(
    <Workflow kind={host.dataset.workflow} view={host.dataset.reportView} reason={host.dataset.ruleReason === 'true'}
      dashboard={dashboard} overview={overview} />
  ));
  render();
  return {
    updateDashboard(data) {
      dashboard = data;
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
