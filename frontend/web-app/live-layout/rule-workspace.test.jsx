import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { reviewPreviewRule, RuleList, ruleWorkspace } from './preview-rule-workspace';
import { mountRuleControls } from './rule-controls';
import { currentPreviewUser, previewAdmin, previewStaff, setPreviewUser } from './preview-session-user.js';

it('shows real selected rule metadata and history, including after state filtering', () => {
  const rejected = ruleWorkspace.rules.find(rule => rule.status === 'REJECTED');
  let tools;
  const registerTableTools = next => { tools = next; };
  const { rerender } = render(<RuleList registerTableTools={registerTableTools} />);
  expect(screen.getByRole('region', { name: '룰 최근 변경' })).toBeInTheDocument();
  act(() => tools.filter.onChange('REJECTED'));
  const detail = within(screen.getByRole('region', { name: '룰 상세' }));
  expect(detail.getByRole('heading', { name: new RegExp(rejected.id) })).toHaveTextContent(rejected.name);
  expect(detail.getByText('80점 이상')).toBeInTheDocument();
  expect(detail.getByText(rejected.author)).toBeInTheDocument();
  expect(detail.getByRole('link', { name: '변경 사유' })).toHaveAttribute('href', `/rules/reason?rule=${rejected.id}`);
  rerender(<RuleList reason registerTableTools={registerTableTools} />);
  const history = within(screen.getByRole('region', { name: '룰 변경 사유' }));
  expect(history.getByText(rejected.history[0].reason)).toBeInTheDocument();
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
    expect(within(footer).queryByRole('button', { name: '승인' })).not.toBeInTheDocument();
    expect(reviewPreviewRule(draft.id, 'REJECTED', '조건 보완').ok).toBe(false);
    act(() => setPreviewUser(previewAdmin));
    expect(within(footer).getByRole('button', { name: '승인' })).toHaveClass('screen-primary--positive');
    expect(within(footer).getByRole('button', { name: '반려' })).toHaveClass('screen-primary--negative');
    expect(reviewPreviewRule(draft.id, 'TESTING', '').ok).toBe(false);
    const approved = reviewPreviewRule(draft.id, 'TESTING', '조건 확인 완료');
    expect(approved.value.history.at(-1)).toMatchObject({ actor: previewAdmin.name, action: '승인', reason: '조건 확인 완료' });
    expect(JSON.parse(sessionStorage.getItem('aml-preview-rule-drafts'))).toContainEqual(approved.value);
  } finally {
    unmount?.();
    ruleWorkspace.rules = before;
    setPreviewUser(beforeUser);
    if (beforeStorage === null) sessionStorage.removeItem('aml-preview-rule-drafts');
    else sessionStorage.setItem('aml-preview-rule-drafts', beforeStorage);
    footer.remove();
  }
});
