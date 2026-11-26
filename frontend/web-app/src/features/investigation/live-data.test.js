import { beforeEach, expect, test, vi } from 'vitest';

const board = {
  businessAt: '2023-09-08T09:00:00Z', nextEpisodeId: 21,
  cases: [
    { caseId: 13, kind: 'EPISODE', status: 'OPEN', outcome: null, assigneeId: 1, createdAt: '2023-09-08T09:00:00Z', closedAt: null, ageDays: 0,
      summary: { riskScore: 0.73, primaryType: 'Fan-out', typeShare: 0.6, amountsByCurrency: { USD: 100 } },
      linkedAlertIds: [8, 9], members: [{ txId: 7, reviewRole: 'SUBJECT', state: 'PENDING', decision: null }] },
    { caseId: 8, kind: 'ALERT', status: 'CLOSED', outcome: 'TRANSFERRED', assigneeId: 1, createdAt: '2023-09-07T01:00:00Z', closedAt: '2023-09-08T09:00:00Z', ageDays: 1,
      reviewStartedAt: null, readAt: null, episodeId: 13, summary: { riskScore: 0.5, primaryType: 'Fan-out', typeShare: 1, amountsByCurrency: {} }, members: [],
      edits: [{ action: 'MOVE', sourceAlertId: 8, targetAlertId: 6, txIds: [7], reason: '같은 흐름', editor: '직원', at: '2023-09-07T02:00:00Z' }] },
    { caseId: 5, kind: 'ALERT', status: 'CLOSED', outcome: 'SUSPICIOUS', assigneeId: 2, createdAt: '2023-09-05T16:30:00Z', closedAt: '2023-09-08T09:00:00Z', ageDays: 2,
      reviewStartedAt: '2023-09-06T00:00:00Z', summary: { riskScore: 0.9, primaryType: 'Cycle', typeShare: null, amountsByCurrency: { USD: '100.00' } },
      members: [{ txId: 7, reviewRole: 'SUBJECT', state: 'DECIDED', decision: 'SUSPICIOUS' }] },
    { caseId: 6, kind: 'ALERT', status: 'OPEN', outcome: null, assigneeId: 1, createdAt: '2023-09-05T01:00:00Z', closedAt: null, ageDays: 3,
      reviewStartedAt: null, readAt: null, summary: { riskScore: 0.4, primaryType: 'Fan-in', typeShare: 1, amountsByCurrency: {} }, members: [] },
    { caseId: 9, kind: 'ALERT', status: 'OPEN', outcome: null, assigneeId: 1, createdAt: '2023-09-05T02:00:00Z', closedAt: null, ageDays: 3,
      reviewStartedAt: null, readAt: '2023-09-06T00:00:00Z', summary: { riskScore: 0.4, primaryType: 'Fan-in', typeShare: 1, amountsByCurrency: {} }, members: [] },
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
  const { loadLiveSource, liveCodes, liveNextEpisodeCode, serverIdFromCode } = await import('./live-data.js');
  const { cases, mine, transactions } = await loadLiveSource();
  const [episode, transferred, closed, open, read] = cases;

  expect(episode).toMatchObject({ code: 'E-230908-000013', kind: 'Episode', status: '처리 중', assigned: true, pattern: 'Fan-out 60%', score: 73, linkedAlerts: 1 });
  // 16:30Z is the next day in KST.
  expect(closed).toMatchObject({ code: 'A-230906-000005', status: '처리 완료', verdict: 'abnormal', open: false, pattern: 'Cycle', amountByCurrency: { USD: 100 } });
  expect(open).toMatchObject({ code: 'A-230905-000006', status: '처리 전', verdict: 'unjudged', unread: true, elapsed: 3 });
  expect(closed.related[0]).toMatchObject({ code: 'T-230905-00000007', timestamp: '2023-09-05 00:20', verdict: 'abnormal', score: 91,
    from: { owner: '가', code: 'a' }, to: { owner: '나', code: 'b' } });
  expect(episode.related[0].verdict).toBe('unjudged');
  expect(transactions).toHaveLength(1);
  // 열람 여부는 서버 값이다.
  expect(read).toMatchObject({ status: '처리 전', unread: false });
  // Episode에 묶인 Alert는 처리 완료로 보이고 Episode ID를 가진다. Episode는 소속 Alert ID를 가진다.
  expect(transferred).toMatchObject({ status: '처리 완료', open: false, verdict: 'unjudged', episodeCode: 'E-230908-000013' });
  expect(episode.linkedAlertCodes).toEqual(['A-230907-000008', 'A-230905-000009']);
  expect(transferred.membershipHistory).toEqual([{ action: 'move', sourceCode: 'A-230907-000008', targetCode: 'A-230905-000006',
    transactionCodes: ['T-230905-00000007'], reason: '같은 흐름', reviewer: '직원', at: '2023-09-07T02:00:00Z' }]);
  expect(liveNextEpisodeCode()).toBe('E-230908-000021');
  expect(mine.map(row => row.code)).toEqual(['E-230908-000013', 'A-230907-000008', 'A-230905-000006', 'A-230905-000009']);
  expect(liveCodes('A')).toEqual(['A-230907-000008', 'A-230906-000005', 'A-230905-000006', 'A-230905-000009']);
  expect(serverIdFromCode('A-230906-000005')).toBe(5);
  // The cold import pulls in query-controls.jsx (date picker, icons) and exceeds 5s on loaded CI runners.
}, 30_000);
