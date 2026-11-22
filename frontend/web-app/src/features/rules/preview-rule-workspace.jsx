import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { createWorkspaceState, saveWorkspaceRule, transitionWorkspaceRule } from '@/next/workspace-data';
import { ruleStatusLabels } from '@/next/features/rules-logic';
import { ActionButton, PrimaryButton } from '../../components/primary-button';
import { Panel } from '../../components/panel';
import { RuleConditionFacts } from './rule-condition-tree';
import { activateRecordCard } from '../../components/record-card';
import { ScreenActions } from '../../components/screen-actions';
import { StatusTag } from '../../components/semantic-tags';
import { currentPreviewUser, subscribePreviewUser } from '../auth/preview-session-user.js';
import { downloadCsv } from '../../components/query-controls';
import { SortableTableHead, tableCount, useTableSort, WorkflowTable } from '../../components/workflow-table';
import { fetchLiveRules, liveRules, reviewLiveRule, saveLiveRule } from './live-rules.js';
import './preview-rule-workspace.css';

const presets = { DRAFT: 'pending', PENDING_APPROVAL: 'caution', TESTING: 'inProgress', ACTIVE: 'done', STOPPED: 'cancelled', REJECTED: 'failed' };
export const ruleWorkspace = createWorkspaceState();
export const previewRuleTemplates = ruleWorkspace.rules;
const templatesById = new Map(previewRuleTemplates.map(rule => [rule.id, rule]));
const draftStorageKey = 'aml-preview-rule-drafts';

if (liveRules) ruleWorkspace.rules = [];
else try {
  const changes = JSON.parse(sessionStorage.getItem(draftStorageKey) ?? '[]');
  if (Array.isArray(changes)) {
    const rulesById = new Map(templatesById);
    for (const rule of changes) if (rule && typeof rule.id === 'string') rulesById.set(rule.id, rule);
    ruleWorkspace.rules = [...rulesById.values()];
  }
} catch {
  // The sample templates remain available when tab storage cannot be read.
}

function persistRuleChange(result, actor, action) {
  if (!result.ok) return result;
  const { state, value } = result.value;
  const history = [...value.history];
  history[history.length - 1] = { ...history.at(-1), ...(actor && { actor }), ...(action && { action }) };
  const next = { ...value, history, ...(actor && !action && { author: actor }) };
  const rules = state.rules.map(rule => rule.id === next.id ? next : rule);
  try {
    sessionStorage.setItem(draftStorageKey, JSON.stringify(rules.filter(rule => rule !== templatesById.get(rule.id))));
  } catch {
    return { ok: false, error: '이 브라우저 탭에 룰 변경을 저장할 수 없습니다.' };
  }
  ruleWorkspace.rules = rules;
  return { ok: true, value: next };
}

// 서비스 모드: 서버에 저장된 룰을 화면 상태로 쓴다.
export function loadLiveRules() {
  return fetchLiveRules().then(rules => { ruleWorkspace.rules = rules; return rules; });
}

function applyLiveRule(result) {
  if (!result.ok) return result;
  const known = ruleWorkspace.rules.some(rule => rule.id === result.value.id);
  ruleWorkspace.rules = known ? ruleWorkspace.rules.map(rule => rule.id === result.value.id ? result.value : rule)
    : [...ruleWorkspace.rules, result.value];
  return result;
}

export function savePreviewRule(input, existingId) {
  if (liveRules) return saveLiveRule(input, existingId).then(applyLiveRule);
  return persistRuleChange(saveWorkspaceRule(ruleWorkspace, input, existingId), currentPreviewUser()?.name);
}

const requestReview = { status: 'PENDING_APPROVAL', label: '승인 요청', tone: 'brand' };
const reviewDecisions = [
  { status: 'REJECTED', label: '반려', tone: 'negative' },
  { status: 'TESTING', label: '승인', tone: 'positive' },
];

function reviewActions(rule, user) {
  if (!user || !rule) return [];
  if (rule.status === 'DRAFT') return [requestReview];
  return user.role === 'ADMIN' && rule.status === 'PENDING_APPROVAL' ? reviewDecisions : [];
}

export function reviewPreviewRule(id, status, reason) {
  const user = currentPreviewUser();
  const rule = ruleWorkspace.rules.find(row => row.id === id);
  const action = reviewActions(rule, user).find(action => action.status === status);
  if (!action) return { ok: false, error: '룰 상태와 처리 권한을 확인해 주세요.' };
  if (liveRules) return reviewLiveRule(id, status, reason).then(applyLiveRule);
  return persistRuleChange(transitionWorkspaceRule(ruleWorkspace, id, status, reason), user.name, action.label);
}

const countFormat = new Intl.NumberFormat('ko-KR');
const timeFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });

function RuleTime({ value }) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? <time dateTime={value}>{timeFormat.format(date)} KST</time> : '기록 없음';
}

function RuleReview({ rule, actionsHost, onReview }) {
  const user = useSyncExternalStore(subscribePreviewUser, currentPreviewUser);
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const dialog = useRef(null);
  const reasonField = useRef(null);
  const titleId = useId();
  const allowed = reviewActions(rule, user);

  useEffect(() => {
    if (!decision) return;
    dialog.current.showModal();
    reasonField.current.focus();
  }, [decision]);

  function submit(event) {
    event.preventDefault();
    const applied = result => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      dialog.current.close();
      onReview(result.value);
    };
    // 서비스 모드는 서버 응답을 기다린다.
    const result = reviewPreviewRule(rule.id, decision.status, reason.trim());
    if (result instanceof Promise) void result.then(applied);
    else applied(result);
  }

  return <>
    {allowed.length > 0 && <ScreenActions host={actionsHost} stackOnNarrow>
      {allowed.map(action => <PrimaryButton key={action.status} tone={action.tone}
        aria-haspopup="dialog" onHold={() => {
          setReason('');
          setError('');
          setDecision(action);
        }}>{action.label}</PrimaryButton>)}
    </ScreenActions>}
    {decision && <dialog ref={dialog} className="rule-review-dialog glass-dialog glass" aria-labelledby={titleId}
      onClose={() => setDecision(null)}>
      <form className="case-judgment-form" onSubmit={submit}>
        <header className="case-judgment-header"><h2 id={titleId}>룰 {decision.label}</h2></header>
        <div className="case-judgment-body">
          <p><code>{rule.id}</code> · {rule.name}</p>
          <p>변경 후 상태 · {ruleStatusLabels[decision.status]}</p>
          <label className="case-judgment-field">변경 사유
            <Textarea ref={reasonField} value={reason} rows={3} maxLength={1000} required
              onChange={event => { setReason(event.target.value); setError(''); }} />
          </label>
          {error && <p role="alert" data-rule-block-error>{error}</p>}
          <div className="rule-review-dialog-actions">
            <ActionButton shape="pill" surface="floating" onClick={() => dialog.current.close()}>취소</ActionButton>
            <PrimaryButton type="submit" tone={decision.tone} disabled={!reason.trim()}>{decision.label} 확인</PrimaryButton>
          </div>
        </div>
      </form>
    </dialog>}
  </>;
}

export function RuleList({ reason = false, initialRule, registerTableTools, actionsHost }) {
  const [rules, setRules] = useState(() => ruleWorkspace.rules);
  useEffect(() => {
    if (liveRules) void loadLiveRules().then(setRules, () => undefined);
  }, []);
  const [notice, setNotice] = useState('');
  const [id, choose] = useState(() => rules.some(row => row.id === initialRule) ? initialRule : rules[0]?.id);
  const [status, setStatus] = useState('all');
  const rows = rules.filter(rule => status === 'all' || rule.status === status);
  const sorting = useTableSort(rows);
  const selected = rows.find(rule => rule.id === id) ?? rows[0];
  const breakdown = Object.entries(ruleStatusLabels).map(([value, label]) => ({
    value, label, count: rules.filter(rule => rule.status === value).length,
  })).filter(({ count }) => count);
  const history = selected ? [...selected.history].reverse() : [];
  const ruleFilter = [{ value: 'all', label: '전체' }, ...breakdown.map(({ value, label }) => ({ value, label }))];
  useEffect(() => registerTableTools?.({
    filter: { label: '룰 상태', options: ruleFilter, value: status, onChange: setStatus },
    entries: [{ label: '조회된 룰', format: 'CSV', count: sorting.rows.length,
      download: () => downloadCsv('rules', ['상태', '룰 ID', '룰 이름', '버전', '담당자'],
        sorting.rows.map(rule => [ruleStatusLabels[rule.status], rule.id, rule.name, rule.version, rule.author])) }],
  }));
  return <>
    {notice && <p className="visually-hidden" role="status">{notice}</p>}
    <dl className="workflow-rule-inventory" aria-label="룰 상태별 수">
      <Panel as="div"><dt>등록된 룰</dt><dd>{countFormat.format(rules.length)}</dd></Panel>
      {breakdown.map(({ value, label, count }) => <Panel as="div" key={value}>
        <dt><StatusTag preset={presets[value]}>{label}</StatusTag></dt>
        <dd>{countFormat.format(count)}</dd>
      </Panel>)}
    </dl>
    <div className="screen-row screen-rule-list">
      <Panel className="workflow-rule-list" aria-label="룰 목록">
        <WorkflowTable label="룰 목록" summary={tableCount(rows.length, rules.length, '개')}>
            <TableHeader><TableRow>
              <SortableTableHead sorting={sorting} column="status" value={rule => ruleStatusLabels[rule.status]}>상태</SortableTableHead>
              <SortableTableHead sorting={sorting} column="rule" value={rule => rule.name}>룰</SortableTableHead>
              <SortableTableHead sorting={sorting} column="version" value={rule => rule.version}>버전</SortableTableHead>
              <SortableTableHead sorting={sorting} column="author" value={rule => rule.author}>담당자</SortableTableHead>
            </TableRow></TableHeader>
            <TableBody>{sorting.rows.map(rule => <TableRow key={rule.id} data-selected={rule.id === selected?.id}
              onClick={event => activateRecordCard(event, () => choose(rule.id))}>
              <TableCell><StatusTag preset={presets[rule.status]}>{ruleStatusLabels[rule.status]}</StatusTag></TableCell>
              <th scope="row">
                <ActionButton onClick={() => choose(rule.id)} aria-pressed={rule.id === selected?.id} className="workflow-rule-select">
                  <code>{rule.id}</code> {rule.name}
                </ActionButton>
              </th>
              <TableCell>v{rule.version}</TableCell><TableCell>{rule.author}</TableCell>
            </TableRow>)}
              {!rows.length && <TableRow><TableCell colSpan={4}>조건에 맞는 룰이 없습니다.</TableCell></TableRow>}
            </TableBody>
        </WorkflowTable>
      </Panel>
      {selected && <Panel className="workflow-rule-detail" aria-label="룰 상세">
        <h2><code>{selected.id}</code> {selected.name}</h2>
        <div className="workflow-rule-detail-tags">
          <StatusTag preset={presets[selected.status]}>{ruleStatusLabels[selected.status]}</StatusTag>
          <StatusTag preset="neutral">v{selected.version}</StatusTag>
        </div>
        <p>{selected.description}</p>
        <dl className="rule-condition-facts">
          <div><dt>담당자</dt><dd>{selected.author}</dd></div>
          <div><dt>마지막 변경</dt><dd><RuleTime value={selected.updatedAt} /></dd></div>
        </dl>
        <h3>적용 조건</h3>
        <RuleConditionFacts input={selected} />
        <div className="workflow-rule-links">
          <ActionButton as="a" shape="pill" href={`/rules/backtest?rule=${selected.id}`}>백테스트로 열기</ActionButton>
          {reason ? <ActionButton as="a" shape="pill" href={`/rules?rule=${selected.id}`}>룰 목록</ActionButton> :
            <ActionButton as="a" shape="pill" href={`/rules/reason?rule=${selected.id}`}>변경 사유</ActionButton>}
        </div>
      </Panel>}
    </div>
    {selected && <Panel className="workflow-rule-reason" aria-label={reason ? '룰 변경 사유' : '룰 최근 변경'}>
      <h2>{reason ? '변경 사유' : '최근 변경'}</h2>
      {history.length ? <ol className="workflow-rule-history">
        {(reason ? history : history.slice(0, 1)).map((entry, index) => <li key={index}>
          <div><strong>{entry.action}</strong> <span>{entry.actor} · <RuleTime value={entry.at} /></span></div>
          <p>{entry.reason}</p>
        </li>)}
      </ol> : <p>기록된 변경 이력이 없습니다.</p>}
    </Panel>}
    {selected && <RuleReview key={selected.id} rule={selected} actionsHost={actionsHost} onReview={rule => {
      setRules(ruleWorkspace.rules);
      setNotice(`${rule.id} · ${ruleStatusLabels[rule.status]}`);
    }} />}
  </>;
}
