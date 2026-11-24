import { expect, it } from 'vitest';
import { dashboardFixtures, dashboardFixtureResponse, dashboardFixtureBoardPage, dashboardRecordCodes } from './dashboard-fixtures';
import { readPreviewRoute } from '../app/preview-route';

const source = dashboardFixtures({
  T: dashboardRecordCodes({ prefix: 'T', digits: 8 }),
  A: dashboardRecordCodes({ prefix: 'A', digits: 6, first: [1042, 1051, 1069] }),
  E: dashboardRecordCodes({ prefix: 'E', digits: 6 }),
});
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

it('derives multi-day KPI, charts and board from the same identifiable records', () => {
  const data = dashboardFixtureResponse(source);
  expect(data.period).toEqual({ from: '2026-11-11', to: '2026-11-18' });
  expect(data.transactions).toHaveLength(175);
  expect(data.alertCases).toHaveLength(67);
  expect(data.cases).toHaveLength(104);
  expect(sum(data.operationalDaily, 'total')).toBe(data.transactions.length);
  expect(sum(data.operationalDaily, 'suspicious')).toBe(data.suspicious.length);
  expect(sum(data.operationalDaily, 'linked')).toBe(data.linked);
  expect(sum(data.operationalDaily, 'settled')).toBe(data.settled);
  expect(sum(data.operationalDaily, 'newAccounts')).toBe(data.newAccounts);
  expect(data.dailyAlertStatus.map(day => day.pending + day.inProgress + day.done)).toEqual(data.daily.map(day => day.incoming));
  expect(data.daily.filter(day => day.incoming > 0)).toHaveLength(8);
  expect(data.dailyAlertStatus[0].done).toBeGreaterThan(0);
  expect(data.daily[0].completed).toBe(0);
  expect(data.daily[1].completed).toBeGreaterThan(0);
  const codes = new Set(data.transactions.map(row => row.code));
  expect(data.cases.every(row => row.related.every(transaction => codes.has(transaction.code)))).toBe(true);
  const later = data.transactions.find(row => row.code.startsWith('T-261118'));
  expect(readPreviewRoute(new URL(`http://localhost:5215/transactions/${later.code}`)).code).toBe(later.code);
  expect(dashboardFixtureBoardPage(data.cases, { page: 1 }).content).toEqual(data.cases.slice(20, 40));
});

it('uses USD for synthetic transactions and case totals', () => {
  const data = dashboardFixtureResponse(source);
  expect([...new Set(data.transactions.map(row => row.currency))]).toEqual(['USD']);
  expect(data.transactions.slice(0, 6).map(row => row.amount)).toEqual([420, 200, 300, 1680, 500, 600]);
  const caseWithEvidence = data.cases.find(row => row.code === 'A-261111-000018');
  expect(caseWithEvidence.amountByCurrency).toEqual({ USD: sum(caseWithEvidence.related, 'amount') });
});

it('preserves true zero dates and scopes transactions to included case evidence when filtering', () => {
  const range = { from: new Date(2026, 10, 12), to: new Date(2026, 10, 12) };
  const scoped = dashboardFixtureResponse(source, { range });
  expect(scoped.daily[0].completed).toBeGreaterThan(scoped.dailyAlertStatus[0].done);
  const [match] = scoped.cases;
  const filtered = dashboardFixtureResponse(source, { rows: [match], population: [match], range });
  expect(filtered.cases).toEqual([match]);
  expect(filtered.transactions.map(row => row.code).sort()).toEqual(match.related.map(row => row.code).sort());
  expect(filtered.operationalDaily[0].totalCases).toBe(1);
  const empty = dashboardFixtureResponse(source, { range, rows: [], population: [] });
  expect(empty.transactions).toEqual([]);
  expect(empty.daily).toEqual([{ day: '2026-11-12', incoming: 0, completed: 0 }]);
});

it('deduplicates suspicious transactions and finds Alert evidence outside the transaction date range', () => {
  const date = new Date(2026, 10, 11);
  const range = { from: date, to: date };
  const linkedTransaction = { ...source.transactions[0], score: 95 };
  const unlinkedTransaction = { ...source.transactions[1], score: 95 };
  const alert = { ...source.cases[0], date: new Date(2026, 10, 12), related: [linkedTransaction, linkedTransaction] };
  const data = dashboardFixtureResponse({
    transactions: [linkedTransaction, linkedTransaction, unlinkedTransaction], cases: [alert], mine: [],
  }, { range });

  expect(data.alertCases).toHaveLength(0);
  expect(data.suspicious).toHaveLength(2);
  expect(data).toMatchObject({ dataSource: 'sample', linked: 1, unlinked: 1, coverageScope: 'institution' });
  expect(data.operationalDaily[0]).toMatchObject({ linked: 1, unlinked: 1 });
});
