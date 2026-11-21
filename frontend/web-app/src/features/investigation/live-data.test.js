import { beforeEach, expect, test, vi } from 'vitest';

const board = {
  businessAt: '2023-09-08T09:00:00Z',
  cases: [
    { caseId: 13, kind: 'EPISODE', status: 'OPEN', outcome: null, assigneeId: 1, createdAt: '2023-09-08T09:00:00Z', closedAt: null, ageDays: 0,
      summary: { riskScore: 0.73, primaryType: 'Fan-out', typeShare: 0.6, amountsByCurrency: { USD: 100 } },
      members: [{ txId: 7, reviewRole: 'SUBJECT', state: 'PENDING', decision: null }] },
    { caseId: 5, kind: 'ALERT', status: 'CLOSED', outcome: 'SUSPICIOUS', assigneeId: 2, createdAt: '2023-09-05T16:30:00Z', closedAt: '2023-09-08T09:00:00Z', ageDays: 2,
      reviewStartedAt: '2023-09-06T00:00:00Z', summary: { riskScore: 0.9, primaryType: 'Cycle', typeShare: null, amountsByCurrency: { USD: '100.00' } },
      members: [{ txId: 7, reviewRole: 'SUBJECT', state: 'DECIDED', decision: 'SUSPICIOUS' }] },
    { caseId: 6, kind: 'ALERT', status: 'OPEN', outcome: null, assigneeId: 1, createdAt: '2023-09-05T01:00:00Z', closedAt: null, ageDays: 3,
      reviewStartedAt: null, summary: { riskScore: 0.4, primaryType: 'Fan-in', typeShare: 1, amountsByCurrency: {} }, members: [] },
  ],
  transactions: [{ txId: 7, occurredAt: '2023-09-04T15:20:00Z', fromAccountId: 'a', toAccountId: 'b', fromOwnerName: '가', toOwnerName: '나',
    amountPaid: 100, paymentCurrency: 'USD', paymentFormat: 'ACH', launderingScore: 0.91 }],
};

beforeEach(() => {
  vi.resetModules();
  vi.doMock('@/api/common', () => ({ getJson: vi.fn(async () => board) }));
  vi.doMock('../auth/preview-session-user.js', () => ({ currentPreviewUser: () => ({ id: 1 }) }));
});

test('server cases become screen rows with KST display codes and three-step status', async () => {
  const { loadLiveSource, liveCodes, serverIdFromCode } = await import('./live-data.js');
  const { cases, mine, transactions } = await loadLiveSource();
  const [episode, closed, open] = cases;

  expect(episode).toMatchObject({ code: 'E-230908-000013', kind: 'Episode', status: '처리 중', assigned: true, pattern: 'Fan-out 60%', score: 73, linkedAlerts: 1 });
  // 16:30Z is the next day in KST.
  expect(closed).toMatchObject({ code: 'A-230906-000005', status: '처리 완료', verdict: 'abnormal', open: false, pattern: 'Cycle', amountByCurrency: { USD: 100 } });
  expect(open).toMatchObject({ code: 'A-230905-000006', status: '처리 전', verdict: 'unjudged', unread: true, elapsed: 3 });
  expect(closed.related[0]).toMatchObject({ code: 'T-230905-00000007', timestamp: '2023-09-05 00:20', verdict: 'abnormal', score: 91,
    from: { owner: '가', code: 'a' }, to: { owner: '나', code: 'b' } });
  expect(episode.related[0].verdict).toBe('unjudged');
  expect(transactions).toHaveLength(1);
  expect(mine.map(row => row.code)).toEqual(['E-230908-000013', 'A-230905-000006']);
  expect(liveCodes('A')).toEqual(['A-230906-000005', 'A-230905-000006']);
  expect(serverIdFromCode('A-230906-000005')).toBe(5);
});
