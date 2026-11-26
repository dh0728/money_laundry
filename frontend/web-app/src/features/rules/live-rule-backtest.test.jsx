import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/common';
import { cancelBacktest, fetchBacktest, fetchBacktestPeriod, fetchBacktests, fetchRule, fetchRuleCatalog, fetchRules, requestBacktest } from '@/api/rules';
import { LiveRuleBacktest } from './live-rule-backtest';
import { activeRuleFixture, catalogFixture, draftRuleFixture, rulesFixture } from './rule-test-fixtures';

// 서비스 모드의 백테스트 화면. 서버 응답은 API.md §12 의 모양으로 만든 것이다.
vi.mock('@/api/rules', () => ({
  fetchRuleCatalog: vi.fn(), fetchRules: vi.fn(), fetchRule: vi.fn(),
  requestBacktest: vi.fn(), fetchBacktest: vi.fn(), fetchBacktests: vi.fn(), cancelBacktest: vi.fn(), fetchBacktestPeriod: vi.fn(),
}));

// RULE-004: 운영 v1(수취 계좌 6개 이상)과 내가 쓴 새 버전 v2(5개 이상)가 같이 있는 룰
const working = { ...draftRuleFixture.working, versionId: 6, versionNo: 2, sentence: '수취 계좌 수가 5개 이상이면 근거로 표시합니다.' };
const operating = { ...draftRuleFixture.working, versionId: 5, versionNo: 1, status: 'ACTIVE', editable: false, sentence: '수취 계좌 수가 6개 이상이면 근거로 표시합니다.' };
const comparedRule = { ...draftRuleFixture, status: 'ACTIVE', operating, working };

const head = (status, extra = {}) => ({
  backtestId: 31, status, progress: 0, cancelRequested: false, errorCode: null, ruleId: 4, code: 'RULE-004', name: '분산 송금 감시', template: 'FAN_OUT',
  versionId: 6, versionNo: 2, summary: '수취 계좌 5개 이상 · 7일', currentDefinition: true,
  baseline: { versionId: 5, versionNo: 1, summary: '수취 계좌 6개 이상 · 7일' }, period: { from: '2023-09-08', to: '2023-09-16', days: 9 },
  requestedBy: 'L1 심사자 A', requestedAt: '2023-09-17T00:00:00Z', startedAt: null, finishedAt: null, ...extra,
});
const result = {
  kpis: { hits: 3, added: 1, dropped: 1, precision: 50, judged: 2, baseHits: 3, basePrecision: 100, baseJudged: 1 },
  txCount: 12000, evidenceTxCount: 18, evidenceShare: 0.15, hitDays: 4, alertOverlap: 2, expectedNewAlerts: 1, chunkedCount: 0, skippedBusySubjects: 2,
  busy: { maxTransactions: 512, windowMinutes: 4320 },
  sweep: { metric: 'DISTINCT_COUNTERPARTIES', label: '서로 다른 수취 계좌 수', unit: '개', rows: [
    { value: 4, current: false, hits: 5, txCount: 26, alertOverlap: 2, expectedNewAlerts: 3 },
    { value: 5, current: true, hits: 3, txCount: 18, alertOverlap: 2, expectedNewAlerts: 1 },
    { value: 6, current: false, hits: 2, txCount: 13, alertOverlap: 2, expectedNewAlerts: 0 }] },
  cases: [
    { subjectType: 'ACCOUNT', subject: 'c41f3f2a', state: 'ADDED', measured: { SUM_USD: 10000, TX_COUNT: 5, DISTINCT_COUNTERPARTIES: 5 }, txCount: 5, alertId: null, judgement: null },
    { subjectType: 'ACCOUNT', subject: '9be07d11', state: 'DROPPED', measured: { DISTINCT_COUNTERPARTIES: 6, TX_COUNT: 6, SUM_USD: 12000 }, txCount: 6, alertId: 3003, judgement: 'NORMAL' },
    { subjectType: 'ACCOUNT', subject: '57e936c0', state: 'KEPT', measured: { DISTINCT_COUNTERPARTIES: 7, TX_COUNT: 7, SUM_USD: 14000 }, txCount: 7, alertId: 3001, judgement: 'SUSPICIOUS' }],
};
const completed = { ...head('COMPLETED', { progress: 100, finishedAt: '2023-09-17T00:00:05Z' }), ...result };
const problem = (status, code, detail) => new ApiError({ type: 'about:blank', title: code, status, code, detail });
// 원장 09-01 ~ 09-16. 첫 7일은 이력으로만 쓰므로 09-08 부터 검사할 수 있다
const periodFixture = { ledgerFrom: '2023-09-01', ledgerTo: '2023-09-16', earliest: '2023-09-08', from: '2023-09-08', to: '2023-09-16', days: 9, warmupDays: 7, maxDays: 90 };

let footer;
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView ??= vi.fn();
  vi.mocked(fetchRuleCatalog).mockResolvedValue(catalogFixture);
  vi.mocked(fetchRules).mockResolvedValue(rulesFixture);
  vi.mocked(fetchRule).mockImplementation(ruleId => Promise.resolve(ruleId === 4 ? comparedRule : activeRuleFixture));
  vi.mocked(fetchBacktests).mockResolvedValue([]);
  vi.mocked(fetchBacktestPeriod).mockResolvedValue(periodFixture);
  footer = document.createElement('footer');
  document.body.append(footer);
});
afterEach(() => {
  footer.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const runButton = name => within(footer).getByRole('button', { name });
const card = name => within(screen.getByRole('region', { name }));
/** 검사 기간 카드의 검사 일수를 고른다. 공용 선택창은 열어서 항목을 눌러야 한다. */
const chooseSpan = async option => {
  fireEvent.keyDown(card('검사 기간').getByRole('combobox', { name: '검사 일수' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
};

it('고른 룰의 새 버전과 비교할 운영 버전을 보여 주고, 실행하면 끝날 때까지 2초마다 상태를 읽는다', async () => {
  render(<LiveRuleBacktest initialRule="RULE-004" actionsHost={footer} />);
  await screen.findByRole('region', { name: '백테스트 대상 룰' });
  expect(await card('백테스트 대상 룰').findByText(working.sentence)).toBeInTheDocument();
  expect(card('백테스트 대상 룰').getByRole('combobox', { name: '룰' })).toHaveTextContent('RULE-004');
  expect(card('비교 기준').getByText('운영 버전 · v1')).toBeInTheDocument();
  expect(card('실행 상태').getByText(/아직 돌린 백테스트가 없습니다/)).toBeInTheDocument();
  expect(card('실행 기록').getByRole('table', { name: '실행 기록' })).toHaveTextContent('아직 돌린 백테스트가 없습니다.');
  expect(within(footer).getByRole('link', { name: '조건 고치기' })).toHaveAttribute('href', '/rules/new?rule=RULE-004');

  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.mocked(requestBacktest).mockResolvedValue({ backtestId: 31, status: 'QUEUED' });
  vi.mocked(fetchBacktest).mockResolvedValueOnce(head('QUEUED')).mockResolvedValueOnce(head('RUNNING', { progress: 40 })).mockResolvedValue(completed);
  fireEvent.click(runButton('백테스트 실행'));
  expect(await card('실행 상태').findByText('대기 중')).toBeInTheDocument();
  // 새 버전(versionId 6)을 보낸다. 비교 기준은 서버가 운영 버전으로 고른다.
  expect(requestBacktest).toHaveBeenCalledWith({ versionId: 6 });
  expect(runButton('백테스트 실행')).toBeDisabled();
  expect(card('백테스트 대상 룰').getByLabelText('룰')).toBeDisabled();

  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(card('실행 상태').getByText('실행 중')).toBeInTheDocument();
  expect(card('실행 상태').getByLabelText('진행률')).toHaveValue(40);
  vi.mocked(fetchBacktests).mockResolvedValue([completed]);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(card('실행 상태').getByText('완료')).toBeInTheDocument();

  const kpis = within(screen.getByLabelText('백테스트 결과'));
  expect(kpis.getByText('적중 대상').nextElementSibling).toHaveTextContent('3 개');
  expect(kpis.getByText('운영 v1 은 3개')).toBeInTheDocument();
  expect(kpis.getByText('새로 걸림').nextElementSibling).toHaveTextContent('1 개');
  expect(kpis.getByText('빠짐').nextElementSibling).toHaveTextContent('1 개');
  expect(kpis.getByText('사람 판정 기준 정확도').nextElementSibling).toHaveTextContent('50%');
  expect(kpis.getByText('판정 2건 기준 · 운영 v1 은 100%')).toBeInTheDocument();
  // 끝난 뒤에는 더 읽지 않는다
  const reads = vi.mocked(fetchBacktest).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(fetchBacktest).toHaveBeenCalledTimes(reads);
  expect(runButton('다시 실행')).toBeEnabled();
});

it('끝난 백테스트의 값 변화 표, 검사 범위, 사례, 알아 둘 것을 보여 준다', async () => {
  const earlier = head('CANCELLED', { backtestId: 30, versionNo: 1, baseline: null, currentDefinition: false });
  vi.mocked(fetchBacktests).mockResolvedValue([completed, earlier]);
  vi.mocked(fetchBacktest).mockResolvedValue({ ...completed, currentDefinition: false, evidenceShare: 12.5, chunkedCount: 1 });
  render(<LiveRuleBacktest initialRule="RULE-004" actionsHost={footer} />);

  const sweep = within(await screen.findByRole('region', { name: '값을 바꾸면' }));
  const sweepTable = sweep.getByRole('table', { name: '값을 바꾸면' });
  expect(sweepTable.closest('.data-table-frame')).toContainElement(sweep.getByRole('heading', { name: '값을 바꾸면' }));
  expect(sweepTable.closest('.screen-panel')).toBeNull();
  const current = sweep.getByRole('row', { name: /이번 값/ });
  expect(current).toHaveTextContent('5개');
  expect(within(current).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['3', '18', '2', '1']);
  expect(sweep.getAllByRole('row')).toHaveLength(4);

  const scope = within(screen.getByRole('region', { name: '검사 범위' }));
  expect(scope.getByText('2023-09-08 ~ 2023-09-16 (9일)')).toBeInTheDocument();
  expect(scope.getByText('12,000건')).toBeInTheDocument();
  expect(scope.getByText(/대상 1개/)).toHaveTextContent('추정');

  // 측정값은 템플릿이 정한 순서(수취 계좌 → 거래 → 총액)와 카탈로그의 문구 · 단위로 읽는다
  const cases = within(screen.getByRole('region', { name: '사례' }));
  const casesTable = cases.getByRole('table', { name: '사례' });
  expect(casesTable.closest('.screen-panel')).toBeNull();
  const added = within(cases.getByText('c41f3f2a').closest('tr'));
  expect(added.getByText('새로 걸림')).toBeInTheDocument();
  expect(added.getByText('수취 계좌 5개 · 거래 5건 · 보낸 총액 10,000 USD')).toBeInTheDocument();
  const dropped = within(cases.getByText('9be07d11').closest('tr'));
  expect(dropped.getByText('빠짐')).toBeInTheDocument();
  expect(dropped.getByText('3003')).toBeInTheDocument();
  expect(dropped.getByText('정상')).toBeInTheDocument();
  expect(within(cases.getByText('57e936c0').closest('tr')).getByText('의심')).toBeInTheDocument();

  const notices = within(screen.getByRole('list', { name: '알아 둘 것' }));
  expect(notices.getByText(/조건을 고치기 전의 것입니다/)).toBeInTheDocument();
  expect(notices.getByText(/검사한 거래의 12.5% 입니다/)).toBeInTheDocument();
  expect(notices.getByText(/바쁜 계좌 2개는 평가하지 않았습니다/)).toHaveTextContent('72시간 안 같은 방향 거래 512건 초과');
  expect(notices.getByText(/바쁜 계좌 2개는 평가하지 않았습니다/)).not.toHaveTextContent('경로 자리');
  expect(notices.getByText(/32건을 넘는 대상이 1개/)).toBeInTheDocument();
  const history = card('실행 기록');
  const historyTable = history.getByRole('table', { name: '실행 기록' });
  expect(historyTable.closest('.data-table-frame')).toContainElement(history.getByRole('heading', { name: '실행 기록' }));
  expect(historyTable.closest('.screen-panel')).toBeNull();
  expect(history.getAllByRole('columnheader').map(cell => cell.textContent))
    .toEqual(['버전', '상태', '비교 기준', '검사 기간', '검사한 거래', '요청자', '요청 시각']);
  expect(history.getByRole('button', { name: '다운로드' })).toBeInTheDocument();
  const currentRun = history.getByRole('button', { name: /v2 · 완료 · 운영 v1 과 비교/ });
  expect(currentRun).toHaveAttribute('aria-pressed', 'true');
  const currentRunRow = within(currentRun.closest('tr'));
  expect(currentRunRow.getByText('12,000건')).toHaveAttribute('data-numeric', 'true');
  expect(currentRunRow.getByText('2023-09-08 ~ 2023-09-16 (9일)')).toBeInTheDocument();
  expect(currentRunRow.getByText('L1 심사자 A')).toBeInTheDocument();
  fireEvent.click(history.getByRole('button', { name: '버전 · 오름차순 정렬' }));
  const earlierRunRow = history.getAllByRole('row')[1];
  expect(earlierRunRow).toHaveTextContent('조건을 고치기 전');
  vi.mocked(fetchBacktest).mockResolvedValue(earlier);
  fireEvent.click(within(earlierRunRow).getByText('취소됨'));
  expect(await card('실행 상태').findByText('취소됨')).toBeInTheDocument();
  expect(within(earlierRunRow).getByRole('button', { name: /v1 · 취소됨/ })).toHaveAttribute('aria-pressed', 'true');
});

it('타겟 날과 검사 일수를 고르면 실행 전에 읽을 범위를 보여 주고 그 기간으로 접수한다', async () => {
  render(<LiveRuleBacktest initialRule="RULE-004" actionsHost={footer} />);
  await screen.findByRole('region', { name: '백테스트 대상 룰' });
  await card('백테스트 대상 룰').findByText(working.sentence);
  const period = card('검사 기간');
  // 처음에는 타겟 날이 원장 마지막 날, 검사 일수가 전체다. 룰의 기간이 7일이라 검사 첫날(09-08)에서 7일 앞부터 돌아본다
  expect(await period.findByLabelText('타겟 날')).toHaveValue('2023-09-16');
  expect(period.getByLabelText('타겟 날')).toHaveAttribute('min', '2023-09-08');
  expect(period.getByLabelText('타겟 날')).toHaveAttribute('max', '2023-09-16');
  expect(period.getByRole('combobox', { name: '검사 일수' })).toHaveTextContent('전체');
  expect(period.getByText('검사하는 날짜').nextElementSibling).toHaveTextContent('2023-09-08 ~ 2023-09-16 (9일)');
  expect(period.getByText('돌아보는 거래').nextElementSibling).toHaveTextContent('2023-09-01부터 (룰의 기간 7일)');
  expect(period.getByText('처음 거래하는 상대 · 바쁜 계좌').nextElementSibling).toHaveTextContent('2023-09-01 ~ 2023-09-16 기준');
  expect(period.getByText(/타겟 날 뒤의 거래는 읽지 않습니다/)).toHaveTextContent('원장은 2023-09-01 ~ 2023-09-16 이고 첫 7일은 이력으로만 씁니다.');

  // 09-12 하루만: 그날만 검사하고 09-05 부터 돌아본다. 처음 거래하는 상대와 바쁜 계좌는 09-12 까지의 거래로 본다
  fireEvent.change(period.getByLabelText('타겟 날'), { target: { value: '2023-09-12' } });
  await chooseSpan('1일');
  expect(period.getByText('검사하는 날짜').nextElementSibling).toHaveTextContent('2023-09-12 (1일)');
  expect(period.getByText('돌아보는 거래').nextElementSibling).toHaveTextContent('2023-09-05부터 (룰의 기간 7일)');
  expect(period.getByText('처음 거래하는 상대 · 바쁜 계좌').nextElementSibling).toHaveTextContent('2023-09-01 ~ 2023-09-12 기준');

  // 3일: 타겟 날을 포함해 앞으로 3일
  await chooseSpan('3일');
  expect(period.getByText('검사하는 날짜').nextElementSibling).toHaveTextContent('2023-09-10 ~ 2023-09-12 (3일)');
  expect(period.queryByText(/채우지 못합니다/)).not.toBeInTheDocument();

  // 7일을 골라도 원장 첫 7일(09-07 까지)은 검사하지 않는다
  await chooseSpan('7일');
  expect(period.getByText('검사하는 날짜').nextElementSibling).toHaveTextContent('2023-09-08 ~ 2023-09-12 (5일)');
  expect(period.getByText('원장 첫 7일은 검사하지 않아 7일을 채우지 못합니다.')).toBeInTheDocument();

  vi.mocked(requestBacktest).mockResolvedValue({ backtestId: 31, status: 'QUEUED' });
  vi.mocked(fetchBacktest).mockResolvedValue(head('QUEUED', { period: { from: '2023-09-08', to: '2023-09-12', days: 5 } }));
  fireEvent.click(runButton('백테스트 실행'));
  expect(await card('실행 상태').findByText('대기 중')).toBeInTheDocument();
  expect(requestBacktest).toHaveBeenCalledWith({ versionId: 6, from: '2023-09-08', to: '2023-09-12' });
  // 도는 중에는 기간을 바꿀 수 없다
  expect(period.getByLabelText('타겟 날')).toBeDisabled();
  expect(period.getByRole('combobox', { name: '검사 일수' })).toBeDisabled();
});

it('타겟 날이 검사할 수 있는 날짜 밖이면 실행을 막고, 범위를 못 읽으면 서버의 기본 기간으로 돌린다', async () => {
  const view = render(<LiveRuleBacktest initialRule="RULE-004" actionsHost={footer} />);
  await screen.findByRole('region', { name: '백테스트 대상 룰' });
  await card('백테스트 대상 룰').findByText(working.sentence);
  const period = card('검사 기간');
  fireEvent.change(await period.findByLabelText('타겟 날'), { target: { value: '2023-09-05' } });
  expect(period.getByRole('alert')).toHaveTextContent('타겟 날은 2023-09-08 ~ 2023-09-16 안에서 골라야 합니다.');
  expect(period.getByLabelText('타겟 날')).toBeInvalid();
  expect(period.queryByText('검사하는 날짜')).not.toBeInTheDocument();
  expect(runButton('백테스트 실행')).toBeDisabled();
  fireEvent.change(period.getByLabelText('타겟 날'), { target: { value: '' } });
  expect(period.getByRole('alert')).toHaveTextContent('타겟 날을 골라 주세요.');
  fireEvent.change(period.getByLabelText('타겟 날'), { target: { value: '2023-09-16' } });
  expect(period.queryByRole('alert')).not.toBeInTheDocument();
  expect(runButton('백테스트 실행')).toBeEnabled();
  view.unmount();

  // 원장이 비어 범위를 못 읽은 화면: 기간을 고르는 칸이 없고, 실행하면 기간 없이 보낸다
  vi.mocked(fetchBacktestPeriod).mockRejectedValue(problem(400, 'VALIDATION_FAILED', '원장에 거래가 없어 백테스트를 돌릴 수 없습니다.'));
  render(<LiveRuleBacktest initialRule="RULE-004" actionsHost={footer} />);
  await screen.findByRole('region', { name: '백테스트 대상 룰' });
  await card('백테스트 대상 룰').findByText(working.sentence);
  expect(await card('검사 기간').findByText('원장에 거래가 없어 백테스트를 돌릴 수 없습니다.')).toBeInTheDocument();
  expect(card('검사 기간').queryByLabelText('타겟 날')).not.toBeInTheDocument();
  vi.mocked(requestBacktest).mockResolvedValue({ backtestId: 31, status: 'QUEUED' });
  vi.mocked(fetchBacktest).mockResolvedValue(head('QUEUED'));
  fireEvent.click(runButton('백테스트 실행'));
  await waitFor(() => expect(requestBacktest).toHaveBeenCalledWith({ versionId: 6 }));
});

it('끝난 백테스트의 검사 범위에 돌아본 거래와 바쁜 계좌를 센 마지막 날을 보여 준다', async () => {
  // 타겟 날 09-12, 3일로 돌린 백테스트. 서버가 실제로 읽은 범위를 lookback · busy.until 로 준다
  const chosen = { ...completed, period: { from: '2023-09-10', to: '2023-09-12', days: 3 },
    busy: { ...result.busy, until: '2023-09-12' }, lookback: { from: '2023-09-03', windowMinutes: 10080, ledgerFrom: '2023-09-01' } };
  vi.mocked(fetchBacktests).mockResolvedValue([chosen]);
  vi.mocked(fetchBacktest).mockResolvedValue(chosen);
  const view = render(<LiveRuleBacktest initialRule="RULE-004" actionsHost={footer} />);
  const scope = within(await screen.findByRole('region', { name: '검사 범위' }));
  expect(scope.getByText('검사한 날짜').nextElementSibling).toHaveTextContent('2023-09-10 ~ 2023-09-12 (3일)');
  expect(scope.getByText('돌아본 거래').nextElementSibling).toHaveTextContent('2023-09-03부터 (룰의 기간 7일)');
  expect(scope.getByText('처음 거래하는 상대 · 바쁜 계좌').nextElementSibling).toHaveTextContent('2023-09-01 ~ 2023-09-12 기준');
  // 실행 기록 표의 검사 기간 칸에도 일수가 붙는다
  expect(within(screen.getByRole('table', { name: '실행 기록' })).getByText('2023-09-10 ~ 2023-09-12 (3일)')).toBeInTheDocument();
  view.unmount();

  // 기간이 없는 템플릿(단건 고액거래)은 돌아보지 않는다
  const noWindow = { ...chosen, lookback: { from: null, windowMinutes: null, ledgerFrom: '2023-09-01' } };
  vi.mocked(fetchBacktests).mockResolvedValue([noWindow]);
  vi.mocked(fetchBacktest).mockResolvedValue(noWindow);
  const second = render(<LiveRuleBacktest initialRule="RULE-004" actionsHost={footer} />);
  expect(within(await screen.findByRole('region', { name: '검사 범위' })).getByText('돌아본 거래').nextElementSibling)
    .toHaveTextContent('없음 (기간 없이 거래 1건씩 봅니다)');
  second.unmount();

  // 이 값을 넣기 전에 돌린 백테스트에는 없다. 그때는 줄을 그리지 않는다
  vi.mocked(fetchBacktests).mockResolvedValue([completed]);
  vi.mocked(fetchBacktest).mockResolvedValue(completed);
  render(<LiveRuleBacktest initialRule="RULE-004" actionsHost={footer} />);
  const old = within(await screen.findByRole('region', { name: '검사 범위' }));
  expect(old.queryByText('돌아본 거래')).not.toBeInTheDocument();
  expect(old.queryByText('처음 거래하는 상대 · 바쁜 계좌')).not.toBeInTheDocument();
});

it('경로형 룰은 경로의 거래 수를 바꿔 본 결과와 측정값(가장 긴 경로의 거래 수)을 보여 준다', async () => {
  // RULE-004 가 RANDOM · 연쇄 경유 룰일 때
  vi.mocked(fetchRule).mockImplementation(ruleId => Promise.resolve(ruleId === 4
    ? { ...draftRuleFixture, template: 'RANDOM', templateName: 'RANDOM · 연쇄 경유' } : activeRuleFixture));
  const pathRun = { ...completed, template: 'RANDOM', baseline: null,
    kpis: { ...result.kpis, added: null, dropped: null, baseHits: null, basePrecision: null, baseJudged: null },
    sweep: { metric: 'minHops', label: '경로 거래 수', unit: '건', rows: [
      { value: 2, current: false, hits: 9, txCount: 30, alertOverlap: 2, expectedNewAlerts: 6 },
      { value: 3, current: true, hits: 2, txCount: 7, alertOverlap: 1, expectedNewAlerts: 1 }] },
    cases: [{ subjectType: 'ACCOUNT', subject: 'c41f3f2a', state: 'HIT', measured: { HOPS: 4 }, txCount: 4, alertId: null, judgement: null }] };
  vi.mocked(fetchBacktests).mockResolvedValue([pathRun]);
  vi.mocked(fetchBacktest).mockResolvedValue(pathRun);
  render(<LiveRuleBacktest initialRule="RULE-004" actionsHost={footer} />);

  const sweep = within(await screen.findByRole('region', { name: '값을 바꾸면' }));
  expect(sweep.getByText('경로 거래 수만 바꿔 같은 기간에 다시 돌린 결과입니다.')).toBeInTheDocument();
  expect(sweep.getByRole('row', { name: /이번 값/ })).toHaveTextContent('3건');
  // 측정값 HOPS 는 조건 값(minHops)의 문구로 읽는다
  const cases = within(screen.getByRole('region', { name: '사례' }));
  expect(within(cases.getByText('c41f3f2a').closest('tr')).getByText('경로 거래 수 4건')).toBeInTheDocument();
  // 경로형 · 2홉형은 바쁜 계좌를 대상뿐 아니라 경로 자리에서도 뺀다
  expect(within(screen.getByRole('list', { name: '알아 둘 것' })).getByText(/바쁜 계좌 2개는 평가하지 않았습니다/))
    .toHaveTextContent('경유 · 경로 자리에 바쁜 계좌가 있는 거래도 잇지 않습니다.');
  // 이제 경로형도 다시 돌릴 수 있다
  expect(screen.queryByText(/백테스트는 아직 제공하지 않습니다/)).not.toBeInTheDocument();
  expect(runButton('다시 실행')).toBeEnabled();
});

it('대상이 거래인 룰(단건 고액거래)은 사례를 거래 코드로 보여 주고 예상 새 Alert 를 빼고 보여 준다', async () => {
  vi.mocked(fetchRule).mockImplementation(ruleId => Promise.resolve(ruleId === 4
    ? { ...draftRuleFixture, template: 'LARGE_TX', templateName: '단건 고액거래' } : activeRuleFixture));
  const largeRun = { ...completed, template: 'LARGE_TX', baseline: null, skippedBusySubjects: 0, expectedNewAlerts: 0,
    kpis: { ...result.kpis, hits: 2, added: null, dropped: null, baseHits: null, basePrecision: null, baseJudged: null },
    sweep: { metric: 'TX_USD', label: '건당 금액', unit: 'USD', rows: [
      { value: 9000, current: false, hits: 3, txCount: 3, alertOverlap: 1, expectedNewAlerts: 0 },
      { value: 10000, current: true, hits: 2, txCount: 2, alertOverlap: 1, expectedNewAlerts: 0 }] },
    cases: [
      { subjectType: 'TX', subject: '101', txId: 101, occurredAt: '2023-09-09T02:00:00Z', state: 'HIT', measured: { TX_USD: 11500 }, txCount: 1, alertId: 3001, judgement: null },
      { subjectType: 'TX', subject: '205', txId: 205, occurredAt: '2023-09-09T16:30:00Z', state: 'HIT', measured: { TX_USD: 30000 }, txCount: 1, alertId: null, judgement: null }] };
  vi.mocked(fetchBacktests).mockResolvedValue([largeRun]);
  vi.mocked(fetchBacktest).mockResolvedValue(largeRun);
  render(<LiveRuleBacktest initialRule="RULE-004" actionsHost={footer} />);

  // 대상을 "거래 N건" 으로 센다
  const kpis = within(await screen.findByLabelText('백테스트 결과'));
  expect(kpis.getByText('적중 거래').closest('div')).toHaveTextContent('적중 거래2 건');
  // 사례의 대상은 거래 코드다. 날짜는 한국 시각 기준이라 16:30Z 는 다음 날이다.
  const cases = within(screen.getByRole('region', { name: '사례' }));
  expect(cases.getByRole('columnheader', { name: /대상 거래/ })).toBeInTheDocument();
  expect(within(cases.getByText('T-230909-00000101').closest('tr')).getByText('건당 금액 11,500 USD')).toBeInTheDocument();
  expect(cases.getByText('T-230910-00000205')).toBeInTheDocument();
  // 이 템플릿의 룰은 Alert 를 만들 수 없으므로 예상 새 Alert 를 보여 주지 않는다
  const sweep = within(screen.getByRole('region', { name: '값을 바꾸면' }));
  expect(sweep.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['건당 금액', '적중 거래', '근거 거래', 'Alert 와 겹침']);
  expect(sweep.getByRole('row', { name: /이번 값/ })).toHaveTextContent('10,000 USD');
  const scope = within(screen.getByRole('region', { name: '검사 범위' }));
  expect(scope.queryByText('예상 새 Alert')).not.toBeInTheDocument();
  expect(scope.getByText('이 템플릿의 룰은 Alert 를 만들지 않고 근거로만 표시합니다.')).toBeInTheDocument();
  expect(scope.getByText('이미 있는 Alert 와 겹침').closest('div')).toHaveTextContent('거래 2건');
});

it('방향을 고르는 템플릿은 돌릴 버전의 방향에 맞는 문구로 측정값을 읽는다', async () => {
  // RULE-004 가 분할 입·출금 룰이고 방향이 입금일 때
  vi.mocked(fetchRule).mockImplementation(ruleId => Promise.resolve(ruleId === 4
    ? { ...draftRuleFixture, template: 'STRUCTURING', templateName: '분할 입·출금',
      working: { ...draftRuleFixture.working, definition: { ...draftRuleFixture.working.definition, direction: 'IN' } } } : activeRuleFixture));
  const splitRun = { ...completed, template: 'STRUCTURING', baseline: null, sweep: null,
    kpis: { ...result.kpis, added: null, dropped: null, baseHits: null, basePrecision: null, baseJudged: null },
    cases: [{ subjectType: 'ACCOUNT', subject: 'c41f3f2a', state: 'HIT', measured: { SUM_USD: 15000, TX_COUNT: 2, DISTINCT_COUNTERPARTIES: 2 }, txCount: 2, alertId: null, judgement: null }] };
  vi.mocked(fetchBacktests).mockResolvedValue([splitRun]);
  vi.mocked(fetchBacktest).mockResolvedValue(splitRun);
  render(<LiveRuleBacktest initialRule="RULE-004" actionsHost={footer} />);

  const cases = within(await screen.findByRole('region', { name: '사례' }));
  expect(cases.getByRole('columnheader', { name: /대상 계좌/ })).toBeInTheDocument();
  expect(within(cases.getByText('c41f3f2a').closest('tr')).getByText('거래 2건 · 송금 계좌 2개 · 받은 총액 15,000 USD')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '검사 범위' })).getByText('예상 새 Alert')).toBeInTheDocument();
});

it('도는 중에는 취소할 수 있고, 실패하면 이유를 보여 준다', async () => {
  vi.mocked(fetchBacktests).mockResolvedValue([head('RUNNING', { progress: 20 })]);
  vi.mocked(fetchBacktest).mockResolvedValue(head('RUNNING', { progress: 20 }));
  vi.mocked(cancelBacktest).mockResolvedValue(head('RUNNING', { progress: 20, cancelRequested: true }));
  render(<LiveRuleBacktest initialRule="RULE-004" actionsHost={footer} />);
  fireEvent.click(await within(footer).findByRole('button', { name: '취소' }));
  expect(await card('실행 상태').findByText(/취소를 요청했습니다/)).toBeInTheDocument();
  expect(cancelBacktest).toHaveBeenCalledWith(31);
  expect(runButton('취소')).toBeDisabled();

  vi.mocked(fetchBacktests).mockResolvedValue([head('FAILED', { errorCode: 'TIMEOUT' })]);
  vi.mocked(fetchBacktest).mockResolvedValue(head('FAILED', { errorCode: 'TIMEOUT' }));
  fireEvent.click(within(screen.getByRole('region', { name: '실행 기록' })).getByRole('button', { name: /v2/ }));
  expect(await card('실행 상태').findByRole('alert')).toHaveTextContent('120초를 넘어 중단했습니다');
  expect(screen.queryByLabelText('백테스트 결과')).not.toBeInTheDocument();
});

it('평가기가 없는 템플릿은 실행을 막고, 서버가 접수를 거절하면 사유를 보여 준다', async () => {
  // 서버가 준 backtestTemplates 에 없는 템플릿의 룰일 때(지금 서버는 고를 수 있는 열 개를 모두 준다. 이 막는 문구는 옛 서버에 붙었을 때를 위한 것이다)
  vi.mocked(fetchRule).mockImplementation(ruleId => Promise.resolve(ruleId === 4
    ? { ...draftRuleFixture, template: 'DORMANT_ACTIVATION', templateName: '휴면계좌 활성화' } : activeRuleFixture));
  render(<LiveRuleBacktest initialRule="RULE-004" actionsHost={footer} />);
  // 되는 템플릿은 backtestTemplates 에서 읽는다(카탈로그 픽스처에 있는 것은 넷)
  expect(await screen.findByText(/휴면계좌 활성화 템플릿의 백테스트는 아직 제공하지 않습니다/))
    .toHaveTextContent('지금은 FAN-OUT · RANDOM · 단건 고액거래 · 분할 입·출금 만 됩니다.');
  expect(runButton('백테스트 실행')).toBeDisabled();

  // RULE-002(FAN-IN)는 운영 버전뿐이라 비교 없이 그 버전을 돌린다
  fireEvent.keyDown(card('백테스트 대상 룰').getByRole('combobox', { name: '룰' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: /^RULE-002/ }));
  expect(await card('비교 기준').findByText('운영 버전 그대로 돌립니다. 비교할 새 버전이 없습니다.')).toBeInTheDocument();
  vi.mocked(requestBacktest).mockRejectedValue(problem(400, 'VALIDATION_FAILED', '원장에 거래가 없어 백테스트를 돌릴 수 없습니다.'));
  await waitFor(() => expect(runButton('백테스트 실행')).toBeEnabled());
  fireEvent.click(runButton('백테스트 실행'));
  expect(await screen.findByRole('alert')).toHaveTextContent('원장에 거래가 없어 백테스트를 돌릴 수 없습니다.');
  expect(requestBacktest).toHaveBeenCalledWith({ versionId: activeRuleFixture.operating.versionId });
});
