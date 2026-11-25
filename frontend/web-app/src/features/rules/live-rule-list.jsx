import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { cloneRule, commandRule, createRuleVersion, deleteRuleDraft, fetchRule } from '@/api/rules';
import { Textarea } from '@/components/ui/textarea';
import { TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { ActionButton, PrimaryButton } from '../../components/primary-button';
import { DialogFrame } from '../../components/dialog-parts';
import { Panel } from '../../components/panel';
import { activateRecordCard } from '../../components/record-card';
import { ScreenActions } from '../../components/screen-actions';
import { StatusTag } from '../../components/semantic-tags';
import { downloadCsv } from '../../components/query-controls';
import { SortableTableHead, tableCount, useTableSort, WorkflowTable } from '../../components/workflow-table';
import {
  loadRuleCatalog, problemText, refreshLiveRules, ruleEventNames, ruleStatusNames, ruleStatusOrder, ruleStatusPresets,
} from './live-rule-store';
import './preview-rule-workspace.css';
import './live-rule-engine.css';

// 룰 목록과 상세(서비스 모드). 한 룰은 운영 버전 최대 1개와 작업 중 버전 최대 1개를 가진다.
// 상태를 바꾸는 버튼은 서버가 상세에 실어 주는 commands(지금 상태에서 있는 명령, 내가 할 수 있는지, 못 하면 왜)대로 그린다.
// 누가 무엇을 할 수 있는지를 화면이 따로 알지 않는다.

const countFormat = new Intl.NumberFormat('ko-KR');
const timeFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });
const subjectNames = { ACCOUNT: '계좌', TX: '거래' };
/** 사유의 길이. 서버의 제한과 같다. */
const commentLimit = 2000;

// 명령의 버튼 이름, 색, 바뀐 뒤의 상태, 확인 창에 적는 설명. 버튼은 왼쪽부터 negative · inverse · brand 순서로 놓는다.
const commandSpecs = {
  REJECT: { label: '반려', tone: 'negative', after: 'DRAFT', note: '작성 중으로 돌아갑니다. 작성자가 조건을 고쳐 다시 승인 요청할 수 있습니다.' },
  PAUSE: { label: '중지', tone: 'negative', after: 'PAUSED', note: '이 뒤에 시작하는 분석부터 돌지 않습니다. 이미 쌓인 적중은 남습니다.' },
  WITHDRAW: { label: '되돌리기', tone: 'inverse', after: 'DRAFT', note: '작성 중으로 돌아가 조건을 다시 고칠 수 있습니다. 시험 운영은 멈춥니다.' },
  START_SHADOW: { label: '시험 운영 시작', tone: 'inverse', after: 'SHADOW', note: '이 뒤에 시작하는 분석부터 매일 돌려 결과만 쌓습니다. Alert 에는 보이지 않습니다.' },
  CLONE: { label: '복제', tone: 'inverse', note: '이 버전의 조건을 그대로 가진 새 룰을 작성 중 상태로 만듭니다. 새 룰은 복제한 사람이 담당하고, 이 룰은 바뀌지 않습니다. 이름과 조건은 새 룰에서 고칠 수 있습니다.' },
  NEW_VERSION: { label: '새 버전 만들기', tone: 'inverse', note: '운영 버전의 조건을 복사해 작성 중인 새 버전을 만듭니다. 운영 버전은 그대로 돕니다.' },
  SUBMIT: { label: '승인 요청', tone: 'brand', after: 'PENDING', note: '관리자가 승인하면 운영을 시작합니다.' },
  APPROVE: { label: '승인', tone: 'brand', after: 'ACTIVE', note: '이 뒤에 시작하는 분석부터 운영 룰로 돌고, 적중은 Alert 에 근거로 표시됩니다.' },
  RESUME: { label: '재개', tone: 'brand', after: 'ACTIVE', note: '이 뒤에 시작하는 분석부터 다시 돕니다. 멈춰 있던 동안의 분석은 소급하지 않습니다.' },
};
const commandOrder = Object.keys(commandSpecs);
const executionModes = { LIVE: '운영', SHADOW: '시험 운영' };
const executionErrors = { TIMEOUT: '쿼리 120초 초과', BUDGET: '시간 한도 초과', INTERNAL: '실행 오류', INTERRUPTED: '중단됨' };
const backtestNotes = { QUEUED: '백테스트 대기 중', RUNNING: '백테스트 실행 중', FAILED: '백테스트 실패', CANCELLED: '백테스트 취소됨' };

function RuleTime({ value }) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? <time dateTime={value}>{timeFormat.format(date)} KST</time> : '기록 없음';
}

const StatusChip = ({ status }) => <StatusTag preset={ruleStatusPresets[status]}>{ruleStatusNames[status]}</StatusTag>;

function DraftDelete({ rule, version, onClose, onDeleted }) {
  const dialog = useRef(null);
  const titleId = useId();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { dialog.current.showModal(); }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await deleteRuleDraft(rule.ruleId, version.versionId);
      dialog.current.close();
      onDeleted();
    } catch (failure) {
      setError(problemText(failure, '초안을 삭제하지 못했습니다.'));
      setBusy(false);
    }
  }

  const only = rule.versions.length === 1;
  return <DialogFrame ref={dialog} className="rule-review-dialog" title="초안 삭제" titleId={titleId}
    onClose={onClose} onSubmit={submit}
    actions={<>
      <ActionButton shape="pill" surface="floating" onClick={() => dialog.current.close()}>취소</ActionButton>
      <PrimaryButton type="submit" tone="negative" disabled={busy}>삭제</PrimaryButton>
    </>}>
    <div className="case-judgment-body">
      <p><code>{rule.code}</code> · {rule.name} · v{version.versionNo}</p>
      <p>{only ? '이 룰에는 다른 버전이 없어 룰과 변경 기록도 함께 삭제합니다.' : '작성 중인 버전만 삭제합니다. 운영 버전과 변경 기록은 남습니다.'}</p>
      {error && <p role="alert" data-rule-block-error>{error}</p>}
    </div>
  </DialogFrame>;
}

/**
 * 상태 명령 확인 창. 승인 · 반려 · 중지 · 재개는 사유가 있어야 하고 나머지는 메모를 남길 수 있다.
 * 요청 번호(requestId)는 창을 열 때 한 번 만든다. 응답을 못 받아 다시 눌러도 서버는 한 번만 적용한다.
 */
function RuleCommandDialog({ rule, command, onClose, onDone }) {
  const dialog = useRef(null);
  const field = useRef(null);
  const titleId = useId();
  const [requestId] = useState(() => crypto.randomUUID());
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const spec = commandSpecs[command.action];
  const fresh = command.action === 'NEW_VERSION';
  const cloning = command.action === 'CLONE';
  const version = [rule.working, rule.operating].find(item => item?.versionId === command.versionId);

  useEffect(() => {
    dialog.current.showModal();
    field.current?.focus();
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const next = fresh ? (await createRuleVersion(rule.ruleId), await fetchRule(rule.ruleId))
        // 복제는 새 룰을 만든다. 그 룰의 상세를 돌려준다.
        : cloning ? await fetchRule((await cloneRule(rule.ruleId, { versionId: command.versionId })).ruleId)
        : await commandRule(rule.ruleId, { requestId, action: command.action, versionId: command.versionId, revision: command.revision, comment: comment.trim() });
      dialog.current.close();
      onDone(next);
    } catch (failure) {
      setError(problemText(failure, `${spec.label}에 실패했습니다.`));
      setBusy(false);
    }
  }

  return <DialogFrame ref={dialog} className="rule-review-dialog" title={`룰 ${spec.label}`} titleId={titleId}
    onClose={onClose} onSubmit={submit}
    actions={<>
      <ActionButton shape="pill" surface="floating" onClick={() => dialog.current.close()}>취소</ActionButton>
      <PrimaryButton type="submit" tone={spec.tone} disabled={busy || (command.commentRequired && !comment.trim())}>{spec.label} 확인</PrimaryButton>
    </>}>
    <div className="case-judgment-body">
      <p><code>{rule.code}</code> · {rule.name}{version && ` · v${version.versionNo}`}</p>
      {spec.after && <p>변경 후 상태 · {ruleStatusNames[spec.after]}</p>}
      <p className="workflow-rule-note">{spec.note}
        {command.action === 'APPROVE' && rule.operating && ` 지금 운영 버전 v${rule.operating.versionNo} 은 물러납니다.`}</p>
      {!fresh && !cloning && <label className="case-judgment-field">{command.commentRequired ? '사유' : '메모 (선택)'}
        <Textarea ref={field} value={comment} rows={3} maxLength={commentLimit} required={command.commentRequired}
          onChange={event => { setComment(event.target.value); setError(''); }} />
      </label>}
      {error && <p role="alert" data-rule-block-error>{error}</p>}
    </div>
  </DialogFrame>;
}

/** 작업 중 버전의 백테스트 상태. 시험 운영 · 승인 요청은 지금 조건으로 끝낸 백테스트가 있어야 한다. */
function backtestNote(version) {
  if (!['DRAFT', 'SHADOW', 'PENDING'].includes(version.status) || version.backtest === undefined) return null;
  if (!version.backtest) return '백테스트를 아직 돌리지 않았습니다.';
  if (version.backtest.status !== 'COMPLETED') return backtestNotes[version.backtest.status];
  return version.backtest.currentDefinition ? '지금 조건으로 백테스트를 끝냈습니다.' : '조건을 고친 뒤에는 백테스트를 돌리지 않았습니다.';
}

function VersionSummary({ label, version }) {
  const note = backtestNote(version);
  return <div className="rule-version-summary">
    <div className="workflow-rule-detail-tags">
      <StatusTag preset="neutral">{label} · v{version.versionNo}</StatusTag>
      <StatusChip status={version.status} />
    </div>
    <p>{version.sentence || version.summary}</p>
    {note && <p className="workflow-rule-note">{note}</p>}
  </div>;
}

function RuleDetail({ rule, row, subject }) {
  return <Panel className="workflow-rule-detail" aria-label="룰 상세">
    <h2><code>{rule.code}</code> {rule.name}</h2>
    <div className="workflow-rule-detail-tags">
      {rule.status && <StatusChip status={rule.status} />}
      <StatusTag preset="neutral">{rule.templateName}</StatusTag>
      {subject && <StatusTag preset="neutral">대상 · {subject}</StatusTag>}
    </div>
    <dl className="rule-condition-facts">
      <div><dt>담당자</dt><dd>{rule.owner}</dd></div>
      <div><dt>마지막 변경</dt><dd><RuleTime value={row?.changedAt ?? rule.createdAt} /></dd></div>
      {/* 적중 수와 Alert 수는 따로다. 적중은 대상 × 날짜이고, 그중 Alert 의 거래와 겹친 것만 Alert 에 보인다. */}
      {row?.hitCount != null && (rule.operating || row.hitCount > 0) && <div><dt>운영 적중</dt>
        <dd>{countFormat.format(row.hitCount)}건{row.lastHitDate && ` · 마지막 ${row.lastHitDate}`}</dd></div>}
      {row?.linkedAlertCount != null && (rule.operating || row.linkedAlertCount > 0) && <div><dt>연결 Alert</dt>
        <dd>{countFormat.format(row.linkedAlertCount)}건{row.normalRate != null && ` · 정상 판정 ${row.normalRate}%`}</dd></div>}
      {row?.shadowHitCount != null && <div><dt>시험 운영 적중</dt><dd>{countFormat.format(row.shadowHitCount)}건 · Alert 에는 보이지 않음</dd></div>}
      {row?.lastRunFailed && <div><dt>최근 일일 실행</dt><dd><StatusTag preset="caution">실패</StatusTag></dd></div>}
    </dl>
    <h3>적용 조건</h3>
    {rule.operating && <VersionSummary label="운영 버전" version={rule.operating} />}
    {rule.working && <VersionSummary label={rule.operating ? '새 버전' : '작업 중 버전'} version={rule.working} />}
    <h3>버전 이력</h3>
    <ol className="workflow-rule-history">
      {rule.versions.map(version => <li key={version.versionId}>
        <div><strong>v{version.versionNo} · {ruleStatusNames[version.status]}</strong>
          <span>{version.author} · <RuleTime value={version.createdAt} /></span></div>
        <p>{version.summary}</p>
      </li>)}
    </ol>
  </Panel>;
}

/** 일일 실행 기록. 분석이 ALERTS 단계에 들어올 때 시험 운영 · 운영 중인 버전이 한 번씩 돈다. */
function RuleExecutions({ rule }) {
  const executions = rule.executions ?? [];
  if (!executions.length) return null;
  return <Panel className="rule-executions" aria-label="룰 일일 실행">
    <h2>일일 실행</h2>
    <p className="workflow-rule-note">분석 때마다 그 분석이 새로 받은 날짜를 검사합니다. 최근 {executions.length}건입니다.</p>
    <table className="rule-backtest-table">
      <thead><tr><th scope="col">분석 날짜</th><th scope="col">버전</th><th scope="col">방식</th><th scope="col">결과</th>
        <th scope="col">검사 시점</th><th scope="col">적중</th><th scope="col">건너뛴 바쁜 계좌</th></tr></thead>
      <tbody>{executions.map((run, index) => <tr key={index}>
        <th scope="row">{run.analysisDate ?? '—'}</th>
        <td>v{run.versionNo}</td>
        <td>{executionModes[run.mode] ?? run.mode}</td>
        <td>{run.status === 'FAILED' ? `실패 · ${executionErrors[run.errorCode] ?? run.errorCode}` : '완료'}</td>
        <td>{run.triggerCount == null ? '—' : countFormat.format(run.triggerCount)}</td>
        <td>{run.hitCount == null ? '—' : countFormat.format(run.hitCount)}</td>
        <td>{run.skippedBusySubjects == null ? '—' : countFormat.format(run.skippedBusySubjects)}</td>
      </tr>)}</tbody>
    </table>
  </Panel>;
}

function RuleEvents({ rule }) {
  return <Panel className="workflow-rule-reason" aria-label="룰 변경 기록">
    <h2>변경 기록</h2>
    {rule.events.length ? <ol className="workflow-rule-history">
      {rule.events.map((event, index) => <li key={index}>
        <div><strong>{ruleEventNames[event.action] ?? event.action}{event.versionNo ? ` · v${event.versionNo}` : ''}{event.selfApproved ? ' · 본인 승인' : ''}
          {event.clonedFrom ? ` · ${event.clonedFrom.code}${event.clonedFrom.versionNo ? ` v${event.clonedFrom.versionNo}` : ''} 복제` : ''}</strong>
          <span>{event.actor ?? '시스템'} · <RuleTime value={event.at} /></span></div>
        {event.comment && <p>{event.comment}</p>}
      </li>)}
    </ol> : <p>기록된 변경 이력이 없습니다.</p>}
  </Panel>;
}

export function LiveRuleList({ initialRule, registerTableTools, actionsHost }) {
  const [list, setList] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [failure, setFailure] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [code, choose] = useState(initialRule);
  const [detail, setDetail] = useState(null);
  const [detailFailure, setDetailFailure] = useState('');
  const [status, setStatus] = useState('all');
  const [deleting, setDeleting] = useState(false);
  const [command, setCommand] = useState(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let current = true;
    refreshLiveRules().then(loaded => {
      if (!current) return;
      setList(loaded);
      setFailure('');
    }, error => { if (current) setFailure(problemText(error, '룰 목록을 불러오지 못했습니다.')); });
    // 대상(계좌 · 거래) 표시는 카탈로그에서 온다. 못 읽어도 목록은 보여 준다.
    loadRuleCatalog().then(loaded => { if (current) setCatalog(loaded); }, () => undefined);
    return () => { current = false; };
  }, [attempt]);

  const rules = list?.content ?? [];
  const rows = rules.filter(rule => status === 'all' || rule.status === status);
  const sorting = useTableSort(rows);
  const selected = code === null ? undefined : rows.find(rule => rule.code === code) ?? rows[0];
  const selectedId = selected?.ruleId;

  const loadDetail = useCallback(ruleId => {
    let current = true;
    setDetailFailure('');
    fetchRule(ruleId).then(loaded => { if (current) setDetail(loaded); },
      error => { if (current) { setDetail(null); setDetailFailure(problemText(error, '룰 상세를 불러오지 못했습니다.')); } });
    return () => { current = false; };
  }, []);
  // attempt: 초안을 지운 뒤에는 같은 룰이어도 상세를 다시 읽는다
  useEffect(() => (selectedId == null ? undefined : loadDetail(selectedId)), [selectedId, loadDetail, attempt]);

  const backtestable = template => (catalog?.backtestTemplates ?? []).includes(template);
  const subjectOf = template => subjectNames[catalog?.templates.find(item => item.key === template)?.subject];
  const breakdown = ruleStatusOrder.map(value => ({ value, label: ruleStatusNames[value], count: list?.counts[value] ?? 0 })).filter(({ count }) => count);
  const ruleFilter = [{ value: 'all', label: '전체' }, ...breakdown.map(({ value, label }) => ({ value, label }))];
  useEffect(() => registerTableTools?.({
    filter: { label: '룰 상태', options: ruleFilter, value: status, onChange: setStatus },
    entries: [{ label: '조회된 룰', format: 'CSV', count: sorting.rows.length,
      download: () => downloadCsv('rules', ['상태', '룰 ID', '룰 이름', '템플릿', '조건', '버전', '담당자'],
        sorting.rows.map(rule => [ruleStatusNames[rule.status], rule.code, rule.name, rule.templateName, rule.summary, rule.versionNo, rule.owner])) }],
  }));

  if (failure) return <Panel className="glass rule-load-failure">
    <h2>룰 목록을 열 수 없습니다.</h2>
    <p role="alert">{failure}</p>
    <ActionButton shape="pill" surface="floating" onClick={() => setAttempt(count => count + 1)}>다시 시도</ActionButton>
  </Panel>;
  if (!list) return <Panel className="glass" aria-busy="true"><h2>룰 목록을 불러오는 중입니다.</h2></Panel>;

  const shown = detail?.ruleId === selectedId ? detail : null;
  const working = shown?.working;
  // 서버가 준 명령을 정해 둔 순서로. 할 수 없는 명령은 이유를 툴팁으로 달아 꺼 둔다.
  const commands = commandOrder.flatMap(action => (shown?.commands ?? []).filter(item => item.action === action));
  // 누르면 확인 창이 뜬다. 확인 창이 한 번 더 묻으므로 길게 누르기는 쓰지 않는다.
  const commandButton = item => <PrimaryButton key={`${item.action}-${item.versionId}`} tone={commandSpecs[item.action].tone}
    disabled={!item.enabled} {...(item.reason ? { title: item.reason } : {})} aria-haspopup="dialog"
    onClick={() => setCommand(item)}>{commandSpecs[item.action].label}</PrimaryButton>;
  return <>
    {notice && <p className="visually-hidden" role="status">{notice}</p>}
    <dl className="workflow-rule-inventory" aria-label="룰 상태별 수">
      <Panel as="div"><dt>등록된 룰</dt><dd>{countFormat.format(rules.length)}</dd></Panel>
      {breakdown.map(({ value, label, count }) => <Panel as="div" key={value}>
        <dt><StatusTag preset={ruleStatusPresets[value]}>{label}</StatusTag></dt>
        <dd>{countFormat.format(count)}</dd>
      </Panel>)}
    </dl>
    <div className="screen-row screen-rule-list">
      <Panel className="workflow-rule-list" aria-label="룰 목록">
        <WorkflowTable label="룰 목록" summary={tableCount(rows.length, rules.length, '개')}>
          <TableHeader><TableRow>
            <SortableTableHead sorting={sorting} column="status" value={rule => ruleStatusNames[rule.status]}>상태</SortableTableHead>
            <SortableTableHead sorting={sorting} column="rule" value={rule => rule.code}>룰</SortableTableHead>
            <SortableTableHead sorting={sorting} column="pattern" value={rule => rule.templateName}>템플릿</SortableTableHead>
            <SortableTableHead sorting={sorting} column="target" value={rule => subjectOf(rule.template) ?? ''}>대상</SortableTableHead>
            <SortableTableHead sorting={sorting} column="value" value={rule => rule.summary}>조건</SortableTableHead>
            <SortableTableHead sorting={sorting} column="hits" value={rule => rule.hitCount ?? -1}>운영 적중</SortableTableHead>
            <SortableTableHead sorting={sorting} column="alerts" value={rule => rule.linkedAlertCount ?? -1}>연결 Alert</SortableTableHead>
            <SortableTableHead sorting={sorting} column="version" value={rule => rule.versionNo}>버전</SortableTableHead>
            <SortableTableHead sorting={sorting} column="author" value={rule => rule.owner}>담당자</SortableTableHead>
          </TableRow></TableHeader>
          <TableBody>{sorting.rows.map(rule => <TableRow key={rule.ruleId} data-selected={rule.ruleId === selectedId}
            onClick={event => activateRecordCard(event, () => choose(rule.code))}>
            <TableCell><StatusChip status={rule.status} /></TableCell>
            <th scope="row">
              <ActionButton onClick={() => choose(rule.code)} aria-pressed={rule.ruleId === selectedId} className="workflow-rule-select">
                <code>{rule.code}</code> {rule.name}
              </ActionButton>
            </th>
            <TableCell>{rule.templateName}</TableCell>
            <TableCell>{subjectOf(rule.template) ?? '—'}</TableCell>
            <TableCell className="workflow-rule-summary">{rule.summary}</TableCell>
            <TableCell>{rule.hitCount == null ? '—' : countFormat.format(rule.hitCount)}{rule.lastRunFailed && <> <StatusTag preset="caution">실행 실패</StatusTag></>}</TableCell>
            <TableCell>{rule.linkedAlertCount == null ? '—' : countFormat.format(rule.linkedAlertCount)}</TableCell>
            <TableCell>v{rule.versionNo}{rule.workingVersionNo && rule.workingVersionNo !== rule.versionNo ? ` · v${rule.workingVersionNo} ${ruleStatusNames[rule.workingStatus]}` : ''}</TableCell>
            <TableCell>{rule.owner}</TableCell>
          </TableRow>)}
            {!rows.length && <TableRow><TableCell colSpan={9}>{rules.length ? '조건에 맞는 룰이 없습니다.' : '등록된 룰이 없습니다. 룰 만들기에서 첫 룰을 만들어 주세요.'}</TableCell></TableRow>}
          </TableBody>
        </WorkflowTable>
      </Panel>
      {shown && <RuleDetail rule={shown} row={selected} subject={subjectOf(shown.template)} />}
      {selected && !shown && <Panel className="workflow-rule-detail" aria-label="룰 상세" aria-busy={!detailFailure || undefined}>
        <h2><code>{selected.code}</code> {selected.name}</h2>
        {detailFailure ? <p role="alert">{detailFailure}</p> : <p className="workflow-rule-note">상세를 불러오는 중입니다.</p>}
      </Panel>}
    </div>
    {shown && <RuleExecutions rule={shown} />}
    {shown && <RuleEvents rule={shown} />}
    <ScreenActions host={actionsHost} stackOnNarrow>
      <PrimaryButton tone="negative" disabled={!working?.deletable} aria-haspopup="dialog" onClick={() => setDeleting(true)}>초안 삭제</PrimaryButton>
      {commands.filter(item => commandSpecs[item.action].tone === 'negative').map(commandButton)}
      {commands.filter(item => item.action === 'CLONE').map(commandButton)}
      {!shown && <PrimaryButton tone="inverse" disabled>복제</PrimaryButton>}
      {shown && backtestable(shown.template)
        ? <PrimaryButton tone="inverse" as="a" href={`/rules/backtest?rule=${shown.code}`}>백테스트로 열기</PrimaryButton>
        : <PrimaryButton tone="inverse" disabled title={shown ? '이 템플릿의 백테스트는 아직 제공하지 않습니다.' : undefined}>백테스트로 열기</PrimaryButton>}
      {working?.editable
        ? <PrimaryButton tone="inverse" as="a" href={`/rules/new?rule=${shown.code}`}>이어서 작성</PrimaryButton>
        : <PrimaryButton tone="inverse" disabled>이어서 작성</PrimaryButton>}
      {commands.filter(item => commandSpecs[item.action].tone !== 'negative' && item.action !== 'CLONE').map(commandButton)}
    </ScreenActions>
    {command && shown && <RuleCommandDialog key={`${command.action}-${command.versionId}-${command.revision}`} rule={shown} command={command}
      onClose={() => setCommand(null)} onDone={next => {
        if (command.action === 'CLONE') {
          const source = shown.code;
          // 복제로 생긴 새 룰(작성 중)을 고른다. 목록을 먼저 다시 읽고 한꺼번에 바꾼다. 목록에 아직 없는 룰을 먼저 고르면 첫 줄의 룰이 잠깐 보인다.
          // 상태 필터에 가려지지 않게 필터도 푼다.
          refreshLiveRules().then(loaded => {
            setList(loaded);
            setStatus('all');
            choose(next.code);
            setDetail(next);
            setNotice(`${source} 복제 · 새 룰 ${next.code}`);
          }, error => setFailure(problemText(error, '룰 목록을 불러오지 못했습니다.')));
          return;
        }
        setNotice(`${next.code} · ${commandSpecs[command.action].label} · ${ruleStatusNames[next.status] ?? ''}`);
        setDetail(next);
        // 목록의 상태와 상태별 수도 다시 읽는다
        setAttempt(count => count + 1);
      }} />}
    {deleting && working && <DraftDelete rule={shown} version={working} onClose={() => setDeleting(false)} onDeleted={() => {
      setNotice(`${shown.code} v${working.versionNo} 초안 삭제됨`);
      setDetail(null);
      setAttempt(count => count + 1);
    }} />}
  </>;
}
