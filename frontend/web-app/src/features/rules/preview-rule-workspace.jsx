import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { createWorkspaceState, saveWorkspaceRule, transitionWorkspaceRule } from '@/next/workspace-data';
import { ruleStatusLabels } from '@/next/features/rules-logic';
import { ActionButton, PrimaryButton } from '../../components/primary-button';
import { DialogFrame } from '../../components/dialog-parts';
import { Panel } from '../../components/panel';
import { RuleConditionFacts } from './rule-condition-tree';
import { activateRecordCard } from '../../components/record-card';
import { ScreenActions } from '../../components/screen-actions';
import { StatusTag } from '../../components/semantic-tags';
import { currentPreviewUser, subscribePreviewUser } from '../auth/preview-session-user.js';
import { downloadCsv } from '../../components/query-controls';
import { SortableTableHead, tableCount, useTableSort, WorkflowTable } from '../../components/workflow-table';
import { liveRules, refreshLiveRules } from './live-rule-store';
import './preview-rule-workspace.css';

const presets = { DRAFT: 'pending', PENDING_APPROVAL: 'caution', TESTING: 'inProgress', ACTIVE: 'done', STOPPED: 'cancelled', REJECTED: 'failed' };
export const ruleWorkspace = createWorkspaceState();
export const previewRuleTemplates = ruleWorkspace.rules;
const templatesById = new Map(previewRuleTemplates.map(rule => [rule.id, rule]));
const draftStorageKey = 'aml-preview-rule-drafts';
const deletedStorageKey = 'aml-preview-rule-deleted';

function readDeletedTemplates() {
  try {
    const ids = JSON.parse(sessionStorage.getItem(deletedStorageKey) ?? '[]');
    return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

if (liveRules) ruleWorkspace.rules = [];
else try {
  const changes = JSON.parse(sessionStorage.getItem(draftStorageKey) ?? '[]');
  if (Array.isArray(changes)) {
    const rulesById = new Map(templatesById);
    for (const id of readDeletedTemplates()) rulesById.delete(id);
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

// 서비스 모드의 룰 화면은 live-rule-list · live-rule-builder 가 맡는다. 여기 있는 것은 프리뷰(샘플 데이터)용이다.
// 앱이 처음 뜰 때 서버의 룰 목록을 읽어 둔다(Alert 상세의 "현재 운영 중인 룰"이 쓴다).
export const loadLiveRules = refreshLiveRules;

export function savePreviewRule(input, existingId) {
  return persistRuleChange(saveWorkspaceRule(ruleWorkspace, input, existingId), currentPreviewUser()?.name);
}

export function deletePreviewRule(id) {
  if (!ruleWorkspace.rules.some(rule => rule.id === id)) return { ok: false, error: '삭제할 룰을 찾을 수 없습니다.' };
  const rules = ruleWorkspace.rules.filter(rule => rule.id !== id);
  try {
    sessionStorage.setItem(draftStorageKey, JSON.stringify(rules.filter(rule => rule !== templatesById.get(rule.id))));
    if (templatesById.has(id)) sessionStorage.setItem(deletedStorageKey, JSON.stringify([...new Set([...readDeletedTemplates(), id])]));
  } catch {
    return { ok: false, error: '이 브라우저 탭에 룰 삭제를 저장할 수 없습니다.' };
  }
  ruleWorkspace.rules = rules;
  return { ok: true, value: id };
}

// 초안·반려 룰은 담당자와 관리자, 그 밖의 상태는 관리자만 삭제할 수 있다. 서버도 같은 기준으로 거절한다.
const canDeleteRule = (rule, user) => Boolean(rule && user)
  && (user.role === 'ADMIN' || (['DRAFT', 'REJECTED'].includes(rule.status) && rule.author === user.name));

const requestReview = { status: 'PENDING_APPROVAL', label: '승인 요청', tone: 'brand' };
const approveRule = { status: 'TESTING', label: '승인', tone: 'brand' };
const rejectRule = { status: 'REJECTED', label: '반려', tone: 'negative' };
const stopRule = { status: 'STOPPED', label: '중지', tone: 'negative' };

function reviewActions(rule, user) {
  if (!user || !rule) return [];
  if (rule.status === 'DRAFT') return [requestReview];
  if (user.role !== 'ADMIN') return [];
  if (rule.status === 'PENDING_APPROVAL') return [rejectRule, approveRule];
  return ['TESTING', 'ACTIVE'].includes(rule.status) ? [stopRule] : [];
}

export function reviewPreviewRule(id, status, reason) {
  const user = currentPreviewUser();
  const rule = ruleWorkspace.rules.find(row => row.id === id);
  const action = reviewActions(rule, user).find(action => action.status === status);
  if (!action) return { ok: false, error: '룰 상태와 처리 권한을 확인해 주세요.' };
  return persistRuleChange(transitionWorkspaceRule(ruleWorkspace, id, status, reason), user.name, action.label);
}

const countFormat = new Intl.NumberFormat('ko-KR');
const timeFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });

function RuleTime({ value }) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? <time dateTime={value}>{timeFormat.format(date)} KST</time> : '기록 없음';
}

function RuleReview({ rule, actionsHost, destructive, children, onReview }) {
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

  const actionButton = action => <PrimaryButton key={action.status} tone={action.tone}
    disabled={!allowed.includes(action)} aria-haspopup="dialog" onHold={() => {
      setReason('');
      setError('');
      setDecision(action);
    }}>{action.label}</PrimaryButton>;

  return <>
    <ScreenActions host={actionsHost} stackOnNarrow>
      {destructive}
      {actionButton(stopRule)}
      {actionButton(rejectRule)}
      {children}
      {actionButton(rule?.status === 'DRAFT' ? requestReview : approveRule)}
    </ScreenActions>
    {decision && <DialogFrame ref={dialog} className="rule-review-dialog" title={`룰 ${decision.label}`} titleId={titleId}
      onClose={() => setDecision(null)} onSubmit={submit}
      actions={<PrimaryButton type="submit" tone={decision.tone} disabled={!reason.trim()}>{decision.label} 확인</PrimaryButton>}>
      <div className="case-judgment-body">
        <p><code>{rule.id}</code> · {rule.name}</p>
        <p>변경 후 상태 · {ruleStatusLabels[decision.status]}</p>
        <label className="case-judgment-field">변경 사유
          <Textarea ref={reasonField} value={reason} rows={3} maxLength={1000} required
            onChange={event => { setReason(event.target.value); setError(''); }} />
        </label>
        {error && <p role="alert" data-rule-block-error>{error}</p>}
      </div>
    </DialogFrame>}
  </>;
}

function RuleLink({ rule, path, children }) {
  return rule ? <PrimaryButton tone="inverse" as="a" href={`${path}?rule=${rule.id}`}>{children}</PrimaryButton>
    : <PrimaryButton tone="inverse" disabled>{children}</PrimaryButton>;
}

function RuleDelete({ rule, onClose, onDelete }) {
  const dialog = useRef(null);
  const titleId = useId();
  const [error, setError] = useState('');

  useEffect(() => { dialog.current.showModal(); }, []);

  function submit(event) {
    event.preventDefault();
    const applied = result => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      dialog.current.close();
      onDelete();
    };
    // 서비스 모드는 서버 응답을 기다린다.
    const result = deletePreviewRule(rule.id);
    if (result instanceof Promise) void result.then(applied);
    else applied(result);
  }

  return <DialogFrame ref={dialog} className="rule-review-dialog" title="룰 삭제" titleId={titleId}
    onClose={onClose} onSubmit={submit}
    actions={<>
      <ActionButton shape="pill" surface="floating" onClick={() => dialog.current.close()}>취소</ActionButton>
      <PrimaryButton type="submit" tone="negative">삭제</PrimaryButton>
    </>}>
    <div className="case-judgment-body">
      <p><code>{rule.id}</code> · {rule.name}</p>
      <p>이 룰을 목록에서 삭제합니다.</p>
      {error && <p role="alert" data-rule-block-error>{error}</p>}
    </div>
  </DialogFrame>;
}

export function RuleList({ reason = false, initialRule, registerTableTools, actionsHost }) {
  const [rules, setRules] = useState(() => ruleWorkspace.rules);
  const user = useSyncExternalStore(subscribePreviewUser, currentPreviewUser);
  const [notice, setNotice] = useState('');
  const [id, choose] = useState(() => rules.some(row => row.id === initialRule) ? initialRule : rules[0]?.id);
  const [status, setStatus] = useState('all');
  const [deleting, setDeleting] = useState(null);
  const rows = rules.filter(rule => status === 'all' || rule.status === status);
  const sorting = useTableSort(rows);
  const selected = id === null ? undefined : rows.find(rule => rule.id === id) ?? rows[0];
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
    <RuleReview key={selected?.id ?? ''} rule={selected} actionsHost={actionsHost} onReview={rule => {
      setRules(ruleWorkspace.rules);
      setNotice(`${rule.id} · ${ruleStatusLabels[rule.status]}`);
    }} destructive={<PrimaryButton tone="negative" disabled={!canDeleteRule(selected, user)} aria-haspopup="dialog"
      onClick={() => setDeleting(selected)}>룰 삭제</PrimaryButton>}>
      <PrimaryButton tone="inverse" disabled={!selected} onClick={() => {
        const applied = result => {
          setRules(ruleWorkspace.rules);
          if (result.ok) choose(result.value.id);
          setNotice(result.ok ? `${result.value.id} 복제됨` : result.error);
        };
        // 서비스 모드는 서버 응답을 기다린다.
        const result = savePreviewRule({ ...selected, name: `${selected.name} (복제)` });
        if (result instanceof Promise) void result.then(applied);
        else applied(result);
      }}>복제</PrimaryButton>
      <RuleLink rule={selected} path="/rules/backtest">백테스트로 열기</RuleLink>
      {reason && <RuleLink rule={selected} path="/rules">룰 목록</RuleLink>}
    </RuleReview>
    {deleting && <RuleDelete rule={deleting} onClose={() => setDeleting(null)} onDelete={() => {
      setRules(ruleWorkspace.rules);
      choose(null);
      setNotice(`${deleting.id} 삭제됨`);
    }} />}
  </>;
}
