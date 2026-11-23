import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { RuleList } from './preview-rule-workspace';
import { createSampleRuleRepository } from './rule-repository';
import { mountRuleControls } from './rule-controls';
import { currentPreviewUser, previewAdmin, previewStaff, setPreviewUser } from '../auth/preview-session-user.js';

const dialogApi = { showModal: HTMLDialogElement.prototype.showModal, close: HTMLDialogElement.prototype.close };
const priorUser = currentPreviewUser();
let footer;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});
afterAll(() => Object.assign(HTMLDialogElement.prototype, dialogApi));
afterEach(() => {
  act(() => setPreviewUser(priorUser));
  footer?.remove();
});

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}
function setup(user = previewAdmin) {
  act(() => setPreviewUser(user));
  footer = document.createElement('footer');
  document.body.append(footer);
  return createSampleRuleRepository({ storage: memoryStorage() });
}
const action = name => within(footer).getByRole(name === '복제' || name === '백테스트로 열기' ? 'link' : 'button', { name });
const rulesNamed = async (repository, status) => (await repository.list()).find(rule => rule.status === status);

it('shows selected rule metadata and history, including after state filtering', async () => {
  const repository = setup();
  const rejected = await rulesNamed(repository, 'REJECTED');
  let tools;
  const registerTableTools = next => { tools = next; };
  const { rerender } = render(<RuleList repository={repository} registerTableTools={registerTableTools} actionsHost={footer} />);
  expect(await screen.findByRole('region', { name: '룰 최근 변경' })).toBeInTheDocument();
  act(() => tools.filter.onChange('REJECTED'));
  const detail = within(screen.getByRole('region', { name: '룰 상세' }));
  expect(detail.getByRole('heading', { name: new RegExp(rejected.id) })).toHaveTextContent(rejected.name);
  expect(detail.getByText('80점 이상')).toBeInTheDocument();
  expect(detail.getByText(rejected.author)).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '룰 최근 변경' })).toHaveTextContent(rejected.history.at(-1).reason);
  rerender(<RuleList reason repository={repository} registerTableTools={registerTableTools} actionsHost={footer} />);
  const history = within(screen.getByRole('region', { name: '룰 변경 사유' }));
  expect(history.getByText(rejected.history[0].reason)).toBeInTheDocument();
  expect(within(footer).getByRole('link', { name: '룰 목록' })).toHaveAttribute('href', `/rules?rule=${rejected.id}`);
});

it('shows loading, empty, and retryable error states', async () => {
  setup();
  let finish;
  const subscribe = () => () => {};
  const pending = { subscribe, list: () => new Promise(resolve => { finish = resolve; }) };
  const { unmount } = render(<RuleList repository={pending} actionsHost={footer} />);
  expect(screen.getByRole('status')).toHaveTextContent('룰 목록을 불러오는 중입니다.');
  await act(async () => finish([]));
  expect(screen.getByText('등록된 룰이 없습니다.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '룰 만들기' })).toHaveAttribute('href', '/rules/new');
  unmount();

  let calls = 0;
  const flaky = { subscribe, list: () => ++calls === 1 ? Promise.reject(new Error('연결 실패')) : Promise.resolve([]) };
  render(<RuleList repository={flaky} actionsHost={footer} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('룰 목록을 불러오지 못했습니다. 연결 실패');
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByText('등록된 룰이 없습니다.')).toBeInTheDocument();
  expect(calls).toBe(2);
});

it('always shows every rule action in order and explains why a dimmed one cannot be used', async () => {
  const repository = setup(previewStaff);
  const pending = await rulesNamed(repository, 'PENDING_APPROVAL');
  render(<RuleList repository={repository} initialRule={pending.id} actionsHost={footer} />);
  await screen.findByRole('region', { name: '룰 상세' });
  const order = ['룰 삭제', '중지', '반려', '초안으로 되돌리기', '복제', '백테스트로 열기', '재테스트', '운영 시작', '승인'].map(action);
  order.slice(1).forEach((node, index) => expect(order[index].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
  expect(action('승인')).toBeDisabled();
  expect(action('승인')).toHaveAccessibleDescription('관리자만 승인할 수 있어요.');
  expect(action('승인').closest('[data-blocked-reason]')).toHaveAttribute('aria-label', '관리자만 승인할 수 있어요.');
  expect(action('운영 시작')).toHaveAccessibleDescription('테스트 중 상태의 룰만 운영을 시작할 수 있어요.');
  expect(action('룰 삭제')).toHaveAccessibleDescription('관리자만 보관할 수 있어요.');
  expect(action('복제')).toHaveAttribute('href', `/rules/new?rule=${pending.id}`);

  act(() => setPreviewUser(previewAdmin));
  await waitFor(() => expect(action('승인')).toBeEnabled());
  expect(action('승인')).toHaveClass('screen-primary--positive');
  expect(action('운영 시작')).toHaveClass('screen-primary--brand');
  expect(action('재테스트')).toHaveClass('screen-primary--brand');
  expect(action('반려')).toHaveClass('screen-primary--negative');
  expect(action('중지')).toHaveClass('screen-primary--negative');
  expect(action('초안으로 되돌리기')).toHaveClass('screen-primary--inverse');
  expect(action('승인')).not.toHaveAttribute('title');
});

it('moves a rule through approve, start operation, stop, and retest with one reason dialog', async () => {
  const repository = setup();
  const pending = await rulesNamed(repository, 'PENDING_APPROVAL');
  render(<RuleList repository={repository} initialRule={pending.id} actionsHost={footer} />);
  await screen.findByRole('region', { name: '룰 상세' });
  const detail = () => within(screen.getByRole('region', { name: '룰 상세' }));
  for (const [name, status] of [['승인', '테스트 중'], ['운영 시작', '운영 중'], ['중지', '중지'], ['재테스트', '테스트 중']]) {
    await waitFor(() => expect(action(name)).toBeEnabled());
    fireEvent.click(action(name));
    const dialog = within(screen.getByRole('dialog', { name: `룰 ${name}` }));
    const confirm = dialog.getByRole('button', { name: `${name} 확인` });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAccessibleDescription('변경 사유를 입력해 주세요.');
    expect(screen.getByRole('dialog', { name: `룰 ${name}` }).querySelector('footer.dialog-actions-fill > .accent-action')).toBeInTheDocument();
    fireEvent.change(dialog.getByRole('textbox', { name: '변경 사유' }), { target: { value: `${name} 사유` } });
    fireEvent.click(dialog.getByRole('button', { name: `${name} 확인` }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(detail().getAllByText(status).length).toBeGreaterThan(0));
  }
  const rule = await repository.get(pending.id);
  expect(rule.history.slice(-4).map(entry => [entry.action, entry.actor])).toEqual(
    ['승인', '운영 시작', '중지', '재테스트'].map(label => [label, previewAdmin.name]));
});

it('recommends archiving rules with operating history but still lets them be deleted', async () => {
  const repository = setup();
  const draft = await rulesNamed(repository, 'DRAFT');
  const active = await rulesNamed(repository, 'ACTIVE');
  const withHistory = (await repository.list()).find(rule => rule.id !== active.id && !['DRAFT', 'REJECTED'].includes(rule.status));
  render(<RuleList repository={repository} initialRule={active.id} actionsHost={footer} />);
  await screen.findByRole('region', { name: '룰 상세' });

  fireEvent.click(action('룰 삭제'));
  let dialog = within(screen.getByRole('dialog', { name: '룰 삭제' }));
  expect(dialog.getByText(/삭제하면 운영 이력까지 지워지므로, 이력을 남기려면 보관을 권장합니다/)).toBeInTheDocument();
  expect(dialog.getByRole('button', { name: '삭제' })).toBeEnabled();
  expect(dialog.getByRole('button', { name: '삭제' })).toHaveClass('screen-primary--negative');
  // 공용 DialogFooter가 버튼을 꽉 채우려면 버튼이 감싸이지 않은 직속 자식이어야 한다.
  const dialogFooter = screen.getByRole('dialog', { name: '룰 삭제' }).querySelector('footer.dialog-actions-fill');
  expect([...dialogFooter.children].every(child => child.matches('.button, .accent-action, .hold-button'))).toBe(true);
  expect(dialogFooter.children).toHaveLength(3);
  expect(dialog.getByRole('button', { name: '보관 (권장)' })).toHaveClass('screen-primary--brand');
  expect(dialog.getByRole('button', { name: '보관 (권장)' })).toHaveAccessibleDescription('보관 사유를 입력해 주세요.');
  const [cancel, remove, keep] = ['취소', '삭제', '보관 (권장)'].map(name => dialog.getByRole('button', { name }));
  expect(cancel.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(remove.compareDocumentPosition(keep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.change(dialog.getByRole('textbox', { name: '보관 사유' }), { target: { value: '운영 종료' } });
  fireEvent.click(dialog.getByRole('button', { name: '보관 (권장)' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.queryByRole('row', { name: new RegExp(active.id) })).not.toBeInTheDocument());
  const archived = (await repository.list({ includeArchived: true })).find(rule => rule.id === active.id);
  expect(archived.archivedAt).toBeTruthy();
  expect(archived.history.at(-1)).toMatchObject({ action: '보관', reason: '운영 종료' });

  fireEvent.click(within(screen.getByRole('table', { name: '룰 목록' })).getByRole('row', { name: new RegExp(withHistory.id) }));
  fireEvent.click(action('룰 삭제'));
  fireEvent.click(within(screen.getByRole('dialog', { name: '룰 삭제' })).getByRole('button', { name: '삭제' }));
  await waitFor(() => expect(screen.queryByRole('row', { name: new RegExp(withHistory.id) })).not.toBeInTheDocument());
  expect(await repository.get(withHistory.id)).toBeNull();

  fireEvent.click(within(screen.getByRole('table', { name: '룰 목록' })).getByRole('row', { name: new RegExp(draft.id) }));
  fireEvent.click(action('룰 삭제'));
  dialog = within(screen.getByRole('dialog', { name: '룰 삭제' }));
  expect(dialog.getByRole('button', { name: '삭제' })).toHaveClass('screen-primary--negative');
  expect(dialog.getByRole('button', { name: '보관' })).toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: '취소' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(action('룰 삭제'));
  fireEvent.click(within(screen.getByRole('dialog', { name: '룰 삭제' })).getByRole('button', { name: '삭제' }));
  await waitFor(() => expect(screen.queryByRole('row', { name: new RegExp(draft.id) })).not.toBeInTheDocument());
  expect(await repository.get(draft.id)).toBeNull();
});

it('lets the author handle their own draft but keeps other drafts for the author or an administrator', async () => {
  const repository = setup(previewStaff);
  const others = await rulesNamed(repository, 'DRAFT');
  expect(await repository.transition(others.id, 'requestReview', '검토 요청')).toMatchObject({ ok: false,
    error: '초안·반려 상태에서는 작성자나 관리자만 승인을 요청할 수 있어요.' });
  const own = await repository.save({ name: '분석가 초안', description: '본인 초안', typeCode: null, scoreMin: .8, minTransactions: 1, windowHours: 24 });
  expect(own.value).toMatchObject({ author: previewStaff.name, status: 'DRAFT' });
  expect(own.value.allowedActions).toEqual(expect.arrayContaining(['requestReview', 'delete', 'archive', 'edit']));
  const requested = await repository.transition(own.value.id, 'requestReview', '검토 요청');
  expect(requested.value.status).toBe('PENDING_APPROVAL');
  expect(requested.value.allowedActions).not.toContain('archive');
  expect(requested.value.blockedReasons.archive).toBe('관리자만 보관할 수 있어요.');
});

it('selects a rule by clicking its status, version, owner, or row padding', async () => {
  const repository = setup();
  const [first, second, third] = await repository.list();
  render(<RuleList repository={repository} initialRule={first.id} />);
  const list = within(await screen.findByRole('table', { name: '룰 목록' }));
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

it('previews compiled conditions, saves a draft, and opens a duplicate prefilled without saving it', async () => {
  setup();
  const host = document.createElement('main');
  host.innerHTML = '<div data-rule-editor></div>';
  document.body.append(host);
  const before = sessionStorage.getItem('aml-preview-rule-drafts');
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
    const save = within(footer).getByRole('button', { name: '초안 저장' });
    expect(save).toHaveClass('screen-primary--brand');
    fireEvent.click(save);
    const link = await editor.findByRole('link', { name: '저장한 룰 보기' });
    const saved = JSON.parse(sessionStorage.getItem('aml-preview-rule-drafts')).find(rule => rule.name === '검수용 신규 룰');
    expect(saved).toMatchObject({ status: 'DRAFT', scoreMin: .7, description: '점수 검토 규칙', author: previewAdmin.name });
    expect(link).toHaveAttribute('href', `/rules?rule=${saved.id}`);
    await act(async () => unmount());

    const count = JSON.parse(sessionStorage.getItem('aml-preview-rule-drafts')).length;
    await act(async () => { unmount = mountRuleControls(host, footer, { sourceRule: 'RULE-002' }); });
    expect(await within(host).findByText('조건을 복제했습니다. 저장하면 새 초안이 됩니다.', { exact: false })).toBeInTheDocument();
    expect(within(host).getByRole('textbox', { name: '룰 이름' })).toHaveValue('고위험 거래 모니터링 (복제)');
    expect(JSON.parse(sessionStorage.getItem('aml-preview-rule-drafts'))).toHaveLength(count);
  } finally {
    await act(async () => { unmount?.(); });
    if (before === null) sessionStorage.removeItem('aml-preview-rule-drafts');
    else sessionStorage.setItem('aml-preview-rule-drafts', before);
    host.remove();
  }
});
