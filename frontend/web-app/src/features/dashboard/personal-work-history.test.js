import { expect, test } from 'vitest';
import { personalInvestigationFlow } from './dashboard-flows.js';
import { personalWorkHistory } from './personal-work-history.js';

test('the personal flow counts assigned cases once and splits completed cases by verdict', () => {
  const mine = [
    { code: 'alert-one', kind: 'Alert', status: '처리 전' },
    { code: 'alert-two', kind: 'Alert', status: '처리 완료', verdict: 'unjudged' },
    { code: 'episode', kind: 'Episode', status: '처리 완료', verdict: 'normal' },
  ];
  const { nodes, links } = personalInvestigationFlow(mine, {
    statusByCode: { 'alert-two': '처리 완료' }, verdictByCode: { 'alert-two': 'abnormal' },
  });
  expect(nodes.map(({ name, count }) => [name, count])).toEqual([
    ['Alert', 2], ['Episode', 1], ['검토 대기', 1], ['처리 완료', 2], ['정상 판정', 1], ['이상 판정', 1],
  ]);
  expect(links.map(({ source, target, count }) => [nodes[source].name, nodes[target].name, count])).toEqual([
    ['Alert', '검토 대기', 1], ['Alert', '처리 완료', 1], ['Episode', '처리 완료', 1],
    ['처리 완료', '정상 판정', 1], ['처리 완료', '이상 판정', 1],
  ]);
});

test('personal history shows applied transfers in both directions and keeps earlier judgments after reopening', () => {
  const previousJudgment = { id: 'old', at: '2026-11-24T15:00:00Z' };
  const currentJudgment = { id: 'new', at: '2026-11-25T12:00:00+09:00' };
  const requests = [
    { id: 'received', code: 'alert-one', before: { assignee: 'other' }, assignee: 'me', appliedAt: '2026-11-24T15:30:00Z' },
    { id: 'sent', code: 'alert-two', before: { assignee: 'me' }, assignee: 'other', appliedAt: '2026-11-25T10:00:00+09:00' },
    { id: 'unapplied', code: 'alert-two', before: { assignee: 'other' }, assignee: 'me' },
    { id: 'reopen', code: 'alert-one', before: { assignee: 'me', verdict: 'normal', judgment: previousJudgment } },
  ];
  const cases = [
    { code: 'alert-one', assignee: 'me', verdict: 'abnormal', judgment: currentJudgment },
    { code: 'alert-two', assignee: 'other', verdict: 'abnormal', judgment: { id: 'others', at: currentJudgment.at } },
  ];
  const day = new Date(2026, 10, 25);
  const { assignments, judgments } = personalWorkHistory(cases, requests, 'me', { from: day, to: day });
  expect(assignments.map(row => [row.id, row.incoming])).toEqual([['sent', false], ['received', true]]);
  expect(judgments.map(row => row.id)).toEqual(['new', 'old']);
});
