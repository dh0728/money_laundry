import { beforeEach, expect, test, vi } from 'vitest';

const day = value => new Date(`${value}T00:00:00`);
const transfer = { code: 'T-230905-00000007', date: day('2023-09-05'), hour: 2, score: 91, suspicious: true };
const alert = { code: 'A-230906-000005', kind: 'Alert', date: day('2023-09-06'), status: '처리 중', open: true, assigned: true,
  elapsed: 3, score: 95, hour: 1, pattern: 'Cycle 80%', related: [transfer] };
const other = { ...alert, code: 'A-230907-000006', date: day('2023-09-07'), assigned: false, related: [] };
const source = { businessAt: '2023-09-08T09:00:00Z', cases: [alert, other], mine: [alert], transactions: [transfer] };
const getJson = vi.fn(async () => ({
  days: [{ date: '2023-09-05', total: 40, suspicious: 4, newAccounts: 6, newOwners: 2 }, { date: '2023-09-06', total: 10, suspicious: 0, newAccounts: 1, newOwners: 0 }],
  types: [{ type: 'Cycle', count: 3 }, { type: 'NON_PATTERN', count: 1 }],
  hours: [{ hour: 3, total: 5, suspicious: 0 }, { hour: 9, total: 30, suspicious: 3 }, { hour: 18, total: 15, suspicious: 1 }],
  scores: [{ scorePct: 75, count: 1 }, { scorePct: 95, count: 3 }],
}));

beforeEach(() => {
  getJson.mockClear();
  vi.doMock('@/api/common', () => ({ getJson }));
});

test('whole view reads ledger counts from the server and work metrics from the cases', async () => {
  const { liveDashboardResponse } = await import('./live-dashboard.js');
  const data = await liveDashboardResponse(source, {});

  expect(getJson).toHaveBeenCalledWith('/api/v1/dashboard/transaction-days?from=2023-09-01&to=2023-09-08');
  expect(data.period).toEqual({ from: '2023-09-01', to: '2023-09-08' });
  expect(data.transactions.length).toBe(50);
  expect(data.suspicious.length).toBe(4);
  expect(data.linked).toBe(1);
  expect(data.patterns).toEqual([{ label: 'Cycle', count: 3 }, { label: '미분류', count: 1 }]);
  expect(data.operationalDaily.find(row => row.date === '2023-09-05')).toMatchObject({ total: 40, suspicious: 4, linked: 1 });
  expect(data.operationalDaily.find(row => row.date === '2023-09-06')).toMatchObject({ alerts: 1, openAlerts: 1 });
  expect(data.alertCases).toHaveLength(2);
  expect(data.highRisk).toBe(1);
  // 신규 계좌·소유주, 시간대별, 점수 구간별 수도 서버 집계에서 온다.
  expect(data).toMatchObject({ newAccounts: 7, newOwners: 2 });
  expect(data.hourly[0]).toMatchObject({ label: '09:00', total: 30, suspicious: 3 });
  expect(data.hourly[9]).toMatchObject({ label: '18:00', total: 15, suspicious: 1 });
  expect(data.flags.map(flag => [flag.key, flag.count])).toEqual([['high', 3], ['medium', 1], ['low', 0]]);
});

test('my view counts only the evidence of my cases without asking the server', async () => {
  const { liveDashboardResponse } = await import('./live-dashboard.js');
  const data = await liveDashboardResponse(source, { mine: true });

  expect(getJson).not.toHaveBeenCalled();
  expect(data.cases).toEqual([alert]);
  expect(data.transactions).toEqual([transfer]);
  expect(data.suspicious).toEqual([transfer]);
  expect(data.flags.find(flag => flag.key === 'high').count).toBe(1);
  expect(data.patterns).toEqual([{ label: 'Cycle', count: 1 }]);
});
