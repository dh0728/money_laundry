import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { reviewPreviewRule, RuleList, ruleWorkspace } from './preview-rule-workspace';
import { mountRuleControls } from './rule-controls';
import { currentPreviewUser, previewAdmin, previewStaff, setPreviewUser } from '../auth/preview-session-user.js';

it('shows real selected rule metadata and history, including after state filtering', () => {
  const rejected = ruleWorkspace.rules.find(rule => rule.status === 'REJECTED');
  let tools;
  const registerTableTools = next => { tools = next; };
  const footer = document.createElement('footer');
  document.body.append(footer);
  const { rerender } = render(<RuleList registerTableTools={registerTableTools} actionsHost={footer} />);
  expect(screen.getByRole('region', { name: '룰 최근 변경' })).toBeInTheDocument();
  act(() => tools.filter.onChange('REJECTED'));
  const detail = within(screen.getByRole('region', { name: '룰 상세' }));
  expect(detail.getByRole('heading', { name: new RegExp(rejected.id) })).toHaveTextContent(rejected.name);
  expect(detail.getByText('80점 이상')).toBeInTheDocument();
  expect(detail.getByText(rejected.author)).toBeInTheDocument();
  expect(detail.queryByRole('link')).not.toBeInTheDocument();
  expect(within(footer).queryByRole('link', { name: '변경 사유' })).not.toBeInTheDocument();
  expect(within(footer).queryByRole('button', { name: '변경 사유' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: '룰 최근 변경' })).toHaveTextContent(rejected.history.at(-1).reason);
  rerender(<RuleList reason registerTableTools={registerTableTools} actionsHost={footer} />);
  const history = within(screen.getByRole('region', { name: '룰 변경 사유' }));
  expect(history.getByText(rejected.history[0].reason)).toBeInTheDocument();
  expect(within(footer).getByRole('link', { name: '룰 목록' })).toHaveAttribute('href', `/rules?rule=${rejected.id}`);
  footer.remove();
});

it('keeps rule actions in the footer, enabled only while a rule is selected, and deletes after confirmation', () => {
  const before = ruleWorkspace.rules;
  const beforeDrafts = sessionStorage.getItem('aml-preview-rule-drafts');
  const beforeDeleted = sessionStorage.getItem('aml-preview-rule-deleted');
  const footer = document.createElement('footer');
  document.body.append(footer);
  const [first, second] = before;
  const dialogApi = { showModal: HTMLDialogElement.prototype.showModal, close: HTMLDialogElement.prototype.close };
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  let unmount;
  try {
    ({ unmount } = render(<RuleList initialRule={first.id} actionsHost={footer} />));
    const actions = within(footer);
    expect(actions.getByRole('link', { name: '백테스트로 열기' })).toHaveAttribute('href', `/rules/backtest?rule=${first.id}`);
    const remove = actions.getByRole('button', { name: '룰 삭제' });
    expect(remove).toHaveClass('screen-primary--negative');
    expect(remove).toBeEnabled();

    fireEvent.click(remove);
    const dialog = within(screen.getByRole('dialog', { name: '룰 삭제' }));
    expect(dialog.getByText(first.name, { exact: false })).toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog', { name: '룰 삭제' })).not.toBeInTheDocument();
    expect(ruleWorkspace.rules).toContain(first);

    fireEvent.click(actions.getByRole('button', { name: '룰 삭제' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '룰 삭제' })).getByRole('button', { name: '삭제' }));
    expect(ruleWorkspace.rules.map(rule => rule.id)).not.toContain(first.id);
    expect(JSON.parse(sessionStorage.getItem('aml-preview-rule-deleted'))).toContain(first.id);
    const list = within(screen.getByRole('table', { name: '룰 목록' }));
    expect(list.queryByRole('row', { name: new RegExp(first.id) })).not.toBeInTheDocument();
    const inventory = within(screen.getByLabelText('룰 상태별 수'));
    expect(inventory.getByText('등록된 룰').nextSibling).toHaveTextContent(String(before.length - 1));
    expect(screen.queryByRole('region', { name: '룰 상세' })).not.toBeInTheDocument();
    for (const name of ['백테스트로 열기', '복제', '룰 삭제']) expect(actions.getByRole('button', { name })).toBeDisabled();

    fireEvent.click(list.getByRole('row', { name: new RegExp(second.id) }));
    expect(actions.getByRole('link', { name: '백테스트로 열기' })).toHaveAttribute('href', `/rules/backtest?rule=${second.id}`);
    expect(actions.getByRole('button', { name: '룰 삭제' })).toBeEnabled();

    fireEvent.click(actions.getByRole('button', { name: '복제' }));
    const copy = ruleWorkspace.rules.at(-1);
    expect(copy).toMatchObject({ name: `${second.name} (복제)`, status: 'DRAFT', scoreMin: second.scoreMin });
    expect(copy.id).not.toBe(second.id);
    expect(within(screen.getByRole('region', { name: '룰 상세' })).getByRole('heading', { name: new RegExp(copy.id) })).toBeInTheDocument();
  } finally {
    unmount?.();
    Object.assign(HTMLDialogElement.prototype, dialogApi);
    ruleWorkspace.rules = before;
    for (const [key, value] of [['aml-preview-rule-drafts', beforeDrafts], ['aml-preview-rule-deleted', beforeDeleted]]) {
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    }
    footer.remove();
  }
});

it('selects a rule by clicking its status, version, owner, or row padding', () => {
  const [first, second, third] = ruleWorkspace.rules;
  render(<RuleList initialRule={first.id} />);
  const list = within(screen.getByRole('table', { name: '룰 목록' }));
  const detail = within(screen.getByRole('region', { name: '룰 상세' }));
  const row = rule => list.getByRole('row', { name: new RegExp(rule.id) });

  for (const [rule, hitTarget] of [
    [second, within(row(second)).getAllByRole('cell')[0]],
    [third, within(row(third)).getByRole('cell', { name: `v${third.version}` })],
    [second, within(row(second)).getByRole('cell', { name: second.author })],
    [first, row(first)],
  ]) {
    fireEvent.click(hitTarget);
    expect(detail.getByRole('heading', { name: new RegExp(rule.id) })).toBeInTheDocument();
    expect(within(row(rule)).getByRole('button', { name: new RegExp(rule.id) })).toHaveAttribute('aria-pressed', 'true');
  }
});

it('previews compiled conditions and persists a new draft from the rule editor', async () => {
  const host = document.createElement('main');
  const footer = document.createElement('footer');
  host.innerHTML = '<div data-rule-editor></div>';
  document.body.append(host, footer);
  const priorRules = ruleWorkspace.rules;
  const priorDrafts = sessionStorage.getItem('aml-preview-rule-drafts');
  let unmount;
  try {
    await act(async () => { unmount = mountRuleControls(host, footer); });
    const editor = within(host);
    fireEvent.change(editor.getByRole('textbox', { name: '룰 이름' }), { target: { value: '검수용 신규 룰' } });
    fireEvent.change(editor.getByRole('textbox', { name: '목적과 근거' }), { target: { value: '점수 검토 규칙' } });
    fireEvent.click(editor.getByRole('button', { name: '최소 점수 추가' }));
    const preview = within(editor.getByRole('region', { name: '작성한 조건 미리 보기' }));
    expect(preview.getByRole('heading', { name: '검수용 신규 룰' })).toBeInTheDocument();
    expect(preview.getByText('70점 이상')).toBeInTheDocument();
    expect(editor.queryByRole('button', { name: '초안 저장' })).not.toBeInTheDocument();
    const save = within(footer).getByRole('button', { name: '초안 저장' });
    expect(save).toHaveClass('screen-primary--brand');
    const form = editor.getByRole('form', { name: '룰 작성' });
    expect(save).toHaveAttribute('aria-controls', form.id);
    fireEvent.submit(form);
    const saved = ruleWorkspace.rules.find(rule => rule.name === '검수용 신규 룰');
    expect(saved).toMatchObject({ status: 'DRAFT', scoreMin: .7, description: '점수 검토 규칙' });
    expect(editor.getByRole('link', { name: '저장한 룰 보기' })).toHaveAttribute('href', `/rules?rule=${saved.id}`);
    expect(JSON.parse(sessionStorage.getItem('aml-preview-rule-drafts'))).toContainEqual(saved);
  } finally {
    await act(async () => { unmount?.(); });
    ruleWorkspace.rules = priorRules;
    if (priorDrafts === null) sessionStorage.removeItem('aml-preview-rule-drafts');
    else sessionStorage.setItem('aml-preview-rule-drafts', priorDrafts);
    host.remove();
    footer.remove();
  }
});

it('keeps approve and reject in the shared footer, and requires administrator and review reason', () => {
  const before = ruleWorkspace.rules;
  const beforeUser = currentPreviewUser();
  const beforeStorage = sessionStorage.getItem('aml-preview-rule-drafts');
  const footer = document.createElement('footer');
  document.body.append(footer);
  let unmount;
  try {
    const draft = before.find(rule => rule.status === 'DRAFT');
    setPreviewUser(previewStaff);
    expect(reviewPreviewRule(draft.id, 'PENDING_APPROVAL', '조건 확인 요청').ok).toBe(true);
    ({ unmount } = render(<RuleList initialRule={draft.id} actionsHost={footer} />));
    expect(within(footer).getByRole('button', { name: '승인' })).toBeDisabled();
    expect(within(footer).getByRole('button', { name: '반려' })).toBeDisabled();
    expect(reviewPreviewRule(draft.id, 'REJECTED', '조건 보완').ok).toBe(false);
    act(() => setPreviewUser(previewAdmin));
    expect(within(footer).getByRole('button', { name: '승인' })).toHaveClass('screen-primary--brand');
    expect(within(footer).getByRole('button', { name: '승인' })).toBeEnabled();
    expect(within(footer).getByRole('button', { name: '반려' })).toHaveClass('screen-primary--negative');
    expect(within(footer).getByRole('button', { name: '중지' })).toBeDisabled();
    const order = ['룰 삭제', '중지', '반려', '복제', '백테스트로 열기', '승인']
      .map(name => within(footer).getByRole(name === '백테스트로 열기' ? 'link' : 'button', { name }));
    expect(order).toHaveLength(6);
    order.slice(1).forEach((node, index) => expect(order[index].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
    expect(reviewPreviewRule(draft.id, 'TESTING', '').ok).toBe(false);
    const approved = reviewPreviewRule(draft.id, 'TESTING', '조건 확인 완료');
    expect(approved.value.history.at(-1)).toMatchObject({ actor: previewAdmin.name, action: '승인', reason: '조건 확인 완료' });
    expect(JSON.parse(sessionStorage.getItem('aml-preview-rule-drafts'))).toContainEqual(approved.value);

    act(() => setPreviewUser(previewStaff));
    expect(reviewPreviewRule(draft.id, 'STOPPED', '운영 점검').ok).toBe(false);
    act(() => setPreviewUser(previewAdmin));
    expect(reviewPreviewRule(draft.id, 'STOPPED', '운영 점검').value).toMatchObject({ status: 'STOPPED' });
  } finally {
    unmount?.();
    ruleWorkspace.rules = before;
    setPreviewUser(beforeUser);
    if (beforeStorage === null) sessionStorage.removeItem('aml-preview-rule-drafts');
    else sessionStorage.setItem('aml-preview-rule-drafts', beforeStorage);
    footer.remove();
  }
});

it('opens with a sample rule awaiting approval so an administrator can reject or approve it', () => {
  const beforeUser = currentPreviewUser();
  const footer = document.createElement('footer');
  document.body.append(footer);
  const pending = ruleWorkspace.rules.find(rule => rule.status === 'PENDING_APPROVAL');
  let unmount;
  try {
    expect(pending).toBeDefined();
    setPreviewUser(previewAdmin);
    ({ unmount } = render(<RuleList initialRule={pending.id} actionsHost={footer} />));
    expect(within(screen.getByLabelText('룰 상태별 수')).getByText('승인 대기')).toBeInTheDocument();
    expect(within(footer).getByRole('button', { name: '반려' })).toBeEnabled();
    expect(within(footer).getByRole('button', { name: '승인' })).toBeEnabled();
  } finally {
    unmount?.();
    setPreviewUser(beforeUser);
    footer.remove();
  }
});
