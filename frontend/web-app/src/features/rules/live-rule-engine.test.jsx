import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/common';
import {
  commandRule, createRule, createRuleVersion, deleteRuleDraft, fetchRule, fetchRuleCatalog, fetchRules, saveRuleDraft, validateRule,
} from '@/api/rules';
import { LiveRuleBuilder } from './live-rule-builder';
import { LiveRuleList } from './live-rule-list';
import { activeRuleFixture, catalogFixture, checkFixture, draftRuleFixture, rulesFixture } from './rule-test-fixtures';

// 서비스 모드의 룰 만들기 · 룰 목록. 서버 응답은 실제 응답을 줄인 것(rule-test-fixtures)으로 대신한다.
vi.mock('@/api/rules', () => ({
  fetchRuleCatalog: vi.fn(), fetchRules: vi.fn(), fetchRule: vi.fn(), validateRule: vi.fn(), createRule: vi.fn(), saveRuleDraft: vi.fn(), deleteRuleDraft: vi.fn(),
  commandRule: vi.fn(), createRuleVersion: vi.fn(),
}));

const fanOutDefaults = catalogFixture.templates.find(template => template.key === 'FAN_OUT').defaults;
const fanOut = { schema: 2, template: 'FAN_OUT', ...fanOutDefaults };
const problem = (status, code, detail) => new ApiError({ type: 'about:blank', title: code, status, code, detail });

let footer;
beforeEach(() => {
  vi.mocked(fetchRuleCatalog).mockResolvedValue(catalogFixture);
  vi.mocked(fetchRules).mockResolvedValue(rulesFixture);
  vi.mocked(fetchRule).mockImplementation(ruleId => Promise.resolve(ruleId === 4 ? draftRuleFixture : activeRuleFixture));
  vi.mocked(validateRule).mockResolvedValue(checkFixture);
  vi.mocked(createRule).mockResolvedValue({ ruleId: 9, code: 'RULE-009', versionId: 31, revision: 0 });
  vi.mocked(saveRuleDraft).mockResolvedValue({ ...checkFixture, ruleId: 9, code: 'RULE-009', name: '분산 송금 감시', versionId: 31, versionNo: 1, status: 'DRAFT', revision: 1 });
  vi.mocked(deleteRuleDraft).mockResolvedValue(undefined);
  footer = document.createElement('footer');
  document.body.append(footer);
  window.history.replaceState(null, '', '/rules/new');
});
afterEach(() => {
  footer.remove();
  vi.clearAllMocks();
});

const builder = async props => {
  render(<LiveRuleBuilder actionsHost={footer} {...props} />);
  await screen.findByRole('group', { name: '조건 블록' }, { timeout: 3000 });
  // 조건을 고친 뒤 0.3초 모아서 검증한다
  await screen.findByText(checkFixture.sentence, undefined, { timeout: 3000 });
};
const saveButton = () => within(footer).getByRole('button', { name: '초안 저장' });
const lastChecked = () => vi.mocked(validateRule).mock.calls.at(-1)[0];
const part = name => within(screen.getByRole('region', { name }));

it('첫 템플릿의 기본값을 IF → THEN 블록에 채우고 서버가 읽어 준 문장과 체크리스트를 보여 준다', async () => {
  await builder();
  expect(screen.getByRole('heading', { name: '새 룰' })).toBeInTheDocument();
  expect(lastChecked()).toEqual({ template: 'FAN_OUT', definition: fanOut });

  const block = within(screen.getByRole('group', { name: '조건 블록' }));
  expect(block.getByText('IF')).toBeInTheDocument();
  expect(block.getByText('THEN')).toBeInTheDocument();
  expect(part('세는 거래').getByLabelText('건당 금액 값')).toHaveValue('1,000');
  expect(part('기간').getByLabelText('기간')).toHaveValue('10080');
  expect(part('적중 조건').getByLabelText('서로 다른 수취 계좌 수 값')).toHaveValue('6');
  // Alert 생성은 4단계 전까지 고를 수 없다
  expect(block.getByRole('option', { name: 'Alert 생성 (준비 중)' })).toBeDisabled();

  const checklist = within(screen.getByRole('region', { name: '검토 체크리스트' }));
  expect(checklist.getAllByRole('listitem').slice(0, 4).map(item => item.querySelector('strong').textContent)).toEqual(['형식', '조건', '데이터', '실행 비용']);
  expect(checklist.getByText(checkFixture.warnings[0])).toBeInTheDocument();
  // 이름이 없으면 저장하지 못한다
  expect(saveButton()).toBeDisabled();
});

it('이후 제공 템플릿은 고를 수 없고, 다른 템플릿을 눌렀다 돌아와도 고치던 값이 남는다', async () => {
  await builder();
  const library = within(screen.getByRole('region', { name: '템플릿 고르기' }));
  expect(within(library.getByRole('region', { name: '이후 제공' })).getByRole('button')).toBeDisabled();

  fireEvent.change(part('적중 조건').getByLabelText('서로 다른 수취 계좌 수 값'), { target: { value: '9' } });
  fireEvent.click(library.getByRole('button', { name: /RANDOM/ }));
  // 경로형은 길 찾는 값 세 줄이 잠긴 줄로 나온다
  expect(part('적중 조건').getByLabelText('경로 거래 수')).toHaveValue('3');
  expect(part('세는 거래').getByRole('group', { name: 'OR 그룹' })).toBeInTheDocument();
  await waitFor(() => expect(lastChecked().template).toBe('RANDOM'), { timeout: 3000 });

  fireEvent.click(library.getByRole('button', { name: /FAN-OUT/ }));
  expect(part('적중 조건').getByLabelText('서로 다른 수취 계좌 수 값')).toHaveValue('9');
});

it('값을 고치고 조건 줄 사이의 AND 를 눌러 OR 로 바꾸면 바뀐 정의로 다시 검증한다', async () => {
  await builder();
  const where = part('적중 조건');
  fireEvent.change(where.getByLabelText('서로 다른 수취 계좌 수 값'), { target: { value: '8' } });
  fireEvent.click(where.getByRole('button', { name: '조건 추가' }));
  fireEvent.click(where.getByRole('button', { name: /^AND\./ }));
  expect(where.getByRole('button', { name: /^OR\./ })).toBeInTheDocument();

  await waitFor(() => expect(lastChecked().definition.where).toEqual({
    op: 'ANY', items: [{ metric: 'DISTINCT_COUNTERPARTIES', cmp: 'GTE', value: 8 }, { metric: 'DISTINCT_COUNTERPARTIES', cmp: 'GTE' }],
  }), { timeout: 3000 });
  // 원래 기본값은 그대로다
  expect(fanOutDefaults.where.items).toEqual([{ metric: 'DISTINCT_COUNTERPARTIES', cmp: 'GTE', value: 6 }]);
});

it('처음 저장은 룰을 만들고 주소에 번호를 남기며, 다시 저장은 같은 초안을 revision 과 함께 고친다', async () => {
  await builder();
  fireEvent.change(screen.getByLabelText('룰 이름'), { target: { value: '  분산 송금 감시  ' } });
  await waitFor(() => expect(saveButton()).toBeEnabled());
  fireEvent.click(saveButton());

  expect(await screen.findByRole('heading', { name: 'RULE-009 · v1 작성 중' })).toBeInTheDocument();
  expect(createRule).toHaveBeenCalledWith({ name: '분산 송금 감시', template: 'FAN_OUT', definition: fanOut });
  expect(window.location.search).toBe('?rule=RULE-009');
  expect(screen.getByRole('link', { name: '저장한 룰 보기' })).toHaveAttribute('href', '/rules?rule=RULE-009');
  expect(screen.getByRole('link', { name: '백테스트로 열기' })).toHaveAttribute('href', '/rules/backtest?rule=RULE-009');
  // 고친 것이 없으면 다시 저장하지 않고, 저장한 룰의 템플릿은 바꾸지 못한다
  expect(saveButton()).toBeDisabled();
  expect(screen.getByRole('button', { name: /RANDOM/ })).toBeDisabled();

  fireEvent.change(part('기간').getByLabelText('기간'), { target: { value: '1440' } });
  await waitFor(() => expect(lastChecked()).toMatchObject({ ruleId: 9, definition: { windowMinutes: 1440 } }), { timeout: 3000 });
  await waitFor(() => expect(saveButton()).toBeEnabled());
  fireEvent.click(saveButton());
  await waitFor(() => expect(saveRuleDraft).toHaveBeenCalledWith(9, 31, { name: '분산 송금 감시', definition: { ...fanOut, windowMinutes: 1440 }, revision: 0 }));
  expect(createRule).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(saveButton()).toBeDisabled());
});

it('형식이 틀리면 저장을 막고, 서버가 저장을 거절하면 사유를 보여 준다', async () => {
  vi.mocked(validateRule).mockResolvedValue({ ...checkFixture, canSave: false, canRun: false, sentence: null, summary: null,
    items: checkFixture.items.map(item => (item.key === 'FORMAT' ? { ...item, ok: false, errors: ['적중 조건이 1개 이상 있어야 합니다.'] } : item)) });
  render(<LiveRuleBuilder actionsHost={footer} />);
  expect(await screen.findByText('적중 조건이 1개 이상 있어야 합니다.', undefined, { timeout: 3000 })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('룰 이름'), { target: { value: '분산 송금 감시' } });
  expect(screen.getByText('형식이 맞지 않아 문장으로 읽을 수 없습니다.')).toBeInTheDocument();
  expect(saveButton()).toBeDisabled();

  vi.mocked(validateRule).mockResolvedValue(checkFixture);
  vi.mocked(createRule).mockRejectedValue(problem(403, 'FORBIDDEN_ROLE', '룰을 만들 권한이 없습니다.'));
  fireEvent.change(part('기간').getByLabelText('기간'), { target: { value: '1440' } });
  await waitFor(() => expect(saveButton()).toBeEnabled(), { timeout: 3000 });
  fireEvent.click(saveButton());
  expect(await screen.findByRole('alert')).toHaveTextContent('룰을 만들 권한이 없습니다.');
  expect(screen.getByRole('heading', { name: '새 룰' })).toBeInTheDocument();
});

it('이어서 작성은 저장된 초안을 불러오고, 고칠 수 없는 룰이면 새 룰로 연다', async () => {
  const { unmount } = render(<LiveRuleBuilder actionsHost={footer} initialRuleId={4} />);
  expect(await screen.findByRole('heading', { name: 'RULE-004 · v1 작성 중' })).toBeInTheDocument();
  expect(screen.getByLabelText('룰 이름')).toHaveValue('분산 송금 감시');
  await waitFor(() => expect(lastChecked()).toEqual({ template: 'FAN_OUT', definition: draftRuleFixture.working.definition, ruleId: 4 }), { timeout: 3000 });
  unmount();

  render(<LiveRuleBuilder actionsHost={footer} initialRuleId={2} />);
  expect(await screen.findByRole('heading', { name: '새 룰' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('RULE-002 에는 내가 고칠 수 있는 작성 중 버전이 없습니다.');
});

it('목록은 상태별 수 · 템플릿 · 대상 · 조건을 보여 주고, 고른 룰의 문장과 변경 기록을 읽어 온다', async () => {
  render(<LiveRuleList initialRule="RULE-004" actionsHost={footer} />);
  // 상세는 목록이 온 뒤에 따로 읽는다. 문장은 상세에만 나온다(목록은 요약).
  expect(await screen.findByText(draftRuleFixture.working.sentence)).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '룰 상세' })).toHaveTextContent('작업 중 버전 · v1');
  expect(fetchRule).toHaveBeenCalledWith(4);

  expect(within(screen.getByLabelText('룰 상태별 수')).getByText('등록된 룰').nextElementSibling).toHaveTextContent('2');
  const row = within(screen.getByRole('button', { name: /RULE-004/ }).closest('tr'));
  expect(row.getByText('FAN-OUT · 분산 송금')).toBeInTheDocument();
  expect(row.getByText('계좌')).toBeInTheDocument();
  expect(row.getByText(draftRuleFixture.working.summary)).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '룰 변경 기록' })).getByText('룰 만듦 · v1')).toBeInTheDocument();

  // 작성 중인 초안: 이어서 작성, 초안 삭제, 백테스트로 열기가 열려 있다
  const actions = within(footer);
  expect(actions.getByRole('link', { name: '이어서 작성' })).toHaveAttribute('href', '/rules/new?rule=RULE-004');
  expect(actions.getByRole('button', { name: '초안 삭제' })).toBeEnabled();
  expect(actions.getByRole('link', { name: '백테스트로 열기' })).toHaveAttribute('href', '/rules/backtest?rule=RULE-004');
  // 상태 명령은 서버가 준 것만 나오고, 할 수 없는 것은 이유와 함께 꺼져 있다
  for (const name of ['시험 운영 시작', '승인 요청']) {
    expect(actions.getByRole('button', { name })).toBeDisabled();
    expect(actions.getByRole('button', { name })).toHaveAttribute('title', '지금 조건으로 끝낸 백테스트가 있어야 합니다.');
  }
  for (const name of ['승인', '반려', '중지', '재개', '새 버전 만들기']) expect(actions.queryByRole('button', { name })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: '룰 상세' })).toHaveTextContent('백테스트를 아직 돌리지 않았습니다.');
  expect(screen.queryByRole('region', { name: '룰 일일 실행' })).not.toBeInTheDocument();

  // 운영 중 룰에는 고칠 초안이 없다. 적중 수와 Alert 수, 일일 실행 기록을 보여 준다.
  fireEvent.click(screen.getByRole('button', { name: /RULE-002/ }));
  expect(await screen.findByText(activeRuleFixture.operating.sentence)).toBeInTheDocument();
  const detail = screen.getByRole('region', { name: '룰 상세' });
  expect(detail).toHaveTextContent('운영 버전 · v1');
  expect(within(detail).getByText('운영 적중').nextElementSibling).toHaveTextContent('3건 · 마지막 2023-09-15');
  expect(within(detail).getByText('연결 Alert').nextElementSibling).toHaveTextContent('2건 · 정상 판정 50%');
  const runs = within(screen.getByRole('region', { name: '룰 일일 실행' })).getAllByRole('row');
  expect(runs[1]).toHaveTextContent('2023-09-16v1운영실패 · 쿼리 120초 초과');
  expect(runs[2]).toHaveTextContent('2023-09-15v1운영완료1,20430');
  expect(actions.getByRole('button', { name: '이어서 작성' })).toBeDisabled();
  expect(actions.getByRole('button', { name: '초안 삭제' })).toBeDisabled();
  expect(actions.getByRole('button', { name: '중지' })).toHaveAttribute('title', '관리자만 할 수 있습니다.');
  expect(actions.getByRole('button', { name: '새 버전 만들기' })).toBeEnabled();
});

// jsdom 에는 <dialog> 의 showModal · close 가 없다
function withDialog(run) {
  const dialogApi = { showModal: HTMLDialogElement.prototype.showModal, close: HTMLDialogElement.prototype.close };
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  return run().finally(() => Object.assign(HTMLDialogElement.prototype, dialogApi));
}

it('상태 명령은 확인 창에서 사유를 받아 서버에 보내고, 바뀐 상세와 목록을 다시 보여 준다', () => withDialog(async () => {
  // 관리자가 본 승인 대기 룰: 승인 · 반려를 할 수 있고 둘 다 사유가 있어야 한다
  const pending = { ...draftRuleFixture, status: 'PENDING',
    working: { ...draftRuleFixture.working, status: 'PENDING', revision: 2, editable: false, deletable: false,
      backtest: { backtestId: 31, status: 'COMPLETED', currentDefinition: true, finishedAt: '2023-09-17T00:00:00Z' } },
    commands: [
      { action: 'WITHDRAW', versionId: 5, revision: 2, enabled: false, reason: '작성자만 할 수 있습니다.', commentRequired: false },
      { action: 'APPROVE', versionId: 5, revision: 2, enabled: true, reason: null, commentRequired: true },
      { action: 'REJECT', versionId: 5, revision: 2, enabled: true, reason: null, commentRequired: true },
    ] };
  const approved = { ...pending, status: 'ACTIVE', working: null, operating: { ...pending.working, status: 'ACTIVE', revision: 3 },
    commands: [{ action: 'PAUSE', versionId: 5, revision: 3, enabled: true, reason: null, commentRequired: true }],
    events: [{ at: '2023-09-17T00:00:00Z', actor: '관리자', action: 'APPROVED', comment: '백테스트 확인', versionNo: 1, selfApproved: true }] };
  vi.mocked(fetchRule).mockResolvedValue(pending);
  render(<LiveRuleList initialRule="RULE-004" actionsHost={footer} />);
  const actions = within(footer);
  await waitFor(() => expect(actions.getByRole('button', { name: '승인' })).toBeEnabled());
  expect(screen.getByRole('region', { name: '룰 상세' })).toHaveTextContent('지금 조건으로 백테스트를 끝냈습니다.');
  expect(actions.getByRole('button', { name: '되돌리기' })).toBeDisabled();
  // 버튼은 왼쪽부터 위험한 것, 가운데 보조, 오른쪽 끝에 주된 명령
  const order = ['반려', '되돌리기', '승인'].map(name => actions.getByRole('button', { name }));
  expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  fireEvent.click(actions.getByRole('button', { name: '승인' }));
  const dialog = within(screen.getByRole('dialog', { name: '룰 승인' }));
  expect(dialog.getByText('변경 후 상태 · 운영 중')).toBeInTheDocument();
  // 사유가 없으면 확인할 수 없다
  expect(dialog.getByRole('button', { name: '승인 확인' })).toBeDisabled();
  fireEvent.change(dialog.getByLabelText('사유'), { target: { value: '  백테스트 확인  ' } });

  vi.mocked(commandRule).mockRejectedValueOnce(problem(409, 'INVALID_TRANSITION', '다른 곳에서 먼저 바꿨습니다. 다시 조회하세요.'));
  fireEvent.submit(dialog.getByRole('button', { name: '승인 확인' }).closest('form'));
  expect(await dialog.findByRole('alert')).toHaveTextContent('다른 곳에서 먼저 바꿨습니다. 다시 조회하세요.');

  vi.mocked(commandRule).mockResolvedValue(approved);
  vi.mocked(fetchRule).mockResolvedValue(approved);
  vi.mocked(fetchRules).mockResolvedValue({ content: rulesFixture.content.map(rule => (rule.code === 'RULE-004' ? { ...rule, status: 'ACTIVE' } : rule)), counts: { ACTIVE: 2 } });
  await act(async () => { fireEvent.submit(dialog.getByRole('button', { name: '승인 확인' }).closest('form')); });
  // 다시 눌러도 같은 요청 번호라 서버는 한 번만 적용한다
  const [first, second] = vi.mocked(commandRule).mock.calls;
  expect(second).toEqual([4, { requestId: expect.any(String), action: 'APPROVE', versionId: 5, revision: 2, comment: '백테스트 확인' }]);
  expect(second[1].requestId).toBe(first[1].requestId);

  expect(screen.queryByRole('dialog', { name: '룰 승인' })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('RULE-004 · 승인 · 운영 중');
  await waitFor(() => expect(actions.getByRole('button', { name: '중지' })).toBeEnabled());
  expect(actions.queryByRole('button', { name: '승인' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '룰 변경 기록' })).getByText('승인 · v1 · 본인 승인')).toBeInTheDocument();
  expect(within(screen.getByLabelText('룰 상태별 수')).getByText('운영 중').closest('div')).toHaveTextContent('2');
}));

it('새 버전 만들기는 운영 버전을 복사한 초안을 만들고 상세를 다시 읽는다', () => withDialog(async () => {
  render(<LiveRuleList initialRule="RULE-002" actionsHost={footer} />);
  const actions = within(footer);
  await waitFor(() => expect(actions.getByRole('button', { name: '새 버전 만들기' })).toBeEnabled());
  fireEvent.click(actions.getByRole('button', { name: '새 버전 만들기' }));
  const dialog = within(screen.getByRole('dialog', { name: '룰 새 버전 만들기' }));
  // 사유를 받지 않는다
  expect(dialog.queryByRole('textbox')).not.toBeInTheDocument();

  const drafted = { ...activeRuleFixture, working: { ...activeRuleFixture.operating, versionId: 9, versionNo: 2, status: 'DRAFT', editable: true, deletable: true, backtest: null },
    commands: [{ action: 'NEW_VERSION', versionId: 2, revision: 0, enabled: false, reason: '작업 중인 버전이 이미 있습니다.', commentRequired: false }] };
  vi.mocked(createRuleVersion).mockResolvedValue({ ruleId: 2, code: 'RULE-002', versionId: 9, versionNo: 2, revision: 0 });
  vi.mocked(fetchRule).mockResolvedValue(drafted);
  await act(async () => { fireEvent.submit(dialog.getByRole('button', { name: '새 버전 만들기 확인' }).closest('form')); });
  expect(createRuleVersion).toHaveBeenCalledWith(2);
  expect(commandRule).not.toHaveBeenCalled();
  await waitFor(() => expect(actions.getByRole('link', { name: '이어서 작성' })).toHaveAttribute('href', '/rules/new?rule=RULE-002'));
  expect(actions.getByRole('button', { name: '새 버전 만들기' })).toHaveAttribute('title', '작업 중인 버전이 이미 있습니다.');
  expect(screen.getByRole('region', { name: '룰 상세' })).toHaveTextContent('새 버전 · v2');
}));

it('초안 삭제는 확인을 거쳐 지우고 목록을 다시 읽는다', async () => {
  const dialogApi = { showModal: HTMLDialogElement.prototype.showModal, close: HTMLDialogElement.prototype.close };
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  try {
    render(<LiveRuleList initialRule="RULE-004" actionsHost={footer} />);
    await waitFor(() => expect(within(footer).getByRole('button', { name: '초안 삭제' })).toBeEnabled());
    fireEvent.click(within(footer).getByRole('button', { name: '초안 삭제' }));
    const dialog = within(screen.getByRole('dialog', { name: '초안 삭제' }));
    expect(dialog.getByText('이 룰에는 다른 버전이 없어 룰과 변경 기록도 함께 삭제합니다.')).toBeInTheDocument();

    vi.mocked(deleteRuleDraft).mockRejectedValueOnce(problem(409, 'INVALID_TRANSITION', '시험 운영을 한 버전은 삭제할 수 없습니다.'));
    fireEvent.submit(dialog.getByRole('button', { name: '삭제' }).closest('form'));
    expect(await dialog.findByRole('alert')).toHaveTextContent('시험 운영을 한 버전은 삭제할 수 없습니다.');

    vi.mocked(fetchRules).mockResolvedValue({ content: rulesFixture.content.filter(rule => rule.code !== 'RULE-004'), counts: { ACTIVE: 1 } });
    await act(async () => { fireEvent.submit(dialog.getByRole('button', { name: '삭제' }).closest('form')); });
    expect(deleteRuleDraft).toHaveBeenLastCalledWith(4, draftRuleFixture.working.versionId);
    await waitFor(() => expect(screen.queryByRole('button', { name: /RULE-004/ })).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: '초안 삭제' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('RULE-004 v1 초안 삭제됨');
  } finally {
    Object.assign(HTMLDialogElement.prototype, dialogApi);
  }
});

it('목록을 못 읽으면 사유와 다시 시도를 보여 준다', async () => {
  vi.mocked(fetchRules).mockRejectedValueOnce(problem(500, 'INTERNAL', '룰 목록을 읽는 중 오류가 났습니다.'));
  render(<LiveRuleList actionsHost={footer} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('룰 목록을 읽는 중 오류가 났습니다.');
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByRole('button', { name: /RULE-002/ })).toBeInTheDocument();
});
