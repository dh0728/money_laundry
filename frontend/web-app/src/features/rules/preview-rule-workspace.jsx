import React, { cloneElement, useEffect, useId, useRef, useState } from 'react';
import { TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { RULE_LIMITS, ruleStatusLabels, ruleTransitionActions } from '@/next/features/rules-logic';
import { ActionButton, PrimaryButton } from '../../components/primary-button';
import { bindTooltip } from '../../components/components.js';
import { DialogFrame } from '../../components/dialog-parts';
import { Panel } from '../../components/panel';
import { RuleConditionFacts } from './rule-condition-tree';
import { activateRecordCard } from '../../components/record-card';
import { ScreenActions } from '../../components/screen-actions';
import { StatusTag } from '../../components/semantic-tags';
import { downloadCsv } from '../../components/query-controls';
import { SortableTableHead, tableCount, useTableSort, WorkflowTable } from '../../components/workflow-table';
import { ruleRepository } from './rule-repository';
import { useRules } from './use-rules';
import './preview-rule-workspace.css';

const presets = { DRAFT: 'pending', PENDING_APPROVAL: 'caution', TESTING: 'inProgress', ACTIVE: 'done', STOPPED: 'cancelled', REJECTED: 'failed' };
const actionTones = { requestReview: 'brand', approve: 'positive', activate: 'brand', retest: 'brand', reject: 'negative', stop: 'negative' };
const noRule = '룰을 먼저 선택해 주세요.';
const countFormat = new Intl.NumberFormat('ko-KR');
const timeFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });

function RuleTime({ value }) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? <time dateTime={value}>{timeFormat.format(date)} KST</time> : '기록 없음';
}

/** 흐린 버튼에 못 쓰는 이유를 붙인다. 마우스를 올리면 툴팁, 스크린리더는 버튼 설명으로 읽는다. */
function BlockedReason({ reason, children }) {
  const host = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!reason) return undefined;
    return bindTooltip(host.current, document.getElementById('tooltip'), { instantOnHover: true });
  }, [reason]);
  if (!reason) return children;
  return <span ref={host} className="rule-action-guard" aria-label={reason} data-blocked-reason="">
    {cloneElement(children, { 'aria-describedby': id })}
    <span id={id} className="visually-hidden">{reason}</span>
  </span>;
}

const reasonFor = (rule, action) => !rule ? noRule
  : rule.allowedActions.includes(action) ? '' : rule.blockedReasons[action] ?? '지금은 할 수 없어요.';

function RuleActions({ rule, actionsHost, listLink, onTransition, onRemove }) {
  const approveSlot = rule?.status === 'DRAFT' ? 'requestReview' : 'approve';
  const transition = action => {
    const reason = reasonFor(rule, action);
    return <BlockedReason key={action} reason={reason}>
      <PrimaryButton tone={actionTones[action]} disabled={Boolean(reason)} aria-haspopup="dialog"
        onClick={() => onTransition(action)}>{ruleTransitionActions[action].label}</PrimaryButton>
    </BlockedReason>;
  };
  const removeReason = !rule ? noRule
    : rule.allowedActions.includes('delete') || rule.allowedActions.includes('archive') ? '' : rule.blockedReasons.archive;
  const link = (action, path, label) => {
    const reason = reasonFor(rule, action);
    return <BlockedReason reason={reason}>
      {reason ? <PrimaryButton tone="inverse" disabled>{label}</PrimaryButton>
        : <PrimaryButton tone="inverse" as="a" href={`${path}?rule=${rule.id}`}>{label}</PrimaryButton>}
    </BlockedReason>;
  };
  return <ScreenActions host={actionsHost} stackOnNarrow>
    <BlockedReason reason={removeReason}>
      <PrimaryButton tone="negative" disabled={Boolean(removeReason)} aria-haspopup="dialog" onClick={onRemove}>룰 삭제</PrimaryButton>
    </BlockedReason>
    {transition('stop')}
    {transition('reject')}
    {link('duplicate', '/rules/new', '복제')}
    {link('backtest', '/rules/backtest', '백테스트로 열기')}
    {listLink && rule && <PrimaryButton tone="inverse" as="a" href={`/rules?rule=${rule.id}`}>룰 목록</PrimaryButton>}
    {transition('retest')}
    {transition('activate')}
    {transition(approveSlot)}
  </ScreenActions>;
}

/** 모든 상태 변경(승인 요청·승인·반려·중지·운영 시작·재테스트)이 같은 사유 입력 창을 쓴다. */
function RuleDecision({ rule, action, repository, onClose, onDone }) {
  const dialog = useRef(null);
  const reasonField = useRef(null);
  const titleId = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const definition = ruleTransitionActions[action];

  useEffect(() => {
    dialog.current.showModal();
    reasonField.current.focus();
  }, []);

  function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    void repository.transition(rule.id, action, reason).then(result => {
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      dialog.current.close();
      onDone(result.value, definition.label);
    }, () => {
      setBusy(false);
      setError('처리하지 못했습니다. 다시 시도해 주세요.');
    });
  }

  return <DialogFrame ref={dialog} className="rule-review-dialog" title={`룰 ${definition.label}`} titleId={titleId}
    onClose={onClose} onSubmit={submit}
    actions={<BlockedReason reason={busy ? '처리 중입니다.' : reason.trim() ? '' : '변경 사유를 입력해 주세요.'}>
      <PrimaryButton type="submit" tone={actionTones[action]} disabled={!reason.trim() || busy} aria-busy={busy || undefined}>
        {busy ? '처리 중…' : `${definition.label} 확인`}</PrimaryButton>
    </BlockedReason>}>
    <div className="case-judgment-body">
      <p><code>{rule.id}</code> · {rule.name}</p>
      <p>변경 후 상태 · {ruleStatusLabels[definition.to]}</p>
      <label className="case-judgment-field">변경 사유
        <Textarea ref={reasonField} value={reason} rows={3} maxLength={RULE_LIMITS.reason} required
          onChange={event => { setReason(event.target.value); setError(''); }} />
      </label>
      {error && <p role="alert" data-rule-block-error>{error}</p>}
    </div>
  </DialogFrame>;
}

/** 삭제 창: 취소 / 보관 / 삭제. 운영 이력이 있는 룰은 삭제 대신 보관을 권한다. */
function RuleRemove({ rule, repository, onClose, onDone }) {
  const dialog = useRef(null);
  const titleId = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canDelete = rule.allowedActions.includes('delete');
  const canArchive = rule.allowedActions.includes('archive');
  const archiveReason = !canArchive ? rule.blockedReasons.archive : busy ? '처리 중입니다.' : reason.trim() ? '' : '보관 사유를 입력해 주세요.';
  const deleteReason = !canDelete ? rule.blockedReasons.delete : busy ? '처리 중입니다.' : '';

  useEffect(() => { dialog.current.showModal(); }, []);

  function run(request, label) {
    if (busy) return;
    setBusy(true);
    void request().then(result => {
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      dialog.current.close();
      onDone(label);
    }, () => {
      setBusy(false);
      setError('처리하지 못했습니다. 다시 시도해 주세요.');
    });
  }

  return <DialogFrame ref={dialog} className="rule-review-dialog" title="룰 삭제" titleId={titleId}
    onClose={onClose} onSubmit={event => {
      event.preventDefault();
      if (canDelete) run(() => repository.delete(rule.id), '삭제됨');
    }}
    actions={<>
      <ActionButton shape="pill" surface="floating" onClick={() => dialog.current.close()}>취소</ActionButton>
      <BlockedReason reason={archiveReason}>
        <PrimaryButton tone={canDelete ? 'inverse' : 'brand'} disabled={Boolean(archiveReason)}
          onClick={() => run(() => repository.archive(rule.id, reason), '보관됨')}>보관</PrimaryButton>
      </BlockedReason>
      <BlockedReason reason={deleteReason}>
        <PrimaryButton type="submit" tone="negative" disabled={Boolean(deleteReason)}>삭제</PrimaryButton>
      </BlockedReason>
    </>}>
    <div className="case-judgment-body">
      <p><code>{rule.id}</code> · {rule.name}</p>
      <p>{canDelete ? '삭제하면 룰과 이력이 목록에서 사라집니다. 이력을 남기려면 보관하세요.'
        : '운영 이력이 있는 룰은 삭제하지 않고 보관합니다. 보관해도 이력은 남습니다.'}</p>
      <label className="case-judgment-field">보관 사유
        <Textarea value={reason} rows={2} maxLength={RULE_LIMITS.reason}
          onChange={event => { setReason(event.target.value); setError(''); }} />
      </label>
      {error && <p role="alert" data-rule-block-error>{error}</p>}
    </div>
  </DialogFrame>;
}

function RuleListState({ status, error, onRetry }) {
  if (status === 'loading') return <Panel className="workflow-rule-state" role="status" aria-busy="true">
    <p>룰 목록을 불러오는 중입니다.</p>
  </Panel>;
  if (status === 'error') return <Panel className="workflow-rule-state" role="alert">
    <p>룰 목록을 불러오지 못했습니다.{error && ` ${error}`}</p>
    <ActionButton shape="pill" surface="floating" onClick={onRetry}>다시 시도</ActionButton>
  </Panel>;
  return <Panel className="workflow-rule-state">
    <p>등록된 룰이 없습니다.</p>
    <PrimaryButton tone="inverse" as="a" href="/rules/new">룰 만들기</PrimaryButton>
  </Panel>;
}

export function RuleList({ reason = false, initialRule, registerTableTools, actionsHost, repository = ruleRepository }) {
  const { status: loadState, rules, error: loadError, retry } = useRules(repository);
  const [notice, setNotice] = useState('');
  const [id, choose] = useState(initialRule);
  const [status, setStatus] = useState('all');
  const [deciding, setDeciding] = useState(null);
  const [removing, setRemoving] = useState(null);
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
  const actions = <RuleActions rule={selected} actionsHost={actionsHost} listLink={reason}
    onTransition={setDeciding} onRemove={() => setRemoving(selected)} />;
  if (!rules.length) return <>
    <RuleListState status={loadState === 'ready' ? 'empty' : loadState} error={loadError} onRetry={retry} />
    {actions}
  </>;
  return <>
    {notice && <p className="visually-hidden" role="status">{notice}</p>}
    {loadState === 'error' && <p role="alert" className="workflow-rule-note">
      최신 룰 목록을 불러오지 못해 직전 목록을 보여 줍니다. <ActionButton onClick={retry}>다시 시도</ActionButton>
    </p>}
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
    {actions}
    {deciding && selected && <RuleDecision key={`${selected.id}-${deciding}`} rule={selected} action={deciding}
      repository={repository} onClose={() => setDeciding(null)}
      onDone={(rule, label) => setNotice(`${rule.id} · ${label} · ${ruleStatusLabels[rule.status]}`)} />}
    {removing && <RuleRemove rule={removing} repository={repository} onClose={() => setRemoving(null)}
      onDone={label => {
        choose(null);
        setNotice(`${removing.id} ${label}`);
      }} />}
  </>;
}
