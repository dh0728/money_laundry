import { expect, test } from 'vitest';
import { businessDateKey, clampDashboardDate, dashboardDateRange, isDateKey, shiftDateKey, sourceAsOf } from './dashboard-as-of.js';

const alert = (code, extra) => ({ code, kind: 'Alert', open: true, status: '처리 전', verdict: 'unjudged', assigned: false, unread: true,
  createdAt: '2026-09-10T01:00:00Z', elapsed: 6, related: [{ code: `T-${code}`, status: '처리 전', verdict: 'unjudged' }], ...extra });
const closed = { open: false, status: '처리 완료', verdict: 'abnormal', judgment: { verdict: 'abnormal' } };
const lateAlert = alert('A-2', { createdAt: '2026-09-15T16:00:00Z', elapsed: 0 }); // KST 9/16 01:00
const firstAlert = alert('A-1');
const source = {
  transactions: [], businessAt: '2026-09-16T03:00:00Z',
  cases: [
    firstAlert,
    lateAlert,
    alert('A-3', { ...closed, completedAt: '2026-09-16T01:00:00Z', reviewStartedAt: '2026-09-14T01:00:00Z',
      related: [{ code: 'T-A-3', status: '처리 완료', verdict: 'abnormal' }] }),
    alert('A-4', { ...closed, verdict: 'normal', completedAt: '2026-09-12T01:00:00Z', reviewStartedAt: '2026-09-11T01:00:00Z', assigned: true }),
    alert('A-5', { status: '처리 중', reviewStartedAt: '2026-09-16T00:30:00Z', episodeCode: 'E-2',
      related: [{ code: 'T-A-5', status: '처리 중', verdict: 'unjudged' }] }),
    alert('E-1', { kind: 'Episode', status: '처리 중', createdAt: '2026-09-13T01:00:00Z', linkedAlertCodes: ['A-1', 'A-2'],
      overlappingAlerts: [firstAlert, lateAlert], linkedAlerts: 2 }),
    alert('E-2', { kind: 'Episode', status: '처리 중', createdAt: '2026-09-15T18:00:00Z' }),
  ],
};
const rows = view => Object.fromEntries(view.cases.map(row => [row.code, row]));

test('date keys follow the KST calendar', () => {
  expect(isDateKey('2026-09-15')).toBe(true);
  expect(isDateKey('2026-02-30')).toBe(false);
  expect(isDateKey('20260915')).toBe(false);
  expect(businessDateKey('2026-09-15T16:00:00Z')).toBe('2026-09-16');
  expect(shiftDateKey('2026-09-01', -1)).toBe('2026-08-31');
  expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
});

test('the selectable range runs from the first case to the business day, and today is not a past date', () => {
  const range = dashboardDateRange(source);
  expect(range).toEqual({ first: '2026-09-10', last: '2026-09-16' });
  expect(clampDashboardDate('2026-09-16', range)).toBeUndefined();
  expect(clampDashboardDate('2026-09-20', range)).toBeUndefined();
  expect(clampDashboardDate('nope', range)).toBeUndefined();
  expect(clampDashboardDate('2026-09-01', range)).toBe('2026-09-10');
  expect(clampDashboardDate('2026-09-15', range)).toBe('2026-09-15');
});

test('work created after the reference day is left out and ages stop at the end of that day', () => {
  const view = sourceAsOf(source, '2026-09-15');
  expect(view.cases.map(row => row.code)).toEqual(['A-1', 'A-3', 'A-4', 'A-5', 'E-1']);
  expect(view).toMatchObject({ asOfDate: '2026-09-15', businessAt: '2026-09-15T14:59:59.999Z' });
  expect(rows(view)['A-1']).toMatchObject({ elapsed: 5, unread: false });
  expect(view.mine.map(row => row.code)).toEqual(['A-4']);
});

test('work closed or started after the reference day returns to its earlier state', () => {
  const by = rows(sourceAsOf(source, '2026-09-15'));
  expect(by['A-3']).toMatchObject({ open: true, status: '처리 중', verdict: 'unjudged',
    related: [{ code: 'T-A-3', status: '처리 중', verdict: 'unjudged' }] });
  expect(by['A-3'].completedAt).toBeUndefined();
  expect(by['A-3'].judgment).toBeUndefined();
  expect(by['A-4']).toMatchObject({ open: false, status: '처리 완료', verdict: 'normal', completedAt: '2026-09-12T01:00:00Z' });
  expect(by['A-5']).toMatchObject({ status: '처리 전', related: [{ code: 'T-A-5', status: '처리 전', verdict: 'unjudged' }] });

  const early = sourceAsOf(source, '2026-09-11');
  expect(early.cases.map(row => `${row.code}:${row.status}:${row.elapsed}`))
    .toEqual(['A-1:처리 전:1', 'A-3:처리 전:1', 'A-4:처리 중:1', 'A-5:처리 전:1']);
});

test('links to work that did not exist yet are dropped', () => {
  const by = rows(sourceAsOf(source, '2026-09-15'));
  expect(by['A-5'].episodeCode).toBeUndefined();
  expect(by['E-1']).toMatchObject({ linkedAlertCodes: ['A-1'], linkedAlerts: 1, status: '처리 중' });
  expect(by['E-1'].overlappingAlerts).toEqual([by['A-1']]);
});

test('the received list is left untouched and the same day returns the same view', () => {
  const view = sourceAsOf(source, '2026-09-15');
  expect(sourceAsOf(source, '2026-09-15')).toBe(view);
  expect(source.cases).toHaveLength(7);
  expect(source.cases[2]).toMatchObject({ open: false, status: '처리 완료' });
  expect(source.cases[5].overlappingAlerts).toHaveLength(2);
});
