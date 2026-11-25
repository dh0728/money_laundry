import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/common';
import { fetchCaseRuleHits } from '@/api/rules';
import { CaseRuleHits, useCaseRuleHits } from './case-rule-hits';

// 사건 상세의 "룰 적중"(서비스 모드). 응답은 API.md §12 의 rule-hits 모양이다.
vi.mock('@/api/rules', () => ({ fetchCaseRuleHits: vi.fn() }));
afterEach(() => vi.clearAllMocks());

const hit = {
  alertId: 12, ruleId: 3, code: 'RULE-003', name: '분산 송금 감시', template: 'FAN_OUT', templateName: 'FAN-OUT · 분산 송금', pattern: 1,
  versionId: 7, versionNo: 2, versionStatus: 'ACTIVE', summary: '첫 거래 상대 · 건당 1,000 USD 이상 · 수취 계좌 6개 이상 · 7일',
  subjectType: 'ACCOUNT', subjectLabel: '송금 계좌', subject: 'c41f3f2a', hitDates: ['2023-09-09', '2023-09-11'], windowMinutes: 10080,
  measured: { DISTINCT_COUNTERPARTIES: 7, TX_COUNT: 7, SUM_USD: 65700 },
  conditions: [
    { metric: 'DISTINCT_COUNTERPARTIES', label: '서로 다른 수취 계좌 수', cmp: 'GTE', value: 6, unit: '개', measured: 7 },
    { metric: 'SUM_USD', label: '보낸 총액', cmp: 'GTE', value: 50000, unit: 'USD', measured: 65700 },
    { metric: 'NO_REPEAT', label: '상대 계좌마다 거래가 한 번뿐', cmp: null, value: null, unit: null, measured: null },
  ],
  roles: [], matchedTxIds: [101, 102, 999], evidenceTxCount: 7,
};
const records = [{ txId: 101, code: 'T-230909-00000101' }, { txId: 102, code: 'T-230909-00000102' }, { txId: 103, code: 'T-230909-00000103' }];

function Screen({ caseId, alertCode }) {
  return <CaseRuleHits state={useCaseRuleHits(caseId)} records={records} alertCode={alertCode} />;
}

it('사건에 걸린 룰을 조건과 실제 값, 겹친 거래와 함께 보여 준다', async () => {
  vi.mocked(fetchCaseRuleHits).mockResolvedValue([hit, { ...hit, alertId: 13, versionId: 6, versionNo: 1, versionStatus: 'RETIRED', matchedTxIds: [103], hitDates: ['2023-09-09'] }]);
  render(<Screen caseId={41} />);
  expect(screen.getByText('룰 적중을 불러오는 중입니다.')).toBeInTheDocument();
  const [card, retired] = within(await screen.findByRole('list', { name: '룰 적중' })).getAllByRole('listitem').filter(item => item.parentElement.classList.contains('case-rule-hits'));
  expect(fetchCaseRuleHits).toHaveBeenCalledWith(41);
  expect(within(card).getByRole('link', { name: 'RULE-003' })).toHaveAttribute('href', '/rules?rule=RULE-003');
  expect(card).toHaveTextContent('v2 · 분산 송금 감시');
  expect(card).toHaveTextContent('FAN-OUT · 분산 송금');
  expect(card).toHaveTextContent('송금 계좌 c41f3f2a · 적중 날짜 2023-09-09, 2023-09-11');
  const conditions = within(within(card).getByRole('list', { name: '조건과 실제 값' })).getAllByRole('listitem').map(item => item.textContent);
  expect(conditions).toEqual(['서로 다른 수취 계좌 수 ≥ 6개 → 실제 7개', '보낸 총액 ≥ 50,000 USD → 실제 65,700 USD', '상대 계좌마다 거래가 한 번뿐']);
  // 겹친 거래 수는 서버 값이고, 화면 코드는 이 사건의 거래에서 찾은 것만 보여 준다
  expect(card).toHaveTextContent('이 사건의 거래 3건이 이 적중의 근거 거래입니다(근거 거래 전체 7건).');
  expect(within(card).getAllByRole('button').map(button => button.textContent)).toEqual(['T-230909-00000101', 'T-230909-00000102']);
  // 운영 중인 버전에는 상태를 붙이지 않고, 물러난 버전이 운영 중일 때 만든 적중에는 붙인다
  expect(card).not.toHaveTextContent('지금은');
  expect(retired).toHaveTextContent('지금은 교체됨');
});

it('경로형 · 2홉형 적중은 조건 한 줄과 함께 나온 계좌(출발 · 경유 · 경로 계좌)를 보여 준다', async () => {
  const cycle = { ...hit, ruleId: 5, code: 'RULE-005', name: '순환 감시', template: 'CYCLE', templateName: 'CYCLE · 순환거래', pattern: 5,
    subjectLabel: '출발 계좌(돈이 돌아온 계좌)', subject: 'aaaa0001', hitDates: ['2023-09-09'], measured: { HOPS: 3 },
    conditions: [{ metric: 'minHops', label: '순환 거래 수', cmp: 'GTE', value: 3, unit: '건', measured: 3 }],
    roles: [{ role: 'PATH', label: '경로 계좌', accountId: 'bbbb0002' }, { role: 'PATH', label: '경로 계좌', accountId: 'cccc0003' }],
    matchedTxIds: [101], evidenceTxCount: 3 };
  const mids = Array.from({ length: 10 }, (_, index) => `mid0000${index}`);
  const scatter = { ...hit, ruleId: 6, code: 'RULE-006', name: '뿌렸다 모으기 감시', template: 'SCATTER_GATHER', templateName: 'SCATTER-GATHER · 뿌렸다 모으기', pattern: 4,
    subjectLabel: '도착 계좌', subject: 'dddd0004', hitDates: ['2023-09-10'], measured: { MID_COUNT: 10 },
    conditions: [{ metric: 'MID_COUNT', label: '경유 계좌 수', cmp: 'GTE', value: 4, unit: '개', measured: 10 }],
    roles: [{ role: 'SOURCE', label: '출발 계좌', accountId: 'eeee0005' }, ...mids.map(accountId => ({ role: 'MID', label: '경유 계좌', accountId }))],
    matchedTxIds: [102], evidenceTxCount: 20 };
  vi.mocked(fetchCaseRuleHits).mockResolvedValue([cycle, scatter, hit]);
  render(<Screen caseId={41} />);
  const [first, second, plain] = within(await screen.findByRole('list', { name: '룰 적중' })).getAllByRole('listitem').filter(item => item.parentElement.classList.contains('case-rule-hits'));

  expect(first).toHaveTextContent('출발 계좌(돈이 돌아온 계좌) aaaa0001 · 적중 날짜 2023-09-09');
  expect(within(first).getByRole('list', { name: '조건과 실제 값' })).toHaveTextContent('순환 거래 수 ≥ 3건 → 실제 3건');
  // 경로 계좌는 서버가 준 순서(지나간 순서) 그대로다
  expect(within(within(first).getByRole('list', { name: '함께 나온 계좌' })).getAllByRole('listitem').map(item => item.textContent))
    .toEqual(['경로 계좌 2개bbbb0002cccc0003']);

  // 출발 계좌 다음에 경유 계좌. 한 역할이 8개를 넘으면 접어 두고 누르면 다 보여 준다.
  const roles = within(within(second).getByRole('list', { name: '함께 나온 계좌' }));
  const [source, mid] = roles.getAllByRole('listitem');
  expect(source).toHaveTextContent('출발 계좌 1개eeee0005');
  expect(mid).toHaveTextContent('경유 계좌 10개');
  expect(mid).toHaveTextContent('mid00007');
  expect(mid).not.toHaveTextContent('mid00008');
  const more = within(mid).getByRole('button', { name: '경유 계좌 2개 더 보기' });
  expect(more).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(more);
  expect(mid).toHaveTextContent('mid00009');
  expect(within(mid).getByRole('button', { name: '경유 계좌 접기' })).toHaveAttribute('aria-expanded', 'true');

  // 집계형 적중에는 이 줄이 없다
  expect(within(plain).queryByRole('list', { name: '함께 나온 계좌' })).not.toBeInTheDocument();
});

it('대상이 거래인 룰(단건 고액거래)은 걸린 거래를 한 장에 모아 보여 준다', async () => {
  const large = { ...hit, ruleId: 8, code: 'RULE-008', name: '고액 거래 감시', template: 'LARGE_TX', templateName: '단건 고액거래', pattern: null,
    subjectType: 'TX', subjectLabel: '거래 1건', subject: null, hitDates: ['2023-09-09', '2023-09-10'], windowMinutes: null, measured: { TX_USD: 50000 },
    conditions: [{ metric: 'TX_USD', label: '건당 금액', cmp: 'GTE', value: 10000, unit: 'USD', measured: 50000 }],
    roles: [], matchedTxIds: [101, 102], evidenceTxCount: 2 };
  vi.mocked(fetchCaseRuleHits).mockResolvedValue([large, { ...large, alertId: 13, matchedTxIds: [103], hitDates: ['2023-09-09'], measured: { TX_USD: 12000 },
    conditions: [{ ...large.conditions[0], measured: 12000 }], evidenceTxCount: 1 }]);
  render(<Screen caseId={41} />);
  const [many, one] = within(await screen.findByRole('list', { name: '룰 적중' })).getAllByRole('listitem').filter(item => item.parentElement.classList.contains('case-rule-hits'));

  // 대상 계좌 대신 걸린 거래 수를 적는다
  expect(many).toHaveTextContent('거래 2건 · 적중 날짜 2023-09-09, 2023-09-10');
  expect(many).not.toHaveTextContent('거래 1건');
  // 여러 건을 모은 카드의 실제 값은 그 가운데 가장 큰 금액이다
  expect(within(many).getByRole('list', { name: '조건과 실제 값' })).toHaveTextContent('건당 금액 ≥ 10,000 USD → 가장 큰 거래 50,000 USD');
  expect(many).toHaveTextContent('이 사건의 거래 2건이 이 룰에 걸렸습니다.');
  expect(within(many).getAllByRole('button').map(button => button.textContent)).toEqual(['T-230909-00000101', 'T-230909-00000102']);
  // 한 건이면 그냥 실제 값이다
  expect(one).toHaveTextContent('거래 1건 · 적중 날짜 2023-09-09');
  expect(within(one).getByRole('list', { name: '조건과 실제 값' })).toHaveTextContent('건당 금액 ≥ 10,000 USD → 실제 12,000 USD');
});

it('Episode 에서는 카드가 어느 Alert 의 것인지 보여 준다', async () => {
  vi.mocked(fetchCaseRuleHits).mockResolvedValue([hit]);
  render(<Screen caseId={50} alertCode={id => (id === 12 ? 'A-230912-000012' : undefined)} />);
  expect(await screen.findByRole('button', { name: 'A-230912-000012 상세 열기' })).toBeInTheDocument();
});

it('걸린 룰이 없거나 읽지 못하면 그렇게 알리고, 사건을 옮기면 다시 읽는다', async () => {
  vi.mocked(fetchCaseRuleHits).mockResolvedValue([]);
  const view = render(<Screen caseId={41} />);
  expect(await screen.findByText('이 사건의 거래에 걸린 운영 룰이 없습니다.')).toBeInTheDocument();

  vi.mocked(fetchCaseRuleHits).mockRejectedValue(new ApiError({ type: 'about:blank', title: 'NOT_FOUND', status: 404, code: 'NOT_FOUND', detail: '사건이 없습니다.' }));
  view.rerender(<Screen caseId={42} />);
  // 앞 사건의 결과를 새 사건에 보여 주지 않는다
  expect(screen.getByText('룰 적중을 불러오는 중입니다.')).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('사건이 없습니다.');
  expect(fetchCaseRuleHits).toHaveBeenLastCalledWith(42);
});
