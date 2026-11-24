import React from 'react';
import { render, screen, within } from '@testing-library/react';
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
