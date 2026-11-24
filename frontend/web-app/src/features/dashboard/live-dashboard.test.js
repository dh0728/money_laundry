import { beforeEach, expect, test, vi } from 'vitest';

const day = value => new Date(`${value}T00:00:00`);
const transfer = { code: 'T-230905-00000007', date: day('2023-09-05'), hour: 2, score: 91, suspicious: true };
const alert = { code: 'A-230906-000005', kind: 'Alert', date: day('2023-09-06'), status: '처리 중', open: true, assigned: true,
  elapsed: 3, score: 95, hour: 1, pattern: 'Cycle 80%', related: [transfer] };
const other = { ...alert, code: 'A-230907-000006', date: day('2023-09-07'), assigned: false, related: [] };
const source = { businessAt: '2023-09-08T09:00:00Z', cases: [alert, other], mine: [alert], transactions: [transfer] };
const ledger = {
  days: Array.from({ length: 8 }, (_, index) => ({
    date: `2023-09-0${index + 1}`, total: 0, suspicious: 0, linkedSuspicious: 0, newAccounts: 0, newOwners: 0,
  })).map(row => ({ ...row,
    ...({
      '2023-09-05': { total: 40, suspicious: 4, linkedSuspicious: 3, newAccounts: 6, newOwners: 2 },
      '2023-09-06': { total: 10, newAccounts: 1 },
    }[row.date]),
  })),
  types: [{ type: 'Cycle', count: 3 }, { type: 'NON_PATTERN', count: 1 }],
  hours: [{ hour: 3, total: 5, suspicious: 0 }, { hour: 9, total: 30, suspicious: 3 }, { hour: 18, total: 15, suspicious: 1 }],
  scores: [{ scorePct: 75, count: 1 }, { scorePct: 95, count: 3 }],
};
const getJson = vi.fn(async () => ledger);

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
  expect(data).toMatchObject({ linked: 3, unlinked: 1, coverageScope: 'institution' });
  expect(data.patterns).toEqual([{ label: 'Cycle', count: 3 }, { label: '미분류', count: 1 }]);
  expect(data.operationalDaily.find(row => row.date === '2023-09-05')).toMatchObject({ total: 40, suspicious: 4, linked: 3, unlinked: 1 });
  expect(data.operationalDaily.find(row => row.date === '2023-09-06')).toMatchObject({ alerts: 1, openAlerts: 1 });
  expect(data.alertCases).toHaveLength(2);
  expect(data.highRisk).toBe(1);
  // 신규 계좌·소유주, 시간대별, 점수 구간별 수도 서버 집계에서 온다.
  expect(data).toMatchObject({ newAccounts: 7, newOwners: 2 });
  expect(data.hourly[0]).toMatchObject({ label: '09:00', total: 30, suspicious: 3 });
  expect(data.hourly[9]).toMatchObject({ label: '18:00', total: 15, suspicious: 1 });
  expect(data.flags.map(flag => [flag.key, flag.count])).toEqual([['high', 3], ['medium', 1], ['low', 0]]);
});

test('personal overdue counts start after day three and retain the Alert and Episode counts', async () => {
  const { liveDashboardResponse } = await import('./live-dashboard.js');
  const lateAlert = { ...alert, code: 'A-overdue', elapsed: 4 };
  const lateEpisode = { ...alert, code: 'E-overdue', kind: 'Episode', elapsed: 4 };
  const completed = { ...lateEpisode, code: 'E-completed', open: false, status: '처리 완료' };
  const mine = [alert, lateAlert, lateEpisode, completed];
  const data = await liveDashboardResponse({ ...source, cases: [...mine, other], mine }, { mine: true });

  expect(data).toMatchObject({ unfinished: 3, overdue: 2, overdueAlerts: 1, overdueEpisodes: 1, urgent: 1 });
  expect(data.hourly.reduce((total, row) => total + row.overdue, 0)).toBe(data.overdue);
});

test('institution coverage stays unavailable when a server day omits its linked count', async () => {
  getJson.mockResolvedValueOnce({ ...ledger, days: ledger.days.map(row => ({ ...row, linkedSuspicious: undefined })) });
  const { liveDashboardResponse } = await import('./live-dashboard.js');
  expect(await liveDashboardResponse(source, {})).toMatchObject({ linked: null, unlinked: null, coverageScope: 'institution' });
});

test('my view counts only the evidence of my cases without asking the server', async () => {
  const { liveDashboardResponse } = await import('./live-dashboard.js');
  const data = await liveDashboardResponse(source, { mine: true });

  expect(getJson).not.toHaveBeenCalled();
  expect(data.cases).toEqual([alert]);
  expect(data.transactions).toEqual([transfer]);
  expect(data.suspicious).toEqual([transfer]);
  expect(data).toMatchObject({ linked: 1, unlinked: 0, coverageScope: 'case-evidence' });
  expect(data.flags.find(flag => flag.key === 'high').count).toBe(1);
  expect(data.patterns).toEqual([{ label: 'Cycle', count: 1 }]);
});

test('institution case filters keep both coverage counts in the same evidence subset', async () => {
  const { liveDashboardResponse } = await import('./live-dashboard.js');
  const episode = { ...alert, kind: 'Episode', code: 'E-selected', date: day('2023-09-05') };
  const range = { from: day('2023-09-05'), to: day('2023-09-05') };
  const data = await liveDashboardResponse(
    { ...source, cases: [alert, other, episode] }, { rows: [episode], population: [alert, episode], range },
  );
  expect(getJson).not.toHaveBeenCalled();
  expect(data.suspicious).toEqual([transfer]);
  expect(data).toMatchObject({ dataSource: 'live', linked: 1, unlinked: 0, coverageScope: 'case-evidence' });
});

test('creation-day charts use explicit membership and current Episode verdicts outside the date range', async () => {
  const { liveDashboardResponse } = await import('./live-dashboard.js');
  const cases = [
    { ...alert, status: '처리 완료', open: false, episodeCode: 'E-open' },
    { ...other, status: '처리 완료', open: false },
    { ...other, code: 'A-individual', status: '처리 전' },
    { ...alert, kind: 'Episode', code: 'E-open', date: day('2023-09-08'), linkedAlertCodes: [] },
    { ...alert, kind: 'Episode', code: 'E-closed', date: day('2023-09-08'), open: false,
      verdict: 'abnormal', linkedAlertCodes: [other.code], related: [] },
  ];
  const result = await liveDashboardResponse({ ...source, cases }, { range: { from: day('2023-09-05'), to: day('2023-09-07') } });
  expect(result.investigation).toMatchObject({ totalAlerts: 3, individualAlerts: 1, episodeAlerts: 2, linkedEpisodes: 2,
    routes: { individual: { pending: 1 }, episode: { inProgress: 1, done: 1, verdicts: { suspicious: 1 } } } });
  expect(result.dailyAlertStatus).toEqual([
    { date: '2023-09-05', pending: 0, inProgress: 0, done: 0 },
    { date: '2023-09-06', pending: 0, inProgress: 1, done: 0 },
    { date: '2023-09-07', pending: 1, inProgress: 0, done: 1 },
  ]);
  expect(result.dailyEpisodeStatus.every(row => row.pending + row.inProgress + row.done === 0)).toBe(true);
  expect(result.alertCases[0].status).toBe('처리 완료');
  const both = await liveDashboardResponse({ ...source, cases });
  expect(both.dailyEpisodeStatus.at(-1)).toEqual({ date: '2023-09-08', pending: 0, inProgress: 1, done: 1 });
});
