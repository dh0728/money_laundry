import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { deleteRuleDraft, fetchRule } from '@/api/rules';
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
// 지금 할 수 있는 일은 초안 이어서 작성과 초안 삭제다. 승인 · 반려 · 중지 · 복제 · 백테스트는 서버 기능이 붙는 대로 연다.

const countFormat = new Intl.NumberFormat('ko-KR');
const timeFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });
const later = '서버 기능이 붙은 뒤에 쓸 수 있습니다.';
const subjectNames = { ACCOUNT: '계좌', TX: '거래' };

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

function VersionSummary({ label, version }) {
  return <div className="rule-version-summary">
    <div className="workflow-rule-detail-tags">
      <StatusTag preset="neutral">{label} · v{version.versionNo}</StatusTag>
      <StatusChip status={version.status} />
    </div>
    <p>{version.sentence || version.summary}</p>
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

function RuleEvents({ rule }) {
  return <Panel className="workflow-rule-reason" aria-label="룰 변경 기록">
    <h2>변경 기록</h2>
    {rule.events.length ? <ol className="workflow-rule-history">
      {rule.events.map((event, index) => <li key={index}>
        <div><strong>{ruleEventNames[event.action] ?? event.action}{event.versionNo ? ` · v${event.versionNo}` : ''}</strong>
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
            <TableCell>v{rule.versionNo}{rule.workingVersionNo && rule.workingVersionNo !== rule.versionNo ? ` · v${rule.workingVersionNo} ${ruleStatusNames[rule.workingStatus]}` : ''}</TableCell>
            <TableCell>{rule.owner}</TableCell>
          </TableRow>)}
            {!rows.length && <TableRow><TableCell colSpan={7}>{rules.length ? '조건에 맞는 룰이 없습니다.' : '등록된 룰이 없습니다. 룰 만들기에서 첫 룰을 만들어 주세요.'}</TableCell></TableRow>}
          </TableBody>
        </WorkflowTable>
      </Panel>
      {shown && <RuleDetail rule={shown} row={selected} subject={subjectOf(shown.template)} />}
      {selected && !shown && <Panel className="workflow-rule-detail" aria-label="룰 상세" aria-busy={!detailFailure || undefined}>
        <h2><code>{selected.code}</code> {selected.name}</h2>
        {detailFailure ? <p role="alert">{detailFailure}</p> : <p className="workflow-rule-note">상세를 불러오는 중입니다.</p>}
      </Panel>}
    </div>
    {shown && <RuleEvents rule={shown} />}
    <ScreenActions host={actionsHost} stackOnNarrow>
      <PrimaryButton tone="negative" disabled={!working?.deletable} aria-haspopup="dialog" onClick={() => setDeleting(true)}>초안 삭제</PrimaryButton>
      <PrimaryButton tone="negative" disabled title={later}>중지</PrimaryButton>
      <PrimaryButton tone="negative" disabled title={later}>반려</PrimaryButton>
      <PrimaryButton tone="inverse" disabled title={later}>복제</PrimaryButton>
      <PrimaryButton tone="inverse" disabled title={later}>백테스트로 열기</PrimaryButton>
      {working?.editable
        ? <PrimaryButton tone="inverse" as="a" href={`/rules/new?rule=${shown.code}`}>이어서 작성</PrimaryButton>
        : <PrimaryButton tone="inverse" disabled>이어서 작성</PrimaryButton>}
      <PrimaryButton tone="brand" disabled title={later}>승인 요청</PrimaryButton>
    </ScreenActions>
    {deleting && working && <DraftDelete rule={shown} version={working} onClose={() => setDeleting(false)} onDeleted={() => {
      setNotice(`${shown.code} v${working.versionNo} 초안 삭제됨`);
      setDetail(null);
      setAttempt(count => count + 1);
    }} />}
  </>;
}
