import { afterEach, expect, it } from 'vitest';
import { cyclicSankeySampleCode, dashboardFixtures, dashboardFixtureResponse, dashboardFixtureBoardPage, dashboardRecordCodes } from './dashboard-fixtures';
import { readPreviewRoute } from '../app/preview-route';
import { investigationFlow, reviewStatusTotals, transactionFlow } from '../features/dashboard/dashboard-flows';
import { countUnfinishedCaseAges } from '../features/dashboard/dashboard-sla-donut';
import { previewAdmin, previewAnalysts, previewStaff } from '../features/auth/preview-session-user';
import { changePreviewEpisode } from '../features/investigation/preview-episode-transfer';

const fixtureCodes = {
  T: dashboardRecordCodes({ prefix: 'T', digits: 8 }),
  A: dashboardRecordCodes({ prefix: 'A', digits: 6, first: [1042, 1051, 1069] }),
  E: dashboardRecordCodes({ prefix: 'E', digits: 6 }),
};
const source = dashboardFixtures(fixtureCodes);
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
const transferKey = 'aml-radar-preview-episode-transfers';
afterEach(() => sessionStorage.removeItem(transferKey));

it('derives multi-day KPI, charts and board from the same identifiable records', () => {
  const data = dashboardFixtureResponse(source);
  expect(data.period).toEqual({ from: '2026-11-11', to: '2026-11-18' });
  expect(data.transactions).toHaveLength(175);
  expect(data.alertCases).toHaveLength(151);
  expect(data.cases).toHaveLength(188);
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

it('keeps sample today metrics independent of the date filter and ranks only open work without duplicating Episode members', () => {
  const full = dashboardFixtureResponse(source);
  const day = new Date('2026-11-11T00:00:00');
  const filtered = dashboardFixtureResponse(source, { range: { from: day, to: day } });
  expect(full.todaySnapshot).toMatchObject({ date: '2026-11-18', openAlerts: 53, openEpisodes: 27,
    detection: { basis: 'transaction-day' } });
  expect(filtered.todaySnapshot).toEqual(full.todaySnapshot);
  expect(full.priorityCases).toHaveLength(8);
  expect(full.priorityCases.every(row => row.open && !row.episodeCode && row.priorityScore === row.score * row.elapsed)).toBe(true);
  expect(full.priorityCases.map(row => row.priorityScore)).toEqual(full.priorityCases.map(row => row.priorityScore).toSorted((a, b) => b - a));
  expect(filtered.priorityCases.every(row => row.code.includes('-261111-'))).toBe(true);
  expect(sum(full.patternAlertCounts, 'count')).toBe(full.alertCases.length);
  expect(sum(filtered.patternAlertCounts, 'count')).toBe(filtered.alertCases.length);
});

it('shows three leading sample recipient banks and keeps the remainder in a single node', () => {
  const data = dashboardFixtureResponse(source);
  const recipients = flow => flow.nodes.filter(node => node.stage === 0).map(({ name, count }) => [name, count]);
  const flow = transactionFlow(data);
  expect(recipients(flow)).toEqual([['가상 은행 A', 64], ['가상 은행 B', 48], ['가상 은행 C', 37], ['기타', 26]]);
  expect(sum(flow.links.filter(link => flow.nodes[link.source].stage === 0), 'count')).toBe(data.transactions.length);
  expect(recipients(transactionFlow({ ...data, transactions: data.transactions.slice(0, 2), suspicious: [] })))
    .toEqual([['가상 은행 A', 1], ['가상 은행 C', 1]]);
  expect(recipients(transactionFlow({ ...data, dataSource: 'live' }))).toEqual([['은행별 거래 미집계', null]]);
});

it('uses the filtered dashboard case collection and effective status for the elapsed chart', () => {
  const full = dashboardFixtureResponse(source);
  const day = new Date('2026-11-11T00:00:00');
  const filtered = dashboardFixtureResponse(source, { range: { from: day, to: day } });
  for (const [data, kind, daily] of [
    [full, 'Alert', full.dailyAlertStatus], [full, 'Episode', full.dailyEpisodeStatus],
    [filtered, 'Alert', filtered.dailyAlertStatus], [filtered, 'Episode', filtered.dailyEpisodeStatus],
  ]) {
    const ages = countUnfinishedCaseAges(data.cases, data.investigation.statusByCode, kind);
    expect(ages.total).toBe(reviewStatusTotals(daily).unfinished);
    expect(ages.unknown).toBe(0);
    expect(sum(ages.segments, 'value')).toBe(ages.total);
  }
});

it('connects each sample Episode to distinct Alerts and their source transactions', () => {
  const data = dashboardFixtureResponse(source);
  const episodes = source.cases.filter(row => row.kind === 'Episode');
  const alerts = new Map(data.alertCases.map(row => [row.code, row]));
  expect(episodes).toHaveLength(37);
  const memberCodes = episodes.flatMap(row => row.linkedAlertCodes);
  expect(new Set(memberCodes).size).toBe(memberCodes.length);
  for (const episode of episodes) {
    expect(episode.linkedAlertCodesComplete).toBe(true);
    expect(episode.linkedAlertCodes.length).toBeGreaterThanOrEqual(2);
    const members = episode.linkedAlertCodes.map(code => alerts.get(code));
    expect(members.every(alert => alert.episodeCode === episode.code)).toBe(true);
    expect(new Set(episode.related.map(row => row.code)))
      .toEqual(new Set(members.flatMap(alert => alert.related.map(row => row.code))));
  }
  const { investigation } = data;
  expect(investigation).toMatchObject({ individualAlerts: 67, episodeAlerts: 84, linkedEpisodes: 37 });
  expect(investigation.routes.individual.pending).toBeGreaterThan(0);
  expect(investigation.routes.episode.inProgress).toBeGreaterThan(0);
  expect(investigation.routes.episode.verdicts.normal).toBeGreaterThan(0);
  expect(investigation.routes.episode.verdicts.suspicious).toBeGreaterThan(0);
  expect(data.unlinked).toBeGreaterThan(0);
  expect(investigationFlow(data).nodes).toContainEqual(expect.objectContaining({ name: 'Episode 편입', count: 84 }));
  expect(reviewStatusTotals(data.dailyAlertStatus)).toMatchObject({ pending: 27, inProgress: 88, done: 36, unfinished: 115, total: 151 });
  expect(reviewStatusTotals(data.dailyEpisodeStatus)).toMatchObject({ inProgress: 27, done: 10, unfinished: 27, total: 37 });
  expect(reviewStatusTotals([investigation.routes.individual])).toMatchObject({ pending: 27, inProgress: 26, done: 14, total: 67 });
});

it('uses the same synthetic analyst roster for case assignment, filters and both workload cards', () => {
  const { institutionWorkload } = dashboardFixtureResponse(source);
  const { byAssignee, equalAssignments, overdue, staffCount, total } = institutionWorkload;
  expect(staffCount).toBe(32);
  expect(new Set(source.cases.map(row => row.assignee))).toEqual(new Set(previewAnalysts.map(person => person.username)));
  expect(sum(byAssignee, 'assignments')).toBe(source.cases.length);
  expect(sum(byAssignee, 'total')).toBe(total);
  expect(sum(byAssignee, 'overdue')).toBe(overdue.length);
  expect(equalAssignments).toBe(source.cases.length / staffCount);
  expect(source.mine.every(row => row.assignee === previewStaff.username)).toBe(true);
  expect(dashboardFixtureResponse(source, { mine: true }).accountRecommendation).toBeTruthy();
});

it('restores older preview transfers and keeps seeded membership editable', () => {
  const episode = source.cases.find(row => row.kind === 'Episode' && row.open && row.assigned && row.linkedAlertCodes.length === 3);
  const extra = source.cases.find(row => row.kind === 'Alert' && row.open && !row.episodeCode);
  sessionStorage.setItem(transferKey, JSON.stringify([{ code: episode.code, alerts: [extra.code] }]));
  const restored = dashboardFixtures(fixtureCodes);
  expect(restored.cases.find(row => row.code === episode.code).linkedAlertCodes)
    .toEqual([...episode.linkedAlertCodes, extra.code]);
  const [removed, ...retained] = episode.linkedAlertCodes;
  const result = changePreviewEpisode({ cases: restored.cases, alertCodes: [removed], episodeCode: episode.code,
    reason: '별도 조사', unlink: true, user: previewAdmin });
  expect(result.ok).toBe(true);
  const updated = dashboardFixtures(fixtureCodes);
  expect(updated.cases.find(row => row.code === episode.code).linkedAlertCodes).toEqual([...retained, extra.code]);
  expect(updated.cases.find(row => row.code === removed)).toMatchObject({ open: true, status: '처리 중' });
});

it('uses USD for synthetic transactions and case totals', () => {
  const data = dashboardFixtureResponse(source);
  expect([...new Set(data.transactions.map(row => row.currency))]).toEqual(['USD']);
  expect(data.transactions.slice(0, 6).map(row => row.amount)).toEqual([420, 200, 300, 1680, 500, 600]);
  const caseWithEvidence = data.cases.find(row => row.code === 'A-261111-000018');
  expect(caseWithEvidence.amountByCurrency).toEqual({ USD: sum(caseWithEvidence.related, 'amount') });
});

it('uses the same ledger records for the Alert, its chronological cycle and dashboard coverage', () => {
  const ledger = new Map(source.transactions.map(row => [row.code, row]));
  const alert = source.cases.find(row => row.code === cyclicSankeySampleCode);
  expect(alert.pattern).toMatch(/^Cycle /);
  const transfers = alert.related;
  expect(transfers).toHaveLength(4);
  for (const [index, transfer] of transfers.entries()) {
    expect(transfer).toBe(ledger.get(transfer.code));
    expect(transfer.to.code).toBe(transfers[(index + 1) % transfers.length].from.code);
    if (index > 0) expect(transfer.timestamp > transfers[index - 1].timestamp).toBe(true);
  }
  expect(new Date(transfers.at(-1).timestamp.replace(' ', 'T') + ':00+09:00') < new Date(alert.createdAt)).toBe(true);
  expect(alert.amountByCurrency).toEqual({ USD: sum(transfers, 'amount') });
  const dashboard = dashboardFixtureResponse(source, { rows: [alert], population: [alert] });
  expect(new Set(dashboard.transactions.map(row => row.code))).toEqual(new Set(transfers.map(row => row.code)));
});

it('preserves true zero dates and scopes transactions to included case evidence when filtering', () => {
  const range = { from: new Date(2026, 10, 12), to: new Date(2026, 10, 12) };
  const scoped = dashboardFixtureResponse(source, { range });
  const dayInKst = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short' });
  const directCompletions = source.cases.filter(row => row.kind === 'Alert' && row.completedAt &&
    dayInKst.format(new Date(row.completedAt)) === '2026-11-12');
  expect(scoped.daily[0].completed).toBe(directCompletions.length);
  expect(directCompletions.some(row => !scoped.alertCases.includes(row))).toBe(true);
  const episodeCompletions = source.cases.filter(row => row.kind === 'Episode' && row.completedAt &&
    dayInKst.format(new Date(row.completedAt)) === '2026-11-12');
  expect(scoped.dailyCaseEvents.Episode).toEqual([{
    day: '2026-11-12', incoming: scoped.cases.filter(row => row.kind === 'Episode').length, completed: episodeCompletions.length,
  }]);
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
